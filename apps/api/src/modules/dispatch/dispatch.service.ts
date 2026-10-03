import { Injectable } from "@nestjs/common";
import { and, asc, eq, inArray, isNotNull } from "drizzle-orm";
import {
  SHIPMENT_TRANSITIONS,
  type DeliverRequest,
  Driver,
  DriverDay,
  DriverStop,
  FailRequest,
  ProofOfDelivery,
  Shipment,
  ShipmentStatus,
  TripSheet,
} from "@delicate/contracts";
import { optimiseRoute } from "@delicate/contracts";
import {
  assignments,
  bookings,
  proofsOfDelivery,
  shipmentChangeRequests,
  shipmentEvents,
  shipments,
  type DbExecutor,
} from "@delicate/db";
import { DbService } from "../../infra/db.module.js";
import { AuditService } from "../../infra/audit.service.js";
import { SettingsService } from "../../infra/settings.service.js";
import { TripPlanRegistry } from "../../infra/trip-plan.registry.js";
import { OutboxService } from "../../infra/outbox.service.js";
import { AppError } from "../../common/errors.js";
import { requestContext } from "../../common/request-context.js";
import { FleetService } from "../fleet/fleet.service.js";
import { AssignmentService } from "./assignment.service.js";
import { SettlementService } from "./settlement.service.js";
import { BookingService, toShipment } from "../bookings/booking.service.js";

/**
 * The driver-facing workflow. Every action is a transaction that changes the shipment state,
 * appends an event, stores evidence and — on delivery/failure — settles the money.
 */
@Injectable()
export class DispatchService {
  constructor(
    private readonly dbs: DbService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly fleet: FleetService,
    private readonly assignment: AssignmentService,
    private readonly settlement: SettlementService,
    private readonly bookingsSvc: BookingService,
    private readonly settings: SettingsService,
    private readonly plans: TripPlanRegistry,
  ) {}

  /** Today's work for a driver: one collection stop per booking, then one drop per shipment. */
  async day(driver: Driver): Promise<DriverDay> {
    const date = await this.fleet.localDate();
    const shift = await this.fleet.shiftFor(driver.id, date);
    const rows = await this.dbs.db
      .select({ s: shipments, b: bookings })
      .from(assignments)
      .innerJoin(shipments, eq(shipments.id, assignments.shipmentId))
      .innerJoin(bookings, eq(bookings.id, shipments.bookingId))
      .where(
        and(
          eq(assignments.driverId, driver.id),
          eq(assignments.active, true),
          inArray(shipments.status, ["assigned", "collected", "in_transit", "failed"]),
        ),
      )
      .orderBy(asc(bookings.slotDate), asc(bookings.createdAt), asc(shipments.sequence));

    const byBooking = new Map<
      string,
      { b: typeof bookings.$inferSelect; ships: (typeof shipments.$inferSelect)[] }
    >();
    for (const r of rows) {
      const g = byBooking.get(r.b.id) ?? { b: r.b, ships: [] };
      g.ships.push(r.s);
      byBooking.set(r.b.id, g);
    }

    /**
     * Changes applied to these shipments after the driver was assigned to them.
     *
     * The day list refreshes every minute, so the driver's app already holds the new address —
     * but a driver who read the address at the depot is driving to the old one from memory.
     * This is what lets the app say so.
     */
    const changedByShipment = new Map<string, { what: string[]; at: Date }>();
    const shipmentIds = rows.map((r) => r.s.id);
    if (shipmentIds.length) {
      const applied = await this.dbs.db
        .select({
          shipmentId: shipmentChangeRequests.shipmentId,
          kind: shipmentChangeRequests.kind,
          decidedAt: shipmentChangeRequests.decidedAt,
          assignedAt: assignments.createdAt,
        })
        .from(shipmentChangeRequests)
        .innerJoin(
          assignments,
          and(
            eq(assignments.shipmentId, shipmentChangeRequests.shipmentId),
            eq(assignments.active, true),
          ),
        )
        .where(
          and(
            inArray(shipmentChangeRequests.shipmentId, shipmentIds),
            inArray(shipmentChangeRequests.status, ["approved", "auto_applied"]),
            isNotNull(shipmentChangeRequests.decidedAt),
          ),
        );

      for (const row of applied) {
        // Only what changed after this driver picked it up. A correction made the day before
        // they were assigned is just what the job is.
        if (!row.decidedAt || row.decidedAt <= row.assignedAt) continue;
        const existing = changedByShipment.get(row.shipmentId) ?? { what: [], at: row.decidedAt };
        // An unknown kind means a kind added without a word for it; the driver gets the raw
        // name rather than nothing, which is ugly but never silently hides a change.
        const word = CHANGE_WORDS[row.kind] ?? row.kind.replace(/_/g, " ");
        if (!existing.what.includes(word)) existing.what.push(word);
        if (row.decidedAt > existing.at) existing.at = row.decidedAt;
        changedByShipment.set(row.shipmentId, existing);
      }
    }

    const stops: DriverStop[] = [];
    for (const { b, ships } of byBooking.values()) {
      const collection = b.collection as {
        address: DriverStop["address"];
        contact: DriverStop["contact"];
        instructions: string | null;
      };
      const summary = ships.map((s) => ({
        shipmentId: s.id,
        waybill: s.waybill,
        status: s.status,
      }));
      if (ships.some((s) => s.status === "assigned")) {
        stops.push({
          kind: "collection",
          bookingId: b.id,
          bookingReference: b.reference,
          shipmentId: null,
          waybill: null,
          status: null,
          address: collection.address,
          contact: collection.contact,
          instructions: collection.instructions,
          parcels: ships.flatMap((s) => s.parcels as DriverStop["parcels"]),
          slotDate: b.slotDate,
          slotWindowKey: b.slotWindowKey,
          serviceLevelCode: b.serviceLevelCode,
          shipments: summary,
          // A collection stop covers every shipment on the booking, so it is flagged if any
          // of them changed — the driver is loading all of them into the van at once.
          changed: toChangedFlag(
            ships
              .map((s) => changedByShipment.get(s.id))
              .filter((c): c is { what: string[]; at: Date } => !!c)
              .reduce<{ what: string[]; at: Date } | undefined>((acc, c) => {
                if (!acc) return { what: [...c.what], at: c.at };
                for (const w of c.what) if (!acc.what.includes(w)) acc.what.push(w);
                return { what: acc.what, at: c.at > acc.at ? c.at : acc.at };
              }, undefined),
          ),
        });
      }
      for (const s of ships) {
        stops.push({
          kind: "drop",
          bookingId: b.id,
          bookingReference: b.reference,
          shipmentId: s.id,
          waybill: s.waybill,
          status: s.status,
          address: s.deliveryAddress as DriverStop["address"],
          contact: s.recipient as DriverStop["contact"],
          instructions: s.instructions,
          parcels: s.parcels as DriverStop["parcels"],
          slotDate: s.slotDate,
          slotWindowKey: s.slotWindowKey,
          serviceLevelCode: s.serviceLevelCode,
          shipments: summary,
          changed: toChangedFlag(changedByShipment.get(s.id)),
        });
      }
    }
    // Put the day in a sensible order. A released trip is a dispatcher's decision about that
    // order, so it wins; without one, the stops arrive in the order the bookings happened to be
    // made, which has nothing to do with geography, and we order them ourselves.
    const plan = await this.plans.forDriver(driver.id, date);
    const ordered = plan ? orderByPlan(stops, plan) : await this.orderStops(stops);

    return {
      date,
      shift: shift
        ? { id: shift.id, status: shift.status, startedAt: shift.startedAt?.toISOString() ?? null }
        : null,
      stops: ordered.stops,
      route: ordered.route,
    };
  }

  /**
   * Sequence a driver's stops from the depot and back. Stops with no coordinates are left in
   * their original position rather than being guessed at — an address we could not place is a
   * data problem to fix, not one to paper over by inventing a location.
   */
  private async orderStops(
    stops: DriverStop[],
  ): Promise<{ stops: DriverStop[]; route: DriverDay["route"] }> {
    if (stops.length < 2) return { stops, route: null };
    const depot = await this.settings.get("company.depot_address");

    const placed = stops.filter((s) => s.address?.location);
    if (placed.length < 2) return { stops, route: null };

    const result = optimiseRoute({
      depot: depot.location,
      // A drop waits for its own booking's collection, when that collection is still on the run.
      stops: placed.map((s) => ({
        id: stopKey(s),
        location: s.address.location,
        afterStopId: s.kind === "drop" ? `collect:${s.bookingId}` : null,
      })),
      roadFactorBps: 13_000,
    });

    const position = new Map(result.order.map((id, i) => [id, i]));
    const sorted = [...stops].sort((a, b) => {
      const pa = position.get(stopKey(a));
      const pb = position.get(stopKey(b));
      if (pa === undefined || pb === undefined) return 0;
      return pa - pb;
    });
    return {
      stops: sorted,
      route: {
        totalKm: result.totalKm,
        originalKm: result.originalKm,
        savedKm: result.savedKm,
      },
    };
  }

  /** Collect every assigned shipment of a booking in one go (they are picked up together). */
  async collect(
    driver: Driver,
    bookingId: string,
    location: { lat: number; lng: number } | null,
    note: string | null,
  ): Promise<Shipment[]> {
    await this.requireOpenShift(driver);
    return this.dbs.transaction(async (tx) => {
      const rows = await tx
        .select({ s: shipments })
        .from(assignments)
        .innerJoin(shipments, eq(shipments.id, assignments.shipmentId))
        .where(
          and(
            eq(assignments.driverId, driver.id),
            eq(assignments.active, true),
            eq(shipments.bookingId, bookingId),
            eq(shipments.status, "assigned"),
          ),
        )
        .for("update", { of: shipments });
      if (rows.length === 0)
        throw AppError.conflict("nothing_to_collect", "no assigned shipments for this booking");
      const ids: string[] = [];
      for (const { s } of rows) {
        await this.transition(tx, s, "collected", note ?? "Collected", { location });
        ids.push(s.id);
      }
      await this.outbox.emit(
        tx,
        "collection.completed",
        { bookingId, driverId: driver.id, shipmentIds: ids },
        { dedupeKey: `collection:${bookingId}:${driver.id}:${Date.now()}` },
      );
      return rows.map((r) => toShipment({ ...r.s, status: "collected" }));
    });
  }

  async deliver(
    driver: Driver,
    input: DeliverRequest,
  ): Promise<{ shipment: Shipment; pod: ProofOfDelivery }> {
    const shift = await this.requireOpenShift(driver);
    if (!input.signatureDataUrl && !input.photoDataUrl) {
      throw AppError.validation([
        {
          path: ["photoDataUrl"],
          message: "a signature or a photo is required as proof of delivery",
        },
      ]);
    }
    return this.dbs.transaction(async (tx) => {
      const { s, a } = await this.ownedShipment(tx, driver, input.shipmentId, [
        "collected",
        "in_transit",
      ]);
      const signatureFileId = input.signatureDataUrl
        ? await this.fleet.storeDataUrl(tx, "pod_signature", input.signatureDataUrl)
        : null;
      const photoFileId = input.photoDataUrl
        ? await this.fleet.storeDataUrl(tx, "pod_photo", input.photoDataUrl)
        : null;
      const [pod] = await tx
        .insert(proofsOfDelivery)
        .values({
          shipmentId: s.id,
          driverId: driver.id,
          receivedBy: input.receivedBy,
          signatureFileId,
          photoFileId,
          location: input.location,
          note: input.note,
        })
        .returning();

      await this.transition(tx, s, "delivered", `Delivered to ${input.receivedBy}`, {
        location: input.location,
        deliveredAt: new Date(),
      });

      const plannedKm = Number(a.plannedKm);
      const actualKm = input.actualKm ?? (await this.measuredKm(driver.id, s.id, plannedKm));
      await this.outbox.emit(
        tx,
        "delivery.completed",
        {
          shipmentId: s.id,
          bookingId: s.bookingId,
          accountId: s.accountId,
          waybill: s.waybill,
          driverId: driver.id,
          actualKm,
          plannedKm,
          receivedBy: input.receivedBy,
        },
        { dedupeKey: `delivery:${s.id}` },
      );
      await this.settlement.settle(tx, {
        shipmentId: s.id,
        driverId: driver.id,
        shiftId: shift.id,
        actualKm,
        plannedKm,
        outcome: "delivered",
      });
      const fresh = await tx.query.shipments.findFirst({ where: eq(shipments.id, s.id) });
      return { shipment: toShipment(fresh!), pod: toPod(pod!) };
    });
  }

  async fail(driver: Driver, input: FailRequest): Promise<Shipment> {
    const shift = await this.requireOpenShift(driver);
    return this.dbs.transaction(async (tx) => {
      const { s, a } = await this.ownedShipment(tx, driver, input.shipmentId, [
        "collected",
        "in_transit",
      ]);
      const photoFileId = input.photoDataUrl
        ? await this.fleet.storeDataUrl(tx, "fail_photo", input.photoDataUrl)
        : null;
      await this.transition(
        tx,
        s,
        "failed",
        `${input.reason}${input.note ? `: ${input.note}` : ""}`,
        { location: input.location, photoFileId },
      );
      const plannedKm = Number(a.plannedKm);
      const actualKm = await this.measuredKm(driver.id, s.id, plannedKm);
      await this.outbox.emit(
        tx,
        "delivery.failed",
        {
          shipmentId: s.id,
          bookingId: s.bookingId,
          waybill: s.waybill,
          driverId: driver.id,
          reason: input.reason,
        },
        { dedupeKey: `delivery:${s.id}:failed:${Date.now()}` },
      );
      await this.settlement.settle(tx, {
        shipmentId: s.id,
        driverId: driver.id,
        shiftId: shift.id,
        actualKm,
        plannedKm,
        outcome: "failed",
      });
      const fresh = await tx.query.shipments.findFirst({ where: eq(shipments.id, s.id) });
      return toShipment(fresh!);
    });
  }

  /** Dispatcher-driven status change; delivered/failed settle without a driver's earnings. */
  async adminStatus(
    shipmentId: string,
    to: ShipmentStatus,
    note: string | null,
  ): Promise<Shipment> {
    if (to !== "delivered" && to !== "failed")
      return this.bookingsSvc.updateShipmentStatus(shipmentId, to, note);
    return this.dbs.transaction(async (tx) => {
      const [s] = await tx
        .select()
        .from(shipments)
        .where(eq(shipments.id, shipmentId))
        .for("update");
      if (!s) throw AppError.notFound("shipment");
      const a = await this.assignment.activeAssignment(shipmentId, tx);
      await this.transition(tx, s, to, note ?? `Marked ${to} by dispatcher`, {
        deliveredAt: to === "delivered" ? new Date() : undefined,
      });
      const plannedKm = a ? Number(a.plannedKm) : 0;
      await this.settlement.settle(tx, {
        shipmentId,
        driverId: a?.driverId ?? null,
        shiftId: null,
        actualKm: plannedKm,
        plannedKm,
        outcome: to,
      });
      const fresh = await tx.query.shipments.findFirst({ where: eq(shipments.id, shipmentId) });
      return toShipment(fresh!);
    });
  }

  async pod(shipmentId: string): Promise<ProofOfDelivery | null> {
    const row = await this.dbs.db.query.proofsOfDelivery.findFirst({
      where: eq(proofsOfDelivery.shipmentId, shipmentId),
    });
    return row ? toPod(row) : null;
  }

  async podFiles(shipmentId: string) {
    const row = await this.dbs.db.query.proofsOfDelivery.findFirst({
      where: eq(proofsOfDelivery.shipmentId, shipmentId),
    });
    return { signatureFileId: row?.signatureFileId ?? null, photoFileId: row?.photoFileId ?? null };
  }

  // ── internals ───────────────────────────────────────────────────────────────

  private async requireOpenShift(driver: Driver) {
    const date = await this.fleet.localDate();
    const shift = await this.fleet.shiftFor(driver.id, date);
    if (!shift || shift.status !== "open")
      throw AppError.conflict("shift_not_open", "start your shift before working stops");
    return shift;
  }

  private async ownedShipment(
    tx: DbExecutor,
    driver: Driver,
    shipmentId: string,
    allowed: ShipmentStatus[],
  ) {
    const [s] = await tx.select().from(shipments).where(eq(shipments.id, shipmentId)).for("update");
    if (!s) throw AppError.notFound("shipment");
    const a = await this.assignment.activeAssignment(shipmentId, tx);
    if (!a || a.driverId !== driver.id)
      throw AppError.forbidden("this shipment is not assigned to you");
    if (!allowed.includes(s.status))
      throw AppError.conflict("invalid_transition", `shipment is ${s.status}`, { allowed });
    return { s, a };
  }

  private async transition(
    tx: DbExecutor,
    s: typeof shipments.$inferSelect,
    to: ShipmentStatus,
    note: string,
    meta: {
      location?: { lat: number; lng: number } | null;
      deliveredAt?: Date;
      photoFileId?: string | null;
    },
  ) {
    if (!SHIPMENT_TRANSITIONS[s.status].includes(to)) {
      throw AppError.conflict(
        "invalid_transition",
        `cannot move a shipment from ${s.status} to ${to}`,
        {
          allowed: SHIPMENT_TRANSITIONS[s.status],
        },
      );
    }
    await tx
      .update(shipments)
      .set({ status: to, ...(meta.deliveredAt ? { deliveredAt: meta.deliveredAt } : {}) })
      .where(eq(shipments.id, s.id));
    await tx.insert(shipmentEvents).values({
      shipmentId: s.id,
      status: to,
      note,
      actorUserId: requestContext.get()?.userId ?? null,
      metadata: { location: meta.location ?? null, photoFileId: meta.photoFileId ?? null },
    });
    await this.audit.record(tx, {
      action: "shipment.status",
      entityType: "shipment",
      entityId: s.id,
      before: { status: s.status },
      after: { status: to, note },
    });
    await this.outbox.emit(
      tx,
      "shipment.status_changed",
      {
        shipmentId: s.id,
        bookingId: s.bookingId,
        accountId: s.accountId,
        waybill: s.waybill,
        from: s.status,
        to,
        note,
      },
      { dedupeKey: `shipment:${s.id}:${to}:${Date.now()}` },
    );
    await this.bookingsSvc.rollUpBooking(tx, s.bookingId);
  }

  /** Actual km: the driver's GPS trail since collection, else the plan. */
  private async measuredKm(
    driverId: string,
    shipmentId: string,
    plannedKm: number,
  ): Promise<number> {
    const collected = await this.dbs.db.query.shipmentEvents.findFirst({
      where: and(eq(shipmentEvents.shipmentId, shipmentId), eq(shipmentEvents.status, "collected")),
      orderBy: asc(shipmentEvents.occurredAt),
    });
    if (!collected) return plannedKm;
    const km = await this.fleet.trailDistanceKm(driverId, collected.occurredAt, new Date());
    return km && km > 0 ? km : plannedKm;
  }
}

/**
 * One key for a stop, used by both the live ordering and a stored trip, so the two cannot
 * disagree about which row is which stop.
 */
function stopKey(s: Pick<DriverStop, "kind" | "bookingId" | "shipmentId">): string {
  return s.kind === "collection" ? `collect:${s.bookingId}` : `drop:${s.shipmentId}`;
}

/**
 * Order a driver's day by the trip a dispatcher released.
 *
 * Anything the trip does not know about is kept, after the planned stops and in its own order,
 * rather than hidden: a shipment assigned to this driver but never put on the trip is a mistake
 * to notice, and dropping it off the driver's screen is how a parcel spends the day in a van.
 */
function orderByPlan(
  stops: DriverStop[],
  plan: TripSheet,
): { stops: DriverStop[]; route: DriverDay["route"] } {
  const position = new Map(
    [...plan.stops].sort((a, b) => a.sequence - b.sequence).map((s, i) => [stopKey(s), i] as const),
  );
  const planned: DriverStop[] = [];
  const extra: DriverStop[] = [];
  for (const s of stops) (position.has(stopKey(s)) ? planned : extra).push(s);
  planned.sort((a, b) => position.get(stopKey(a))! - position.get(stopKey(b))!);
  return { stops: [...planned, ...extra], route: plan.route };
}

export function toPod(r: typeof proofsOfDelivery.$inferSelect): ProofOfDelivery {
  return {
    shipmentId: r.shipmentId,
    receivedBy: r.receivedBy,
    hasSignature: !!r.signatureFileId,
    hasPhoto: !!r.photoFileId,
    location: r.location as ProofOfDelivery["location"],
    note: r.note,
    capturedAt: r.capturedAt.toISOString(),
  };
}

/** The change kinds in words a driver reads at a glance, standing next to their van. */
const CHANGE_WORDS: Record<string, string> = {
  recipient_contact: "recipient details",
  delivery_address: "delivery address",
  instructions: "instructions",
  reschedule: "delivery date",
};

function toChangedFlag(change: { what: string[]; at: Date } | undefined): DriverStop["changed"] {
  return change ? { what: change.what, at: change.at.toISOString() } : null;
}
