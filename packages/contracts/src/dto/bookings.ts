import { z } from "zod";
import { Cents } from "../money.js";
import { CustomerQuoteBreakdown, QuoteOptions, QuoteParcel } from "../pricing.js";
import { Uuid } from "./common.js";
import { Address } from "./geo.js";
import { Contact } from "./quotes.js";
import { IsoDate, SlotRef } from "./slots.js";

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
  "delivered",
  "failed",
  "cancelled",
]);
export type ShipmentStatus = z.infer<typeof ShipmentStatus>;

/** Legal transitions. Terminal states have no exits; corrections are new bookings. */
export const SHIPMENT_TRANSITIONS: Record<ShipmentStatus, readonly ShipmentStatus[]> = {
  booked: ["assigned", "collected", "cancelled"],
  assigned: ["collected", "booked", "cancelled"],
  collected: ["in_transit", "delivered", "failed"],
  in_transit: ["delivered", "failed"],
  delivered: [],
  failed: ["assigned", "in_transit"],
  cancelled: [],
};

export const CreateBookingRequest = z.object({
  quoteId: Uuid,
  /** Required when the quote's service level needs a slot (Standard). */
  slot: SlotRef.optional(),
  /** Client-generated key so a retried submit cannot double-book. Defaults to the quote id. */
  idempotencyKey: z.string().min(8).max(120).optional(),
  /** The customer's own identifier for this job, searchable and printed on their invoice. */
  customerReference: z.string().trim().max(60).optional(),
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
