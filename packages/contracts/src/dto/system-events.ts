import { z } from "zod";
import { Uuid } from "./common.js";

/**
 * The operational feed: what just went wrong.
 *
 * Distinct from the audit log (who changed what, on purpose) and from the outbox (whether a
 * domain event reached its handlers). These are the failures and the notable refusals that
 * happen around both, written for whoever is on support.
 */

export const SystemEventLevel = z.enum(["info", "warning", "error"]);
export type SystemEventLevel = z.infer<typeof SystemEventLevel>;

export const SystemEvent = z.object({
  id: Uuid,
  level: SystemEventLevel,
  category: z.string(),
  message: z.string(),
  context: z.unknown().nullable(),
  requestId: z.string().nullable(),
  accountId: Uuid.nullable(),
  /** How many times this same fault was folded into this row. 1 means it happened once. */
  count: z.number().int().min(1),
  lastSeenAt: z.string(),
  createdAt: z.string(),
});
export type SystemEvent = z.infer<typeof SystemEvent>;

export const ListSystemEventsQuery = z.object({
  level: SystemEventLevel.optional(),
  category: z.string().max(64).optional(),
  accountId: Uuid.optional(),
  /** Substring of the message, for when somebody half-remembers the wording. */
  q: z.string().max(120).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().optional(),
});
export type ListSystemEventsQuery = z.infer<typeof ListSystemEventsQuery>;

/**
 * The header: how bad is it, right now.
 *
 * `categories` is derived from the rows rather than from an enum, because the categories are
 * free text at the call site -- a new failure worth surfacing should cost a line, not a
 * migration. The feed lists what it actually finds.
 */
export const SystemEventStats = z.object({
  since: z.string(),
  errors: z.number().int().min(0),
  warnings: z.number().int().min(0),
  info: z.number().int().min(0),
  categories: z.array(
    z.object({
      category: z.string(),
      level: SystemEventLevel,
      count: z.number().int().min(0),
      lastSeenAt: z.string(),
    }),
  ),
});
export type SystemEventStats = z.infer<typeof SystemEventStats>;
