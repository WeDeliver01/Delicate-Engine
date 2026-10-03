import { z } from "zod";
import { Cents } from "../money.js";
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

// ── the dispatch board ────────────────────────────────────────────────────────

/**
 * The lanes the board is divided into. Mutually exclusive and derived from the shipment's own
 * status plus where it sits on a started trip — a shipment is in exactly one of them.
 *
 * Three are not statuses and cannot be stored, because they stop being true the moment the
 * driver moves: `en_route_collection` and `out_for_delivery` are read off the trip's current
 * stop, and `awaiting_driver` is "assigned, but nobody has handed the driver a day yet".
 */
export const BoardLane = z.enum([
  "unassigned",
  "awaiting_driver",
  "en_route_collection",
  "collected",
  "in_transit",
  "out_for_delivery",
  "delivered",
  "failed",
]);
export type BoardLane = z.infer<typeof BoardLane>;

export const BOARD_LANE_LABELS: Record<BoardLane, string> = {
  unassigned: "Unassigned",
  awaiting_driver: "Assigned",
  en_route_collection: "Going to collect",
  collected: "Collected",
  in_transit: "In transit",
  out_for_delivery: "Out for delivery",
  delivered: "Delivered",
  failed: "Failed",
};

/**
 * Why a shipment needs a person to look at it.
 *
 * Deliberately *not* a lane. A shipment that is late is still in transit, and moving its card
 * out of the lane it is actually in to a bin called "exception" loses the one fact a dispatcher
 * needs in order to act on it. So this rides on the card, and the board also counts them.
 */
export const BoardExceptionKind = z.enum([
  /** Past the window it is working to, and not finished. Needs a trip to be meaningful. */
  "behind_schedule",
  /** Scheduled for a day already gone and still not finished. */
  "overdue",
  /** A delivery was attempted and failed; somebody has to decide what happens next. */
  "failed_attempt",
  /** Today's work with no driver on it. */
  "no_driver",
  /** Something was changed after the driver was assigned, so they may be driving to the old one. */
  "changed_after_assignment",
  /** A customer is waiting on ops to rule on a change. */
  "change_awaiting_decision",
]);
export type BoardExceptionKind = z.infer<typeof BoardExceptionKind>;

export const BOARD_EXCEPTION_LABELS: Record<BoardExceptionKind, string> = {
  behind_schedule: "Behind schedule",
  overdue: "Overdue",
  failed_attempt: "Failed attempt",
  no_driver: "No driver",
  changed_after_assignment: "Changed after assignment",
  change_awaiting_decision: "Change awaiting decision",
};

/** One shipment on the board. Everything a dispatcher needs before opening anything. */
export const BoardCard = z.object({
  shipmentId: Uuid,
  waybill: z.string(),
  bookingId: Uuid,
  bookingReference: z.string(),
  customerReference: z.string().nullable(),
  accountId: Uuid,
  accountName: z.string(),
  lane: BoardLane,
  status: ShipmentStatus,
  serviceLevelCode: z.string(),
  slotDate: IsoDate.nullable(),
  slotWindowKey: z.string().nullable(),
  collection: z.object({ address: Address, contact: Contact.nullable() }),
  delivery: z.object({ address: Address, contact: Contact.nullable() }),
  instructions: z.string().nullable(),
  parcels: z.array(QuoteParcel),
  /** Integer cents, from the parcels that declared one. Null when nothing was declared. */
  declaredValueCents: Cents.nullable(),
  priceCents: Cents,
  driverId: Uuid.nullable(),
  driverName: z.string().nullable(),
  tripId: Uuid.nullable(),
  tripReference: z.string().nullable(),
  /** Where this shipment's drop sits on the driver's day, when it is on one. */
  stopSequence: z.number().int().positive().nullable(),
  window: TripStopWindow.nullable(),
  plannedArrivalMinute: MinuteOfDay.nullable(),
  etaMinute: MinuteOfDay.nullable(),
  exceptions: z.array(BoardExceptionKind),
  updatedAt: z.string().datetime(),
});
export type BoardCard = z.infer<typeof BoardCard>;

/** A driver's day at a glance: the right-hand rail of the board. */
export const BoardDriver = z.object({
  driverId: Uuid,
  name: z.string(),
  vehicleRegistration: z.string().nullable(),
  shiftStatus: z.enum(["none", "scheduled", "open", "closed"]),
  tripId: Uuid.nullable(),
  tripReference: z.string().nullable(),
  tripStatus: TripStatus.nullable(),
  progress: TripProgress.nullable(),
  /** What they are doing right now, in words, for the rail. */
  activity: z.enum(["available", "no_shift", "planned", "ready", "working", "finished"]),
  currentStop: z
    .object({
      kind: TripStopKind,
      sequence: z.number().int().positive(),
      address: z.string(),
      waybill: z.string().nullable(),
      windowEndMinute: MinuteOfDay.nullable(),
    })
    .nullable(),
  lastSeen: z
    .object({ at: z.string().datetime(), location: LatLng, ageMinutes: z.number().int() })
    .nullable(),
  behindCount: z.number().int().nonnegative(),
});
export type BoardDriver = z.infer<typeof BoardDriver>;

export const DispatchBoard = z.object({
  date: IsoDate,
  /** Minutes past midnight in the operating timezone, so the client need not guess the clock. */
  nowMinute: MinuteOfDay,
  cards: z.array(BoardCard),
  drivers: z.array(BoardDriver),
  laneCounts: z.record(BoardLane, z.number().int().nonnegative()),
  exceptionCounts: z.record(BoardExceptionKind, z.number().int().nonnegative()),
});
export type DispatchBoard = z.infer<typeof DispatchBoard>;

export const BoardQuery = z.object({ date: IsoDate.optional() });
export type BoardQuery = z.infer<typeof BoardQuery>;

/**
 * Who should take this shipment, and why.
 *
 * The reason is the whole point. A dispatcher who cannot see why a name was suggested either
 * follows it blindly or ignores the feature, and both are worse than no suggestion.
 */
export const AssignmentRecommendation = z.object({
  driverId: Uuid,
  name: z.string(),
  /** Lower is better. Exposed so the ordering is not a mystery, not for display. */
  score: z.number(),
  distanceKm: z.number().nonnegative(),
  load: z.number().int().nonnegative(),
  capacity: z.number().int().nonnegative(),
  tripId: Uuid.nullable(),
  tripReference: z.string().nullable(),
  reason: z.string(),
});
export type AssignmentRecommendation = z.infer<typeof AssignmentRecommendation>;

/** Put a shipment on a driver's day, making the trip if they do not have one for that date. */
export const AssignToDayRequest = z.object({
  shipmentId: Uuid,
  driverId: Uuid,
  date: IsoDate.nullable().default(null),
});
export type AssignToDayRequest = z.infer<typeof AssignToDayRequest>;
