import { z } from "zod";
import { Address } from "./geo.js";
import { Uuid } from "./common.js";
import { IsoDate, TimedWindow } from "./slots.js";
import { CustomerQuoteBreakdown, QuoteOptions, QuoteParcel } from "../pricing.js";

export const Contact = z.object({
  name: z.string().min(2).max(120),
  phone: z.string().min(6).max(24),
  email: z.string().email().nullable().default(null),
});
export type Contact = z.infer<typeof Contact>;

/**
 * A delivery, as much as is known when the question is asked.
 *
 * Only the address is required, because the point of a quote is a price and an address is all
 * a price needs. Who is receiving it and what is in the box do not change the distance; the
 * parcels change the price a little, and the recipient not at all.
 *
 * So a customer can get a number by typing one thing. The details become compulsory at the
 * moment they actually matter — booking it — and `CreateBookingRequest` carries whatever the
 * quote did not.
 */
export const DropInput = z.object({
  address: Address,
  /** Null while this is only a quote. Required before the shipment exists. */
  recipient: Contact.nullable().default(null),
  instructions: z.string().max(500).nullable().default(null),
  /** Empty prices as a plain delivery; package surcharges are added once they are known. */
  parcels: z.array(QuoteParcel).max(20).default([]),
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
  /**
   * The day the job is for, when it is known at pricing time. Only date-conditional
   * surcharges read it, and those are zero on every rate card, so omitting it prices
   * exactly as before.
   */
  deliveryDate: IsoDate.optional(),
  /**
   * The narrow windows the customer wants, when they want them.
   *
   * One pair per booking rather than per drop: a booking already has one collection and one
   * slot that every drop inherits, and per-drop windows would mean per-drop pricing. A
   * dispatcher can still narrow an individual stop afterwards, and a customer who needs two
   * genuinely different promises books twice.
   */
  timedWindow: z
    .object({
      collection: TimedWindow.nullable().default(null),
      delivery: TimedWindow.nullable().default(null),
    })
    .optional(),
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
  /** Weekends and public holidays can carry a surcharge, so the day changes the number. */
  deliveryDate: IsoDate.optional(),
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
