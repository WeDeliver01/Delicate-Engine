import {
  pgTable,
  pgEnum,
  uuid,
  text,
  integer,
  boolean,
  timestamp,
  jsonb,
  doublePrecision,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// ── Enums ───────────────────────────────────────────────────────────────────
export const tierEnum = pgEnum("tier", [
  "bronze",
  "silver",
  "gold",
  "platinum",
  "diamond",
  "founder",
]);

export const ledgerEntryEnum = pgEnum("ledger_entry_type", [
  "accrual", // cash back on a completed shipment
  "milestone", // bonus credit on hitting a milestone
  "referral", // referral reward
  "redemption", // customer spends wallet balance
  "adjustment", // manual ops correction (signed)
  "reversal", // undo of a prior entry
]);

export const actorEnum = pgEnum("actor_type", [
  "customer",
  "driver",
  "ops",
  "system",
]);

// ── Topology: nodes, tags, customer users ────────────────────────────────────

// A node is a customer location/entity that earns loyalty (e.g. a bakery).
// external_client_id links to the Route Optimizer's client/store id.
export const nodes = pgTable(
  "nodes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    externalClientId: text("external_client_id"), // Route Optimizer client/store id
    name: text("name").notNull(),
    type: text("type").notNull().default("bakery"),
    status: text("status").notNull().default("active"),
    contactEmail: text("contact_email"),
    contactPhone: text("contact_phone"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    externalIdx: uniqueIndex("nodes_external_client_idx").on(t.externalClientId),
  }),
);

// A physical NTAG 424 DNA tag bound to a node. The tag only carries identity;
// last_read_counter enforces replay protection on each SUN tap.
export const tags = pgTable(
  "tags",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tagUid: text("tag_uid").notNull(), // 7-byte UID, hex (14 chars), from PICC data
    label: text("label").notNull(), // human label, e.g. HBB001
    nodeId: uuid("node_id")
      .notNull()
      .references(() => nodes.id, { onDelete: "restrict" }),
    lastReadCounter: integer("last_read_counter").notNull().default(0),
    status: text("status").notNull().default("active"), // active | disabled | lost
    batch: text("batch"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    uidIdx: uniqueIndex("tags_uid_idx").on(t.tagUid),
    nodeIdx: index("tags_node_idx").on(t.nodeId),
  }),
);

// Customer-portal accounts. A node can have several staff users.
export const customerUsers = pgTable(
  "customer_users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    nodeId: uuid("node_id")
      .notNull()
      .references(() => nodes.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    passwordHash: text("password_hash").notNull(),
    displayName: text("display_name").notNull(),
    role: text("role").notNull().default("owner"), // owner | staff
    status: text("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    emailIdx: uniqueIndex("customer_users_email_idx").on(t.email),
  }),
);

// ── Event engine: append-only event store ────────────────────────────────────
export const events = pgTable(
  "events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    source: text("source").notNull(), // nfc_tap | route_optimizer | booking | geofence | manual
    type: text("type").notNull(), // delivery.completed | collection.confirmed | tag.tapped ...
    actorType: actorEnum("actor_type").notNull().default("system"),
    actorId: text("actor_id"), // driver id, customer user id, etc.
    nodeId: uuid("node_id").references(() => nodes.id, { onDelete: "set null" }),
    tagId: uuid("tag_id").references(() => tags.id, { onDelete: "set null" }),
    geoLat: doublePrecision("geo_lat"),
    geoLng: doublePrecision("geo_lng"),
    amountCents: integer("amount_cents"), // delivery charge, when known (drives cash back)
    payload: jsonb("payload").$type<Record<string, unknown>>().default({}),
    dedupKey: text("dedup_key").notNull(), // idempotency: one row per real-world event
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }).defaultNow().notNull(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
  },
  (t) => ({
    dedupIdx: uniqueIndex("events_dedup_idx").on(t.dedupKey),
    typeIdx: index("events_type_idx").on(t.type),
    nodeIdx: index("events_node_idx").on(t.nodeId),
    occurredIdx: index("events_occurred_idx").on(t.occurredAt),
  }),
);

// Observability: what each rule did with each event.
export const eventDispatchLog = pgTable("event_dispatch_log", {
  id: uuid("id").primaryKey().defaultRandom(),
  eventId: uuid("event_id")
    .notNull()
    .references(() => events.id, { onDelete: "cascade" }),
  ruleId: uuid("rule_id"),
  actionType: text("action_type").notNull(),
  status: text("status").notNull(), // ok | skipped | error
  detail: text("detail"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

// ── Rules engine (config-driven) ─────────────────────────────────────────────
export const rules = pgTable(
  "rules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    eventType: text("event_type").notNull(), // matches events.type, or "*"
    actionType: text("action_type").notNull(), // accrue_loyalty | send_webhook | award_milestone | noop
    config: jsonb("config").$type<Record<string, unknown>>().default({}),
    priority: integer("priority").notNull().default(100),
    enabled: boolean("enabled").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    eventTypeIdx: index("rules_event_type_idx").on(t.eventType),
  }),
);

// ── Loyalty ──────────────────────────────────────────────────────────────────

// One loyalty account per node. wallet_balance_cents is a cached sum of the
// ledger; the reconciliation job verifies it against the ledger nightly.
export const loyaltyAccounts = pgTable(
  "loyalty_accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    nodeId: uuid("node_id")
      .notNull()
      .references(() => nodes.id, { onDelete: "cascade" }),
    tier: tierEnum("tier").notNull().default("bronze"),
    walletBalanceCents: integer("wallet_balance_cents").notNull().default(0),
    lifetimeShipments: integer("lifetime_shipments").notNull().default(0),
    monthShipments: integer("month_shipments").notNull().default(0),
    monthPeriod: text("month_period").notNull().default(""), // e.g. "2026-06"
    status: text("status").notNull().default("active"),
    joinedAt: timestamp("joined_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    nodeIdx: uniqueIndex("loyalty_accounts_node_idx").on(t.nodeId),
  }),
);

// Append-only money ledger. Amounts are signed integer cents (ZAR).
// The unique (source_event_id, entry_type) index makes accrual idempotent:
// a duplicated completion webhook can never credit twice.
export const walletLedger = pgTable(
  "wallet_ledger",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => loyaltyAccounts.id, { onDelete: "restrict" }),
    entryType: ledgerEntryEnum("entry_type").notNull(),
    amountCents: integer("amount_cents").notNull(), // signed
    balanceAfterCents: integer("balance_after_cents").notNull(),
    sourceEventId: uuid("source_event_id").references(() => events.id, {
      onDelete: "set null",
    }),
    reference: text("reference"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    accountIdx: index("wallet_ledger_account_idx").on(t.accountId),
    // Idempotency guard for event-driven entries.
    sourceUnique: uniqueIndex("wallet_ledger_source_entry_idx").on(
      t.sourceEventId,
      t.entryType,
    ),
  }),
);

// Tier thresholds and cash-back rates. cashback_bps = basis points (200 = 2%).
export const tierConfig = pgTable("tier_config", {
  id: uuid("id").primaryKey().defaultRandom(),
  code: tierEnum("code").notNull().unique(),
  label: text("label").notNull(),
  minMonthShipments: integer("min_month_shipments").notNull(),
  cashbackBps: integer("cashback_bps").notNull(),
  benefits: jsonb("benefits").$type<string[]>().default([]),
  displayOrder: integer("display_order").notNull().default(0),
});

// Milestone definitions: "every Nth" (recurring) or "at N" (one-off).
export const milestones = pgTable("milestones", {
  id: uuid("id").primaryKey().defaultRandom(),
  code: text("code").notNull().unique(),
  label: text("label").notNull(),
  triggerType: text("trigger_type").notNull(), // every_n | at_n
  n: integer("n").notNull(),
  rewardType: text("reward_type").notNull(), // credit | free_delivery | badge
  rewardValueCents: integer("reward_value_cents").notNull().default(0),
  enabled: boolean("enabled").notNull().default(true),
});

export const milestoneAwards = pgTable(
  "milestone_awards",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => loyaltyAccounts.id, { onDelete: "cascade" }),
    milestoneId: uuid("milestone_id")
      .notNull()
      .references(() => milestones.id, { onDelete: "restrict" }),
    shipmentNumber: integer("shipment_number").notNull(),
    eventId: uuid("event_id").references(() => events.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    // Idempotency: a given milestone fires at most once per shipment number.
    uniqueAward: uniqueIndex("milestone_awards_unique_idx").on(
      t.accountId,
      t.milestoneId,
      t.shipmentNumber,
    ),
  }),
);

export const referrals = pgTable("referrals", {
  id: uuid("id").primaryKey().defaultRandom(),
  referrerNodeId: uuid("referrer_node_id")
    .notNull()
    .references(() => nodes.id, { onDelete: "cascade" }),
  referredNodeId: uuid("referred_node_id").references(() => nodes.id, {
    onDelete: "set null",
  }),
  status: text("status").notNull().default("pending"), // pending | qualified | rewarded
  rewardCents: integer("reward_cents").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

// ── Webhooks ─────────────────────────────────────────────────────────────────
export const webhookEndpoints = pgTable("webhook_endpoints", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  url: text("url").notNull(),
  secret: text("secret").notNull(),
  eventTypes: jsonb("event_types").$type<string[]>().default(["*"]),
  enabled: boolean("enabled").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const webhookDeliveries = pgTable("webhook_deliveries", {
  id: uuid("id").primaryKey().defaultRandom(),
  endpointId: uuid("endpoint_id")
    .notNull()
    .references(() => webhookEndpoints.id, { onDelete: "cascade" }),
  eventId: uuid("event_id")
    .notNull()
    .references(() => events.id, { onDelete: "cascade" }),
  status: text("status").notNull().default("pending"), // pending | delivered | failed
  attempts: integer("attempts").notNull().default(0),
  lastError: text("last_error"),
  responseCode: integer("response_code"),
  nextRetryAt: timestamp("next_retry_at", { withTimezone: true }).defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

// Idempotency log for inbound webhooks (from the Route Optimizer, booking, etc.)
export const inboundWebhooks = pgTable(
  "inbound_webhooks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    source: text("source").notNull(),
    deliveryId: text("delivery_id").notNull(), // sender's idempotency id
    signatureValid: boolean("signature_valid").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().default({}),
    eventId: uuid("event_id").references(() => events.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    deliveryIdx: uniqueIndex("inbound_webhooks_delivery_idx").on(
      t.source,
      t.deliveryId,
    ),
  }),
);

// ── Audit ────────────────────────────────────────────────────────────────────
export const auditLogs = pgTable("audit_logs", {
  id: uuid("id").primaryKey().defaultRandom(),
  actor: text("actor").notNull(),
  action: text("action").notNull(),
  entity: text("entity"),
  detail: jsonb("detail").$type<Record<string, unknown>>().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const schema = {
  nodes,
  tags,
  customerUsers,
  events,
  eventDispatchLog,
  rules,
  loyaltyAccounts,
  walletLedger,
  tierConfig,
  milestones,
  milestoneAwards,
  referrals,
  webhookEndpoints,
  webhookDeliveries,
  inboundWebhooks,
  auditLogs,
};

export const _sqlHelper = sql; // re-export to keep sql tagged template available
