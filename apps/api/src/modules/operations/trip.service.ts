import { Injectable } from "@nestjs/common";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import {
  type AddStopsRequest,
  type CreateTripRequest,
  type Driver,
  type LatLng,
  type SequenceSource,
  type SetStopWindowRequest,
  type Trip,
  type TripQuery,
  type TripSheet,
  type TripStop,
  type DayStop,
  type WindowSource,
  haversineKm,
  sequenceDay,
  serviceMinutes,
} from "@delicate/contracts";
import {
  assignments,
  bookings,
  drivers,
  shipments,
  tripStops,
  trips,
  vehicles,
  waybillCounters,
  type DbExecutor,
} from "@delicate/db";
import { DbService } from "../../infra/db.module.js";
import { AuditService } from "../../infra/audit.service.js";
import { OutboxService } from "../../infra/outbox.service.js";
import { SettingsService } from "../../infra/settings.service.js";
import { AppError } from "../../common/errors.js";
import { requestContext } from "../../common/request-context.js";
import { FleetService } from "../fleet/fleet.service.js";
import { AssignmentService } from "../dispatch/assignment.service.js";
import { SchedulingService } from "../scheduling/scheduling.service.js";

/**
 * Straight-line distance multiplied by this to approximate roads — the same figure the driver
 * app's ordering uses, so a trip sheet and the app never disagree about how far the day is.
 */
const ROAD_FACTOR = 1.3;

/** Statuses from which a shipment can still be placed on a trip. */
const PLACEABLE = ["booked", "assigned", "failed"] as const;

/** Statuses a trip can still be changed in. */
const MUTABLE = ["planned", "released", "started"] as const;

/**
 * Trips: one driver, one date, one ordered list of stops.
 *
 * The driver's day used to be recomputed on every request, which meant nothing about it was a
 * decision — no row said the Menlyn drop goes third, and the order could change between two
 * refreshes of the app. A trip is that decision written down.
 *
 * Division of labour, so two things never claim the same job:
 *   - `assignments` (dispatch) stays the authority on **who owes this drop**.
 *   - `trips` / `trip_stops` own **where it sits in the day**.
 * Putting a shipment on a trip therefore also assigns it, in the same transaction.
 *
 * Nothing here touches money. Settlement is still triggered by `delivery.completed` with the
 * actual distance, exactly as before.
 */
@Injectable()
export class TripService {
  constructor(
    private readonly dbs: DbService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly settings: SettingsService,
    private readonly fleet: FleetService,
    private readonly assignment: AssignmentService,
    private readonly scheduling: SchedulingService,
  ) {}

  // ── lifecycle ───────────────────────────────────────────────────────────────

  async create(input: CreateTripRequest): Promise<Trip> {
    return this.dbs.transaction(async (tx) => {
      const driver = await this.fleet.getDriver(input.driverId, tx);
      const existing = await tx.query.trips.findFirst({
        where: and(
          eq(trips.driverId, driver.id),
          eq(trips.date, input.date),
          sql`${trips.status} <> 'abandoned'`,
        ),
      });
      // The unique index would refuse this anyway; saying so plainly beats a constraint error.
      if (existing)
        throw AppError.conflict(
          "trip_exists",
          `${driver.fullName} already has a trip on ${input.date}`,
          { tripId: existing.id },
        );

      const shift = await this.fleet.shiftFor(driver.id, input.date, tx);
      const [row] = await tx
        .insert(trips)
        .values({
          reference: await this.nextReference(tx, input.date),
          driverId: driver.id,
          date: input.date,
          shiftId: shift?.id ?? null,
          // The shift's vehicle is the one the driver is actually in; an explicit choice wins.
          vehicleId: input.vehicleId ?? shift?.vehicleId ?? driver.vehicleId ?? null,
          createdByUserId: requestContext.get()?.userId ?? null,
        })
        .returning();

      await this.audit.record(tx, {
        action: "trip.create",
        entityType: "trip",
        entityId: row!.id,
        before: null,
        after: row,
      });
      return this.hydrate(tx, row!.id);
    });
  }

  /**
   * Put shipments on a trip.
   *
   * A drop implies its booking's collection, which is added for free. A dispatcher should not
   * have to remember that a parcel must be picked up before it is delivered, and the sequencer's
   * precedence rule depends on the collection stop being there to point at.
   */
  async addStops(tripId: string, input: AddStopsRequest): Promise<TripSheet> {
    await this.dbs.transaction(async (tx) => {
      const trip = await this.lockMutable(tx, tripId);
      const rows = await tx
        .select({ s: shipments, b: bookings })
        .from(shipments)
        .innerJoin(bookings, eq(bookings.id, shipments.bookingId))
        .where(inArray(shipments.id, input.shipmentIds));
      if (rows.length !== input.shipmentIds.length) throw AppError.notFound("shipment");

      for (const { s, b } of rows) {
        if (!PLACEABLE.includes(s.status as (typeof PLACEABLE)[number])) {
          throw AppError.conflict(
            "shipment_not_placeable",
            `${s.waybill} is ${s.status} and cannot be put on a trip`,
          );
        }
        // Already on this trip: adding it twice is a dispatcher double-click, not an error.
        const already = await tx.query.tripStops.findFirst({
          where: and(
            eq(tripStops.tripId, tripId),
            eq(tripStops.kind, "drop"),
            eq(tripStops.shipmentId, s.id),
          ),
        });
        if (already) continue;

        // One shipment, one trip: take it off whichever other trip holds it first.
        await this.detach(tx, s.id, `moved to ${trip.reference}`);

        // A window the customer actually bought beats the slot it sits inside: that is the
        // promise, and it is what lateness has to be measured against. The slot is the fallback
        // for everyone who did not buy one.
        const slotWindow = await this.slotWindow(b.slotWindowKey);
        const fallback = {
          startMinute: slotWindow?.startMinutes ?? null,
          endMinute: slotWindow?.endMinutes ?? null,
          source: "slot" as const,
        };
        const collectionWindow = windowOr(
          b.collectionWindowStartMinute,
          b.collectionWindowEndMinute,
          fallback,
        );
        const dropWindow = windowOr(
          s.deliveryWindowStartMinute,
          s.deliveryWindowEndMinute,
          fallback,
        );

        if (
          !(await tx.query.tripStops.findFirst({
            where: and(
              eq(tripStops.tripId, tripId),
              eq(tripStops.kind, "collection"),
              eq(tripStops.bookingId, b.id),
            ),
          }))
        ) {
          await tx.insert(tripStops).values({
            tripId,
            kind: "collection",
            sequence: await this.nextSequence(tx, tripId),
            bookingId: b.id,
            shipmentId: null,
            windowStartMinute: collectionWindow.startMinute,
            windowEndMinute: collectionWindow.endMinute,
            windowSource: collectionWindow.source,
          });
        }
        await tx.insert(tripStops).values({
          tripId,
          kind: "drop",
          sequence: await this.nextSequence(tx, tripId),
          bookingId: b.id,
          shipmentId: s.id,
          windowStartMinute: dropWindow.startMinute,
          windowEndMinute: dropWindow.endMinute,
          windowSource: dropWindow.source,
        });

        // The trip says this driver does this drop, so the assignment must agree. Dispatch stays
        // the authority on that; we do not write `assignments` ourselves.
        await this.assignment.assign(
          tx,
          s.id,
          trip.driverId,
          "dispatcher",
          `on trip ${trip.reference}`,
        );
      }

      await this.audit.record(tx, {
        action: "trip.add_stops",
        entityType: "trip",
        entityId: tripId,
        before: null,
        after: { shipmentIds: input.shipmentIds },
      });
    });

    if (input.resequence) await this.autoSequence(tripId);
    return this.sheet(tripId);
  }

  async removeStops(tripId: string, stopIds: string[], reason: string | null): Promise<TripSheet> {
    await this.dbs.transaction(async (tx) => {
      const trip = await this.lockMutable(tx, tripId);
      const rows = await tx
        .select()
        .from(tripStops)
        .where(and(eq(tripStops.tripId, tripId), inArray(tripStops.id, stopIds)));
      if (rows.length === 0) throw AppError.notFound("trip stop");

      for (const stop of rows) {
        if (stop.status !== "pending") {
          throw AppError.conflict(
            "stop_already_worked",
            "a stop the driver has already reached cannot be removed from the trip",
            { stopId: stop.id, status: stop.status },
          );
        }
      }

      // Removing a collection takes its booking's drops with it: leaving a drop behind would
      // leave the driver with a parcel they were never asked to pick up.
      const dropIds = new Set(rows.filter((r) => r.kind === "drop").map((r) => r.shipmentId!));
      for (const collection of rows.filter((r) => r.kind === "collection")) {
        const siblings = await tx
          .select()
          .from(tripStops)
          .where(
            and(
              eq(tripStops.tripId, tripId),
              eq(tripStops.kind, "drop"),
              eq(tripStops.bookingId, collection.bookingId),
            ),
          );
        for (const sib of siblings) {
          if (sib.status !== "pending") {
            throw AppError.conflict(
              "stop_already_worked",
              "this booking has a drop the driver has already reached",
              { stopId: sib.id },
            );
          }
          dropIds.add(sib.shipmentId!);
        }
      }

      for (const shipmentId of dropIds) {
        await this.assignment.unassign(tx, shipmentId, reason ?? `off trip ${trip.reference}`);
      }
      await tx.delete(tripStops).where(
        and(
          eq(tripStops.tripId, tripId),
          inArray(tripStops.id, [
            ...rows.map((r) => r.id),
            // Sibling drops of a removed collection are not in `stopIds`; find them by shipment.
            ...(
              await tx
                .select({ id: tripStops.id })
                .from(tripStops)
                .where(
                  and(
                    eq(tripStops.tripId, tripId),
                    eq(tripStops.kind, "drop"),
                    inArray(tripStops.shipmentId, [...dropIds]),
                  ),
                )
            ).map((r) => r.id),
          ]),
        ),
      );
      await this.compact(tx, tripId);
      await this.audit.record(tx, {
        action: "trip.remove_stops",
        entityType: "trip",
        entityId: tripId,
        before: { stopIds },
        after: { reason },
      });
    });
    return this.sheet(tripId);
  }

  /** The dispatcher's hand-ordering. Beats the optimiser, and says so in `sequenceSource`. */
  async resequence(tripId: string, stopIds: string[]): Promise<TripSheet> {
    await this.dbs.transaction(async (tx) => {
      const trip = await this.lockMutable(tx, tripId);
      const current = await tx
        .select()
        .from(tripStops)
        .where(eq(tripStops.tripId, tripId))
        .orderBy(asc(tripStops.sequence));
      const have = new Set(current.map((s) => s.id));
      const want = new Set(stopIds);
      if (have.size !== want.size || [...want].some((id) => !have.has(id))) {
        throw AppError.conflict(
          "incomplete_sequence",
          "a new order must list every stop on the trip exactly once",
          { expected: current.map((s) => s.id) },
        );
      }
      await this.writeSequence(tx, tripId, stopIds);
      await tx.update(trips).set({ sequenceSource: "dispatcher" }).where(eq(trips.id, tripId));
      await this.audit.record(tx, {
        action: "trip.resequence",
        entityType: "trip",
        entityId: tripId,
        before: { order: current.map((s) => s.id) },
        after: { order: stopIds },
      });
      await this.outbox.emit(
        tx,
        "trip.stop_resequenced",
        {
          tripId,
          driverId: trip.driverId,
          sequenceSource: "dispatcher" as SequenceSource,
          from: current.map((s) => s.id),
          to: stopIds,
        },
        { dedupeKey: `trip:${tripId}:resequence:${Date.now()}` },
      );
    });
    return this.sheet(tripId);
  }

  /**
   * Propose an order. Nearest-neighbour plus 2-opt over the stops that have coordinates, with a
   * drop never placed before its own booking's collection.
   *
   * A dispatcher's ordering is not overwritten: once a human has sequenced the day, the
   * optimiser's opinion is no longer interesting.
   */
  async autoSequence(tripId: string, force = false): Promise<TripSheet> {
    await this.dbs.transaction(async (tx) => {
      const trip = await this.lockMutable(tx, tripId);
      if (trip.sequenceSource === "dispatcher" && !force) return;

      const rows = await this.stopRows(tx, tripId);
      if (rows.length < 2) return;
      const depot = await this.settings.get("company.depot_address");
      const policy = await this.scheduling.policy();
      const shift = await this.fleet.shiftFor(trip.driverId, trip.date, tx);
      const startMinute = policy.windows[0]?.startMinutes ?? 0;
      const endMinute = policy.windows[policy.windows.length - 1]?.endMinutes ?? null;

      // A stop whose address was never geocoded is left where it is rather than guessed at: an
      // address we could not place is a data problem to fix, not one to paper over.
      const placed = rows.filter((r) => r.location);
      if (placed.length < 2) return;

      const collectionOf = new Map(
        rows.filter((r) => r.stop.kind === "collection").map((r) => [r.stop.bookingId, r.stop.id]),
      );
      const stops: DayStop[] = placed.map((r) => ({
        id: r.stop.id,
        kind: r.stop.kind,
        location: r.location!,
        afterStopId: r.stop.kind === "drop" ? (collectionOf.get(r.stop.bookingId) ?? null) : null,
        earliestMinute: r.stop.windowStartMinute,
        latestMinute: r.stop.windowEndMinute,
        pieces: r.pieces,
        pinnedMinute: r.stop.windowSource === "pinned" ? r.stop.windowStartMinute : null,
        // Already picked up: it is on the vehicle, so it is not collected again.
        alreadyOnBoard:
          r.stop.kind === "drop" &&
          !!r.shipment &&
          ["collected", "in_transit"].includes(r.shipment.status),
      }));

      const result = sequenceDay({
        depot: depot.location,
        stops,
        startMinute: shift?.startedAt ? startMinute : startMinute,
        endMinute,
        roadFactor: ROAD_FACTOR,
      });

      const unplaced = rows.filter((r) => !r.location).map((r) => r.stop.id);
      await this.writeSequence(tx, tripId, [...result.stops.map((s) => s.id), ...unplaced]);

      for (const stop of result.stops) {
        await tx
          .update(tripStops)
          .set({
            plannedArrivalMinute: Math.min(1440, stop.arrivalMinute),
            plannedServiceMinutes: stop.serviceMinutes,
            legKm: stop.legKm.toFixed(2),
            legMinutes: stop.legMinutes,
          })
          .where(eq(tripStops.id, stop.id));
      }

      await tx
        .update(trips)
        .set({
          sequenceSource: "auto",
          plannedKm: result.totalKm.toFixed(2),
          plannedMinutes: result.totalMinutes,
          routeSnapshot: {
            totalKm: result.totalKm,
            // The order the stops were added in, for the "saved X km" line on the sheet.
            originalKm: this.originalKm(rows, depot.location),
            savedKm: Math.max(0, round2(this.originalKm(rows, depot.location) - result.totalKm)),
            lateStops: result.lateStops,
            overtimeMinutes: result.overtimeMinutes,
            waitMinutes: result.waitMinutes,
          },
        })
        .where(eq(trips.id, tripId));

      await this.outbox.emit(
        tx,
        "trip.planned",
        {
          tripId,
          reference: trip.reference,
          driverId: trip.driverId,
          date: trip.date,
          stopCount: rows.length,
          plannedKm: result.totalKm,
          sequenceSource: "auto" as SequenceSource,
        },
        { dedupeKey: `trip:${tripId}:planned:${Date.now()}` },
      );
    });
    return this.sheet(tripId);
  }

  /** What the day would have cost in the order the stops happened to be added. */
  private originalKm(
    rows: { stop: { sequence: number }; location: LatLng | null }[],
    depot: LatLng,
  ): number {
    const points = [...rows]
      .sort((a, b) => a.stop.sequence - b.stop.sequence)
      .map((r) => r.location)
      .filter((l): l is LatLng => !!l);
    if (points.length === 0) return 0;
    let total = 0;
    let from = depot;
    for (const point of points) {
      total += haversineKm(from, point) * ROAD_FACTOR;
      from = point;
    }
    return round2(total + haversineKm(from, depot) * ROAD_FACTOR);
  }

  /** Hand the trip to the driver. Until this, it is a dispatcher's draft the app cannot see. */
  async release(tripId: string): Promise<Trip> {
    return this.dbs.transaction(async (tx) => {
      const trip = await this.lockTrip(tx, tripId);
      if (trip.status === "released") return this.hydrate(tx, tripId);
      if (trip.status !== "planned")
        throw AppError.conflict("trip_not_releasable", `trip is ${trip.status}`);
      const count = await tx.$count(tripStops, eq(tripStops.tripId, tripId));
      if (count === 0)
        throw AppError.conflict("trip_empty", "a trip needs at least one stop before release");

      await tx
        .update(trips)
        .set({ status: "released", releasedAt: new Date() })
        .where(eq(trips.id, tripId));
      await this.audit.record(tx, {
        action: "trip.release",
        entityType: "trip",
        entityId: tripId,
        before: { status: trip.status },
        after: { status: "released" },
      });
      await this.outbox.emit(
        tx,
        "trip.released",
        {
          tripId,
          reference: trip.reference,
          driverId: trip.driverId,
          date: trip.date,
          stopCount: count,
        },
        { dedupeKey: `trip:${tripId}:released` },
      );
      return this.hydrate(tx, tripId);
    });
  }

  /** The driver begins. Requires an open shift, as every other driver action does. */
  async start(tripId: string, driver: Driver): Promise<Trip> {
    return this.dbs.transaction(async (tx) => {
      const trip = await this.lockTrip(tx, tripId);
      if (trip.driverId !== driver.id) throw AppError.forbidden("this trip is not yours");
      if (trip.status === "started") return this.hydrate(tx, tripId);
      if (trip.status !== "released")
        throw AppError.conflict("trip_not_startable", `trip is ${trip.status}`);
      const shift = await this.fleet.shiftFor(driver.id, trip.date, tx);
      if (!shift || shift.status !== "open")
        throw AppError.conflict("shift_not_open", "start your shift before starting the trip");

      await tx
        .update(trips)
        .set({ status: "started", startedAt: new Date(), shiftId: shift.id })
        .where(eq(trips.id, tripId));
      await this.outbox.emit(
        tx,
        "trip.started",
        {
          tripId,
          reference: trip.reference,
          driverId: driver.id,
          shiftId: shift.id,
          date: trip.date,
        },
        { dedupeKey: `trip:${tripId}:started` },
      );
      return this.hydrate(tx, tripId);
    });
  }

  async complete(tripId: string): Promise<Trip> {
    return this.dbs.transaction(async (tx) => {
      const trip = await this.lockTrip(tx, tripId);
      if (trip.status === "completed") return this.hydrate(tx, tripId);
      if (trip.status !== "started")
        throw AppError.conflict("trip_not_completable", `trip is ${trip.status}`);
      const stops = await tx.select().from(tripStops).where(eq(tripStops.tripId, tripId));
      const open = stops.filter((s) => s.status === "pending" || s.status === "arrived");
      if (open.length > 0) {
        throw AppError.conflict("trip_has_open_stops", "some stops are neither done nor skipped", {
          stopIds: open.map((s) => s.id),
        });
      }

      await tx
        .update(trips)
        .set({ status: "completed", completedAt: new Date() })
        .where(eq(trips.id, tripId));
      await this.outbox.emit(
        tx,
        "trip.completed",
        {
          tripId,
          reference: trip.reference,
          driverId: trip.driverId,
          date: trip.date,
          stopsDone: stops.filter((s) => s.status === "done").length,
          stopsSkipped: stops.filter((s) => s.status === "skipped").length,
          plannedKm: Number(trip.plannedKm),
        },
        { dedupeKey: `trip:${tripId}:completed` },
      );
      return this.hydrate(tx, tripId);
    });
  }

  /**
   * Give up on a trip — a breakdown, a driver sent home. The shipments go back to the
   * dispatcher's queue; the trip is kept as history rather than deleted.
   */
  async abandon(tripId: string, reason: string): Promise<Trip> {
    return this.dbs.transaction(async (tx) => {
      const trip = await this.lockTrip(tx, tripId);
      if (trip.status === "completed" || trip.status === "abandoned")
        throw AppError.conflict("trip_closed", `trip is ${trip.status}`);
      const stops = await tx.select().from(tripStops).where(eq(tripStops.tripId, tripId));
      for (const stop of stops) {
        if (stop.kind !== "drop" || !stop.shipmentId) continue;
        if (stop.status === "done") continue;
        await this.assignment.unassign(tx, stop.shipmentId, `trip abandoned: ${reason}`);
      }
      await tx
        .update(trips)
        .set({ status: "abandoned", abandonedReason: reason })
        .where(eq(trips.id, tripId));
      await this.audit.record(tx, {
        action: "trip.abandon",
        entityType: "trip",
        entityId: tripId,
        before: { status: trip.status },
        after: { status: "abandoned", reason },
      });
      return this.hydrate(tx, tripId);
    });
  }

  // ── stops ───────────────────────────────────────────────────────────────────

  /** The driver is at the stop. Arrival is what ETA accuracy gets measured on. */
  async arrive(stopId: string, driver: Driver, location: LatLng | null): Promise<TripStop> {
    return this.dbs.transaction(async (tx) => {
      const [stop] = await tx
        .select()
        .from(tripStops)
        .where(eq(tripStops.id, stopId))
        .for("update");
      if (!stop) throw AppError.notFound("trip stop");
      const trip = await this.lockTrip(tx, stop.tripId);
      if (trip.driverId !== driver.id) throw AppError.forbidden("this stop is not yours");
      if (trip.status !== "started")
        throw AppError.conflict("trip_not_started", `trip is ${trip.status}`);
      if (stop.status === "arrived")
        return (await this.hydrateStops(tx, stop.tripId, [stopId]))[0]!;
      if (stop.status !== "pending")
        throw AppError.conflict("stop_closed", `stop is ${stop.status}`);

      const now = new Date();
      await tx
        .update(tripStops)
        .set({ status: "arrived", arrivedAt: now })
        .where(eq(tripStops.id, stopId));

      const tz = await this.settings.get("company.timezone");
      const variance =
        stop.plannedArrivalMinute == null
          ? null
          : Math.round(minuteOfDay(now, tz) - stop.plannedArrivalMinute);
      await this.outbox.emit(
        tx,
        "trip.stop_arrived",
        {
          tripId: stop.tripId,
          stopId,
          kind: stop.kind,
          sequence: stop.sequence,
          bookingId: stop.bookingId,
          shipmentId: stop.shipmentId,
          driverId: driver.id,
          varianceMinutes: variance,
          location,
        },
        { dedupeKey: `trip_stop:${stopId}:arrived` },
      );
      return (await this.hydrateStops(tx, stop.tripId, [stopId]))[0]!;
    });
  }

  /**
   * Narrow or pin the window a driver is working to. The source is recorded so the board can
   * still show what was sold rather than quietly losing it.
   */
  async setStopWindow(stopId: string, input: SetStopWindowRequest): Promise<TripStop> {
    return this.dbs.transaction(async (tx) => {
      const [stop] = await tx
        .select()
        .from(tripStops)
        .where(eq(tripStops.id, stopId))
        .for("update");
      if (!stop) throw AppError.notFound("trip stop");
      const start = input.pinnedMinute ?? input.startMinute;
      const end = input.pinnedMinute ?? input.endMinute;
      if (start != null && end != null && end < start) {
        throw AppError.validation([
          { path: ["endMinute"], message: "a window cannot end before it starts" },
        ]);
      }
      await tx
        .update(tripStops)
        .set({
          windowStartMinute: start ?? null,
          windowEndMinute: end ?? null,
          windowSource: input.pinnedMinute != null ? "pinned" : "dispatcher",
        })
        .where(eq(tripStops.id, stopId));
      await this.audit.record(tx, {
        action: "trip.set_stop_window",
        entityType: "trip_stop",
        entityId: stopId,
        before: {
          startMinute: stop.windowStartMinute,
          endMinute: stop.windowEndMinute,
          source: stop.windowSource,
        },
        after: { startMinute: start, endMinute: end, pinned: input.pinnedMinute != null },
      });
      return (await this.hydrateStops(tx, stop.tripId, [stopId]))[0]!;
    });
  }

  /**
   * Close a stop because the work behind it happened. Driven by the driver's own actions
   * arriving as events, so it must be idempotent: a redelivered `delivery.completed` must not
   * turn a skipped stop back into a done one.
   */
  async closeStopsForShipment(shipmentId: string, outcome: "done" | "skipped"): Promise<void> {
    await this.dbs.transaction(async (tx) => {
      const rows = await tx
        .select()
        .from(tripStops)
        .where(and(eq(tripStops.kind, "drop"), eq(tripStops.shipmentId, shipmentId)));
      for (const stop of rows) {
        if (stop.status === "done" || stop.status === "skipped") continue;
        await tx
          .update(tripStops)
          .set({ status: outcome, completedAt: new Date() })
          .where(eq(tripStops.id, stop.id));
      }
    });
  }

  /** A booking was collected: its collection stop is done wherever it sits. */
  async closeCollection(bookingId: string, driverId: string): Promise<void> {
    await this.dbs.transaction(async (tx) => {
      const rows = await tx
        .select({ stop: tripStops, trip: trips })
        .from(tripStops)
        .innerJoin(trips, eq(trips.id, tripStops.tripId))
        .where(and(eq(tripStops.kind, "collection"), eq(tripStops.bookingId, bookingId)));
      for (const { stop, trip } of rows) {
        if (trip.driverId !== driverId) continue;
        if (stop.status === "done" || stop.status === "skipped") continue;
        await tx
          .update(tripStops)
          .set({ status: "done", completedAt: new Date() })
          .where(eq(tripStops.id, stop.id));
      }
    });
  }

  // ── reads ───────────────────────────────────────────────────────────────────

  async list(query: TripQuery): Promise<Trip[]> {
    const where = [
      query.date ? eq(trips.date, query.date) : undefined,
      query.driverId ? eq(trips.driverId, query.driverId) : undefined,
      query.status ? eq(trips.status, query.status) : undefined,
    ].filter((c): c is NonNullable<typeof c> => !!c);
    const rows = await this.dbs.db
      .select()
      .from(trips)
      .where(where.length ? and(...where) : undefined)
      .orderBy(asc(trips.date), asc(trips.reference));
    return Promise.all(rows.map((r) => this.hydrate(this.dbs.db, r.id)));
  }

  async sheet(tripId: string): Promise<TripSheet> {
    const trip = await this.hydrate(this.dbs.db, tripId);
    const ids = (
      await this.dbs.db
        .select({ id: tripStops.id })
        .from(tripStops)
        .where(eq(tripStops.tripId, tripId))
        .orderBy(asc(tripStops.sequence))
    ).map((r) => r.id);
    return { ...trip, stops: await this.hydrateStops(this.dbs.db, tripId, ids) };
  }

  /** The trip a driver is working, or the next one released to them. */
  async currentFor(driver: Driver): Promise<TripSheet | null> {
    return this.forDriver(driver.id, await this.fleet.localDate());
  }

  /**
   * The day a driver has been handed for a date. A planned trip is deliberately not returned:
   * until a dispatcher releases it, it is a draft and the driver must not be working from it.
   */
  async forDriver(driverId: string, date: string): Promise<TripSheet | null> {
    const row = await this.dbs.db.query.trips.findFirst({
      where: and(
        eq(trips.driverId, driverId),
        eq(trips.date, date),
        inArray(trips.status, ["released", "started"]),
      ),
    });
    return row ? this.sheet(row.id) : null;
  }

  // ── internals ───────────────────────────────────────────────────────────────

  private async lockTrip(tx: DbExecutor, tripId: string) {
    const [row] = await tx.select().from(trips).where(eq(trips.id, tripId)).for("update");
    if (!row) throw AppError.notFound("trip");
    return row;
  }

  private async lockMutable(tx: DbExecutor, tripId: string) {
    const trip = await this.lockTrip(tx, tripId);
    if (!MUTABLE.includes(trip.status as (typeof MUTABLE)[number]))
      throw AppError.conflict("trip_closed", `trip is ${trip.status}`);
    return trip;
  }

  private async nextSequence(tx: DbExecutor, tripId: string): Promise<number> {
    const [row] = await tx
      .select({ max: sql<number | null>`max(${tripStops.sequence})` })
      .from(tripStops)
      .where(eq(tripStops.tripId, tripId));
    return (row?.max ?? 0) + 1;
  }

  /**
   * Write an order. Two passes, because `trip_stops_sequence_uq` is a plain unique index and
   * cannot be deferred: assigning 1,2,3 over 3,1,2 collides halfway through. Parking the rows
   * on negative sequences first leaves nothing to collide with.
   */
  private async writeSequence(tx: DbExecutor, tripId: string, stopIds: string[]): Promise<void> {
    for (const [i, id] of stopIds.entries()) {
      await tx
        .update(tripStops)
        .set({ sequence: -(i + 1) })
        .where(and(eq(tripStops.tripId, tripId), eq(tripStops.id, id)));
    }
    for (const [i, id] of stopIds.entries()) {
      await tx
        .update(tripStops)
        .set({ sequence: i + 1 })
        .where(and(eq(tripStops.tripId, tripId), eq(tripStops.id, id)));
    }
  }

  /** Close the gaps a removal left, so sequences stay 1..n. */
  private async compact(tx: DbExecutor, tripId: string): Promise<void> {
    const rows = await tx
      .select({ id: tripStops.id })
      .from(tripStops)
      .where(eq(tripStops.tripId, tripId))
      .orderBy(asc(tripStops.sequence));
    await this.writeSequence(
      tx,
      tripId,
      rows.map((r) => r.id),
    );
  }

  /** Take a shipment off whatever other live trip holds it. One shipment, one trip. */
  private async detach(tx: DbExecutor, shipmentId: string, reason: string): Promise<void> {
    const rows = await tx
      .select({ stop: tripStops, trip: trips })
      .from(tripStops)
      .innerJoin(trips, eq(trips.id, tripStops.tripId))
      .where(
        and(
          eq(tripStops.kind, "drop"),
          eq(tripStops.shipmentId, shipmentId),
          eq(tripStops.status, "pending"),
          inArray(trips.status, ["planned", "released", "started"]),
        ),
      );
    for (const { stop, trip } of rows) {
      await tx.delete(tripStops).where(eq(tripStops.id, stop.id));
      // A collection with no drops left on that trip is dead weight on the driver's day.
      const left = await tx.$count(
        tripStops,
        and(
          eq(tripStops.tripId, trip.id),
          eq(tripStops.kind, "drop"),
          eq(tripStops.bookingId, stop.bookingId),
        ),
      );
      if (left === 0) {
        await tx
          .delete(tripStops)
          .where(
            and(
              eq(tripStops.tripId, trip.id),
              eq(tripStops.kind, "collection"),
              eq(tripStops.bookingId, stop.bookingId),
              eq(tripStops.status, "pending"),
            ),
          );
      }
      await this.compact(tx, trip.id);
      void reason;
    }
  }

  private async nextReference(tx: DbExecutor, date: string): Promise<string> {
    const day = date.replace(/-/g, "").slice(2);
    const key = `TRIP:${day}`;
    await tx.insert(waybillCounters).values({ day: key }).onConflictDoNothing();
    const [row] = await tx
      .update(waybillCounters)
      .set({ next: sql`${waybillCounters.next} + 1` })
      .where(eq(waybillCounters.day, key))
      .returning({ next: waybillCounters.next });
    return `TRIP-${day}-${String(row!.next - 1).padStart(3, "0")}`;
  }

  /** The slot window a booking bought, in minutes, as the default target for its stops. */
  private async slotWindow(windowKey: string | null) {
    if (!windowKey) return null;
    const policy = await this.scheduling.policy();
    return policy.windows.find((w) => w.key === windowKey) ?? null;
  }

  private async stopRows(tx: DbExecutor, tripId: string) {
    const rows = await tx
      .select({ stop: tripStops, b: bookings, s: shipments })
      .from(tripStops)
      .innerJoin(bookings, eq(bookings.id, tripStops.bookingId))
      .leftJoin(shipments, eq(shipments.id, tripStops.shipmentId))
      .where(eq(tripStops.tripId, tripId))
      .orderBy(asc(tripStops.sequence));
    return rows.map((r) => {
      const parcels = (r.stop.kind === "drop" ? ((r.s?.parcels as unknown[]) ?? []) : []) as {
        quantity?: number;
      }[];
      const pieces = parcels.reduce((n, p) => n + (p.quantity ?? 1), 0);
      return {
        stop: r.stop,
        booking: r.b,
        shipment: r.s,
        location: addressLocation(r.stop.kind === "drop" ? r.s?.deliveryAddress : r.b.collection),
        pieces,
        serviceMinutes: serviceMinutes(r.stop.kind, pieces),
      };
    });
  }

  private async hydrate(tx: DbExecutor, tripId: string): Promise<Trip> {
    const [row] = await tx
      .select({ t: trips, driverName: drivers.fullName, registration: vehicles.registration })
      .from(trips)
      .innerJoin(drivers, eq(drivers.id, trips.driverId))
      .leftJoin(vehicles, eq(vehicles.id, trips.vehicleId))
      .where(eq(trips.id, tripId));
    if (!row) throw AppError.notFound("trip");
    const stops = await tx
      .select({ id: tripStops.id, status: tripStops.status })
      .from(tripStops)
      .where(eq(tripStops.tripId, tripId))
      .orderBy(asc(tripStops.sequence));
    const snapshot = row.t.routeSnapshot as Trip["route"];
    return {
      id: row.t.id,
      reference: row.t.reference,
      driverId: row.t.driverId,
      driverName: row.driverName,
      shiftId: row.t.shiftId,
      vehicleId: row.t.vehicleId,
      vehicleRegistration: row.registration ?? null,
      date: row.t.date,
      status: row.t.status,
      sequenceSource: row.t.sequenceSource,
      plannedKm: Number(row.t.plannedKm),
      plannedMinutes: row.t.plannedMinutes,
      route: snapshot
        ? {
            totalKm: snapshot.totalKm,
            originalKm: snapshot.originalKm,
            savedKm: snapshot.savedKm,
          }
        : null,
      startedAt: row.t.startedAt?.toISOString() ?? null,
      releasedAt: row.t.releasedAt?.toISOString() ?? null,
      completedAt: row.t.completedAt?.toISOString() ?? null,
      progress: {
        total: stops.length,
        done: stops.filter((s) => s.status === "done").length,
        skipped: stops.filter((s) => s.status === "skipped").length,
        currentStopId:
          stops.find((s) => s.status === "arrived")?.id ??
          stops.find((s) => s.status === "pending")?.id ??
          null,
      },
      createdAt: row.t.createdAt.toISOString(),
    };
  }

  private async hydrateStops(
    tx: DbExecutor,
    tripId: string,
    stopIds: string[],
  ): Promise<TripStop[]> {
    if (stopIds.length === 0) return [];
    const rows = await this.stopRows(tx, tripId);
    const wanted = new Set(stopIds);
    const siblings = await tx
      .select({
        id: shipments.id,
        waybill: shipments.waybill,
        status: shipments.status,
        bookingId: shipments.bookingId,
        parcels: shipments.parcels,
      })
      .from(shipments)
      .where(inArray(shipments.bookingId, [...new Set(rows.map((r) => r.stop.bookingId))]));

    return rows
      .filter((r) => wanted.has(r.stop.id))
      .map((r) => {
        const address = (
          r.stop.kind === "drop"
            ? r.shipment?.deliveryAddress
            : (r.booking.collection as { address: unknown }).address
        ) as TripStop["address"];
        const contact = (
          r.stop.kind === "drop"
            ? r.shipment?.recipient
            : (r.booking.collection as { contact: unknown }).contact
        ) as TripStop["contact"];
        const instructions =
          r.stop.kind === "drop"
            ? (r.shipment?.instructions ?? null)
            : ((r.booking.collection as { instructions: string | null }).instructions ?? null);
        return {
          id: r.stop.id,
          tripId: r.stop.tripId,
          kind: r.stop.kind,
          sequence: r.stop.sequence,
          status: r.stop.status,
          bookingId: r.stop.bookingId,
          bookingReference: r.booking.reference,
          shipmentId: r.stop.shipmentId,
          waybill: r.shipment?.waybill ?? null,
          shipmentStatus: r.shipment?.status ?? null,
          address,
          contact: contact ?? null,
          instructions,
          // A drop carries its own parcels; a collection carries everything the driver loads at
          // that counter, which is every shipment on the booking.
          parcels: (r.stop.kind === "drop"
            ? ((r.shipment?.parcels as TripStop["parcels"]) ?? [])
            : siblings
                .filter((s) => s.bookingId === r.stop.bookingId)
                .flatMap((s) => (s.parcels as TripStop["parcels"]) ?? [])) as TripStop["parcels"],
          serviceLevelCode: r.booking.serviceLevelCode,
          window: {
            startMinute: r.stop.windowStartMinute,
            endMinute: r.stop.windowEndMinute,
            source: r.stop.windowSource,
          },
          plannedArrivalMinute: r.stop.plannedArrivalMinute,
          plannedServiceMinutes: r.stop.plannedServiceMinutes,
          legKm: r.stop.legKm == null ? null : Number(r.stop.legKm),
          legMinutes: r.stop.legMinutes,
          arrivedAt: r.stop.arrivedAt?.toISOString() ?? null,
          completedAt: r.stop.completedAt?.toISOString() ?? null,
          groupKey: r.stop.groupKey,
          note: r.stop.note,
          shipments: siblings
            .filter((s) => s.bookingId === r.stop.bookingId)
            .map((s) => ({ shipmentId: s.id, waybill: s.waybill, status: s.status })),
        };
      });
  }
}

/**
 * Pull coordinates out of either shape we store them in.
 *
 * A shipment's `delivery_address` *is* an address, so the point is at `.location`. A booking's
 * `collection` is a wrapper around one, so it is at `.address.location`. Reading only the first
 * meant every collection stop looked unplaceable and was quietly left out of the route — the
 * day was being ordered over its deliveries alone, and the "saved km" on the trip sheet was
 * measuring the wrong journey.
 */
function addressLocation(value: unknown): LatLng | null {
  const node = (value ?? null) as { location?: LatLng; address?: { location?: LatLng } } | null;
  const loc = node?.location ?? node?.address?.location;
  return loc && typeof loc.lat === "number" && typeof loc.lng === "number" ? loc : null;
}

function minuteOfDay(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? "0");
  return get("hour") * 60 + get("minute");
}

function round2(km: number): number {
  return Math.round(km * 100) / 100;
}

/**
 * A sold window if there is one, otherwise the slot it sits in.
 *
 * `source` is the part that matters later: the board and the trip sheet show what was promised
 * differently from what was merely inherited, and a dispatcher narrowing a slot-derived window
 * is a different act from one overriding a window a customer paid for.
 */
function windowOr(
  startMinute: number | null,
  endMinute: number | null,
  fallback: { startMinute: number | null; endMinute: number | null; source: WindowSource },
): { startMinute: number | null; endMinute: number | null; source: WindowSource } {
  return startMinute != null && endMinute != null
    ? { startMinute, endMinute, source: "sold" }
    : fallback;
}
