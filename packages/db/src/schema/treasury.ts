import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { createdAt, id, timestamps } from "./_shared.js";

/**
 * Treasury: where the contribution margin of every settled delivery is earmarked.
 *
 * These are *earmarks over cash the ledger has already recorded*, not ledger accounts — the
 * journals in `journals`/`journal_lines` remain the books of account. Treasury answers a
 * different question: of the margin we made, how much is already spoken for by rent, insurance,
 * tax and the like. Nothing here moves money; Phase 3B turns a funded wallet into a payment
 * *proposal* that a human executes.
 */

export const walletCategoryEnum = pgEnum("wallet_category", [
  "operating_expense",
  "reserve",
  "capital",
]);

export const allocationKindEnum = pgEnum("allocation_kind", [
  "allocation",
  "overflow",
  "reversal",
  "payment",
  "adjustment",
]);

export const allocationWallets = pgTable(
  "allocation_wallets",
  {
    id: id(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    category: walletCategoryEnum("category").notNull(),
    /** Lower runs first inside its category. */
    priority: integer("priority").notNull().default(10),
    /** Derived from allocation_transactions, denormalised for fast reads; only this module writes it. */
    balanceCents: bigint("balance_cents", { mode: "number" }).notNull().default(0),
    active: boolean("active").notNull().default(true),
    /** Operating wallets: the bill this wallet exists to pay. */
    vendor: text("vendor"),
    obligationAmountCents: bigint("obligation_amount_cents", { mode: "number" }),
    /** Day of the month the debit order lands (1–28). */
    dueDay: integer("due_day"),
    /** Reserve/capital wallets: the balance built towards each month. Null = unbounded. */
    monthlyTargetCents: bigint("monthly_target_cents", { mode: "number" }),
    /** The unbounded sink that absorbs the remainder; exactly one wallet may have this. */
    isRetainedEarnings: boolean("is_retained_earnings").notNull().default(false),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("allocation_wallets_slug_uq").on(t.slug),
    uniqueIndex("allocation_wallets_sink_uq")
      .on(t.isRetainedEarnings)
      .where(sql`${t.isRetainedEarnings} = true`),
    index("allocation_wallets_category_idx").on(t.category, t.priority),
  ],
);

/**
 * Append-only movement log per wallet (invariant #2). A correction is a `reversal` row, never
 * an update. `period` (YYYY-MM) is what makes funding progress reset each month without any
 * money moving. `idempotencyKey` is what makes at-least-once event delivery safe.
 */
export const allocationTransactions = pgTable(
  "allocation_transactions",
  {
    id: id(),
    walletId: uuid("wallet_id")
      .notNull()
      .references(() => allocationWallets.id, { onDelete: "restrict" }),
    kind: allocationKindEnum("kind").notNull(),
    amountCents: bigint("amount_cents", { mode: "number" }).notNull(),
    balanceAfterCents: bigint("balance_after_cents", { mode: "number" }).notNull(),
    /** What produced this line, e.g. `shipment:<uuid>` or `payment:<uuid>`. */
    reference: text("reference"),
    period: text("period").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    memo: text("memo"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("allocation_tx_idem_uq").on(t.idempotencyKey),
    index("allocation_tx_wallet_idx").on(t.walletId, t.period),
    index("allocation_tx_reference_idx").on(t.reference),
    index("allocation_tx_period_idx").on(t.period, t.createdAt),
  ],
);
