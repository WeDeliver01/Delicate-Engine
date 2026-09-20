import { z } from "zod";
import { Cents } from "../money.js";
import { Uuid } from "./common.js";

/**
 * Double-entry ledger (invariant #3): every economic event is one journal whose lines sum to
 * zero. Debits are positive, credits negative. Balances are derived, never stored.
 *
 * Owner scoping: company-wide accounts have ownerType "company"; driver payables are per
 * driver; customer liabilities per account.
 */
export const LedgerAccount = z.enum([
  // customer money
  "CUSTOMER_PREPAID_LIABILITY", // what we owe customers (their wallet balances)     credit-normal
  "CUSTOMER_RECEIVABLE", // postpaid usage not yet paid                             debit-normal
  "CASH_CLEARING", // top-ups received, awaiting bank reconciliation                  debit-normal
  // revenue and tax
  "REVENUE", // delivery revenue ex VAT                                              credit-normal
  "VAT_OUTPUT", // VAT collected, owed to SARS                                        credit-normal
  // costs
  "FUEL_EXPENSE", // fuel cost recognised per delivery                               debit-normal
  "FUEL_PAYABLE", // owed to the driver's fuel card (PayCentral load)                credit-normal
  "DRIVER_EARNINGS_EXPENSE", // driver pay recognised                                debit-normal
  "DRIVER_EARNINGS_PAYABLE", // owed to drivers                                      credit-normal
  "LOYALTY_EXPENSE", // cashback granted                                             debit-normal
  "ADJUSTMENTS", // finance corrections                                              either
]);
export type LedgerAccount = z.infer<typeof LedgerAccount>;

export const OwnerType = z.enum(["company", "account", "driver"]);
export type OwnerType = z.infer<typeof OwnerType>;

export const JournalKind = z.enum([
  "topup",
  "settlement",
  "reversal",
  "adjustment",
  "cashback",
  "payout",
  "fuel_load",
]);
export type JournalKind = z.infer<typeof JournalKind>;

export const JournalLine = z.object({
  account: LedgerAccount,
  ownerType: OwnerType,
  ownerId: Uuid.nullable(),
  amountCents: Cents, // debit > 0, credit < 0
  memo: z.string().max(200).nullable(),
});
export type JournalLine = z.infer<typeof JournalLine>;

export const Journal = z.object({
  id: Uuid,
  kind: JournalKind,
  refType: z.string().nullable(),
  refId: z.string().nullable(),
  description: z.string(),
  occurredAt: z.string().datetime(),
  lines: z.array(JournalLine),
});
export type Journal = z.infer<typeof Journal>;

export const AccountBalance = z.object({
  account: LedgerAccount,
  ownerType: OwnerType,
  ownerId: Uuid.nullable(),
  balanceCents: Cents, // signed: debit-normal positive, credit-normal negative
});
export type AccountBalance = z.infer<typeof AccountBalance>;
