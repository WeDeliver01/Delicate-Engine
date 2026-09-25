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
import { bigint } from "drizzle-orm/pg-core";
import { createdAt, id, timestamps } from "./_shared.js";
import { accounts } from "./identity.js";
import { shipments } from "./bookings.js";

/**
 * Notifications. Append-only like every other record of something we claimed: a row is written
 * when a message is enqueued and only ever changes status, so "we told them" can be proved.
 *
 * A message with nowhere to go is stored as `suppressed` with the reason, never dropped.
 */

export const notificationChannelEnum = pgEnum("notification_channel", ["email", "sms", "whatsapp"]);

export const notificationStatusEnum = pgEnum("notification_status", [
  "queued",
  "sending",
  "sent",
  "failed",
  "suppressed",
  "dead",
]);

export const notificationAudienceEnum = pgEnum("notification_audience", ["customer", "recipient"]);

/** The copy. Seeded from code, then owned by the operator. */
export const notificationTemplates = pgTable(
  "notification_templates",
  {
    id: id(),
    kind: text("kind").notNull(),
    channel: notificationChannelEnum("channel").notNull(),
    audience: notificationAudienceEnum("audience").notNull(),
    subject: text("subject"),
    body: text("body").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    ...timestamps(),
  },
  (t) => [uniqueIndex("notification_templates_uq").on(t.kind, t.channel, t.audience)],
);

export const notifications = pgTable(
  "notifications",
  {
    id: id(),
    kind: text("kind").notNull(),
    channel: notificationChannelEnum("channel").notNull(),
    audience: notificationAudienceEnum("audience").notNull(),
    status: notificationStatusEnum("status").notNull().default("queued"),
    accountId: uuid("account_id").references(() => accounts.id, { onDelete: "set null" }),
    shipmentId: uuid("shipment_id").references(() => shipments.id, { onDelete: "set null" }),
    /** Email address or phone number, stored in full; redacted on the way out of the API. */
    toAddress: text("to_address").notNull(),
    subject: text("subject"),
    body: text("body").notNull(),
    /** The values the template was rendered from, kept so a resend reproduces the same message. */
    payload: jsonb("payload").notNull(),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(5),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    detail: text("detail"),
    providerMessageId: text("provider_message_id"),
    sentAt: timestamp("sent_at", { withTimezone: true, mode: "date" }),
    /** Unique per business fact, so a redelivered event cannot message someone twice. */
    dedupeKey: text("dedupe_key").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("notifications_dedupe_uq").on(t.dedupeKey),
    index("notifications_due_idx").on(t.status, t.nextAttemptAt),
    index("notifications_account_idx").on(t.accountId, t.createdAt),
    index("notifications_shipment_idx").on(t.shipmentId),
  ],
);

/** Per-account opt-outs. Absent row means the defaults apply. */
export const notificationPreferences = pgTable("notification_preferences", {
  accountId: uuid("account_id")
    .primaryKey()
    .references(() => accounts.id, { onDelete: "cascade" }),
  email: boolean("email").notNull().default(true),
  sms: boolean("sms").notNull().default(true),
  whatsapp: boolean("whatsapp").notNull().default(false),
  notifyRecipients: boolean("notify_recipients").notNull().default(true),
  lowBalanceCents: bigint("low_balance_cents", { mode: "number" }).notNull().default(20_000),
  ...timestamps(),
});
