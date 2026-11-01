import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { id, timestamps } from "./_shared.js";
import { accounts } from "./identity.js";

/**
 * Paid membership.
 *
 * A customer pays monthly for cheaper deliveries and a handful of perks. Deliberately separate
 * from loyalty, which is the opposite arrangement: loyalty is *earned* from spend and pays
 * cashback, membership is *bought* and discounts the rate. An account can have both, and
 * merging them would make it impossible to answer why a given price was what it was.
 */

export const membershipStatusEnum = pgEnum("membership_status", [
  "active",
  /** Renewal fell due and could not be collected. Benefits stay on during the grace period. */
  "past_due",
  /** Ended by the customer or by us; benefits are gone. Kept for history. */
  "cancelled",
  /** Ran past its period without renewing. */
  "expired",
]);

/** How the monthly fee is taken. Chosen per membership, because customers differ. */
export const membershipCollectionEnum = pgEnum("membership_collection", [
  "wallet",
  "invoice",
  "manual",
]);

/**
 * What a tier costs and what it buys.
 *
 * Editable in the console rather than hard-coded, because the prices on the marketing page
 * change more often than the code does, and a price that lives in two places eventually
 * disagrees with itself.
 */
export const membershipPlans = pgTable(
  "membership_plans",
  {
    id: id(),
    code: text("code").notNull(),
    name: text("name").notNull(),
    /** The monthly fee. */
    priceCents: integer("price_cents").notNull(),
    /** Taken off the delivery price. 1500 = 15% off. */
    discountBps: integer("discount_bps").notNull().default(0),
    /** The "ideal for 20+ deliveries a month" line, for the marketing page. */
    suitedFromDeliveries: integer("suited_from_deliveries").notNull().default(0),
    /** Shipments included each period before the usual price applies. */
    freeShipmentsPerPeriod: integer("free_shipments_per_period").notNull().default(0),
    /** Public holiday delivery at no surcharge. */
    waivesHolidaySurcharge: boolean("waives_holiday_surcharge").notNull().default(false),
    /** Every surcharge waived -- weekend, holiday, timed window. The Enterprise promise. */
    waivesAllSurcharges: boolean("waives_all_surcharges").notNull().default(false),
    /** May create service clients and call the API. */
    includesApiAccess: boolean("includes_api_access").notNull().default(false),
    /** Shown to the customer; nothing in the engine acts on these two. */
    prioritySupport: boolean("priority_support").notNull().default(false),
    dedicatedManager: boolean("dedicated_manager").notNull().default(false),
    sortOrder: integer("sort_order").notNull().default(0),
    active: boolean("active").notNull().default(true),
    ...timestamps(),
  },
  (t) => [uniqueIndex("membership_plans_code_uq").on(t.code)],
);

/**
 * One account's subscription, and its history.
 *
 * Rows are never rewritten on an upgrade: the old one ends and a new one begins, so "what were
 * they paying in March" has an answer. Only one may be live at a time, which the partial unique
 * index enforces rather than trusting every call site to check.
 */
export const accountMemberships = pgTable(
  "account_memberships",
  {
    id: id(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    planId: uuid("plan_id")
      .notNull()
      .references(() => membershipPlans.id, { onDelete: "restrict" }),
    status: membershipStatusEnum("status").notNull().default("active"),
    collection: membershipCollectionEnum("collection").notNull().default("wallet"),
    /**
     * The price agreed when they signed up.
     *
     * Copied off the plan rather than read through it, so raising the price of Growth does not
     * silently raise it for everyone already on it.
     */
    priceCents: integer("price_cents").notNull(),
    discountBps: integer("discount_bps").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    currentPeriodStart: timestamp("current_period_start", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    currentPeriodEnd: timestamp("current_period_end", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
    /** Set when the customer has asked to stop but has already paid for this period. */
    cancelAtPeriodEnd: boolean("cancel_at_period_end").notNull().default(false),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true, mode: "date" }),
    /** Free shipments taken this period; reset on renewal. */
    freeShipmentsUsed: integer("free_shipments_used").notNull().default(0),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("account_memberships_live_uq")
      .on(t.accountId)
      .where(sql`${t.status} in ('active', 'past_due')`),
    index("account_memberships_renewal_idx").on(t.status, t.currentPeriodEnd),
  ],
);

/**
 * Every charge a membership has raised, successful or not.
 *
 * Separate from the membership itself so a renewal that failed twice before going through is
 * still explainable, and so the money has somewhere to point at from the ledger.
 */
export const membershipCharges = pgTable(
  "membership_charges",
  {
    id: id(),
    membershipId: uuid("membership_id")
      .notNull()
      .references(() => accountMemberships.id, { onDelete: "cascade" }),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    amountCents: integer("amount_cents").notNull(),
    collection: membershipCollectionEnum("collection").notNull(),
    periodStart: timestamp("period_start", { withTimezone: true, mode: "date" }).notNull(),
    periodEnd: timestamp("period_end", { withTimezone: true, mode: "date" }).notNull(),
    /** `paid` once the money is in; `failed` keeps the reason for whoever has to chase it. */
    status: text("status").notNull(),
    detail: text("detail"),
    walletEntryId: uuid("wallet_entry_id"),
    invoiceId: uuid("invoice_id"),
    ...timestamps(),
  },
  (t) => [
    // One charge per membership per period, so a retried renewal cannot bill twice.
    uniqueIndex("membership_charges_period_uq").on(t.membershipId, t.periodStart),
    index("membership_charges_account_idx").on(t.accountId, t.createdAt),
  ],
);
