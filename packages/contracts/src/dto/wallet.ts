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

/**
 * A movement a super admin or finance makes on a customer's account by hand.
 *
 * Everything the business does to a balance outside the ordinary flow of top-ups and
 * deliveries: a payment that arrived by EFT, a refund paid back out, goodwill, a debt written
 * off. Each one is a wallet entry and a balanced journal in the same transaction, so the
 * books and the balance can never disagree about what happened.
 *
 * The amount is always positive. Which way it moves is the type's business, not the typist's:
 * a debit typed as a negative number is how somebody credits an account they meant to charge.
 */
export const AccountTransactionType = z.enum([
  "payment",
  "payment_reversal",
  "refund",
  "refund_reversal",
  "admin_credit",
  "admin_debit",
  "promotional_credit",
  "balance_adjustment_credit",
  "balance_adjustment_debit",
  "bad_debt_write_off",
]);
export type AccountTransactionType = z.infer<typeof AccountTransactionType>;

/** What each one is and which way it moves the balance. Shared so the console cannot differ. */
export const ACCOUNT_TRANSACTIONS: Record<
  AccountTransactionType,
  { label: string; direction: "credit" | "debit"; help: string }
> = {
  payment: {
    label: "Payment",
    direction: "credit",
    help: "Money received from the customer outside the payment gateway — an EFT, cash at the door.",
  },
  payment_reversal: {
    label: "Payment reversal",
    direction: "debit",
    help: "A payment that did not stick: a bounced EFT, a chargeback.",
  },
  refund: {
    label: "Refund",
    direction: "debit",
    help: "Money paid back out to the customer. Their balance falls by what left our bank.",
  },
  refund_reversal: {
    label: "Refund reversal",
    direction: "credit",
    help: "A refund that failed or was recalled.",
  },
  admin_credit: {
    label: "Admin credit",
    direction: "credit",
    help: "A correction in the customer's favour where nothing else fits.",
  },
  admin_debit: {
    label: "Admin debit",
    direction: "debit",
    help: "A correction against the customer where nothing else fits.",
  },
  promotional_credit: {
    label: "Promotional credit",
    direction: "credit",
    help: "Money we are giving away: a goodwill gesture, a campaign. Costs the business, not the customer.",
  },
  balance_adjustment_credit: {
    label: "Balance adjustment credit",
    direction: "credit",
    help: "Putting the balance right after a mistake, upwards.",
  },
  balance_adjustment_debit: {
    label: "Balance adjustment debit",
    direction: "debit",
    help: "Putting the balance right after a mistake, downwards.",
  },
  bad_debt_write_off: {
    label: "Bad debt write-off",
    direction: "credit",
    help: "Giving up on money owed. Clears what the customer owes and books the loss to us.",
  },
};

export const AccountTransactionRequest = z.object({
  type: AccountTransactionType,
  /** Always positive, VAT included. The type decides the direction. */
  amountCents: PositiveCents.max(100_000_00),
  description: z.string().trim().max(200).optional(),
  /** The delivery it is about, when it is about one. Printed on the entry. */
  waybill: z.string().trim().max(40).optional(),
});
export type AccountTransactionRequest = z.infer<typeof AccountTransactionRequest>;
