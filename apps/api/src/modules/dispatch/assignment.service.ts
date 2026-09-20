import { Inject, Injectable } from "@nestjs/common";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { PinoLogger } from "nestjs-pino";
import { haversineKm, type Assignment, type LatLng, type Shipment } from "@delicate/contracts";
import {
  assignments,
  bookings,
  driverPositions,
  drivers,
  settlementForecasts,
  shifts,
  shipmentEvents,
  shipments,
  type DbExecutor,
} from "@delicate/db";
import { DbService } from "../../infra/db.module.js";
import { AuditService } from "../../infra/audit.service.js";
import { OutboxService } from "../../infra/outbox.service.js";
import { SettingsService } from "../../infra/settings.service.js";
import { GEO_PROVIDER, type GeoProvider } from "../../infra/geo/geo.provider.js";
import { AppError } from "../../common/errors.js";
import { requestContext } from "../../common/request-context.js";
import { toLocal } from "../scheduling/scheduling.service.js";
import { Clock } from "../../infra/clock.js";
import { toShipment } from "../bookings/booking.service.js";

interface Candidate {
  driverId: string;
  name: string;
  score: number;
  load: number;
  capacity: number;
  distanceKm: number;
}

/**
 * Assignment engine. Auto-assign runs when a booking is confirmed (outbox handler) and picks
 * the best available driver; a dispatcher can override at any time before collection.
 * Candidates need a shift on the delivery date (any shift for today when on-demand) and
 * spare capacity; score = distance to the collection point + a load penalty.
 * The engine recommends and assigns work — it never moves money (invariant #7).
 */
@Injectable()
export class AssignmentService {
  constructor(
    private readonly dbs: DbService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly settings: SettingsService,
    @Inject(GEO_PROVIDER) private readonly geo: GeoProvider,
    private readonly clock: Clock,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(AssignmentService.name);
  }

  async candidates(shipmentId: string, tx?: DbExecutor): Promise<Candidate[]> {
    const db = tx ?? this.dbs.db;
    const s = await db.query.shipments.findFirst({ where: eq(shipments.id, shipmentId) });
    if (!s) throw AppError.notFound("shipment");
    const booking = await db.query.bookings.findFirst({ where: eq(bookings.id, s.bookingId) });
    const collection = (booking!.collection as { address: { location: LatLng } }).address.location;
    const tz = await this.settings.get("company.timezone");
    const date = s.slotDate ?? toLocal(this.clock.now(), tz).date;
    const depot = (await this.settings.get("company.depot_address")).location;

    const rows = await db
      .select({
        id: drivers.id,
        name: drivers.fullName,
        capacity: drivers.dailyStopCapacity,
        homeBase: drivers.homeBase,
        shiftStatus: shifts.status,
        position: driverPositions.location,
        positionAt: driverPositions.recordedAt,
      })
      .from(drivers)
      .innerJoin(shifts, and(eq(shifts.driverId, drivers.id), eq(shifts.date, date)))
      .leftJoin(driverPositions, eq(driverPositions.driverId, drivers.id))
      .where(and(eq(drivers.status, "active"), inArray(shifts.status, ["scheduled", "open"])));
    if (rows.length === 0) return [];

    const loads = await db
      .select({ driverId: assignments.driverId, count: sql<number>`count(*)::int` })
      .from(assignments)
      .innerJoin(shipments, eq(shipments.id, assignments.shipmentId))
      .where(
        and(
          eq(assignments.active, true),
          inArray(
            assignments.driverId,
            rows.map((r) => r.id),
          ),
          s.slotDate ? eq(shipments.slotDate, s.slotDate) : isNull(shipments.slotDate),
        ),
      )
      .groupBy(assignments.driverId);
    const loadBy = new Map(loads.map((l) => [l.driverId, l.count]));

    const fresh = Date.now() - 30 * 60_000;
    return rows
      .map((r) => {
        const load = loadBy.get(r.id) ?? 0;
        const usePosition =
          r.position && r.positionAt && r.positionAt.getTime() > fresh && r.shiftStatus === "open";
        const from = (
          usePosition ? (r.position as LatLng) : ((r.homeBase as LatLng | null) ?? depot)
        ) as LatLng;
        const distanceKm = Math.round(haversineKm(from, collection) * 10) / 10;
        return {
          driverId: r.id,
          name: r.name,
          capacity: r.capacity,
          load,
          distanceKm,
          score: distanceKm + load * 2,
        };
      })
      .filter((c) => c.load < c.capacity)
      .sort((a, b) => a.score - b.score);
  }

  /** Called by the worker for each shipment of a confirmed booking. Idempotent. */
  async autoAssign(shipmentId: string): Promise<Assignment | null> {
    return this.dbs.transaction(async (tx) => {
      const existing = await tx.query.assignments.findFirst({
        where: and(eq(assignments.shipmentId, shipmentId), eq(assignments.active, true)),
      });
      if (existing) return toAssignment(existing);
      const [best] = await this.candidates(shipmentId, tx);
      if (!best) {
        this.logger.warn({ shipmentId }, "no driver available; left for dispatcher");
        return null;
      }
      return this.assign(
        tx,
        shipmentId,
        best.driverId,
        "auto",
        `auto: ${best.distanceKm} km, load ${best.load}/${best.capacity}`,
      );
    });
  }

  async assign(
    tx: DbExecutor,
    shipmentId: string,
    driverId: string,
    source: "auto" | "dispatcher",
    note: string | null,
  ): Promise<Assignment> {
    const [s] = await tx.select().from(shipments).where(eq(shipments.id, shipmentId)).for("update");
    if (!s) throw AppError.notFound("shipment");
    if (!["booked", "assigned", "failed"].includes(s.status)) {
      throw AppError.conflict("shipment_not_assignable", `shipment is ${s.status}`);
    }
    const driver = await tx.query.drivers.findFirst({
      where: and(eq(drivers.id, driverId), eq(drivers.status, "active")),
    });
    if (!driver) throw AppError.notFound("active driver");

    const current = await tx.query.assignments.findFirst({
      where: and(eq(assignments.shipmentId, shipmentId), eq(assignments.active, true)),
    });
    if (current?.driverId === driverId) return toAssignment(current);
    if (current) {
      await tx
        .update(assignments)
        .set({
          active: false,
          endedAt: new Date(),
          endedReason: `reassigned to ${driver.fullName}`,
        })
        .where(eq(assignments.id, current.id));
    }

    const plannedKm = await this.plannedKm(
      s.bookingId,
      s.deliveryAddress as { location: LatLng },
      tx,
    );
    const [row] = await tx
      .insert(assignments)
      .values({ shipmentId, driverId, source, plannedKm: String(plannedKm), note })
      .returning();

    if (s.status !== "assigned") {
      await tx.update(shipments).set({ status: "assigned" }).where(eq(shipments.id, shipmentId));
      await tx
        .insert(shipmentEvents)
        .values({
          shipmentId,
          status: "assigned",
          note: `Driver ${driver.fullName}`,
          actorUserId: requestContext.get()?.userId ?? null,
        });
    }
    await this.writeForecast(tx, s, row!, plannedKm);
    await this.audit.record(tx, {
      action: "shipment.assign",
      entityType: "shipment",
      entityId: shipmentId,
      before: current,
      after: row,
    });
    await this.outbox.emit(
      tx,
      "shipment.assigned",
      {
        shipmentId,
        bookingId: s.bookingId,
        accountId: s.accountId,
        waybill: s.waybill,
        driverId,
        previousDriverId: current?.driverId ?? null,
        source,
        plannedKm,
      },
      { dedupeKey: `assignment:${row!.id}` },
    );
    return toAssignment(row!);
  }

  async unassign(tx: DbExecutor, shipmentId: string, reason: string): Promise<void> {
    const current = await tx.query.assignments.findFirst({
      where: and(eq(assignments.shipmentId, shipmentId), eq(assignments.active, true)),
    });
    if (!current) return;
    const s = await tx.query.shipments.findFirst({ where: eq(shipments.id, shipmentId) });
    await tx
      .update(assignments)
      .set({ active: false, endedAt: new Date(), endedReason: reason })
      .where(eq(assignments.id, current.id));
    if (s?.status === "assigned") {
      await tx.update(shipments).set({ status: "booked" }).where(eq(shipments.id, shipmentId));
      await tx
        .insert(shipmentEvents)
        .values({
          shipmentId,
          status: "booked",
          note: `Unassigned: ${reason}`,
          actorUserId: requestContext.get()?.userId ?? null,
        });
    }
    await this.outbox.emit(
      tx,
      "shipment.unassigned",
      { shipmentId, waybill: s!.waybill, driverId: current.driverId, reason },
      { dedupeKey: `assignment:${current.id}:ended` },
    );
  }

  async activeAssignment(shipmentId: string, tx?: DbExecutor) {
    return (tx ?? this.dbs.db).query.assignments.findFirst({
      where: and(eq(assignments.shipmentId, shipmentId), eq(assignments.active, true)),
    });
  }

  /** Shipments booked with no driver — the dispatcher's to-do list. */
  async unassigned(): Promise<Shipment[]> {
    const rows = await this.dbs.db
      .select({ s: shipments })
      .from(shipments)
      .leftJoin(
        assignments,
        and(eq(assignments.shipmentId, shipments.id), eq(assignments.active, true)),
      )
      .where(and(eq(shipments.status, "booked"), isNull(assignments.id)))
      .orderBy(asc(shipments.slotDate), asc(shipments.createdAt));
    return rows.map((r) => toShipment(r.s));
  }

  /** depot → collection → drop, for this one shipment. */
  private async plannedKm(
    bookingId: string,
    delivery: { location: LatLng },
    tx: DbExecutor,
  ): Promise<number> {
    const booking = await tx.query.bookings.findFirst({ where: eq(bookings.id, bookingId) });
    const collection = (booking!.collection as { address: { location: LatLng } }).address.location;
    const depot = (await this.settings.get("company.depot_address")).location;
    const legs = await this.geo.routeLegsKm([depot, collection, delivery.location]);
    return Math.round(legs.reduce((a, b) => a + b, 0) * 100) / 100;
  }

  private async writeForecast(
    tx: DbExecutor,
    s: typeof shipments.$inferSelect,
    a: typeof assignments.$inferSelect,
    plannedKm: number,
  ): Promise<void> {
    const rules = await this.settings.get("settlement.rules");
    const booking = await tx.query.bookings.findFirst({ where: eq(bookings.id, s.bookingId) });
    const breakdown = booking!.breakdown as { subtotalCents: number };
    const dropCount = await tx.$count(
      shipments,
      and(eq(shipments.bookingId, s.bookingId), sql`${shipments.status} <> 'cancelled'`),
    );
    const revenueCents = Math.round(breakdown.subtotalCents / Math.max(1, dropCount));
    const fuelCostCents = Math.round(plannedKm * rules.fuelCostPerKmCents);
    const driverEarningCents =
      rules.driverEarningPerDropCents + Math.round(plannedKm * rules.driverEarningPerKmCents);
    await tx
      .insert(settlementForecasts)
      .values({
        shipmentId: s.id,
        assignmentId: a.id,
        plannedKm: String(plannedKm),
        revenueCents,
        fuelCostCents,
        driverEarningCents,
        marginCents: revenueCents - fuelCostCents - driverEarningCents,
      });
  }
}

export function toAssignment(r: typeof assignments.$inferSelect): Assignment {
  return {
    id: r.id,
    shipmentId: r.shipmentId,
    driverId: r.driverId,
    source: r.source,
    plannedKm: Number(r.plannedKm),
    active: r.active,
    createdAt: r.createdAt.toISOString(),
  };
}
