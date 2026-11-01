import { sql } from "drizzle-orm";
import {
  boolean,
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
    /** Set instead of `actorUserId` when a machine did it. Exactly one of the two is set. */
    actorServiceClientId: uuid("actor_service_client_id"),
    /**
     * True when a staff member did this while acting as a customer's account rather than from
     * their own membership of it.
     *
     * Derivable — the actor is not a member of the account — but only by a join nobody will
     * run while answering "did the customer do this, or did we do it for them". That question
     * comes up when a customer disputes a charge, so the answer is stored rather than
     * reconstructed.
     */
    impersonated: boolean("impersonated").notNull().default(false),
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
    index("audit_service_actor_idx").on(t.actorServiceClientId, t.createdAt),
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

export const systemEventLevelEnum = pgEnum("system_event_level", ["info", "warning", "error"]);

/**
 * Operational events worth a human knowing about: why a webhook was refused, why a booking was
 * turned away, what 500'd.
 *
 * Deliberately not the audit log, which answers who changed a setting, and deliberately not the
 * outbox, which answers how a domain event reached its handlers. This sits beside both and
 * records the failures that happen around them, so the answer to "what just went wrong" is a
 * screen rather than an SSH session. Phase 8 exists because a BobPay webhook rejected every
 * payment for two weeks and the only trace was 200 hours of container log.
 *
 * `category` is a free-text dotted string rather than an enum on purpose: a new failure worth
 * surfacing should cost one line at the call site, not a migration. The admin feed lists the
 * categories it actually finds.
 */
export const systemEvents = pgTable(
  "system_events",
  {
    id: id(),
    level: systemEventLevelEnum("level").notNull(),
    /** Dotted and coarse-to-fine, e.g. `webhook.bobpay`, `booking.rejected`, `http.5xx`. */
    category: text("category").notNull(),
    /** One line, for the list. Written for whoever is on support, not for a parser. */
    message: text("message").notNull(),
    /** Everything else, for the detail view. Never secrets: see `SystemEventsService.record`. */
    context: jsonb("context"),
    requestId: text("request_id"),
    /**
     * Set when the event belongs to one customer, so an account's own troubles can be pulled
     * out of a feed that is mostly everybody else's.
     */
    accountId: uuid("account_id"),
    /**
     * Collapses a repeated failure instead of writing the same row ten thousand times. Rows
     * sharing a key are one event with a count and a last-seen, which is the difference
     * between a feed somebody reads and a feed somebody mutes.
     *
     * The service buckets this by the hour before it gets here, so the collapsing rolls over
     * on its own: the same fault in January and in June are two rows, not one row with a
     * count of two and a six-month-old `created_at`.
     */
    dedupeKey: text("dedupe_key"),
    count: integer("count").notNull().default(1),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    createdAt: createdAt(),
  },
  (t) => [
    // The feed's own query: newest first, usually narrowed by level or category.
    index("system_events_recent_idx").on(t.createdAt),
    index("system_events_level_idx").on(t.level, t.createdAt),
    index("system_events_category_idx").on(t.category, t.createdAt),
    index("system_events_account_idx").on(t.accountId, t.createdAt),
    uniqueIndex("system_events_dedupe_uq")
      .on(t.dedupeKey)
      .where(sql`${t.dedupeKey} is not null`),
  ],
);
