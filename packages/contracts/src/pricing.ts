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
 *   window      = timed-window surcharge, when the customer buys a narrow window
 *   dated       = weekend / public-holiday surcharge, when the caller says the date qualifies
 *                 (zero on every rate card until the business decides otherwise)
 *   subtotal    = max(base + fuel + extraDrops + parcels + options + window + dated, minFee)
 *   subtotal    = max(subtotal, costFloor)             ← see below; never below true cost
 *   vat         = subtotal × vatBps (only when registered)
 *   total       = subtotal + vat
 *
 * Every intermediate figure is integer cents, rounded half-up at each step so the breakdown
 * lines always sum to the total exactly.
 *
 * The cost floor (from "Delicate Engine pricing model", Oct 2026 — the audit that found 636
 * of 1,657 deliveries cash-negative on direct cost, because the rate card above was a number
 * someone picked rather than a number derived from fuel, wear and driver time, and nothing
 * checked it against either):
 *
 *   c_var   = fuelConsumption/100 × fuelPrice + vehicleWear        (cents per km, derived)
 *   hours   = distanceKm / speed + collectionMinutes/60 + dropMinutes/60 × dropCount
 *   cost    = c_var × distanceKm + driverCostPerHour × hours
 *   floor   = cost / (1 − targetMargin)
 *
 * `distanceKm` here is every kilometre actually driven for the job — depot to collection,
 * every leg between drops, last drop back to depot — not the discounted figure a batching
 * saving is billed on. The fuel is burnt either way; only the price passed on to the customer
 * is allowed to reflect a saving, never the floor that protects the business. Whatever the
 * rate card and its multipliers arrive at, the subtotal is lifted to the floor if it falls
 * short, the same way the flat minimum fee already works — this is a second, cost-derived
 * minimum, applied after it. One cost model, set once in Admin → Pricing, holds every rate
 * card to the same floor, which is what makes the floor fair: no account is priced to a loss
 * because its own card happened to be set too low.
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

/**
 * When the delivery falls, as facts rather than dates — the engine stays a pure function.
 * The caller decides what counts as a weekend or a public holiday (it needs a timezone and a
 * holiday list to know) and passes the answer in.
 */
export const DateFlags = z.object({
  weekend: z.boolean().default(false),
  publicHoliday: z.boolean().default(false),
});
export type DateFlags = z.infer<typeof DateFlags>;

export const NO_DATE_FLAGS: DateFlags = { weekend: false, publicHoliday: false };

/**
 * Read a delivery date as pricing facts.
 *
 * `YYYY-MM-DD` is already a local date, so the day of the week is a property of the string
 * and needs no timezone; reading it as UTC is what stops the machine's own offset moving a
 * Saturday booking to a Friday. Public holidays need a calendar nobody has chosen yet, so
 * the caller supplies the list and gets `false` until it does.
 */
export function dateFlagsFor(
  deliveryDate: string,
  publicHolidays: readonly string[] = [],
): DateFlags {
  const day = new Date(`${deliveryDate}T00:00:00Z`).getUTCDay();
  return {
    weekend: day === 0 || day === 6,
    publicHoliday: publicHolidays.includes(deliveryDate),
  };
}

/**
 * What a delivery actually costs the business: fuel, wear and the driver's time. One of
 * these, set in Admin → Pricing, holds every rate card to the same floor — the fairness is
 * in there being a single shared answer to "what does this cost us", not one per account.
 *
 * Seeded from the October 2026 audit. Four of the seven numbers are stated assumptions —
 * vehicle wear, driver cost, effective speed and the two stop times — and should be replaced
 * with real figures (service invoices, payroll, tracking) before the floor is trusted. Fuel
 * price is not an assumption: update it the day it changes, because `targetMarginBps` is a
 * fraction of it and a stale price erodes the floor exactly the way the old rate card did
 * through 2026, 46% of fuel inflation absorbed by nobody.
 */
export const CostModel = z.object({
  /** Published monthly. The single input worth checking first when a quote looks wrong. */
  fuelPriceCentsPerLitre: NonNegativeCents,
  /** Fleet average, litres per 100 km. */
  fuelConsumptionL100km: z.number().positive().max(50),
  /** Tyres, services, repairs and the unplanned ones. Per km, assumption until proven. */
  vehicleWearCentsPerKm: NonNegativeCents,
  /** Fully loaded: UIF, leave, overtime, not the payslip number alone. */
  driverCostCentsPerHour: NonNegativeCents,
  /** Including traffic and stops, not the speed limit. */
  effectiveSpeedKmh: z.number().positive().max(120),
  /** Arrival to departure at the collection point, once per booking. */
  collectionMinutes: z.number().nonnegative().max(120),
  /** Arrival to departure at each drop. */
  dropMinutes: z.number().nonnegative().max(120),
  /**
   * The margin every delivery must clear over true direct cost before anything else — not a
   * target to aim for, a floor the engine enforces. 5500 is 55%.
   */
  targetMarginBps: Bps,
});
export type CostModel = z.infer<typeof CostModel>;

/** c_var: fuel plus wear, per kilometre, in cents. Derived — never entered directly. */
export function variableCostCentsPerKm(m: CostModel): number {
  return (m.fuelConsumptionL100km / 100) * m.fuelPriceCentsPerLitre + m.vehicleWearCentsPerKm;
}

/** What the job actually cost: every kilometre driven, priced at c_var, plus driver time. */
export function directCostCents(m: CostModel, distanceKm: number, dropCount: number): Cents {
  const hours =
    distanceKm / m.effectiveSpeedKmh + m.collectionMinutes / 60 + (m.dropMinutes / 60) * dropCount;
  return (
    Math.round(variableCostCentsPerKm(m) * distanceKm) +
    Math.round(m.driverCostCentsPerHour * hours)
  );
}

/** The price that holds the margin floor over a given direct cost: cost ÷ (1 − target). */
export function costFloorCents(m: CostModel, cost: Cents): Cents {
  const marginFraction = Math.min(m.targetMarginBps, 9_900) / 10_000;
  return Math.round(cost / (1 - marginFraction));
}

export interface PricingInput {
  /** Road kilometres for each leg of the loop, in order. Must have at least 2 legs. */
  legsKm: number[];
  dropCount: number;
  /**
   * Billable distance, drop by drop.
   *
   * Without it the whole loop is one number and every delivery after the first is a flat
   * fee, which charges the same for a drop down the road as for one across town. With it
   * each delivery is priced on the road kilometres from the collection to its own door --
   * the second and later ones at `extraDropKmFactorBps` of theirs, because the van is
   * already out and the only new cost is the detour.
   *
   * `overheadKm` is the part of the trip that happens once however many drops there are:
   * getting to the collection and getting home again. Charged once, at full rate.
   */
  billable?: { overheadKm: number; dropKm: number[] };
  rateCard: RateCard;
  serviceLevel: ServiceLevel;
  /** What this job must never be priced below, whatever the rate card says. */
  costModel: CostModel;
  parcels: { packageType: PackageType; quantity: number }[];
  options: QuoteOptions;
  vatBps: Bps; // 0 when not VAT registered
  /** Defaults to neither, which is what keeps date-conditional pricing switched off. */
  dateFlags?: DateFlags;
  /**
   * True when the customer is buying a narrow window rather than the whole slot. Priced here
   * so a booking can always explain its total; whether the window is *available* is a capacity
   * question the booking transaction answers.
   */
  timedWindow?: boolean;
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
 * reach a browser — see the note on it.
 */
export const QuoteBreakdown = z.object({
  distanceKm: z.number(),
  legsKm: z.array(z.number()),
  /**
   * Road kilometres from the collection to each drop, in order.
   *
   * What the drop was charged on, and what a dispatcher needs to answer "can this be there by
   * ten". Empty on quotes priced before each drop was measured separately.
   */
  dropKm: z.array(z.number()).default([]),
  cogsCents: Cents,
  lines: z.array(QuoteLine),
  subtotalCents: Cents,
  vatBps: Bps,
  vatCents: Cents,
  totalCents: Cents,
  minFeeApplied: z.boolean(),
  /**
   * What this job actually cost: every kilometre driven plus the driver's time, from the
   * cost model in force when it was quoted. Fuel moves monthly; this is what makes an old
   * quote's margin explainable against the fuel price on the day it was made rather than
   * today's.
   */
  directCostCents: Cents.default(0),
  /** The price the cost model required: directCostCents ÷ (1 − target margin). */
  costFloorCents: Cents.default(0),
  /** True when the rate card's own price fell short and the floor lifted it. */
  costFloorApplied: z.boolean().default(false),
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

  const round2 = (km: number) => Math.round(km * 100) / 100;
  const legsKm = input.legsKm.map(round2);

  /*
    What the customer is charged kilometres for. Either the plain loop -- one number, every
    drop after the first a flat fee -- or, when the caller has measured each drop, the
    overhead once plus each drop's own distance, with the batched ones discounted.
  */
  const billableKm = input.billable
    ? round2(
        input.billable.overheadKm +
          input.billable.dropKm.reduce(
            (total, km, i) => total + km * (i === 0 ? 1 : rateCard.extraDropKmFactorBps / 10_000),
            0,
          ),
      )
    : round2(legsKm.reduce((a, b) => a + b, 0));
  // What was actually driven, which is what the cost of the day is measured against. The
  // same number as the billable one for a single drop, and more than it for a batch -- the
  // difference is the discount, and it belongs on the record rather than in a comment.
  const distanceKm = round2(legsKm.reduce((a, b) => a + b, 0));

  const dropKm = (input.billable?.dropKm ?? []).map(round2);
  const cogsCents = roundCents(billableKm * rateCard.costPerKmCents);
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
  // On top of their kilometres, which are already in the line above: a stop costs driver
  // time whether it is down the road or across town. Zero on a rate card that prices on
  // distance alone.
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
  /*
    A share of what is being sent, independent of liability cover: insuring the parcel and
    this are two different things priced off the same number. An order placed through an
    integrated store carries its own total as the declared value, sent with the booking
    exactly as the ecommerce payload gave it to us -- that is what this is actually charged
    on for most of the orders that will ever see it. A human filling in the portal form pays
    it too, but only once they have put a value in, which today means opting into cover.
  */
  if (options.declaredValueCents > 0 && rateCard.orderValueFeeBps > 0) {
    lines.push({
      code: "order_value_fee",
      label: "Order value fee",
      amountCents: applyBps(options.declaredValueCents, rateCard.orderValueFeeBps),
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

  // Date-conditional surcharges. The rate card ships with these at zero, so they add nothing
  // until someone sets them: the framework exists, the business rule is off. Turning it on is
  // a pricing decision with its own release, not a side effect of this code being here.
  const dateFlags = input.dateFlags ?? NO_DATE_FLAGS;
  if (dateFlags.weekend) {
    const amount =
      applyBps(baseCents, rateCard.weekendSurchargeBps) + rateCard.weekendSurchargeCents;
    if (amount > 0) lines.push({ code: "weekend", label: "Weekend delivery", amountCents: amount });
  }
  if (dateFlags.publicHoliday) {
    const amount =
      applyBps(baseCents, rateCard.publicHolidaySurchargeBps) +
      rateCard.publicHolidaySurchargeCents;
    if (amount > 0) {
      lines.push({ code: "public_holiday", label: "Public holiday delivery", amountCents: amount });
    }
  }

  // A promise to be somewhere inside an hour, rather than inside half a day. Zero until the
  // business prices it, like the surcharges above.
  if (input.timedWindow) {
    const amount =
      applyBps(baseCents, rateCard.timedWindowSurchargeBps) + rateCard.timedWindowSurchargeCents;
    if (amount > 0) {
      lines.push({ code: "timed_window", label: "Timed delivery window", amountCents: amount });
    }
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

  /*
    What this job actually cost, independent of everything above. The rate card's price is a
    commercial decision -- a multiplier, a discount, a flat fee someone chose -- and none of
    that changes how much fuel was burnt getting there. Every kilometre actually driven is
    costed here, not the figure a batching saving was billed on: the saving is real and the
    customer should see it, but it is a saving on what they pay, never on what protects the
    business.

    This is a second, cost-derived minimum, applied after the flat one above. Either can
    bind; whichever is higher wins, the same way the flat minimum already worked before this
    existed.
  */
  const directCost = directCostCents(input.costModel, distanceKm, input.dropCount);
  const floor = costFloorCents(input.costModel, directCost);
  let costFloorApplied = false;
  if (subtotalCents < floor) {
    lines.push({
      code: "cost_floor_adjustment",
      label: "Cost floor adjustment",
      amountCents: floor - subtotalCents,
    });
    subtotalCents = floor;
    costFloorApplied = true;
  }

  const vatCents = applyBps(subtotalCents, vatBps);
  const totalCents = subtotalCents + vatCents;
  const marginBps =
    subtotalCents > 0 ? Math.round(((subtotalCents - cogsCents) / subtotalCents) * 10_000) : 0;

  return {
    distanceKm,
    dropKm,
    legsKm,
    cogsCents,
    lines,
    subtotalCents,
    vatBps,
    vatCents,
    totalCents,
    minFeeApplied,
    directCostCents: directCost,
    costFloorCents: floor,
    costFloorApplied,
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
