import { sql } from "drizzle-orm";
import {
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { createdAt, id } from "./_shared.js";

/**
 * Platform tables: the transactional outbox, the inbound-event inbox, and the audit log.
 * These implement invariants #6 (outbox/inbox) and #10 (audit).
 */

export const outboxStatusEnum = pgEnum("outbox_status", [
  "pending",
  "processing",
  "delivered",
  "failed",
  "dead",
]);

/**
 * Transactional outbox. A domain service writes the state change AND this row in the same
 * transaction; the worker claims due rows, hands them to handlers, and records the outcome.
 * Rows are never deleted; `dead` rows are re-armed by an operator, not silently dropped.
 */
export const outboxMessages = pgTable(
  "outbox_messages",
  {
    id: id(),
    /** The envelope `id` – unique per emission. */
    eventId: uuid("event_id").notNull(),
    eventType: text("event_type").notNull(),
    /** Unique per business fact; a second emission of the same fact is rejected at insert. */
    dedupeKey: text("dedupe_key").notNull(),
    envelope: jsonb("envelope").notNull(),
    status: outboxStatusEnum("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(12),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    lastError: text("last_error"),
    lockedBy: text("locked_by"),
    lockedAt: timestamp("locked_at", { withTimezone: true, mode: "date" }),
    deliveredAt: timestamp("delivered_at", { withTimezone: true, mode: "date" }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("outbox_event_id_uq").on(t.eventId),
    uniqueIndex("outbox_dedupe_key_uq").on(t.dedupeKey),
    index("outbox_due_idx")
      .on(t.status, t.nextAttemptAt)
      .where(sql`${t.status} in ('pending', 'failed')`),
  ],
);

export const inboxStatusEnum = pgEnum("inbox_status", ["received", "processed", "failed"]);

/**
 * Inbound event inbox: every webhook / external event lands here before anything else happens.
 * `(source, externalId)` dedupes literal redelivery; `dedupeKey` dedupes the business fact.
 */
export const inboxMessages = pgTable(
  "inbox_messages",
  {
    id: id(),
    source: text("source").notNull(),
    externalId: text("external_id").notNull(),
    dedupeKey: text("dedupe_key").notNull(),
    eventType: text("event_type").notNull(),
    payload: jsonb("payload").notNull(),
    headers: jsonb("headers"),
    status: inboxStatusEnum("status").notNull().default("received"),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    processedAt: timestamp("processed_at", { withTimezone: true, mode: "date" }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("inbox_source_external_uq").on(t.source, t.externalId),
    uniqueIndex("inbox_dedupe_key_uq").on(t.dedupeKey),
    index("inbox_status_idx").on(t.status),
  ],
);

/**
 * Append-only audit log of every privileged or state-changing action: who, what, on which
 * entity, before/after. Written inside the same transaction as the change.
 */
export const auditLog = pgTable(
  "audit_log",
  {
    id: id(),
    actorUserId: uuid("actor_user_id"),
    actorAccountId: uuid("actor_account_id"),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id"),
    before: jsonb("before"),
    after: jsonb("after"),
    requestId: text("request_id"),
    ip: text("ip"),
    createdAt: createdAt(),
  },
  (t) => [
    index("audit_entity_idx").on(t.entityType, t.entityId),
    index("audit_actor_idx").on(t.actorUserId, t.createdAt),
  ],
);

/**
 * Idempotency keys for retry-safe write endpoints (invariant #9). The first request stores its
 * response; a replay with the same key + same request hash returns it verbatim.
 */
export const idempotencyKeys = pgTable(
  "idempotency_keys",
  {
    key: text("key").notNull(),
    scope: text("scope").notNull(), // e.g. userId or accountId
    requestHash: text("request_hash").notNull(),
    statusCode: integer("status_code"),
    responseBody: jsonb("response_body"),
    lockedAt: timestamp("locked_at", { withTimezone: true, mode: "date" }),
    completedAt: timestamp("completed_at", { withTimezone: true, mode: "date" }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("idempotency_scope_key_uq").on(t.scope, t.key)],
);
