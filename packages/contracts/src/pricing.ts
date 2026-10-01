import { z } from "zod";
import { applyBps, Bps, Cents, NonNegativeCents } from "./money.js";
import type { PackageType, RateCard, ServiceLevel } from "./dto/catalog.js";
import { Uuid } from "./dto/common.js";

/**
 * Quote engine — a pure function. No I/O, no dates, no randomness: the same inputs always
 * produce the same breakdown, which is what makes a persisted quote auditable.
 *
 * Price model (per booking = one collection + N drops, priced as a loop from the depot):
 *
 *   loopKm      = depot→collection + collection→drop1 + … + dropN→depot   (road km)
 *   cogs        = loopKm × costPerKm
 *   base        = cogs / (1 − margin)                 ← distance component
 *   base        = base × serviceLevel.multiplier + serviceLevel.surcharge
 *   fuel        = base × fuelSurcharge
 *   extraDrops  = (N − 1) × extraDropFee
 *   parcels     = Σ packageType.surcharge
 *   options     = liability cover (% of declared value, min) + early collection + signature + wedding venue
 *   subtotal    = max(base + fuel + extraDrops + parcels + options, minFee)
 *   vat         = subtotal × vatBps (only when registered)
 *   total       = subtotal + vat
 *
 * Every intermediate figure is integer cents, rounded half-up at each step so the breakdown
 * lines always sum to the total exactly.
 */

export const QuoteOptions = z.object({
  liabilityCover: z.boolean().default(false),
  declaredValueCents: NonNegativeCents.default(0),
  earlyCollection: z.boolean().default(false),
  signatureOnDelivery: z.boolean().default(false),
  weddingVenue: z.boolean().default(false),
});
export type QuoteOptions = z.infer<typeof QuoteOptions>;

export const QuoteParcel = z.object({
  packageTypeId: Uuid,
  quantity: z.number().int().min(1).max(100).default(1),
  weightKg: z.number().positive().max(500).nullable().default(null),
  description: z.string().max(200).nullable().default(null),
});
export type QuoteParcel = z.infer<typeof QuoteParcel>;

export interface PricingInput {
  /** Road kilometres for each leg of the loop, in order. Must have at least 2 legs. */
  legsKm: number[];
  dropCount: number;
  rateCard: RateCard;
  serviceLevel: ServiceLevel;
  parcels: { packageType: PackageType; quantity: number }[];
  options: QuoteOptions;
  vatBps: Bps; // 0 when not VAT registered
}

export const QuoteLine = z.object({
  code: z.string(),
  label: z.string(),
  amountCents: Cents,
});
export type QuoteLine = z.infer<typeof QuoteLine>;

/**
 * What the engine worked out, in full: the kilometres, what the driving cost us, and the margin
 * taken. This is persisted on the quote so a charged price can always be explained years later,
 * and it is for us.
 *
 * It must never leave the API to a customer. `toCustomerBreakdown` is the only thing that should
 * reach a browser.
 */
export const QuoteBreakdown = z.object({
  distanceKm: z.number(),
  legsKm: z.array(z.number()),
  cogsCents: Cents,
  lines: z.array(QuoteLine),
  subtotalCents: Cents,
  vatBps: Bps,
  vatCents: Cents,
  totalCents: Cents,
  minFeeApplied: z.boolean(),
  /** Gross margin on the subtotal, for internal display only. */
  marginBps: Bps,
});
export type QuoteBreakdown = z.infer<typeof QuoteBreakdown>;

/**
 * The price as the customer is allowed to see it: what each part costs, VAT, and the total.
 *
 * Everything that explains *how* the number was reached is dropped — the kilometres, the legs,
 * what the driving cost us, and the margin. Those are the rate logic, and a customer who has
 * the distance and the price can work out our rate per kilometre with a division, which is the
 * one thing a competitor would want.
 *
 * Labels are stripped of any distance too, so quotes priced before this existed do not leak it
 * when they are re-read.
 */
export const CustomerQuoteBreakdown = z.object({
  lines: z.array(QuoteLine),
  subtotalCents: Cents,
  vatBps: Bps,
  vatCents: Cents,
  totalCents: Cents,
  minFeeApplied: z.boolean(),
});
export type CustomerQuoteBreakdown = z.infer<typeof CustomerQuoteBreakdown>;

/** Matches "12 km", "12.4km", "· 12,4 km" and the like, anywhere in a label. */
const DISTANCE_IN_LABEL = /\s*[·,-]?\s*\d+(?:[.,]\d+)?\s*km\b/gi;

export function toCustomerBreakdown(b: QuoteBreakdown): CustomerQuoteBreakdown {
  return {
    lines: b.lines.map((l) => ({ ...l, label: l.label.replace(DISTANCE_IN_LABEL, "").trim() })),
    subtotalCents: b.subtotalCents,
    vatBps: b.vatBps,
    vatCents: b.vatCents,
    totalCents: b.totalCents,
    minFeeApplied: b.minFeeApplied,
  };
}

function roundCents(value: number): Cents {
  return Math.round(value);
}

export function priceQuote(input: PricingInput): QuoteBreakdown {
  const { rateCard, serviceLevel, options, vatBps } = input;
  if (input.legsKm.length < 2) throw new Error("a loop needs at least two legs");
  if (input.dropCount < 1) throw new Error("at least one drop is required");

  const legsKm = input.legsKm.map((km) => Math.round(km * 100) / 100);
  const distanceKm = Math.round(legsKm.reduce((a, b) => a + b, 0) * 100) / 100;

  const cogsCents = roundCents(distanceKm * rateCard.costPerKmCents);
  const marginFraction = Math.min(rateCard.marginBps, 9_900) / 10_000;
  let baseCents = roundCents(cogsCents / (1 - marginFraction));
  baseCents = applyBps(baseCents, serviceLevel.multiplierBps) + serviceLevel.surchargeCents;

  const lines: QuoteLine[] = [
    {
      code: "distance",
      // The service level alone. The distance is still on the breakdown for us, but putting it
      // in a label makes it a customer-facing number that is then impossible to take back --
      // and from the distance and the price, our rate per kilometre is one division away.
      label: serviceLevel.name,
      amountCents: baseCents,
    },
  ];

  const fuelCents = applyBps(baseCents, rateCard.fuelSurchargeBps);
  if (fuelCents > 0) lines.push({ code: "fuel", label: "Fuel surcharge", amountCents: fuelCents });

  const extraDrops = input.dropCount - 1;
  if (extraDrops > 0 && rateCard.extraDropFeeCents > 0) {
    lines.push({
      code: "extra_drops",
      label: `${extraDrops} additional drop${extraDrops > 1 ? "s" : ""}`,
      amountCents: extraDrops * rateCard.extraDropFeeCents,
    });
  }

  for (const p of input.parcels) {
    const amount = p.quantity * p.packageType.surchargeCents;
    if (amount > 0) {
      lines.push({
        code: `parcel:${p.packageType.code}`,
        label: `${p.quantity} × ${p.packageType.name} handling`,
        amountCents: amount,
      });
    }
  }

  if (options.liabilityCover) {
    const pct = applyBps(options.declaredValueCents, rateCard.liabilityCoverBps);
    lines.push({
      code: "liability_cover",
      label: "Delicate liability cover",
      amountCents: Math.max(pct, rateCard.liabilityCoverMinCents),
    });
  }
  if (options.earlyCollection && rateCard.earlyCollectionFeeCents > 0) {
    lines.push({
      code: "early_collection",
      label: "Early collection",
      amountCents: rateCard.earlyCollectionFeeCents,
    });
  }
  if (options.signatureOnDelivery && rateCard.signatureFeeCents > 0) {
    lines.push({
      code: "signature",
      label: "Signature on delivery",
      amountCents: rateCard.signatureFeeCents,
    });
  }
  if (options.weddingVenue && rateCard.weddingVenueFeeCents > 0) {
    lines.push({
      code: "wedding_venue",
      label: "Wedding venue delivery",
      amountCents: rateCard.weddingVenueFeeCents,
    });
  }

  let subtotalCents = lines.reduce((sum, l) => sum + l.amountCents, 0);
  let minFeeApplied = false;
  if (subtotalCents < rateCard.minFeeCents) {
    lines.push({
      code: "min_fee",
      label: "Minimum delivery fee adjustment",
      amountCents: rateCard.minFeeCents - subtotalCents,
    });
    subtotalCents = rateCard.minFeeCents;
    minFeeApplied = true;
  }

  const vatCents = applyBps(subtotalCents, vatBps);
  const totalCents = subtotalCents + vatCents;
  const marginBps =
    subtotalCents > 0 ? Math.round(((subtotalCents - cogsCents) / subtotalCents) * 10_000) : 0;

  return {
    distanceKm,
    legsKm,
    cogsCents,
    lines,
    subtotalCents,
    vatBps,
    vatCents,
    totalCents,
    minFeeApplied,
    marginBps: Math.max(0, Math.min(10_000, marginBps)),
  };
}

/** Great-circle distance in km. Used for the fallback estimator and sanity checks. */
export function haversineKm(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const la1 = (a.lat * Math.PI) / 180;
  const la2 = (b.lat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
