import { z } from "zod";
import { Bps, Cents, NonNegativeCents } from "../money.js";
import { Uuid } from "./common.js";

/**
 * Treasury: what happens to the margin after a delivery settles.
 *
 * The double-entry ledger records what the business earned and owes. Treasury is the layer on
 * top that decides where the *contribution margin* is earmarked: fund this month's obligations
 * first (weighted by how soon each debit order lands), then top up reserves in priority order,
 * and let whatever is left fall into retained earnings.
 *
 * Reconciliation rule (the treasury equivalent of "journals balance"): for every settlement,
 * the sum of its allocation transactions equals the contribution margin exactly.
 */

export const WalletCategory = z.enum(["operating_expense", "reserve", "capital"]);
export type WalletCategory = z.infer<typeof WalletCategory>;

export const AllocationWallet = z.object({
  id: Uuid,
  slug: z.string().min(2).max(60),
  name: z.string().min(2).max(80),
  category: WalletCategory,
  /** Lower runs first inside its category. */
  priority: z.number().int().min(0).max(1000),
  balanceCents: Cents,
  active: z.boolean(),
  /** Operating wallets: the bill this wallet exists to pay. */
  obligation: z
    .object({
      vendor: z.string().max(120),
      monthlyAmountCents: NonNegativeCents,
      /** Day of the month the debit order lands (1–28). */
      dueDay: z.number().int().min(1).max(28),
    })
    .nullable(),
  /** Reserve/capital wallets: the balance we are building towards each month. Null = unbounded. */
  monthlyTargetCents: NonNegativeCents.nullable(),
  /** The unbounded sink that absorbs the remainder; exactly one wallet has this. */
  isRetainedEarnings: z.boolean(),
});
export type AllocationWallet = z.infer<typeof AllocationWallet>;

export const UpsertWalletRequest = AllocationWallet.omit({
  id: true,
  balanceCents: true,
  isRetainedEarnings: true,
}).partial({
  active: true,
  priority: true,
  obligation: true,
  monthlyTargetCents: true,
});
export type UpsertWalletRequest = z.infer<typeof UpsertWalletRequest>;

export const AllocationKind = z.enum([
  "allocation",
  "overflow",
  "reversal",
  "payment",
  "adjustment",
]);
export type AllocationKind = z.infer<typeof AllocationKind>;

export const AllocationTransaction = z.object({
  id: Uuid,
  walletId: Uuid,
  walletSlug: z.string(),
  kind: AllocationKind,
  amountCents: Cents,
  balanceAfterCents: Cents,
  /** The settlement (or payment) that produced this line. */
  reference: z.string().nullable(),
  period: z.string(), // YYYY-MM, so a new month resets funding progress without moving money
  createdAt: z.string().datetime(),
});
export type AllocationTransaction = z.infer<typeof AllocationTransaction>;

/** What one settlement's margin did. */
export const AllocationResult = z.object({
  settlementRef: z.string(),
  marginCents: Cents,
  period: z.string(),
  lines: z.array(
    z.object({
      walletSlug: z.string(),
      name: z.string(),
      amountCents: Cents,
      kind: AllocationKind,
    }),
  ),
});
export type AllocationResult = z.infer<typeof AllocationResult>;

/** Per-wallet funding progress for the current month, with risk against the due date. */
export const WalletForecast = z.object({
  walletId: Uuid,
  slug: z.string(),
  name: z.string(),
  category: WalletCategory,
  targetCents: NonNegativeCents,
  fundedCents: Cents,
  remainingCents: Cents,
  progressBps: Bps,
  dueDay: z.number().int().nullable(),
  daysUntilDue: z.number().int().nullable(),
  /** Projected funding by month end at the current run rate. */
  projectedCents: Cents,
  atRisk: z.boolean(),
});
export type WalletForecast = z.infer<typeof WalletForecast>;

export const TreasuryDashboard = z.object({
  period: z.string(),
  /** 0–100: how well obligations are covered, weighted by urgency. */
  healthScore: z.number().int().min(0).max(100),
  marginThisPeriodCents: Cents,
  obligationsTotalCents: Cents,
  obligationsFundedCents: Cents,
  projectedCoverageBps: Bps,
  shortfallCents: Cents,
  operating: z.array(WalletForecast),
  reserves: z.array(WalletForecast),
  capital: z.array(WalletForecast),
  availableOperatingCashCents: Cents,
  upcomingDebitOrders: z.array(
    z.object({
      slug: z.string(),
      name: z.string(),
      vendor: z.string(),
      amountCents: Cents,
      dueDay: z.number().int(),
      fundedCents: Cents,
      covered: z.boolean(),
    }),
  ),
  recent: z.array(AllocationTransaction),
});
export type TreasuryDashboard = z.infer<typeof TreasuryDashboard>;

/** Tuning knobs for the allocation algorithm; admin-editable, snapshotted per allocation. */
export const TreasuryPolicy = z.object({
  /** Days before a debit order when urgency starts climbing. */
  urgencyWindowDays: z.number().int().min(1).max(31),
  /** Maximum urgency multiplier on the due date itself. */
  urgencyMaxMultiplierBps: z.number().int().min(10_000).max(50_000),
  /** Stop allocating to reserves while obligations are under this coverage. */
  reserveGateBps: Bps,
});
export type TreasuryPolicy = z.infer<typeof TreasuryPolicy>;
