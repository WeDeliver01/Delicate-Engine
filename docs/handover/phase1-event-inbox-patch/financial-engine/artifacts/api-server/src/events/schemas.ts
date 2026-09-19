import { z } from "zod/v4";

/**
 * Event contract between the Route Optimizer (operational truth) and the
 * Financial Engine (financial truth).
 *
 * The envelope is identical for every event. The payload is discriminated by
 * `eventType`. For Phase 1 we only accept DeliveryCompleted; every other type
 * is persisted to the inbox and acknowledged, but left unprocessed (status
 * stays "received") so we never lose an event we don't yet handle.
 *
 * All money is integer cents. All distance is kilometres as a number, but only
 * ever used to derive cents via the pricing rules, never stored as money.
 */

const isoDate = z.union([z.string(), z.date()]).transform((v) => new Date(v));

export const eventEnvelopeBase = z.object({
  eventId: z.uuid(),
  eventType: z.string().min(1),
  eventVersion: z.number().int().positive().default(1),
  source: z.string().min(1).default("route-optimizer"),
  /** Business dedupe key, e.g. "delivery:WB12345". Stable across retries. */
  dedupeKey: z.string().min(1),
  /** When it happened operationally (not when we received it). */
  occurredAt: isoDate,
});

/**
 * DeliveryCompleted is the only settlement trigger in Phase 1.
 *
 * Identity: the Route Optimizer emits the Financial Engine's own UUIDs for
 * driver and bakery. The mapping from optimizer identities (driverAccountId,
 * client name) to financial entities is owned by the emit side
 * (server/lib/financial-events.ts) so the Financial Engine never has to know
 * about operational identifiers.
 *
 * Distance: `distanceKm` is the *actual* executed distance from the optimizer.
 * The Financial Engine settles against this number rather than recomputing a
 * route, which is the whole point of going event-driven.
 */
export const deliveryCompletedPayload = z.object({
  driverId: z.uuid(),
  bakeryId: z.uuid(),
  waybill: z.string().min(1),
  priceCents: z.number().int().nonnegative(),
  distanceKm: z.number().nonnegative(),
  zone: z.string().nullish(),
  currency: z.string().default("ZAR"),
  customer: z
    .object({
      lat: z.number(),
      lng: z.number(),
      address: z.string().nullish(),
    })
    .optional(),
});
export type DeliveryCompletedPayload = z.infer<typeof deliveryCompletedPayload>;

export const deliveryCompletedEvent = eventEnvelopeBase.extend({
  eventType: z.literal("DeliveryCompleted"),
  payload: deliveryCompletedPayload,
});
export type DeliveryCompletedEvent = z.infer<typeof deliveryCompletedEvent>;

/**
 * Generic envelope used at the HTTP boundary. We validate the envelope
 * strictly, but keep the payload as unknown for types we do not yet process.
 * Known types get their full payload validated inside the handler.
 */
export const incomingEvent = eventEnvelopeBase.extend({
  payload: z.unknown(),
});
export type IncomingEvent = z.infer<typeof incomingEvent>;

/** Types the Financial Engine actively settles in Phase 1. */
export const PROCESSED_EVENT_TYPES = new Set<string>(["DeliveryCompleted"]);
