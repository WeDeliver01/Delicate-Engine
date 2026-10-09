import { z } from "zod";
import { Cents, NonNegativeCents, PositiveCents } from "../money.js";
import { BillingMode } from "../enums.js";
import { Uuid } from "./common.js";

/**
 * Wallet & Billing. One wallet per account. Every movement is an append-only entry; the
 * balance shown is the sum of entries. Holds reserve funds at booking time and are captured
 * (charged) or released later. Postpaid accounts get a credit limit on top of their balance.
 */

export const WalletEntryKind = z.enum([
  "topup", // provider-confirmed top-up
  "charge", // captured hold for a booking
  "refund", // reversal of a charge
  "adjustment", // finance correction (audited)
  "cashback", // loyalty credit
  "statement_payment", // postpaid statement settled
]);
export type WalletEntryKind = z.infer<typeof WalletEntryKind>;

export const WalletEntry = z.object({
  id: Uuid,
  accountId: Uuid,
  kind: WalletEntryKind,
  amountCents: Cents, // signed: credits > 0, debits < 0
  balanceAfterCents: Cents,
  reference: z.string().nullable(), // e.g. booking id, top-up id
  description: z.string(),
  createdAt: z.string().datetime(),
});
export type WalletEntry = z.infer<typeof WalletEntry>;

export const HoldStatus = z.enum(["active", "captured", "released"]);

export const WalletHold = z.object({
  id: Uuid,
  accountId: Uuid,
  amountCents: PositiveCents,
  status: HoldStatus,
  reference: z.string().nullable(),
  createdAt: z.string().datetime(),
  resolvedAt: z.string().datetime().nullable(),
});
export type WalletHold = z.infer<typeof WalletHold>;

export const WalletSummary = z.object({
  accountId: Uuid,
  billingMode: BillingMode,
  balanceCents: Cents,
  creditLimitCents: NonNegativeCents,
  heldCents: NonNegativeCents,
  /** What a new booking may spend right now: balance + credit − holds. */
  availableCents: Cents,
  currency: z.literal("ZAR"),
});
export type WalletSummary = z.infer<typeof WalletSummary>;

export const PaymentProviderName = z.enum(["manual_eft", "payfast", "yoco", "bobpay"]);
export type PaymentProviderName = z.infer<typeof PaymentProviderName>;

export const TopUpStatus = z.enum(["pending", "confirmed", "failed", "cancelled"]);
export type TopUpStatus = z.infer<typeof TopUpStatus>;

export const TopUp = z.object({
  id: Uuid,
  accountId: Uuid,
  provider: PaymentProviderName,
  amountCents: PositiveCents,
  status: TopUpStatus,
  /** Our reference the payer quotes (EFT) or the provider's payment id. */
  reference: z.string(),
  providerRef: z.string().nullable(),
  createdAt: z.string().datetime(),
  confirmedAt: z.string().datetime().nullable(),
});
export type TopUp = z.infer<typeof TopUp>;

export const CreateTopUpRequest = z.object({
  provider: PaymentProviderName,
  amountCents: PositiveCents.min(5_000).max(100_000_00), // R50 – R100 000
  /**
   * Where in the portal the gateway should drop the customer afterwards.
   *
   * Paying is a round trip through somebody else's site, and the default — the wallet — is
   * the wrong place to land when the top-up was only ever a step in booking a delivery. A
   * path inside our own portal and nothing else: this is handed to a payment provider as a
   * redirect target, and anything that can name another host is an open redirect with our
   * name on it.
   */
  returnTo: z
    .string()
    .max(300)
    .regex(/^\/portal\/[A-Za-z0-9\-._~/]*(\?[A-Za-z0-9\-._~/?:@!$'()*+,;=&%]*)?$/, {
      message: "must be a path inside the portal",
    })
    // `/portal/../../somewhere` satisfies the pattern and is not in the portal once a
    // browser has resolved it.
    .refine((v) => !v.includes(".."), { message: "must be a path inside the portal" })
    .optional(),
});
export type CreateTopUpRequest = z.infer<typeof CreateTopUpRequest>;

/** What the client does next: pay by EFT with these details, or be redirected. */
export const TopUpInstructions = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("eft"),
    bank: z.object({
      accountName: z.string(),
      bankName: z.string(),
      accountNumber: z.string(),
      branchCode: z.string(),
    }),
    reference: z.string(),
    note: z.string(),
  }),
  z.object({
    type: z.literal("redirect"),
    url: z.string().url(),
    method: z.enum(["GET", "POST"]),
    fields: z.record(z.string()).optional(),
  }),
]);
export type TopUpInstructions = z.infer<typeof TopUpInstructions>;

export const CreateTopUpResponse = z.object({ topUp: TopUp, instructions: TopUpInstructions });
export type CreateTopUpResponse = z.infer<typeof CreateTopUpResponse>;

export const CreditTermsRequest = z.object({
  billingMode: BillingMode,
  creditLimitCents: NonNegativeCents,
  statementDay: z.number().int().min(1).max(28).default(1),
  paymentTermsDays: z.number().int().min(0).max(90).default(30),
});
export type CreditTermsRequest = z.infer<typeof CreditTermsRequest>;

export const WalletAdjustmentRequest = z.object({
  amountCents: Cents.refine((v) => v !== 0, "amount must be non-zero"),
  reason: z.string().min(5).max(300),
});
export type WalletAdjustmentRequest = z.infer<typeof WalletAdjustmentRequest>;
