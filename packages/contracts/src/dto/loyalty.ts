import { z } from "zod";
import { Bps, Cents, NonNegativeCents } from "../money.js";
import { Uuid } from "./common.js";

/**
 * Loyalty.
 *
 * Cashback is paid back into the customer's wallet, which is the only reward that costs the
 * business exactly what it says on the tin and that the customer can spend on the next delivery.
 * No points, no expiry, no separate currency to reconcile.
 *
 * It is earned on money actually taken, never on a booking that was merely made — a cancelled
 * booking that had already earned cashback would be a way to mint money.
 */

export const LoyaltyTier = z.object({
  code: z.string().min(2).max(24),
  name: z.string().min(2).max(60),
  /** Spend in the rolling window needed to reach this tier. The first tier is 0. */
  minSpendCents: NonNegativeCents,
  /** Cashback earned at this tier, in basis points of the amount charged excluding VAT. */
  cashbackBps: Bps,
});
export type LoyaltyTier = z.infer<typeof LoyaltyTier>;

export const LoyaltyProgram = z.object({
  enabled: z.boolean(),
  /** How far back spend is counted when working out a tier. */
  windowDays: z.number().int().min(7).max(730),
  /** Do not credit trivial amounts; they cost more to explain than they are worth. */
  minAwardCents: NonNegativeCents,
  tiers: z.array(LoyaltyTier).min(1).max(6),
});
export type LoyaltyProgram = z.infer<typeof LoyaltyProgram>;

export const LoyaltyAward = z.object({
  id: Uuid,
  accountId: Uuid,
  bookingId: Uuid.nullable(),
  reference: z.string(),
  tierCode: z.string(),
  cashbackBps: Bps,
  /** What the cashback was calculated on: the charge excluding VAT. */
  eligibleCents: Cents,
  amountCents: Cents,
  walletEntryId: Uuid.nullable(),
  journalId: Uuid.nullable(),
  createdAt: z.string().datetime(),
});
export type LoyaltyAward = z.infer<typeof LoyaltyAward>;

/** What a customer sees: where they are, what they have earned, and what the next tier needs. */
export const LoyaltyStatus = z.object({
  enabled: z.boolean(),
  accountId: Uuid,
  tier: LoyaltyTier,
  nextTier: LoyaltyTier.nullable(),
  /** Spend counted towards the tier, in the rolling window. */
  windowDays: z.number().int(),
  windowSpendCents: Cents,
  /** What the next tier still needs. Null at the top tier. */
  toNextTierCents: Cents.nullable(),
  earnedAllTimeCents: Cents,
  earnedThisWindowCents: Cents,
  recent: z.array(LoyaltyAward),
});
export type LoyaltyStatus = z.infer<typeof LoyaltyStatus>;
