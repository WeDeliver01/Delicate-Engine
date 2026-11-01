import { index, integer, jsonb, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { id, timestamps } from "./_shared.js";
import { accounts, users } from "./identity.js";

/**
 * Our own record of who visits and what they do, so traffic and funnel questions can be
 * answered from our own rows instead of a third party's dashboard. No raw IPs, no cookies that
 * outlive the session, nothing a user didn't choose to tell us (account/user id, once signed in).
 *
 * A session is the unit a visit is counted against; an event is everything that happened inside
 * one — a pageview or a product moment (signup completed, booking confirmed, ...). Append-only,
 * same as the rest of the engine: a session's summary columns (lastSeenAt, pageviews) are the
 * only ones that change after insert, and only by the ingest path that owns them.
 */

export const siteEventTypeEnum = pgEnum("site_event_type", ["pageview", "custom"]);
export const siteAppEnum = pgEnum("site_app", ["marketing", "portal", "admin"]);

export const siteSessions = pgTable(
  "site_sessions",
  {
    id: id(),
    /** Client-generated, persisted in localStorage. Not tied to a person until they sign in. */
    visitorId: uuid("visitor_id").notNull(),
    app: siteAppEnum("app").notNull(),
    entryPath: text("entry_path").notNull(),
    referrer: text("referrer"),
    utmSource: text("utm_source"),
    utmMedium: text("utm_medium"),
    utmCampaign: text("utm_campaign"),
    deviceType: text("device_type"),
    browser: text("browser"),
    os: text("os"),
    /** Salted hash of the request IP, kept only to count unique sessions from one network. */
    ipHash: text("ip_hash"),
    accountId: uuid("account_id").references(() => accounts.id, { onDelete: "set null" }),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    pageviews: integer("pageviews").notNull().default(0),
    startedAt: timestamp("started_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    ...timestamps(),
  },
  (t) => [
    index("site_sessions_visitor_idx").on(t.visitorId, t.startedAt),
    index("site_sessions_started_idx").on(t.startedAt),
    index("site_sessions_account_idx").on(t.accountId),
  ],
);

export const siteEvents = pgTable(
  "site_events",
  {
    id: id(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => siteSessions.id, { onDelete: "cascade" }),
    visitorId: uuid("visitor_id").notNull(),
    app: siteAppEnum("app").notNull(),
    type: siteEventTypeEnum("type").notNull(),
    /** The path for a pageview, the event name (e.g. "signup_completed") for a custom event. */
    name: text("name").notNull(),
    path: text("path"),
    referrer: text("referrer"),
    props: jsonb("props"),
    accountId: uuid("account_id").references(() => accounts.id, { onDelete: "set null" }),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    occurredAt: timestamp("occurred_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    ...timestamps(),
  },
  (t) => [
    index("site_events_session_idx").on(t.sessionId),
    index("site_events_occurred_idx").on(t.occurredAt),
    index("site_events_type_name_idx").on(t.type, t.name, t.occurredAt),
    index("site_events_account_idx").on(t.accountId),
  ],
);
