import { z } from "zod";
import { Cents, NonNegativeCents } from "../money.js";
import { Uuid } from "./common.js";
import { IsoDate } from "./slots.js";

/**
 * Money movement out of the business (invariant #7: **the engine proposes, a human executes**).
 *
 * Nothing in this module can move money. The engine computes what is owed and to whom, and
 * writes a *proposal*. A finance user approves it, pays it in the bank or the PayCentral portal,
 * and records the execution with the external reference. Only then is a journal posted — so the
 * books say "paid" exactly when the money actually left, never because a robot decided it should.
 */

export const ProposalKind = z.enum([
  /** Pay a driver what the ledger says they have earned. */
  "driver_earnings_payout",
  /** Load a driver's fuel card for fuel already consumed (PayCentral). */
  "driver_fuel_load",
  /** Pay a vendor the bill an operating wallet has been funding. */
  "vendor_payment",
]);
export type ProposalKind = z.infer<typeof ProposalKind>;

/**
 * proposed → approved → executed is the happy path. `rejected` and `cancelled` are terminal and
 * post nothing; `failed` means the human tried to pay and the payment did not land, and can be
 * retried back to `approved`.
 */
export const ProposalStatus = z.enum([
  "proposed",
  "approved",
  "rejected",
  "executed",
  "failed",
  "cancelled",
]);
export type ProposalStatus = z.infer<typeof ProposalStatus>;

export const PayoutMethod = z.enum(["eft", "paycentral", "cash", "other"]);
export type PayoutMethod = z.infer<typeof PayoutMethod>;

/** The evidence behind an amount: which settlements, and what each contributed. */
export const ProposalBasis = z.object({
  /** Ledger balance the amount was derived from, at proposal time. */
  payableBalanceCents: Cents,
  upTo: z.string().datetime().nullable(),
  items: z.array(
    z.object({
      shipmentId: Uuid.nullable(),
      waybill: z.string().nullable(),
      amountCents: Cents,
      settledAt: z.string().datetime().nullable(),
    }),
  ),
  /** Vendor payments: the treasury wallet that funded it. */
  walletSlug: z.string().nullable(),
  note: z.string().nullable(),
});
export type ProposalBasis = z.infer<typeof ProposalBasis>;

export const PaymentProposal = z.object({
  id: Uuid,
  reference: z.string(),
  kind: ProposalKind,
  status: ProposalStatus,
  amountCents: NonNegativeCents,
  currency: z.literal("ZAR"),
  method: PayoutMethod,
  /** Who gets paid. Exactly one of driver / vendor is set. */
  driverId: Uuid.nullable(),
  driverName: z.string().nullable(),
  vendorName: z.string().nullable(),
  walletId: Uuid.nullable(),
  period: z.string(),
  basis: ProposalBasis,
  approvedByUserId: Uuid.nullable(),
  approvedAt: z.string().datetime().nullable(),
  decisionNote: z.string().nullable(),
  executedByUserId: Uuid.nullable(),
  executedAt: z.string().datetime().nullable(),
  /** EFT proof number, PayCentral transaction id — whatever proves the money left. */
  externalReference: z.string().nullable(),
  journalId: Uuid.nullable(),
  createdAt: z.string().datetime(),
});
export type PaymentProposal = z.infer<typeof PaymentProposal>;

/** Ask the engine what it would propose today. Returns proposals in `proposed` state. */
export const PrepareRunRequest = z.object({
  kind: ProposalKind,
  /** Only count settlements up to this date; defaults to now. */
  upTo: IsoDate.optional(),
  /** Limit to one driver, or one wallet for a vendor payment. */
  driverId: Uuid.optional(),
  walletSlug: z.string().optional(),
  /** Skip anything under this amount, so a R3 payout does not cost a R10 EFT fee. */
  minimumCents: NonNegativeCents.optional(),
});
export type PrepareRunRequest = z.infer<typeof PrepareRunRequest>;

export const DecideProposalRequest = z.object({
  note: z.string().max(500).optional(),
});
export type DecideProposalRequest = z.infer<typeof DecideProposalRequest>;

/** Recording an execution is a human asserting "I paid this, here is the proof". */
export const ExecuteProposalRequest = z.object({
  externalReference: z.string().min(2).max(120),
  method: PayoutMethod.optional(),
  paidAt: z.string().datetime().optional(),
  note: z.string().max(500).optional(),
});
export type ExecuteProposalRequest = z.infer<typeof ExecuteProposalRequest>;

export const FailProposalRequest = z.object({
  reason: z.string().min(2).max(500),
});
export type FailProposalRequest = z.infer<typeof FailProposalRequest>;

/** Move reconciled customer cash from the clearing account into the bank. */
export const BankSweepRequest = z.object({
  amountCents: NonNegativeCents,
  reference: z.string().min(2).max(120),
  occurredAt: z.string().datetime().optional(),
  note: z.string().max(500).optional(),
});
export type BankSweepRequest = z.infer<typeof BankSweepRequest>;

/** What finance sees before deciding: who is owed what, and what cash is on hand. */
export const PayablesSummary = z.object({
  bankBalanceCents: Cents,
  cashClearingCents: Cents,
  driverEarningsOwedCents: Cents,
  fuelCardOwedCents: Cents,
  /** Total of every proposal awaiting approval or execution. */
  committedCents: Cents,
  drivers: z.array(
    z.object({
      driverId: Uuid,
      name: z.string(),
      earningsOwedCents: Cents,
      fuelOwedCents: Cents,
      openProposalCents: Cents,
    }),
  ),
  vendors: z.array(
    z.object({
      walletSlug: z.string(),
      name: z.string(),
      vendor: z.string(),
      dueDay: z.number().int(),
      amountCents: Cents,
      fundedCents: Cents,
      payable: z.boolean(),
    }),
  ),
});
export type PayablesSummary = z.infer<typeof PayablesSummary>;
