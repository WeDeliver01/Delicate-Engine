import { sql } from "drizzle-orm";
import {
  bigint,
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { createdAt, id, timestamps } from "./_shared.js";
import { drivers } from "./fleet.js";
import { users } from "./identity.js";
import { allocationWallets } from "./treasury.js";

/**
 * Money-movement proposals (invariant #7). The engine writes rows here; a human approves them,
 * pays them, and records the proof. The journal is posted at execution, never at proposal — so
 * the ledger only ever claims money left after someone says it did.
 */

export const proposalKindEnum = pgEnum("proposal_kind", [
  "driver_earnings_payout",
  "driver_fuel_load",
  "vendor_payment",
]);

export const proposalStatusEnum = pgEnum("proposal_status", [
  "proposed",
  "approved",
  "rejected",
  "executed",
  "failed",
  "cancelled",
]);

export const payoutMethodEnum = pgEnum("payout_method", ["eft", "paycentral", "cash", "other"]);

export const paymentProposals = pgTable(
  "payment_proposals",
  {
    id: id(),
    reference: text("reference").notNull(),
    kind: proposalKindEnum("kind").notNull(),
    status: proposalStatusEnum("status").notNull().default("proposed"),
    amountCents: bigint("amount_cents", { mode: "number" }).notNull(),
    method: payoutMethodEnum("method").notNull(),
    driverId: uuid("driver_id").references(() => drivers.id, { onDelete: "restrict" }),
    vendorName: text("vendor_name"),
    walletId: uuid("wallet_id").references(() => allocationWallets.id, { onDelete: "restrict" }),
    period: text("period").notNull(),
    /** The evidence: which settlements and balances produced this amount. */
    basis: jsonb("basis").notNull(),
    approvedByUserId: uuid("approved_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    approvedAt: timestamp("approved_at", { withTimezone: true, mode: "date" }),
    decisionNote: text("decision_note"),
    executedByUserId: uuid("executed_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    executedAt: timestamp("executed_at", { withTimezone: true, mode: "date" }),
    externalReference: text("external_reference"),
    journalId: uuid("journal_id"),
    /** Unique per row; the partial indexes below are what stop duplicate live proposals. */
    idempotencyKey: text("idempotency_key").notNull(),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("payment_proposals_reference_uq").on(t.reference),
    uniqueIndex("payment_proposals_idem_uq").on(t.idempotencyKey),
    index("payment_proposals_status_idx").on(t.status, t.createdAt),
    index("payment_proposals_driver_idx").on(t.driverId, t.status),
    // At most one live proposal per payee per kind and period: two open EFTs for the same
    // driver is exactly the mistake this table exists to prevent.
    uniqueIndex("payment_proposals_open_driver_uq")
      .on(t.kind, t.driverId, t.period)
      .where(sql`${t.status} in ('proposed', 'approved', 'failed') and ${t.driverId} is not null`),
    uniqueIndex("payment_proposals_open_wallet_uq")
      .on(t.kind, t.walletId, t.period)
      .where(sql`${t.status} in ('proposed', 'approved', 'failed') and ${t.walletId} is not null`),
  ],
);

/** Counter behind human-readable references (PAY-YYMM-NNNN), row-locked like waybills. */
export const paymentCounters = pgTable("payment_counters", {
  period: text("period").primaryKey(),
  next: bigint("next", { mode: "number" }).notNull().default(1),
  createdAt: createdAt(),
});
