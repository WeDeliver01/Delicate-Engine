import { Injectable } from "@nestjs/common";
import { and, asc, desc, eq, gte, inArray, lte } from "drizzle-orm";
import type {
  Driver,
  DriverPosition,
  EndShiftRequest,
  FuelLog,
  FuelLogRequest,
  LatLng,
  LocationPing,
  Shift,
  StartShiftRequest,
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

  async startShift(driver: Driver, input: StartShiftRequest): Promise<Shift> {
    const date = await this.localDate();
    return this.dbs.transaction(async (tx) => {
      await tx
        .insert(shifts)
        .values({ driverId: driver.id, date, vehicleId: input.vehicleId ?? driver.vehicleId })
        .onConflictDoNothing();
      const [row] = await tx
        .select()
        .from(shifts)
        .where(and(eq(shifts.driverId, driver.id), eq(shifts.date, date)))
        .for("update");
      if (row!.status === "open") return toShift(row!);
      if (row!.status === "closed")
        throw AppError.conflict("shift_closed", "today's shift has already been closed");
      const [updated] = await tx
        .update(shifts)
        .set({
          status: "open",
          startedAt: new Date(),
          startOdometerKm: String(input.odometerKm),
          startFuelPct: input.fuelPct,
          startLocation: input.location,
          vehicleId: input.vehicleId ?? row!.vehicleId,
        })
        .where(eq(shifts.id, row!.id))
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
        "shift.started",
        { shiftId: updated!.id, driverId: driver.id, date, odometerKm: input.odometerKm },
        { dedupeKey: `shift:${updated!.id}:started` },
      );
      return toShift(updated!);
    });
  }

  async endShift(driver: Driver, input: EndShiftRequest): Promise<Shift> {
    const date = await this.localDate();
    return this.dbs.transaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(shifts)
        .where(and(eq(shifts.driverId, driver.id), eq(shifts.date, date)))
        .for("update");
      if (!row || row.status !== "open")
        throw AppError.conflict("shift_not_open", "no open shift to end");
      const start = Number(row.startOdometerKm ?? 0);
      if (input.odometerKm < start)
        throw AppError.validation([
          { path: ["odometerKm"], message: `cannot be below the start reading (${start})` },
        ]);
      const [updated] = await tx
        .update(shifts)
        .set({
          status: "closed",
          endedAt: new Date(),
          endOdometerKm: String(input.odometerKm),
          endFuelPct: input.fuelPct,
          endLocation: input.location,
        })
        .where(eq(shifts.id, row.id))
        .returning();
      await this.outbox.emit(
        tx,
        "shift.ended",
        {
          shiftId: row.id,
          driverId: driver.id,
          date,
          odometerKm: input.odometerKm,
          distanceKm: Math.round((input.odometerKm - start) * 10) / 10,
        },
        { dedupeKey: `shift:${row.id}:ended` },
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

  async ping(driver: Driver, pings: LocationPing[]): Promise<void> {
    const date = await this.localDate();
    await this.dbs.transaction(async (tx) => {
      const shift = await this.shiftFor(driver.id, date, tx);
      // Keep the newest as the live position; store all for the trail.
      const sorted = [...pings].sort((a, b) => a.recordedAt.localeCompare(b.recordedAt));
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
      onShift: r.shiftStatus === "open",
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
