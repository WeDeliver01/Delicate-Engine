import { Injectable } from "@nestjs/common";
import { and, asc, desc, eq, gte, inArray, lte } from "drizzle-orm";
import type {
  Driver,
  DriverPosition,
  FuelLog,
  FuelLogRequest,
  LatLng,
  LocationPing,
  Shift,
  OdometerReadingRequest,
  UpsertDriverRequest,
  UpsertVehicleRequest,
  Vehicle,
} from "@delicate/contracts";
import {
  driverLocationHistory,
  driverPositions,
  drivers,
  files,
  fuelLogs,
  shifts,
  users,
  vehicles,
  type DbExecutor,
} from "@delicate/db";
import { DbService } from "../../infra/db.module.js";
import { AuditService } from "../../infra/audit.service.js";
import { OutboxService } from "../../infra/outbox.service.js";
import { SettingsService } from "../../infra/settings.service.js";
import { AppError } from "../../common/errors.js";
import { requestContext } from "../../common/request-context.js";
import { toLocal } from "../scheduling/scheduling.service.js";
import { Clock } from "../../infra/clock.js";

const MAX_FILE_BYTES = 2 * 1024 * 1024;

@Injectable()
export class FleetService {
  constructor(
    private readonly dbs: DbService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly settings: SettingsService,
    private readonly clock: Clock,
  ) {}

  // ── drivers & vehicles (admin) ──────────────────────────────────────────────

  async listDrivers(): Promise<Driver[]> {
    const rows = await this.dbs.db.select().from(drivers).orderBy(asc(drivers.fullName));
    return rows.map(toDriver);
  }

  async getDriver(id: string, tx?: DbExecutor): Promise<Driver> {
    const row = await (tx ?? this.dbs.db).query.drivers.findFirst({ where: eq(drivers.id, id) });
    if (!row) throw AppError.notFound("driver");
    return toDriver(row);
  }

  /** The driver row for the signed-in user, linking by email on first contact. */
  async driverForUser(userId: string, email: string, tx?: DbExecutor): Promise<Driver | null> {
    const db = tx ?? this.dbs.db;
    const byUser = await db.query.drivers.findFirst({ where: eq(drivers.userId, userId) });
    if (byUser) return toDriver(byUser);
    const byEmail = await db.query.drivers.findFirst({
      where: and(eq(drivers.email, email.toLowerCase()), eq(drivers.status, "active")),
    });
    if (!byEmail || byEmail.userId) return null;
    const [linked] = await db
      .update(drivers)
      .set({ userId })
      .where(eq(drivers.id, byEmail.id))
      .returning();
    await db
      .update(users)
      .set({ platformRole: "driver" })
      .where(and(eq(users.id, userId)));
    return toDriver(linked!);
  }

  async upsertDriver(id: string | null, input: UpsertDriverRequest): Promise<Driver> {
    return this.dbs.transaction(async (tx) => {
      const before = id ? await tx.query.drivers.findFirst({ where: eq(drivers.id, id) }) : null;
      if (id && !before) throw AppError.notFound("driver");
      const values = { ...input, email: input.email.toLowerCase() };
      const [row] = id
        ? await tx.update(drivers).set(values).where(eq(drivers.id, id)).returning()
        : await tx.insert(drivers).values(values).returning();
      // If the person already signed in, link and promote them now.
      if (!row!.userId) {
        const user = await tx.query.users.findFirst({ where: eq(users.email, row!.email) });
        if (user) {
          await tx.update(drivers).set({ userId: user.id }).where(eq(drivers.id, row!.id));
          if (!user.platformRole)
            await tx.update(users).set({ platformRole: "driver" }).where(eq(users.id, user.id));
          row!.userId = user.id;
        }
      }
      await this.audit.record(tx, {
        action: id ? "driver.update" : "driver.create",
        entityType: "driver",
        entityId: row!.id,
        before,
        after: row,
      });
      return toDriver(row!);
    });
  }

  /**
   * Name the driver everything goes to, or stand the current one down.
   *
   * Two statements, one transaction: the database allows exactly one main driver, so naming
   * a second without clearing the first is a unique violation rather than a quiet overwrite.
   * Shipments already assigned stay where they are -- this changes what happens next, not
   * what was already decided.
   */
  async setMainDriver(driverId: string | null): Promise<Driver[]> {
    await this.dbs.transaction(async (tx) => {
      const before = await tx.query.drivers.findFirst({ where: eq(drivers.isMain, true) });
      if (before?.id === driverId) return;
      if (before) {
        await tx.update(drivers).set({ isMain: false }).where(eq(drivers.id, before.id));
      }
      if (driverId) {
        const driver = await tx.query.drivers.findFirst({
          where: and(eq(drivers.id, driverId), eq(drivers.status, "active")),
        });
        if (!driver) throw AppError.notFound("active driver");
        await tx.update(drivers).set({ isMain: true }).where(eq(drivers.id, driverId));
      }
      await this.audit.record(tx, {
        action: "driver.set_main",
        entityType: "driver",
        entityId: driverId ?? before?.id ?? "none",
        before: before ? { id: before.id, fullName: before.fullName } : null,
        after: { mainDriverId: driverId },
      });
    });
    return this.listDrivers();
  }

  async listVehicles(): Promise<Vehicle[]> {
    const rows = await this.dbs.db.select().from(vehicles).orderBy(asc(vehicles.registration));
    return rows.map(toVehicle);
  }

  async upsertVehicle(id: string | null, input: UpsertVehicleRequest): Promise<Vehicle> {
    return this.dbs.transaction(async (tx) => {
      const before = id ? await tx.query.vehicles.findFirst({ where: eq(vehicles.id, id) }) : null;
      if (id && !before) throw AppError.notFound("vehicle");
      const values = {
        ...input,
        registration: input.registration.toUpperCase().replace(/\s+/g, " "),
        litresPer100Km: input.litresPer100Km == null ? null : String(input.litresPer100Km),
      };
      const [row] = id
        ? await tx.update(vehicles).set(values).where(eq(vehicles.id, id)).returning()
        : await tx.insert(vehicles).values(values).returning();
      await this.audit.record(tx, {
        action: id ? "vehicle.update" : "vehicle.create",
        entityType: "vehicle",
        entityId: row!.id,
        before,
        after: row,
      });
      return toVehicle(row!);
    });
  }

  // ── shifts ──────────────────────────────────────────────────────────────────

  async scheduleShift(driverId: string, date: string, vehicleId: string | null): Promise<Shift> {
    return this.dbs.transaction(async (tx) => {
      const driver = await this.getDriver(driverId, tx);
      const [row] = await tx
        .insert(shifts)
        .values({ driverId, date, vehicleId: vehicleId ?? driver.vehicleId })
        .onConflictDoUpdate({
          target: [shifts.driverId, shifts.date],
          set: { vehicleId: vehicleId ?? driver.vehicleId },
        })
        .returning();
      await this.audit.record(tx, {
        action: "shift.schedule",
        entityType: "shift",
        entityId: row!.id,
        after: row,
      });
      return toShift(row!);
    });
  }

  async listShifts(from: string, to: string): Promise<Shift[]> {
    const rows = await this.dbs.db
      .select()
      .from(shifts)
      .where(and(gte(shifts.date, from), lte(shifts.date, to)))
      .orderBy(asc(shifts.date));
    return rows.map(toShift);
  }

  async shiftFor(driverId: string, date: string, tx?: DbExecutor) {
    return (tx ?? this.dbs.db).query.shifts.findFirst({
      where: and(eq(shifts.driverId, driverId), eq(shifts.date, date)),
    });
  }

  async localDate(): Promise<string> {
    const tz = await this.settings.get("company.timezone");
    return toLocal(this.clock.now(), tz).date;
  }

  /**
   * Record an odometer (and optionally fuel) reading against the driver's rostered shift.
   *
   * There is no clocking on. A driver is rostered by dispatch and their work appears; nothing
   * they do is gated on having pressed a button first, because a driver standing at a
   * collection with a van full of cake should not be told to go and find their odometer.
   *
   * The first reading of the day becomes the opening one and every later reading replaces the
   * closing one, so the pair still spans the day's running. A driver who logs once has an
   * opening reading and no closing one, which is the truth: we know where they started and not
   * where they stopped.
   *
   * Returns null when the driver is not rostered for today — there is no shift for the reading
   * to belong to, and inventing one would put a driver on the board that dispatch never put
   * there.
   */
  async recordOdometer(driver: Driver, input: OdometerReadingRequest): Promise<Shift | null> {
    const date = await this.localDate();
    return this.dbs.transaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(shifts)
        .where(and(eq(shifts.driverId, driver.id), eq(shifts.date, date)))
        .for("update");
      if (!row) return null;

      const opening = row.startOdometerKm == null;
      const [updated] = await tx
        .update(shifts)
        .set(
          opening
            ? {
                startOdometerKm: String(input.odometerKm),
                startFuelPct: input.fuelPct,
                startLocation: input.location,
              }
            : {
                endOdometerKm: String(input.odometerKm),
                endFuelPct: input.fuelPct,
                endLocation: input.location,
              },
        )
        .where(eq(shifts.id, row.id))
        .returning();

      if (input.location)
        await this.recordPosition(tx, driver.id, updated!.id, {
          location: input.location,
          accuracyM: null,
          speedKmh: null,
          recordedAt: new Date().toISOString(),
        });

      await this.outbox.emit(
        tx,
        opening ? "shift.started" : "shift.ended",
        opening
          ? { shiftId: updated!.id, driverId: driver.id, date, odometerKm: input.odometerKm }
          : {
              shiftId: updated!.id,
              driverId: driver.id,
              date,
              odometerKm: input.odometerKm,
              distanceKm:
                Math.round((input.odometerKm - Number(row.startOdometerKm ?? 0)) * 10) / 10,
            },
        // A driver may log a closing reading more than once in a day — after the last drop,
        // then again back at the depot. The key carries the reading so a corrected figure is a
        // new event rather than one silently swallowed as a duplicate.
        {
          dedupeKey: opening
            ? `shift:${updated!.id}:started`
            : `shift:${updated!.id}:ended:${input.odometerKm}`,
        },
      );
      return toShift(updated!);
    });
  }

  // ── positions ───────────────────────────────────────────────────────────────

  async recordPosition(
    tx: DbExecutor,
    driverId: string,
    shiftId: string | null,
    ping: LocationPing,
  ): Promise<void> {
    const recordedAt = new Date(ping.recordedAt);
    await tx
      .insert(driverPositions)
      .values({
        driverId,
        location: ping.location,
        accuracyM: ping.accuracyM == null ? null : String(ping.accuracyM),
        speedKmh: ping.speedKmh == null ? null : String(ping.speedKmh),
        recordedAt,
      })
      .onConflictDoUpdate({
        target: driverPositions.driverId,
        set: {
          location: ping.location,
          accuracyM: ping.accuracyM == null ? null : String(ping.accuracyM),
          speedKmh: ping.speedKmh == null ? null : String(ping.speedKmh),
          recordedAt,
        },
      });
    await tx.insert(driverLocationHistory).values({
      driverId,
      shiftId,
      location: ping.location,
      accuracyM: ping.accuracyM == null ? null : String(ping.accuracyM),
      speedKmh: ping.speedKmh == null ? null : String(ping.speedKmh),
      recordedAt,
    });
  }

  /**
   * Record a batch of positions, and let the first of the day open the roster row.
   *
   * Drivers do not clock on, so nothing else can say when a day's work actually began. The
   * first position the app reports is the honest answer — the van is moving — and it is one
   * nobody has to remember to give. Without it `startedAt` would never be set and the live
   * board's "on the road since" would be permanently blank.
   */
  async ping(driver: Driver, pings: LocationPing[]): Promise<void> {
    const date = await this.localDate();
    await this.dbs.transaction(async (tx) => {
      const shift = await this.shiftFor(driver.id, date, tx);
      // Keep the newest as the live position; store all for the trail.
      const sorted = [...pings].sort((a, b) => a.recordedAt.localeCompare(b.recordedAt));
      const first = sorted[0];
      if (shift && shift.status === "scheduled" && first) {
        await tx
          .update(shifts)
          .set({ status: "open", startedAt: new Date(first.recordedAt) })
          .where(and(eq(shifts.id, shift.id), eq(shifts.status, "scheduled")));
        shift.status = "open";
      }
      for (const p of sorted)
        await this.recordPosition(tx, driver.id, shift?.status === "open" ? shift.id : null, p);
    });
  }

  async positions(): Promise<DriverPosition[]> {
    const date = await this.localDate();
    const rows = await this.dbs.db
      .select({
        driverId: driverPositions.driverId,
        location: driverPositions.location,
        recordedAt: driverPositions.recordedAt,
        shiftStatus: shifts.status,
      })
      .from(driverPositions)
      .leftJoin(shifts, and(eq(shifts.driverId, driverPositions.driverId), eq(shifts.date, date)))
      .orderBy(desc(driverPositions.recordedAt));
    return rows.map((r) => ({
      driverId: r.driverId,
      location: r.location as LatLng,
      recordedAt: r.recordedAt.toISOString(),
      // Rostered for today and not stood down. It cannot mean "has an open shift" any more:
      // nothing opens one, because drivers no longer clock on.
      onShift: r.shiftStatus != null && r.shiftStatus !== "closed",
    }));
  }

  /** Distance along the recorded trail between two instants (km). Null when no trail. */
  async trailDistanceKm(driverId: string, from: Date, to: Date): Promise<number | null> {
    const rows = await this.dbs.db
      .select({ location: driverLocationHistory.location })
      .from(driverLocationHistory)
      .where(
        and(
          eq(driverLocationHistory.driverId, driverId),
          gte(driverLocationHistory.recordedAt, from),
          lte(driverLocationHistory.recordedAt, to),
        ),
      )
      .orderBy(asc(driverLocationHistory.recordedAt));
    if (rows.length < 2) return null;
    const { haversineKm } = await import("@delicate/contracts");
    let km = 0;
    for (let i = 1; i < rows.length; i++)
      km += haversineKm(rows[i - 1]!.location as LatLng, rows[i]!.location as LatLng);
    return Math.round(km * 100) / 100;
  }

  // ── fuel & files ────────────────────────────────────────────────────────────

  async storeDataUrl(tx: DbExecutor, kind: string, dataUrl: string): Promise<string> {
    const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
    if (!m)
      throw AppError.validation([
        { path: [kind], message: "must be a base64 data URL of a JPEG, PNG or WebP image" },
      ]);
    const bytes = Buffer.from(m[2]!, "base64");
    if (bytes.length > MAX_FILE_BYTES)
      throw AppError.validation([{ path: [kind], message: "image must be 2 MB or smaller" }]);
    const [row] = await tx
      .insert(files)
      .values({
        kind,
        mime: m[1]!,
        bytes,
        sizeBytes: bytes.length,
        uploadedByUserId: requestContext.get()?.userId ?? null,
      })
      .returning({ id: files.id });
    return row!.id;
  }

  async getFile(id: string): Promise<{ mime: string; bytes: Buffer }> {
    const row = await this.dbs.db.query.files.findFirst({ where: eq(files.id, id) });
    if (!row) throw AppError.notFound("file");
    return { mime: row.mime, bytes: row.bytes };
  }

  async logFuel(driver: Driver, input: FuelLogRequest): Promise<FuelLog> {
    const date = await this.localDate();
    return this.dbs.transaction(async (tx) => {
      const shift = await this.shiftFor(driver.id, date, tx);
      const receiptFileId = input.receiptDataUrl
        ? await this.storeDataUrl(tx, "fuel_receipt", input.receiptDataUrl)
        : null;
      const [row] = await tx
        .insert(fuelLogs)
        .values({
          driverId: driver.id,
          shiftId: shift?.id ?? null,
          litres: String(input.litres),
          amountCents: input.amountCents,
          odometerKm: input.odometerKm == null ? null : String(input.odometerKm),
          station: input.station,
          receiptFileId,
        })
        .returning();
      await this.outbox.emit(
        tx,
        "fuel.logged",
        {
          fuelLogId: row!.id,
          driverId: driver.id,
          litres: input.litres,
          amountCents: input.amountCents,
        },
        { dedupeKey: `fuel:${row!.id}` },
      );
      return toFuelLog(row!);
    });
  }

  async fuelLogs(driverId: string | null, limit: number): Promise<FuelLog[]> {
    const rows = await this.dbs.db
      .select()
      .from(fuelLogs)
      .where(driverId ? eq(fuelLogs.driverId, driverId) : undefined)
      .orderBy(desc(fuelLogs.createdAt))
      .limit(limit);
    return rows.map(toFuelLog);
  }

  async driversByIds(ids: string[]): Promise<Map<string, Driver>> {
    if (ids.length === 0) return new Map();
    const rows = await this.dbs.db.select().from(drivers).where(inArray(drivers.id, ids));
    return new Map(rows.map((r) => [r.id, toDriver(r)]));
  }
}

export function toDriver(r: typeof drivers.$inferSelect): Driver {
  return {
    id: r.id,
    userId: r.userId,
    email: r.email,
    fullName: r.fullName,
    phone: r.phone,
    status: r.status,
    vehicleId: r.vehicleId,
    fuelCardRef: r.fuelCardRef,
    dailyStopCapacity: r.dailyStopCapacity,
    homeBase: r.homeBase as LatLng | null,
    isMain: r.isMain,
    createdAt: r.createdAt.toISOString(),
  };
}
export function toVehicle(r: typeof vehicles.$inferSelect): Vehicle {
  return {
    id: r.id,
    registration: r.registration,
    make: r.make,
    model: r.model,
    fuelType: r.fuelType,
    litresPer100Km: r.litresPer100Km == null ? null : Number(r.litresPer100Km),
    constraints: (r.constraints as Vehicle["constraints"]) ?? null,
    active: r.active,
  };
}
export function toShift(r: typeof shifts.$inferSelect): Shift {
  return {
    id: r.id,
    driverId: r.driverId,
    date: r.date,
    status: r.status,
    vehicleId: r.vehicleId,
    startedAt: r.startedAt?.toISOString() ?? null,
    endedAt: r.endedAt?.toISOString() ?? null,
    startOdometerKm: r.startOdometerKm == null ? null : Number(r.startOdometerKm),
    endOdometerKm: r.endOdometerKm == null ? null : Number(r.endOdometerKm),
    startFuelPct: r.startFuelPct,
    endFuelPct: r.endFuelPct,
  };
}
export function toFuelLog(r: typeof fuelLogs.$inferSelect): FuelLog {
  return {
    id: r.id,
    driverId: r.driverId,
    shiftId: r.shiftId,
    litres: Number(r.litres),
    amountCents: r.amountCents,
    odometerKm: r.odometerKm == null ? null : Number(r.odometerKm),
    station: r.station,
    hasReceipt: !!r.receiptFileId,
    createdAt: r.createdAt.toISOString(),
  };
}
