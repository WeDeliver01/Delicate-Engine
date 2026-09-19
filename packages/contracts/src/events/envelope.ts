import { z } from "zod";

/**
 * One envelope for every domain event in the engine. Payloads are discriminated by `type`.
 *
 * - `id`         unique per emission  (idempotent delivery: the same HTTP call replayed)
 * - `dedupeKey`  unique per business fact (idempotent consumption: two emissions, one fact),
 *                e.g. `delivery:DC-260919-00001`
 * - `version`    bump on breaking payload change; consumers may handle several
 * - `occurredAt` when it happened operationally (UTC ISO), not when it was recorded
 */
export const EventActor = z
  .object({
    userId: z.string().uuid().nullable(),
    accountId: z.string().uuid().nullable(),
  })
  .partial();
export type EventActor = z.infer<typeof EventActor>;

export const EventEnvelopeBase = z.object({
  id: z.string().uuid(),
  type: z.string().min(1),
  version: z.number().int().positive().default(1),
  source: z.string().min(1),
  dedupeKey: z.string().min(1),
  occurredAt: z.string().datetime(),
  actor: EventActor.optional(),
  correlationId: z.string().optional(),
});
export type EventEnvelopeBase = z.infer<typeof EventEnvelopeBase>;

export function defineEvent<TType extends string, TPayload extends z.ZodTypeAny>(
  type: TType,
  payload: TPayload,
) {
  return EventEnvelopeBase.extend({ type: z.literal(type), payload });
}
