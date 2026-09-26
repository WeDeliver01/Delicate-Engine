import { z } from "zod";
import { Uuid } from "./common.js";
import { IsoDate } from "./slots.js";
import { Address } from "./geo.js";
import { Contact } from "./quotes.js";

/**
 * Changing a shipment that is already booked.
 *
 * A customer notices the phone number is wrong, or the recipient has moved, or nobody will be
 * in on Thursday. Some of those cost us nothing and should just happen; others change the
 * route, the price or a reserved slot and need someone to look. Rather than deciding that at
 * each call site, every change is asked for the same way and the engine rules on it.
 */

export const ChangeRequestKind = z.enum([
  "recipient_contact",
  "delivery_address",
  "instructions",
  "reschedule",
]);
export type ChangeRequestKind = z.infer<typeof ChangeRequestKind>;

export const ChangeRequestStatus = z.enum([
  "pending",
  "approved",
  "rejected",
  "auto_applied",
  "withdrawn",
]);
export type ChangeRequestStatus = z.infer<typeof ChangeRequestStatus>;

export const CHANGE_REQUEST_KIND_LABELS: Record<ChangeRequestKind, string> = {
  recipient_contact: "Recipient details",
  delivery_address: "Delivery address",
  instructions: "Delivery instructions",
  reschedule: "Delivery date",
};

/** The payload for each kind. Discriminated so an address change cannot smuggle in a new date. */
export const ChangeRequestPayload = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("recipient_contact"),
    recipient: Contact,
  }),
  z.object({
    kind: z.literal("delivery_address"),
    deliveryAddress: Address,
  }),
  z.object({
    kind: z.literal("instructions"),
    instructions: z.string().trim().max(500).nullable(),
  }),
  z.object({
    kind: z.literal("reschedule"),
    slotDate: IsoDate,
    slotWindowKey: z.string().trim().min(1).max(40),
  }),
]);
export type ChangeRequestPayload = z.infer<typeof ChangeRequestPayload>;

export const CreateChangeRequest = z.object({
  payload: ChangeRequestPayload,
  /** The customer's own words, shown to whoever rules on it. */
  reason: z.string().trim().max(300).optional(),
});
export type CreateChangeRequest = z.infer<typeof CreateChangeRequest>;

export const DecideChangeRequest = z.object({
  decision: z.enum(["approve", "reject"]),
  note: z.string().trim().max(300).optional(),
});
export type DecideChangeRequest = z.infer<typeof DecideChangeRequest>;

export const ChangeRequest = z.object({
  id: Uuid,
  shipmentId: Uuid,
  accountId: Uuid,
  waybill: z.string().optional(),
  kind: ChangeRequestKind,
  status: ChangeRequestStatus,
  requested: z.record(z.string(), z.unknown()),
  previous: z.record(z.string(), z.unknown()),
  reason: z.string().nullable(),
  heldBecause: z.string().nullable(),
  decisionNote: z.string().nullable(),
  decidedAt: z.string().nullable(),
  createdAt: z.string(),
});
export type ChangeRequest = z.infer<typeof ChangeRequest>;
