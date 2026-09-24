import { z } from "zod";
import { Bps, Cents, NonNegativeCents } from "../money.js";
import { Uuid } from "./common.js";
import { Address } from "./geo.js";
import { IsoDate } from "./slots.js";

/**
 * Invoicing and statements.
 *
 * A South African tax invoice must carry specific things to be claimable by the customer:
 * the words "TAX INVOICE", the supplier's name, address and VAT number, a serial number, the
 * date, a description of what was supplied, and the VAT shown separately. Above R5 000 it must
 * also carry the recipient's name, address and (if any) VAT number. All of that is captured
 * here and **snapshotted onto the invoice at issue**, so reprinting an old invoice years later
 * shows what was true then, not what the settings say today.
 *
 * If the company is not VAT registered, documents are issued as a plain "INVOICE" with no VAT
 * line — claiming VAT you are not registered for is an offence, so this is not configurable
 * beyond the registration flag.
 */

/** The supplier's legal identity, as printed. */
export const CompanyTaxProfile = z.object({
  legalName: z.string().min(2).max(160),
  tradingName: z.string().max(160).nullable(),
  registrationNumber: z.string().max(40).nullable(),
  vatNumber: z.string().max(20).nullable(),
  address: Address,
  email: z.string().email(),
  phone: z.string().max(32),
  bank: z.object({
    bankName: z.string().max(80),
    accountName: z.string().max(120),
    accountNumber: z.string().max(40),
    branchCode: z.string().max(20),
  }),
});
export type CompanyTaxProfile = z.infer<typeof CompanyTaxProfile>;

export const DocumentKind = z.enum(["tax_invoice", "invoice", "credit_note"]);
export type DocumentKind = z.infer<typeof DocumentKind>;

/** draft is never shown to a customer; issued is immutable and only reversible by credit note. */
export const InvoiceStatus = z.enum(["draft", "issued", "paid", "void"]);
export type InvoiceStatus = z.infer<typeof InvoiceStatus>;

export const InvoiceLine = z.object({
  description: z.string().max(300),
  /** The waybill this line bills for, when it is a delivery. */
  waybill: z.string().nullable(),
  shipmentId: Uuid.nullable(),
  quantity: z.number().int().positive(),
  unitAmountCents: Cents,
  /** Line total excluding VAT. */
  netCents: Cents,
  vatBps: Bps,
  vatCents: Cents,
  grossCents: Cents,
});
export type InvoiceLine = z.infer<typeof InvoiceLine>;

export const Invoice = z.object({
  id: Uuid,
  number: z.string(),
  kind: DocumentKind,
  status: InvoiceStatus,
  accountId: Uuid,
  /** Set for a per-booking invoice; null for a consolidated monthly one. */
  bookingId: Uuid.nullable(),
  /** YYYY-MM for a monthly invoice. */
  period: z.string().nullable(),
  issuedAt: z.string().datetime().nullable(),
  dueAt: z.string().datetime().nullable(),
  netCents: Cents,
  vatCents: Cents,
  totalCents: Cents,
  /** How much of the total is still outstanding; 0 for a prepaid invoice paid from the wallet. */
  outstandingCents: Cents,
  currency: z.literal("ZAR"),
  lines: z.array(InvoiceLine),
  /** Snapshots taken at issue: what was true then. */
  supplier: CompanyTaxProfile,
  billTo: z.object({
    accountName: z.string(),
    legalName: z.string().nullable(),
    vatNumber: z.string().nullable(),
    address: Address.nullable(),
    email: z.string().nullable(),
  }),
  /** Credit notes point at what they reverse. */
  creditsInvoiceId: Uuid.nullable(),
  creditedByInvoiceId: Uuid.nullable(),
  note: z.string().nullable(),
  journalId: Uuid.nullable(),
  createdAt: z.string().datetime(),
});
export type Invoice = z.infer<typeof Invoice>;

export const IssueMonthlyRequest = z.object({
  /** YYYY-MM. Defaults to last month. */
  period: z
    .string()
    .regex(/^\d{4}-\d{2}$/)
    .optional(),
  accountId: Uuid.optional(),
});
export type IssueMonthlyRequest = z.infer<typeof IssueMonthlyRequest>;

export const CreditNoteRequest = z.object({
  reason: z.string().min(3).max(500),
  /** Partial credit; defaults to the whole invoice. */
  amountCents: NonNegativeCents.optional(),
});
export type CreditNoteRequest = z.infer<typeof CreditNoteRequest>;

export const RecordInvoicePaymentRequest = z.object({
  amountCents: NonNegativeCents,
  reference: z.string().min(2).max(120),
  paidAt: z.string().datetime().optional(),
});
export type RecordInvoicePaymentRequest = z.infer<typeof RecordInvoicePaymentRequest>;

/**
 * A statement is derived, never stored: opening balance, every movement in the window, closing
 * balance. Recomputing it from the append-only entries is what makes it trustworthy.
 */
export const StatementLine = z.object({
  at: z.string().datetime(),
  kind: z.string(),
  description: z.string(),
  reference: z.string().nullable(),
  /** Signed: money in positive, money out negative. */
  amountCents: Cents,
  balanceAfterCents: Cents,
});
export type StatementLine = z.infer<typeof StatementLine>;

export const Statement = z.object({
  accountId: Uuid,
  accountName: z.string(),
  from: IsoDate,
  to: IsoDate,
  openingBalanceCents: Cents,
  closingBalanceCents: Cents,
  toppedUpCents: Cents,
  chargedCents: Cents,
  deliveries: z.number().int(),
  lines: z.array(StatementLine),
  /** Postpaid: invoices in the window and what is still owed. */
  invoices: z.array(
    z.object({
      id: Uuid,
      number: z.string(),
      issuedAt: z.string().datetime().nullable(),
      dueAt: z.string().datetime().nullable(),
      totalCents: Cents,
      outstandingCents: Cents,
      status: InvoiceStatus,
    }),
  ),
  outstandingCents: Cents,
});
export type Statement = z.infer<typeof Statement>;

/** Ageing of what customers owe us — the postpaid risk view. */
export const AgeingBucket = z.object({
  accountId: Uuid,
  accountName: z.string(),
  currentCents: Cents,
  days30Cents: Cents,
  days60Cents: Cents,
  days90PlusCents: Cents,
  totalCents: Cents,
  creditLimitCents: Cents,
  overLimit: z.boolean(),
});
export type AgeingBucket = z.infer<typeof AgeingBucket>;
