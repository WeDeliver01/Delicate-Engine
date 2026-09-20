import { z } from "zod";
import { Address } from "./geo.js";
import { Uuid } from "./common.js";
import { QuoteBreakdown, QuoteOptions, QuoteParcel } from "../pricing.js";

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
});
export type QuoteRequest = z.infer<typeof QuoteRequest>;

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
  serviceLevelCode: z.string(),
  rateCardId: Uuid,
  status: QuoteStatus,
  request: QuoteRequest,
  breakdown: QuoteBreakdown,
  /** Provider used for distance: "google" | "haversine". Recorded for audit. */
  distanceProvider: z.string(),
  expiresAt: z.string().datetime(),
  createdAt: z.string().datetime(),
});
export type Quote = z.infer<typeof Quote>;

export const EstimateResponse = z.object({
  breakdown: QuoteBreakdown,
  serviceLevelCode: z.string(),
  distanceProvider: z.string(),
});
export type EstimateResponse = z.infer<typeof EstimateResponse>;
