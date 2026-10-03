import { z } from "zod";
import { Uuid } from "./common.js";
import { Address, LatLng } from "./geo.js";
import { Contact } from "./quotes.js";
import { QuoteParcel } from "../pricing.js";
import { IsoDate } from "./slots.js";
import { ShipmentStatus } from "./bookings.js";

/**
 * Operations: trips, trip stops and the dispatch board.
 *
 * A trip is one driver's day, written down. The shipment stays the unit of delivery and of
 * money; the trip is the unit of dispatch. Nothing in this file concerns money.
 */

export const TripStatus = z.enum(["planned", "released", "started", "completed", "abandoned"]);
export type TripStatus = z.infer<typeof TripStatus>;

export const SequenceSource = z.enum(["auto", "dispatcher"]);
export type SequenceSource = z.infer<typeof SequenceSource>;

export const TripStopKind = z.enum(["collection", "drop"]);
export type TripStopKind = z.infer<typeof TripStopKind>;

export const TripStopStatus = z.enum(["pending", "arrived", "done", "skipped"]);
export type TripStopStatus = z.infer<typeof TripStopStatus>;

export const WindowSource = z.enum(["slot", "dispatcher", "pinned"]);
export type WindowSource = z.infer<typeof WindowSource>;

/** Minutes past midnight, local. 540 = 09:00. */
export const MinuteOfDay = z.number().int().min(0).max(1440);

export const TripStopWindow = z.object({
  startMinute: MinuteOfDay.nullable(),
  endMinute: MinuteOfDay.nullable(),
  source: WindowSource,
});
export type TripStopWindow = z.infer<typeof TripStopWindow>;

/**
 * A stop as the board and the trip sheet read it. Carries both the plan (what we said we would
 * do) and the actual (what happened), because the gap between them is the whole point of a
 * dispatch board.
 */
export const TripStop = z.object({
  id: Uuid,
  tripId: Uuid,
  kind: TripStopKind,
  sequence: z.number().int().positive(),
  status: TripStopStatus,
  bookingId: Uuid,
  bookingReference: z.string(),
  /** Null on a collection stop: it covers every shipment of its booking. */
  shipmentId: Uuid.nullable(),
  waybill: z.string().nullable(),
  shipmentStatus: ShipmentStatus.nullable(),
  address: Address,
  contact: Contact.nullable(),
  instructions: z.string().nullable(),
  parcels: z.array(QuoteParcel),
  serviceLevelCode: z.string(),
  window: TripStopWindow,
  plannedArrivalMinute: MinuteOfDay.nullable(),
  plannedServiceMinutes: z.number().int().nonnegative().nullable(),
  legKm: z.number().nonnegative().nullable(),
  legMinutes: z.number().int().nonnegative().nullable(),
  arrivedAt: z.string().datetime().nullable(),
  completedAt: z.string().datetime().nullable(),
  groupKey: z.string().nullable(),
  note: z.string().nullable(),
  /** Shipments on this stop's booking — what the driver loads at a collection. */
  shipments: z.array(z.object({ shipmentId: Uuid, waybill: z.string(), status: ShipmentStatus })),
});
export type TripStop = z.infer<typeof TripStop>;

export const TripProgress = z.object({
  total: z.number().int().nonnegative(),
  done: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
  /** The stop the driver is working, or the next pending one. Null when the day is finished. */
  currentStopId: Uuid.nullable(),
});
export type TripProgress = z.infer<typeof TripProgress>;

export const Trip = z.object({
  id: Uuid,
  reference: z.string(),
  driverId: Uuid,
  driverName: z.string(),
  shiftId: Uuid.nullable(),
  vehicleId: Uuid.nullable(),
  vehicleRegistration: z.string().nullable(),
  date: IsoDate,
  status: TripStatus,
  sequenceSource: SequenceSource,
  plannedKm: z.number().nonnegative(),
  plannedMinutes: z.number().int().nonnegative(),
  route: z
    .object({ totalKm: z.number(), originalKm: z.number(), savedKm: z.number() })
    .nullable()
    .default(null),
  startedAt: z.string().datetime().nullable(),
  releasedAt: z.string().datetime().nullable(),
  completedAt: z.string().datetime().nullable(),
  progress: TripProgress,
  createdAt: z.string().datetime(),
});
export type Trip = z.infer<typeof Trip>;

/** A trip with its stops: the trip sheet. */
export const TripSheet = Trip.extend({ stops: z.array(TripStop) });
export type TripSheet = z.infer<typeof TripSheet>;

/**
 * What the driver app gets when it asks for today's trip. Wrapped because a bare `null` arrives
 * as an empty body, which the app cannot tell apart from a trip that lost its fields.
 */
export const CurrentTripResponse = z.object({ trip: TripSheet.nullable() });
export type CurrentTripResponse = z.infer<typeof CurrentTripResponse>;

// ── requests ──────────────────────────────────────────────────────────────────

export const CreateTripRequest = z.object({
  driverId: Uuid,
  date: IsoDate,
  vehicleId: Uuid.nullable().default(null),
});
export type CreateTripRequest = z.infer<typeof CreateTripRequest>;

/**
 * Put shipments on a trip. A drop implies its booking's collection, which is added for free —
 * a dispatcher should not have to remember that a parcel must be picked up before it is
 * delivered, and the precedence rule in the sequencer depends on the collection being present.
 */
export const AddStopsRequest = z.object({
  shipmentIds: z.array(Uuid).min(1).max(100),
  /** Re-run the sequencer after adding. Off when a dispatcher is placing stops by hand. */
  resequence: z.boolean().default(true),
});
export type AddStopsRequest = z.infer<typeof AddStopsRequest>;

export const RemoveStopsRequest = z.object({
  stopIds: z.array(Uuid).min(1).max(100),
  reason: z.string().max(200).nullable().default(null),
});
export type RemoveStopsRequest = z.infer<typeof RemoveStopsRequest>;

/** The dispatcher's hand-ordering. Every stop on the trip must appear exactly once. */
export const ResequenceRequest = z.object({ stopIds: z.array(Uuid).min(1).max(200) });
export type ResequenceRequest = z.infer<typeof ResequenceRequest>;

export const SetStopWindowRequest = z.object({
  startMinute: MinuteOfDay.nullable(),
  endMinute: MinuteOfDay.nullable(),
  /** An exact minute to anchor the stop to; sets both ends and marks the window pinned. */
  pinnedMinute: MinuteOfDay.nullable().default(null),
});
export type SetStopWindowRequest = z.infer<typeof SetStopWindowRequest>;

export const ArriveRequest = z.object({
  stopId: Uuid,
  location: LatLng.nullable().default(null),
});
export type ArriveRequest = z.infer<typeof ArriveRequest>;

export const AbandonTripRequest = z.object({ reason: z.string().min(1).max(200) });
export type AbandonTripRequest = z.infer<typeof AbandonTripRequest>;

export const TripQuery = z.object({
  date: IsoDate.optional(),
  driverId: Uuid.optional(),
  status: TripStatus.optional(),
});
export type TripQuery = z.infer<typeof TripQuery>;
