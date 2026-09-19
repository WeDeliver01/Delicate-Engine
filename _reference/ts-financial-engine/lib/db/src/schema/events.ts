import { pgTable, text, integer, timestamp, uuid, jsonb, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * event_inbox is the single front door for every operational event the
 * Financial Engine consumes from the Route Optimizer.
 *
 * Two independent dedupe layers protect us:
 *
 *   1. eventId     , unique per *emission*. Stops literal at-least-once
 *                     redelivery of the exact same HTTP call.
 *   2. dedupeKey   , unique per *business fact* (e.g. "delivery:WB12345").
 *                     Stops two different emissions that describe the same
 *                     real-world event from settling twice.
 *
 * The row is immutable history. We never delete it. `status` advances
 * forward only (received -> processed | failed), and `attempts` / `lastError`
 * give us a replayable audit trail.
 */
export const eventInbox = pgTable(
  "event_inbox",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Envelope identity (unique per emission).
    eventId: uuid("event_id").notNull().unique(),
    eventType: text("event_type").notNull(),
    eventVersion: integer("event_version").notNull().default(1),
    source: text("source").notNull().default("route-optimizer"),
    // Business dedupe key (unique per real-world fact).
    dedupeKey: text("dedupe_key").notNull().unique(),
    // When the operational event actually happened (operational truth).
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    payload: jsonb("payload").notNull(),
    // received -> processed | failed
    status: text("status").notNull().default("received"),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
  },
  (t) => ({
    statusIdx: index("event_inbox_status_idx").on(t.status),
    typeIdx: index("event_inbox_type_idx").on(t.eventType),
  }),
);

export const insertEventInboxSchema = createInsertSchema(eventInbox).omit({
  id: true,
  receivedAt: true,
  processedAt: true,
});
export type InsertEventInbox = z.infer<typeof insertEventInboxSchema>;
export type EventInbox = typeof eventInbox.$inferSelect;
