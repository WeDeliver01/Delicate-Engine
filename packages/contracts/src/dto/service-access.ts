import { z } from "zod";
import { Uuid } from "./common.js";
import { SlotRef } from "./slots.js";
import { QuoteOptions } from "../pricing.js";
import { Address } from "./geo.js";
import { Contact, DropInput, Quote } from "./quotes.js";
import { Booking } from "./bookings.js";

/**
 * Service access: how another system books on a customer's behalf.
 *
 * Everything the engine does for a human comes from a Supabase JWT plus an `X-Account-Id`
 * header. A server has no human and no JWT, so it authenticates with a service credential
 * instead and names the account it is acting for. A credential may only act for accounts it
 * has been explicitly granted, so a leaked key cannot reach the rest of the platform.
 */

export const ServiceScope = z.enum([
  "quotes:write",
  "bookings:write",
  "bookings:read",
  "bookings:cancel",
  "shipments:read",
  "labels:read",
]);
export type ServiceScope = z.infer<typeof ServiceScope>;

export const SERVICE_SCOPES: readonly ServiceScope[] = ServiceScope.options;

export const ServiceClientStatus = z.enum(["active", "revoked"]);
export type ServiceClientStatus = z.infer<typeof ServiceClientStatus>;

export const ServiceClient = z.object({
  id: Uuid,
  name: z.string(),
  /** Stable, human-readable identifier used in logs and audit rows, e.g. "courier-api". */
  slug: z.string(),
  /** The public half of the credential. Safe to show; useless without the secret. */
  keyId: z.string(),
  /** Last four characters of the secret, so an operator can tell two keys apart. */
  secretHint: z.string(),
  status: ServiceClientStatus,
  scopes: z.array(ServiceScope),
  /** Accounts this credential may act for. Empty means it can act for none. */
  accountIds: z.array(Uuid),
  lastUsedAt: z.string().datetime().nullable(),
  revokedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type ServiceClient = z.infer<typeof ServiceClient>;

/**
 * The only response that ever carries the secret. It is hashed on arrival and cannot be read
 * back afterwards; an operator who loses it rotates the credential rather than recovering it.
 */
export const ServiceClientWithSecret = ServiceClient.extend({
  secret: z.string(),
});
export type ServiceClientWithSecret = z.infer<typeof ServiceClientWithSecret>;

export const CreateServiceClientRequest = z.object({
  name: z.string().trim().min(2).max(80),
  slug: z
    .string()
    .trim()
    .min(2)
    .max(40)
    .regex(/^[a-z0-9][a-z0-9-]*$/, "lowercase letters, digits and hyphens only"),
  scopes: z.array(ServiceScope).min(1),
  accountIds: z.array(Uuid).default([]),
});
export type CreateServiceClientRequest = z.infer<typeof CreateServiceClientRequest>;

export const UpdateServiceClientRequest = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  scopes: z.array(ServiceScope).min(1).optional(),
  accountIds: z.array(Uuid).optional(),
});
export type UpdateServiceClientRequest = z.infer<typeof UpdateServiceClientRequest>;

/**
 * Mapping from another system's identifier to an engine account.
 *
 * The calling system knows its own ids — a WooCommerce store, a Shopify shop — and should not
 * have to store ours as well. It sends `system` + `externalId`; we resolve the account. The
 * mapping is a row, so it is auditable and can be corrected without a deploy.
 */
export const AccountExternalRef = z.object({
  id: Uuid,
  accountId: Uuid,
  /** The naming authority, e.g. "courier-api". Scopes `externalId` so ids cannot collide. */
  system: z.string(),
  externalId: z.string(),
  note: z.string().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type AccountExternalRef = z.infer<typeof AccountExternalRef>;

export const LinkAccountExternalRefRequest = z.object({
  accountId: Uuid,
  system: z
    .string()
    .trim()
    .min(2)
    .max(40)
    .regex(/^[a-z0-9][a-z0-9-]*$/, "lowercase letters, digits and hyphens only"),
  externalId: z.string().trim().min(1).max(120),
  note: z.string().trim().max(200).nullable().default(null),
});
export type LinkAccountExternalRefRequest = z.infer<typeof LinkAccountExternalRefRequest>;

/**
 * Book in one call.
 *
 * A portal user quotes, looks at the price, then books. A server integrating a checkout has
 * already shown its customer a price and simply needs the job placed, so it sends the whole
 * request once. The engine still prices it into a real persisted quote first — the booking is
 * backed by the same auditable quote a human booking is — it just does both halves itself.
 */
export const ServiceBookingRequest = z.object({
  serviceLevelCode: z.string().min(2).max(32),
  collection: z.object({
    address: Address,
    contact: Contact.nullable().default(null),
    instructions: z.string().max(500).nullable().default(null),
  }),
  drops: z.array(DropInput).min(1).max(20),
  options: QuoteOptions.default({}),
  /** Required when the service level needs a slot (Standard). */
  slot: SlotRef.optional(),
  /**
   * A quote this caller already priced and showed its customer, to book at that price.
   *
   * Optional, and safe to send stale: a quote that has expired or has already been booked is
   * resolved rather than refused, which is what makes this survive a day of retries. Without
   * it the job is priced fresh at booking time.
   */
  quoteId: Uuid.optional(),
  /**
   * Required, not optional as it is for a human: a retrying job that sends a different key
   * every attempt books the same order twice. Derive it from the caller's own order id.
   */
  idempotencyKey: z.string().min(8).max(120),
  /** The caller's identifier for the job, e.g. `WC-49905`. Searchable, printed on invoices. */
  customerReference: z.string().trim().max(60).optional(),
  /**
   * Refuse rather than book if the price has moved above this since the caller quoted.
   * A checkout quote and the booking that follows it can be hours apart, and silently
   * charging more than the customer was shown is worse than failing the booking.
   */
  maxTotalCents: z.number().int().nonnegative().optional(),
});
export type ServiceBookingRequest = z.infer<typeof ServiceBookingRequest>;

export const ServiceBookingResponse = z.object({
  booking: Booking,
  quote: Quote,
  /** True when this call found an existing booking for the idempotency key and returned it. */
  replayed: z.boolean(),
});
export type ServiceBookingResponse = z.infer<typeof ServiceBookingResponse>;
