import { z } from "zod";
import { Cents } from "../money.js";
import { CustomerQuoteBreakdown, QuoteOptions, QuoteParcel } from "../pricing.js";
import { Uuid } from "./common.js";
import { Address } from "./geo.js";
import { Contact } from "./quotes.js";
import { IsoDate, SlotRef, TimedWindow } from "./slots.js";

/**
 * Bookings & Shipments. A booking is the commercial unit (one collection, N drops, one price,
 * one hold). Each drop is a shipment with its own waybill and status history.
 */

export const BookingStatus = z.enum([
  "confirmed",
  "in_progress",
  "completed",
  "cancelled",
  "rejected_insufficient_funds",
  "rejected_slot_unavailable",
  "rejected_quote_expired",
]);
export type BookingStatus = z.infer<typeof BookingStatus>;

export const ShipmentStatus = z.enum([
  "booked",
  "assigned",
  "collected",
  "in_transit",
  "out_for_delivery",
  "on_hold",
  "delivered",
  "failed",
  "returned_to_sender",
  "cancelled",
]);
export type ShipmentStatus = z.infer<typeof ShipmentStatus>;

/**
 * What a status is called where anyone reads it.
 *
 * Not `status.replace(/_/g, " ")`, which is how this used to be rendered. That showed `failed`
 * as "failed", and a recipient reading "failed" believes their parcel is lost rather than that
 * one attempt did not find them in. The words here are the ones a customer, a recipient and a
 * dispatcher all see, so they are written to be read by someone who is worried.
 */
export const SHIPMENT_STATUS_LABELS: Record<ShipmentStatus, string> = {
  booked: "Booked",
  assigned: "Assigned to a driver",
  collected: "Collected",
  in_transit: "In transit",
  out_for_delivery: "Out for delivery",
  on_hold: "On hold",
  delivered: "Delivered",
  // Not "failed". The parcel is fine and it is going out again; saying otherwise invites a
  // phone call from someone who thinks it is gone.
  failed: "Failed delivery attempt",
  returned_to_sender: "Returned to sender",
  cancelled: "Cancelled",
};

/**
 * Legal transitions. Terminal states have no exits; corrections are new bookings.
 *
 * `out_for_delivery` is the final leg — on the van, on the way to this recipient — and is the
 * only status that makes the driver's position visible to the people waiting. `in_transit` is
 * the broader "moving, but not yet on its way to you".
 *
 * `failed` is not terminal: a parcel nobody was in for goes out again, so it has exits back
 * into the run. `returned_to_sender` is where it ends up when it cannot.
 */
export const SHIPMENT_TRANSITIONS: Record<ShipmentStatus, readonly ShipmentStatus[]> = {
  booked: ["assigned", "collected", "cancelled"],
  assigned: ["collected", "booked", "cancelled", "on_hold"],
  collected: ["out_for_delivery", "in_transit", "delivered", "failed", "on_hold"],
  in_transit: ["out_for_delivery", "delivered", "failed", "on_hold"],
  out_for_delivery: ["delivered", "failed", "in_transit", "on_hold"],
  on_hold: ["assigned", "in_transit", "out_for_delivery", "returned_to_sender", "cancelled"],
  delivered: [],
  failed: ["assigned", "in_transit", "out_for_delivery", "on_hold", "returned_to_sender"],
  returned_to_sender: [],
  cancelled: [],
};

/**
 * Which statuses a shipment can be in and still reach `to`.
 *
 * Derived from `SHIPMENT_TRANSITIONS` rather than written out again, so a transition added in
 * one place cannot be forgotten in the other. Used to tell a driver what is wrong when a status
 * change is refused: "shipment is delivered" is worth more than "invalid transition".
 */
export function statusesThatCanBecome(to: ShipmentStatus): ShipmentStatus[] {
  return (Object.keys(SHIPMENT_TRANSITIONS) as ShipmentStatus[]).filter((from) =>
    SHIPMENT_TRANSITIONS[from].includes(to),
  );
}

/** A shipment whose journey is over, one way or another. Nothing more will happen to it. */
export const SHIPMENT_TERMINAL: readonly ShipmentStatus[] = [
  "delivered",
  "returned_to_sender",
  "cancelled",
];

/**
 * Still someone's work. Derived from the terminal list rather than written out, because the
 * copy that was written out went stale the moment a status was added: the dispatch board's own
 * list stopped at `in_transit`, so an on-demand parcel vanished off the board at the exact
 * moment its driver marked it out for delivery.
 */
export const SHIPMENT_UNFINISHED: readonly ShipmentStatus[] = ShipmentStatus.options.filter(
  (s) => !SHIPMENT_TERMINAL.includes(s),
);

/**
 * The parcel is in the driver's keeping: picked up, not yet handed over.
 *
 * These are the statuses a delivery or a failed attempt can be recorded from. Named once
 * because it was written out twice as `["collected", "in_transit"]`, and adding
 * `out_for_delivery` to the journey without touching both copies made the ordinary path
 * undeliverable — the driver marked a parcel out for delivery and the engine then refused to
 * accept the delivery.
 */
export const IN_DRIVER_HANDS: readonly ShipmentStatus[] = [
  "collected",
  "in_transit",
  "out_for_delivery",
];

/**
 * The statuses a driver may set from their own app.
 *
 * `delivered` is absent on purpose: it is reached through the proof-of-delivery flow, which
 * takes a name and a photo, and not as a bare status change — a delivery with no proof is what
 * a dispute is made of. `returned_to_sender` is absent because ending the job bears on what
 * the customer is charged, and that is a dispatcher's call.
 */
export const DRIVER_SETTABLE_STATUSES: readonly ShipmentStatus[] = [
  "collected",
  "in_transit",
  "out_for_delivery",
  "on_hold",
];

export const CreateBookingRequest = z.object({
  quoteId: Uuid,
  /** Required when the quote's service level needs a slot (Standard). */
  slot: SlotRef.optional(),
  /** Client-generated key so a retried submit cannot double-book. Defaults to the quote id. */
  idempotencyKey: z.string().min(8).max(120).optional(),
  /** The customer's own identifier for this job, searchable and printed on their invoice. */
  customerReference: z.string().trim().max(60).optional(),
  /**
   * Book even though the wallet cannot cover it, taking the balance negative.
   *
   * Super admin only, and refused outright for anyone else rather than ignored — a flag that
   * silently does nothing is how someone believes a booking went through on credit when it
   * did not. Every booking made this way is marked in the audit log.
   */
  allowNegativeBalance: z.boolean().optional(),
  /**
   * Recipient details for the quote's drops, in the same order, for anything the quote did
   * not carry.
   *
   * A quote only needs an address to produce a price, so the people are usually named here
   * instead — at the point someone commits to the delivery, which is when a driver actually
   * needs a name and a number to knock on a door with. Anything already on the quote wins;
   * this fills the gaps.
   */
  drops: z
    .array(
      z.object({
        recipient: Contact,
        instructions: z.string().max(500).nullable().optional(),
      }),
    )
    .max(20)
    .optional(),
  /**
   * The narrow windows to hold. Must match what the quote was priced with, or the booking is
   * refused: a window the customer did not pay for is one we have not agreed to keep.
   */
  timedWindow: z
    .object({
      collection: TimedWindow.nullable().default(null),
      delivery: TimedWindow.nullable().default(null),
    })
    .optional(),
});
export type CreateBookingRequest = z.infer<typeof CreateBookingRequest>;

export const ShipmentEvent = z.object({
  id: Uuid,
  status: ShipmentStatus,
  note: z.string().nullable(),
  occurredAt: z.string().datetime(),
});
export type ShipmentEvent = z.infer<typeof ShipmentEvent>;

export const Shipment = z.object({
  id: Uuid,
  bookingId: Uuid,
  accountId: Uuid,
  waybill: z.string(),
  sequence: z.number().int(),
  status: ShipmentStatus,
  serviceLevelCode: z.string(),
  slotDate: IsoDate.nullable(),
  slotWindowKey: z.string().nullable(),
  /** The narrow window promised for this drop, when one was sold. */
  deliveryWindow: TimedWindow.nullable().default(null),
  recipient: Contact,
  deliveryAddress: Address,
  instructions: z.string().nullable(),
  parcels: z.array(QuoteParcel),
  deliveredAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  events: z.array(ShipmentEvent).optional(),
});
export type Shipment = z.infer<typeof Shipment>;

export const Booking = z.object({
  id: Uuid,
  accountId: Uuid,
  quoteId: Uuid,
  reference: z.string(),
  customerReference: z.string().nullable(),
  status: BookingStatus,
  serviceLevelCode: z.string(),
  slotDate: IsoDate.nullable(),
  slotWindowKey: z.string().nullable(),
  collection: z.object({
    address: Address,
    contact: Contact.nullable(),
    instructions: z.string().nullable(),
  }),
  /** The narrow collection window promised, when one was sold. */
  collectionWindow: TimedWindow.nullable().default(null),
  options: QuoteOptions,
  breakdown: CustomerQuoteBreakdown,
  totalCents: Cents,
  holdId: Uuid.nullable(),
  rejectionReason: z.string().nullable(),
  createdAt: z.string().datetime(),
  cancelledAt: z.string().datetime().nullable(),
  shipments: z.array(Shipment),
});
export type Booking = z.infer<typeof Booking>;

export const CancelBookingRequest = z.object({ reason: z.string().min(3).max(300) });

export const UpdateShipmentStatusRequest = z.object({
  status: ShipmentStatus,
  note: z.string().max(300).optional(),
});
export type UpdateShipmentStatusRequest = z.infer<typeof UpdateShipmentStatusRequest>;

/** Public tracking view: no personal data beyond suburb/city. */
export const TrackingView = z.object({
  waybill: z.string(),
  status: ShipmentStatus,
  serviceLevel: z.string(),
  slot: z.object({ date: IsoDate, label: z.string() }).nullable(),
  destination: z.object({ suburb: z.string().nullable(), city: z.string().nullable() }),
  deliveredAt: z.string().datetime().nullable(),
  timeline: z.array(z.object({ status: ShipmentStatus, occurredAt: z.string().datetime() })),
});
export type TrackingView = z.infer<typeof TrackingView>;
