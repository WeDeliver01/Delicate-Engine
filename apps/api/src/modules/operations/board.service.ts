import { Injectable } from "@nestjs/common";
import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
import {
  type AssignmentRecommendation,
  type BoardCard,
  type BoardDriver,
  type BoardExceptionKind,
  type BoardLane,
  type DispatchBoard,
  type LatLng,
  type QuoteParcel,
  type ShipmentStatus,
  operatingToday,
} from "@delicate/contracts";
import {
  accounts,
  assignments,
  bookings,
  driverPositions,
  drivers,
  shifts,
  shipmentChangeRequests,
  shipments,
  tripStops,
  trips,
  vehicles,
} from "@delicate/db";
import { DbService } from "../../infra/db.module.js";
import { SettingsService } from "../../infra/settings.service.js";
import { Clock } from "../../infra/clock.js";
import { AssignmentService } from "../dispatch/assignment.service.js";
import { TripService } from "./trip.service.js";

/** A trip stop with the address and waybill the board needs, which `trip_stops` alone lacks. */
interface StopRow {
  stop: typeof tripStops.$inferSelect;
  trip: typeof trips.$inferSelect;
  collection: unknown;
  deliveryAddress: unknown;
  waybill: string | null;
}

/** Statuses that are still somebody's problem today. */
const LIVE: ShipmentStatus[] = ["booked", "assigned", "collected", "in_transit"];

/**
 * The dispatch board: one screen that runs the day.
 *
 * A read model, assembled per request and cached nowhere. Three of its lanes cannot be stored
 * because they stop being true the moment a driver moves — "going to collect" and "out for
 * delivery" are read off the trip's current stop — so the board derives everything and the
 * tables stay the record of what happened rather than of what is currently on a screen.
 */
@Injectable()
export class BoardService {
  constructor(
    private readonly dbs: DbService,
    private readonly settings: SettingsService,
    private readonly clock: Clock,
    private readonly assignment: AssignmentService,
    private readonly tripSvc: TripService,
  ) {}

  async board(date?: string): Promise<DispatchBoard> {
    const day = date ?? operatingToday(this.clock.now());
    const nowMinute = await this.nowMinute();
    const today = operatingToday(this.clock.now());

    const rows = await this.dbs.db
      .select({
        s: shipments,
        b: bookings,
        accountName: accounts.name,
        driverId: assignments.driverId,
        driverName: drivers.fullName,
      })
      .from(shipments)
      .innerJoin(bookings, eq(bookings.id, shipments.bookingId))
      .innerJoin(accounts, eq(accounts.id, shipments.accountId))
      .leftJoin(
        assignments,
        and(eq(assignments.shipmentId, shipments.id), eq(assignments.active, true)),
      )
      .leftJoin(drivers, eq(drivers.id, assignments.driverId))
      .where(
        or(
          eq(shipments.slotDate, day),
          // On-demand work has no slot date, so it would never appear on any day's board. It
          // belongs on today's until it is finished, which is also the only day anyone can act
          // on it.
          and(
            isNull(shipments.slotDate),
            inArray(shipments.status, LIVE),
            sql`${shipments.createdAt} >= now() - interval '7 days'`,
            sql`${day} = ${today}`,
          ),
        ),
      );

    const stopRows = await this.dbs.db
      .select({
        stop: tripStops,
        trip: trips,
        collection: bookings.collection,
        deliveryAddress: shipments.deliveryAddress,
        waybill: shipments.waybill,
      })
      .from(tripStops)
      .innerJoin(trips, eq(trips.id, tripStops.tripId))
      .innerJoin(bookings, eq(bookings.id, tripStops.bookingId))
      .leftJoin(shipments, eq(shipments.id, tripStops.shipmentId))
      .where(and(eq(trips.date, day), sql`${trips.status} <> 'abandoned'`));

    const dropStop = new Map(
      stopRows.filter((r) => r.stop.kind === "drop").map((r) => [r.stop.shipmentId!, r]),
    );
    const collectionStop = new Map(
      stopRows.filter((r) => r.stop.kind === "collection").map((r) => [r.stop.bookingId, r]),
    );
    /** The stop each started trip is actually on, so "going to collect" can be told apart. */
    const currentByTrip = new Map<string, (typeof stopRows)[number]>();
    for (const tripId of new Set(stopRows.map((r) => r.trip.id))) {
      const mine = stopRows
        .filter((r) => r.trip.id === tripId)
        .sort((a, b) => a.stop.sequence - b.stop.sequence);
      const current =
        mine.find((r) => r.stop.status === "arrived") ??
        mine.find((r) => r.stop.status === "pending");
      if (current) currentByTrip.set(tripId, current);
    }

    const flagged = await this.changeFlags(rows.map((r) => r.s.id));

    const cards: BoardCard[] = rows.map((r) => {
      const drop = dropStop.get(r.s.id);
      const collection = collectionStop.get(r.b.id);
      const trip = drop?.trip ?? collection?.trip ?? null;
      const current = trip ? currentByTrip.get(trip.id) : undefined;
      const lane = toLane({
        status: r.s.status,
        hasDriver: !!r.driverId,
        tripStarted: trip?.status === "started",
        atOwnCollection: !!current && !!collection && current.stop.id === collection.stop.id,
        atOwnDrop: !!current && !!drop && current.stop.id === drop.stop.id,
      });
      const window = drop
        ? {
            startMinute: drop.stop.windowStartMinute,
            endMinute: drop.stop.windowEndMinute,
            source: drop.stop.windowSource,
          }
        : null;
      const parcels = r.s.parcels as QuoteParcel[];
      const declared = parcels.reduce(
        (n, p) => n + ((p as { declaredValueCents?: number }).declaredValueCents ?? 0),
        0,
      );
      const collectionJson = r.b.collection as {
        address: BoardCard["collection"]["address"];
        contact: BoardCard["collection"]["contact"];
        instructions: string | null;
      };

      return {
        shipmentId: r.s.id,
        waybill: r.s.waybill,
        bookingId: r.b.id,
        bookingReference: r.b.reference,
        customerReference: r.b.customerReference,
        accountId: r.s.accountId,
        accountName: r.accountName,
        lane,
        status: r.s.status,
        serviceLevelCode: r.s.serviceLevelCode,
        slotDate: r.s.slotDate,
        slotWindowKey: r.s.slotWindowKey,
        collection: { address: collectionJson.address, contact: collectionJson.contact },
        delivery: {
          address: r.s.deliveryAddress as BoardCard["delivery"]["address"],
          contact: r.s.recipient as BoardCard["delivery"]["contact"],
        },
        instructions: r.s.instructions,
        parcels,
        declaredValueCents: declared > 0 ? declared : null,
        priceCents: (r.b.breakdown as { totalCents?: number }).totalCents ?? r.b.totalCents,
        driverId: r.driverId ?? null,
        driverName: r.driverName ?? null,
        tripId: trip?.id ?? null,
        tripReference: trip?.reference ?? null,
        stopSequence: drop?.stop.sequence ?? null,
        window,
        plannedArrivalMinute: drop?.stop.plannedArrivalMinute ?? null,
        // The engine does not predict yet; 7e computes this off the driver's trail. Carried as
        // null rather than left out so the board does not change shape when it arrives.
        etaMinute: null,
        exceptions: exceptionsFor({
          status: r.s.status,
          slotDate: r.s.slotDate,
          today,
          hasDriver: !!r.driverId,
          isToday: day === today,
          windowEndMinute: drop?.stop.windowEndMinute ?? null,
          stopStatus: drop?.stop.status ?? null,
          tripStarted: trip?.status === "started",
          nowMinute,
          flags: flagged.get(r.s.id) ?? [],
        }),
        updatedAt: r.s.updatedAt.toISOString(),
      };
    });

    const laneCounts = Object.fromEntries(
      (
        [
          "unassigned",
          "awaiting_driver",
          "en_route_collection",
          "collected",
          "in_transit",
          "out_for_delivery",
          "delivered",
          "failed",
        ] as BoardLane[]
      ).map((lane) => [lane, cards.filter((c) => c.lane === lane).length]),
    ) as Record<BoardLane, number>;

    const exceptionCounts = {} as Record<BoardExceptionKind, number>;
    for (const card of cards) {
      for (const kind of card.exceptions) exceptionCounts[kind] = (exceptionCounts[kind] ?? 0) + 1;
    }

    return {
      date: day,
      nowMinute,
      cards,
      drivers: await this.rail(day, stopRows, currentByTrip, nowMinute),
      laneCounts,
      exceptionCounts,
    };
  }

  /**
   * Who should take this shipment, and why.
   *
   * The scoring is dispatch's (`AssignmentService.candidates`); this adds the sentence that
   * makes it usable. A suggestion a dispatcher cannot see the reason for is either followed
   * blindly or ignored, and both are worse than no suggestion at all.
   */
  async recommendations(shipmentId: string): Promise<AssignmentRecommendation[]> {
    const candidates = await this.assignment.candidates(shipmentId);
    if (candidates.length === 0) return [];
    const s = await this.dbs.db.query.shipments.findFirst({ where: eq(shipments.id, shipmentId) });
    const day = s?.slotDate ?? operatingToday(this.clock.now());
    const live = await this.dbs.db
      .select({ id: trips.id, reference: trips.reference, driverId: trips.driverId })
      .from(trips)
      .where(and(eq(trips.date, day), sql`${trips.status} <> 'abandoned'`));
    const tripBy = new Map(live.map((t) => [t.driverId, t]));

    return candidates.map((c) => {
      const trip = tripBy.get(c.driverId) ?? null;
      const bits = [`${c.distanceKm.toFixed(1)} km from the collection`];
      if (c.load === 0) bits.push("nothing on their day yet");
      else bits.push(`${c.load} of ${c.capacity} stops taken`);
      if (trip) bits.push(`already has ${trip.reference}`);
      return {
        driverId: c.driverId,
        name: c.name,
        score: Math.round(c.score * 100) / 100,
        distanceKm: c.distanceKm,
        load: c.load,
        capacity: c.capacity,
        tripId: trip?.id ?? null,
        tripReference: trip?.reference ?? null,
        reason: bits.join(" · "),
      };
    });
  }

  /** Put a shipment straight onto a driver's day, making the trip if they have none yet. */
  async assignToDay(shipmentId: string, driverId: string, date?: string): Promise<string> {
    const s = await this.dbs.db.query.shipments.findFirst({ where: eq(shipments.id, shipmentId) });
    const day = date ?? s?.slotDate ?? operatingToday(this.clock.now());
    const existing = await this.dbs.db.query.trips.findFirst({
      where: and(
        eq(trips.driverId, driverId),
        eq(trips.date, day),
        inArray(trips.status, ["planned", "released", "started"]),
      ),
    });
    const trip = existing ?? (await this.tripSvc.create({ driverId, date: day, vehicleId: null }));
    await this.tripSvc.addStops(trip.id, { shipmentIds: [shipmentId], resequence: true });
    return trip.id;
  }

  // ── internals ───────────────────────────────────────────────────────────────

  private async nowMinute(): Promise<number> {
    const tz = await this.settings.get("company.timezone");
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: tz,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(this.clock.now());
    const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? "0");
    return get("hour") * 60 + get("minute");
  }

  /** Change requests worth a dispatcher's attention, per shipment. */
  private async changeFlags(shipmentIds: string[]): Promise<Map<string, BoardExceptionKind[]>> {
    const out = new Map<string, BoardExceptionKind[]>();
    if (shipmentIds.length === 0) return out;
    const rows = await this.dbs.db
      .select({
        shipmentId: shipmentChangeRequests.shipmentId,
        status: shipmentChangeRequests.status,
        decidedAt: shipmentChangeRequests.decidedAt,
        assignedAt: assignments.createdAt,
      })
      .from(shipmentChangeRequests)
      .leftJoin(
        assignments,
        and(
          eq(assignments.shipmentId, shipmentChangeRequests.shipmentId),
          eq(assignments.active, true),
        ),
      )
      .where(inArray(shipmentChangeRequests.shipmentId, shipmentIds));

    for (const r of rows) {
      const add = (kind: BoardExceptionKind) => {
        const list = out.get(r.shipmentId) ?? [];
        if (!list.includes(kind)) list.push(kind);
        out.set(r.shipmentId, list);
      };
      if (r.status === "pending") add("change_awaiting_decision");
      // Applied after the driver picked the job up: they may be driving to the old address.
      if (
        (r.status === "approved" || r.status === "auto_applied") &&
        r.decidedAt &&
        r.assignedAt &&
        r.decidedAt > r.assignedAt
      ) {
        add("changed_after_assignment");
      }
    }
    return out;
  }

  private async rail(
    day: string,
    stopRows: StopRow[],
    currentByTrip: Map<string, StopRow>,
    nowMinute: number,
  ): Promise<BoardDriver[]> {
    const rows = await this.dbs.db
      .select({
        d: drivers,
        registration: vehicles.registration,
        shiftStatus: shifts.status,
        tripId: trips.id,
        tripReference: trips.reference,
        tripStatus: trips.status,
        position: driverPositions.location,
        positionAt: driverPositions.recordedAt,
      })
      .from(drivers)
      .leftJoin(vehicles, eq(vehicles.id, drivers.vehicleId))
      .leftJoin(shifts, and(eq(shifts.driverId, drivers.id), eq(shifts.date, day)))
      .leftJoin(
        trips,
        and(
          eq(trips.driverId, drivers.id),
          eq(trips.date, day),
          sql`${trips.status} <> 'abandoned'`,
        ),
      )
      .leftJoin(driverPositions, eq(driverPositions.driverId, drivers.id))
      .where(eq(drivers.status, "active"));

    const now = this.clock.now();
    return rows.map((r) => {
      const mine = r.tripId ? stopRows.filter((s) => s.trip.id === r.tripId) : [];
      const current = r.tripId ? currentByTrip.get(r.tripId) : undefined;
      const done = mine.filter((s) => s.stop.status === "done").length;
      const skipped = mine.filter((s) => s.stop.status === "skipped").length;
      // Stops whose window has already closed while the driver is still on the way to them.
      const behindCount =
        r.tripStatus === "started"
          ? mine.filter(
              (s) =>
                (s.stop.status === "pending" || s.stop.status === "arrived") &&
                s.stop.windowEndMinute != null &&
                s.stop.windowEndMinute < nowMinute,
            ).length
          : 0;

      return {
        driverId: r.d.id,
        name: r.d.fullName,
        vehicleRegistration: r.registration ?? null,
        shiftStatus: r.shiftStatus ?? "none",
        tripId: r.tripId ?? null,
        tripReference: r.tripReference ?? null,
        tripStatus: r.tripStatus ?? null,
        progress: r.tripId
          ? {
              total: mine.length,
              done,
              skipped,
              currentStopId: current?.stop.id ?? null,
            }
          : null,
        activity: activityOf(r.shiftStatus ?? "none", r.tripStatus ?? null),
        currentStop: current
          ? {
              kind: current.stop.kind,
              sequence: current.stop.sequence,
              address: shortAddress(current),
              waybill: current.waybill ?? null,
              windowEndMinute: current.stop.windowEndMinute,
            }
          : null,
        lastSeen:
          r.position && r.positionAt
            ? {
                at: r.positionAt.toISOString(),
                location: r.position as LatLng,
                ageMinutes: Math.max(
                  0,
                  Math.round((now.getTime() - r.positionAt.getTime()) / 60_000),
                ),
              }
            : null,
        behindCount,
      };
    });
  }
}

/**
 * Which lane a shipment belongs in.
 *
 * Ordered most-specific first: a shipment on a started trip whose driver is standing at its
 * drop is "out for delivery", which is a truer thing to tell a customer than "in transit".
 */
function toLane(x: {
  status: string;
  hasDriver: boolean;
  tripStarted: boolean;
  atOwnCollection: boolean;
  atOwnDrop: boolean;
}): BoardLane {
  if (x.status === "delivered") return "delivered";
  if (x.status === "failed") return "failed";
  if (x.status === "booked") return x.hasDriver ? "awaiting_driver" : "unassigned";
  if (x.status === "assigned") {
    return x.tripStarted && x.atOwnCollection ? "en_route_collection" : "awaiting_driver";
  }
  if (x.tripStarted && x.atOwnDrop) return "out_for_delivery";
  return x.status === "collected" ? "collected" : "in_transit";
}

/**
 * What needs a person. `behind_schedule` and `overdue` are deliberately separate: the first is
 * within today and only means anything once a trip gives the stop a window to be late against;
 * the second is the whole-day comparison the shipment list already uses, and the two answer
 * different questions.
 */
function exceptionsFor(x: {
  status: string;
  slotDate: string | null;
  today: string;
  hasDriver: boolean;
  isToday: boolean;
  windowEndMinute: number | null;
  stopStatus: string | null;
  tripStarted: boolean;
  nowMinute: number;
  flags: BoardExceptionKind[];
}): BoardExceptionKind[] {
  const out: BoardExceptionKind[] = [...x.flags];
  const live = ["booked", "assigned", "collected", "in_transit"].includes(x.status);
  if (x.status === "failed") out.push("failed_attempt");
  if (live && x.slotDate && x.slotDate < x.today) out.push("overdue");
  if (live && x.isToday && !x.hasDriver) out.push("no_driver");
  if (
    live &&
    x.tripStarted &&
    x.windowEndMinute != null &&
    x.windowEndMinute < x.nowMinute &&
    (x.stopStatus === "pending" || x.stopStatus === "arrived")
  ) {
    out.push("behind_schedule");
  }
  return out;
}

function activityOf(
  shift: "none" | "scheduled" | "open" | "closed",
  trip: string | null,
): BoardDriver["activity"] {
  if (trip === "completed") return "finished";
  if (trip === "started") return "working";
  if (trip === "released") return "ready";
  if (trip === "planned") return "planned";
  if (shift === "none") return "no_shift";
  return "available";
}

/**
 * Where the driver is standing, in as few words as fit a rail: the suburb when we have one,
 * because "Menlyn" tells a dispatcher more at a glance than a full street address does.
 */
function shortAddress(row: StopRow): string {
  const address = (
    row.stop.kind === "drop"
      ? row.deliveryAddress
      : (row.collection as { address?: unknown } | null)?.address
  ) as { suburb?: string | null; formatted?: string } | null;
  return address?.suburb ?? address?.formatted ?? "unknown";
}
