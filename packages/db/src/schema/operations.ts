import { sql } from "drizzle-orm";
import {
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { id, timestamps } from "./_shared.js";
import { bookings, shipments } from "./bookings.js";
import { drivers, shifts, vehicles } from "./fleet.js";
import { users } from "./identity.js";

/**
 * Operations: the dispatch layer.
 *
 * A driver's day used to be recomputed on every request — read the active assignments, group
 * them, order them. That has one fatal property for a dispatcher: nothing about it is a
 * decision. There is no row saying the Menlyn drop goes third, no planned time to measure an
 * arrival against, and the sequence can rearrange itself between two refreshes of the app.
 *
 * A trip is that decision, written down. The shipment stays the unit of delivery and of money
 * (one waybill, one POD, one settlement, one journal); the trip is the unit of dispatch. Nothing
 * here touches the ledger.
 */

export const tripStatusEnum = pgEnum("trip_status", [
  /** Being built by a dispatcher; the driver cannot see it. */
  "planned",
  /** Handed to the driver. */
  "released",
  /** The driver has started working it. */
  "started",
  "completed",
  /** Abandoned before completion; kept for the record, never deleted. */
  "abandoned",
]);

/** Who put the stops in this order. A dispatcher's hand always beats the optimiser. */
export const sequenceSourceEnum = pgEnum("sequence_source", ["auto", "dispatcher"]);

export const trips = pgTable(
  "trips",
  {
    id: id(),
    reference: text("reference").notNull(),
    driverId: uuid("driver_id")
      .notNull()
      .references(() => drivers.id, { onDelete: "restrict" }),
    /** The shift this trip is worked on. Null while planned for a date with no shift yet. */
    shiftId: uuid("shift_id").references(() => shifts.id, { onDelete: "set null" }),
    vehicleId: uuid("vehicle_id").references(() => vehicles.id, { onDelete: "set null" }),
    date: date("date", { mode: "string" }).notNull(),
    status: tripStatusEnum("status").notNull().default("planned"),
    sequenceSource: sequenceSourceEnum("sequence_source").notNull().default("auto"),
    plannedKm: numeric("planned_km", { precision: 8, scale: 2 }).notNull().default("0"),
    plannedMinutes: integer("planned_minutes").notNull().default(0),
    /** What the ordering saved when it ran, for the trip sheet header. */
    routeSnapshot: jsonb("route_snapshot"),
    startedAt: timestamp("started_at", { withTimezone: true, mode: "date" }),
    completedAt: timestamp("completed_at", { withTimezone: true, mode: "date" }),
    releasedAt: timestamp("released_at", { withTimezone: true, mode: "date" }),
    abandonedReason: text("abandoned_reason"),
    createdByUserId: uuid("created_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("trips_reference_uq").on(t.reference),
    // One live trip per driver per day. An abandoned trip is history and must not block a
    // replacement, so it is excluded rather than deleted.
    uniqueIndex("trips_driver_date_uq")
      .on(t.driverId, t.date)
      .where(sql`${t.status} <> 'abandoned'`),
    index("trips_date_idx").on(t.date, t.status),
  ],
);

export const tripStopKindEnum = pgEnum("trip_stop_kind", ["collection", "drop"]);

export const tripStopStatusEnum = pgEnum("trip_stop_status", [
  "pending",
  /** The driver is there. Distinct from done: arrival is what ETA accuracy is measured on. */
  "arrived",
  "done",
  /** Passed over — nobody home, gate locked. The shipment's own status says what happened. */
  "skipped",
]);

/**
 * Where the window on a stop came from. `slot` is the commercial promise the customer bought,
 * widened to the whole slot window; `dispatcher` is a narrowed target; `pinned` is an exact
 * minute the dispatcher anchored. Keeping the source means the board can show "was 14:00–17:00"
 * rather than quietly losing what was sold.
 */
export const windowSourceEnum = pgEnum("trip_stop_window_source", ["slot", "dispatcher", "pinned"]);

export const tripStops = pgTable(
  "trip_stops",
  {
    id: id(),
    tripId: uuid("trip_id")
      .notNull()
      .references(() => trips.id, { onDelete: "cascade" }),
    kind: tripStopKindEnum("kind").notNull(),
    /** 1-based position in the day. Unique per trip. */
    sequence: integer("sequence").notNull(),
    bookingId: uuid("booking_id")
      .notNull()
      .references(() => bookings.id, { onDelete: "restrict" }),
    /** Null on a collection stop: it covers every shipment of its booking, as the driver app does. */
    shipmentId: uuid("shipment_id").references(() => shipments.id, { onDelete: "restrict" }),
    status: tripStopStatusEnum("status").notNull().default("pending"),
    /** Minutes past midnight the driver is expected to arrive, from the sequencing run. */
    plannedArrivalMinute: integer("planned_arrival_minute"),
    plannedServiceMinutes: integer("planned_service_minutes"),
    legKm: numeric("leg_km", { precision: 8, scale: 2 }),
    legMinutes: integer("leg_minutes"),
    /** The window the driver is working to. Minutes past midnight. */
    windowStartMinute: integer("window_start_minute"),
    windowEndMinute: integer("window_end_minute"),
    windowSource: windowSourceEnum("window_source").notNull().default("slot"),
    /** Stops a dispatcher merged into one call. Shared key, serviced together. */
    groupKey: text("group_key"),
    arrivedAt: timestamp("arrived_at", { withTimezone: true, mode: "date" }),
    completedAt: timestamp("completed_at", { withTimezone: true, mode: "date" }),
    note: text("note"),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("trip_stops_sequence_uq").on(t.tripId, t.sequence),
    // A drop appears at most once on a trip. Collections are keyed by booking instead, below.
    uniqueIndex("trip_stops_drop_uq")
      .on(t.tripId, t.shipmentId)
      .where(sql`${t.kind} = 'drop'`),
    uniqueIndex("trip_stops_collection_uq")
      .on(t.tripId, t.bookingId)
      .where(sql`${t.kind} = 'collection'`),
    index("trip_stops_trip_idx").on(t.tripId, t.sequence),
    index("trip_stops_shipment_idx").on(t.shipmentId),
  ],
);
