import { z } from "zod";
import { Bps } from "../money.js";
import { CompanyTaxProfile } from "./billing.js";
import { AdminCopySettings } from "./notifications.js";
import { BookingLimits, SettlementRules } from "./catalog.js";
import { Address } from "./geo.js";
import { SlotPolicy } from "./slots.js";

/**
 * Operator-editable settings.
 *
 * Until now every one of these lived only in the seed, which meant the numbers that decide what
 * a customer is charged, what a driver earns and what a tax invoice claims could only be changed
 * by a developer. They are the operator's, so they belong in the console.
 *
 * Each group is its own request, because they carry different risk: the tax identity is what
 * SARS sees, the settlement rules are what drivers are paid, and mixing them into one blob would
 * make the audit trail useless.
 */

export const VatSettings = z.object({
  /** Off means documents issue as a plain "INVOICE" with no VAT line at all. */
  registered: z.boolean(),
  /** South Africa is 15% = 1500 bps. Only applied while `registered`. */
  bps: Bps,
});
export type VatSettings = z.infer<typeof VatSettings>;

export const OperationsSettings = z.object({
  depotAddress: Address,
  timezone: z.string().min(1).max(64),
  /** Latest minute of the day an on-demand booking is still accepted for today. */
  sameDayCutoffMinutes: z.number().int().min(0).max(1439),
});
export type OperationsSettings = z.infer<typeof OperationsSettings>;

/**
 * What is still a placeholder. Surfaced so nobody discovers on their first real invoice that the
 * VAT number was never filled in.
 */
export const SettingsReadiness = z.object({
  /** Documents will carry the words "TAX INVOICE" and a VAT line. */
  issuesTaxInvoices: z.boolean(),
  missing: z.array(
    z.object({
      field: z.string(),
      why: z.string(),
      severity: z.enum(["blocking", "advisory"]),
    }),
  ),
  /** Obligations configured in treasury, and how many still carry the seeded placeholder amount. */
  obligationCount: z.number().int(),
  placeholderObligationCount: z.number().int(),
});
export type SettingsReadiness = z.infer<typeof SettingsReadiness>;

export const SettingsBundle = z.object({
  company: CompanyTaxProfile,
  /** Printed at the foot of every waybill. */
  waybillTerms: z.string(),
  adminCopy: AdminCopySettings,
  vat: VatSettings,
  operations: OperationsSettings,
  settlement: SettlementRules,
  slots: SlotPolicy,
  bookingLimits: BookingLimits,
  readiness: SettingsReadiness,
});
export type SettingsBundle = z.infer<typeof SettingsBundle>;
