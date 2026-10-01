import { z } from "zod";
import { Address } from "./geo.js";
import { Uuid } from "./common.js";
import { CustomerQuoteBreakdown, QuoteOptions, QuoteParcel } from "../pricing.js";

export const Contact = z.object({
  name: z.string().min(2).max(120),
  phone: z.string().min(6).max(24),
  email: z.string().email().nullable().default(null),
});
export type Contact = z.infer<typeof Contact>;

export const DropInput = z.object({
  address: Address,
  recipient: Contact,
  instructions: z.string().max(500).nullable().default(null),
  parcels: z.array(QuoteParcel).min(1).max(20),
});
export type DropInput = z.infer<typeof DropInput>;

/**
 * What the portal (or the public estimator) sends. Prices are NEVER trusted from the client;
 * the engine recomputes from the catalog on every call.
 */
export const QuoteRequest = z.object({
  serviceLevelCode: z.string().min(2).max(32),
  collection: z.object({
    address: Address,
    contact: Contact.nullable().default(null),
    instructions: z.string().max(500).nullable().default(null),
  }),
  drops: z.array(DropInput).min(1).max(20),
  options: QuoteOptions.default({}),
  /** Optional: the account whose rate card applies. Public estimates omit it. */
  accountId: Uuid.optional(),
  /** A name the customer gives a quote they mean to keep, e.g. "Saturday market run". */
  label: z.string().trim().max(80).optional(),
});
export type QuoteRequest = z.infer<typeof QuoteRequest>;

export const RenameQuoteRequest = z.object({
  label: z.string().trim().max(80).nullable(),
});
export type RenameQuoteRequest = z.infer<typeof RenameQuoteRequest>;

/** Public estimator: no contacts/parcels needed, just where and how. */
export const EstimateRequest = z.object({
  serviceLevelCode: z.string().min(2).max(32).default("standard"),
  collection: Address,
  drops: z.array(Address).min(1).max(20),
  packageTypeCodes: z.array(z.string()).default([]),
  options: QuoteOptions.default({}),
});
export type EstimateRequest = z.infer<typeof EstimateRequest>;

export const QuoteStatus = z.enum(["priced", "booked", "expired"]);

export const Quote = z.object({
  id: Uuid,
  accountId: Uuid.nullable(),
  /** QT-YYMMDD-NNNN. Null on quotes priced before references existed. */
  reference: z.string().nullable(),
  /** What the customer called it, if they saved it. */
  label: z.string().nullable(),
  serviceLevelCode: z.string(),
  rateCardId: Uuid,
  status: QuoteStatus,
  request: QuoteRequest,
  breakdown: CustomerQuoteBreakdown,
  expiresAt: z.string().datetime(),
  createdAt: z.string().datetime(),
});
export type Quote = z.infer<typeof Quote>;

export const EstimateResponse = z.object({
  breakdown: CustomerQuoteBreakdown,
  serviceLevelCode: z.string(),
});
export type EstimateResponse = z.infer<typeof EstimateResponse>;
