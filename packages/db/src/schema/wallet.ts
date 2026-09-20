import { sql } from "drizzle-orm";
import {
  bigint,
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
import { createdAt, id, timestamps } from "./_shared.js";
import { accounts, users } from "./identity.js";

/**
 * Wallet & Billing (invariants #1, #2, #4, #5): integer cents, append-only entries, balance
 * derived from entries, holds reserved in the booking transaction, credits only from verified
 * confirmations.
 */

/** One per account. `balance_cents` is a cache of SUM(wallet_entries.amount_cents). */
export const wallets = pgTable("wallets", {
  accountId: uuid("account_id")
    .primaryKey()
    .references(() => accounts.id, { onDelete: "restrict" }),
  balanceCents: bigint("balance_cents", { mode: "number" }).notNull().default(0),
  creditLimitCents: bigint("credit_limit_cents", { mode: "number" }).notNull().default(0),
  statementDay: integer("statement_day").notNull().default(1),
  paymentTermsDays: integer("payment_terms_days").notNull().default(30),
  ...timestamps(),
});

export const walletEntryKindEnum = pgEnum("wallet_entry_kind", [
  "topup",
  "charge",
  "refund",
  "adjustment",
  "cashback",
  "statement_payment",
]);

/** Append-only. Never updated, never deleted. Corrections are new entries. */
export const walletEntries = pgTable(
  "wallet_entries",
  {
    id: id(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "restrict" }),
    kind: walletEntryKindEnum("kind").notNull(),
    amountCents: bigint("amount_cents", { mode: "number" }).notNull(),
    balanceAfterCents: bigint("balance_after_cents", { mode: "number" }).notNull(),
    reference: text("reference"),
    description: text("description").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    createdByUserId: uuid("created_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("wallet_entries_idem_uq").on(t.idempotencyKey),
    index("wallet_entries_account_idx").on(t.accountId, t.createdAt),
  ],
);

export const holdStatusEnum = pgEnum("hold_status", ["active", "captured", "released"]);

export const walletHolds = pgTable(
  "wallet_holds",
  {
    id: id(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "restrict" }),
    amountCents: bigint("amount_cents", { mode: "number" }).notNull(),
    status: holdStatusEnum("status").notNull().default("active"),
    reference: text("reference"),
    idempotencyKey: text("idempotency_key").notNull(),
    createdAt: createdAt(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true, mode: "date" }),
  },
  (t) => [
    uniqueIndex("wallet_holds_idem_uq").on(t.idempotencyKey),
    index("wallet_holds_active_idx")
      .on(t.accountId)
      .where(sql`${t.status} = 'active'`),
  ],
);

export const paymentProviderEnum = pgEnum("payment_provider", [
  "manual_eft",
  "payfast",
  "yoco",
  "bobpay",
]);
export const topUpStatusEnum = pgEnum("topup_status", [
  "pending",
  "confirmed",
  "failed",
  "cancelled",
]);

export const topUps = pgTable(
  "top_ups",
  {
    id: id(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "restrict" }),
    provider: paymentProviderEnum("provider").notNull(),
    amountCents: bigint("amount_cents", { mode: "number" }).notNull(),
    status: topUpStatusEnum("status").notNull().default("pending"),
    reference: text("reference").notNull(),
    providerRef: text("provider_ref"),
    metadata: jsonb("metadata"),
    initiatedByUserId: uuid("initiated_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    confirmedByUserId: uuid("confirmed_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true, mode: "date" }),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("top_ups_reference_uq").on(t.reference),
    index("top_ups_account_idx").on(t.accountId, t.createdAt),
    index("top_ups_status_idx").on(t.status),
  ],
);
