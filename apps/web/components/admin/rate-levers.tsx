"use client";

import type { RateCard } from "@delicate/contracts";

/**
 * The rate card's levers, as a form.
 *
 * One editor for all three kinds of card — the house rates, a group's and a single customer's
 * — because they are the same twenty numbers and a second copy of this grid would drift from
 * the first the day a lever is added. Money is edited in rands and stored in cents;
 * percentages are edited as % and stored in basis points, so nothing here is ever a float the
 * engine has to trust.
 */

export const MONEY_FIELDS = [
  "costPerKmCents",
  "minFeeCents",
  "extraDropFeeCents",
  "liabilityCoverMinCents",
  "earlyCollectionFeeCents",
  "signatureFeeCents",
  "weddingVenueFeeCents",
  "timedWindowSurchargeCents",
  "weekendSurchargeCents",
  "publicHolidaySurchargeCents",
] as const satisfies readonly (keyof RateCard)[];

export const PCT_FIELDS = [
  "marginBps",
  "fuelSurchargeBps",
  "liabilityCoverBps",
  "orderValueFeeBps",
  "roadFactorBps",
  // How much of a batched drop's own distance it is charged. 100% prices it like a separate
  // trip; 0% makes extra drops free of distance, leaving only the flat fee.
  "extraDropKmFactorBps",
  "timedWindowSurchargeBps",
  "weekendSurchargeBps",
  "publicHolidaySurchargeBps",
] as const satisfies readonly (keyof RateCard)[];

export type LeverField = (typeof MONEY_FIELDS)[number] | (typeof PCT_FIELDS)[number];

const LABELS: Record<LeverField, string> = {
  costPerKmCents: "Cost per km (R)",
  marginBps: "Gross margin (%)",
  fuelSurchargeBps: "Fuel surcharge (%)",
  minFeeCents: "Minimum fee (R)",
  extraDropFeeCents: "Extra drop fee (R)",
  liabilityCoverBps: "Liability cover (% of declared)",
  liabilityCoverMinCents: "Liability cover minimum (R)",
  earlyCollectionFeeCents: "Early collection (R)",
  signatureFeeCents: "Signature on delivery (R)",
  weddingVenueFeeCents: "Wedding venue (R)",
  roadFactorBps: "Road factor (% of straight line)",
  extraDropKmFactorBps: "Batched drop distance charged (%)",
  // Charged on the declared value of every order that carries one — an integrated store's own
  // order total, most of the time. Independent of the liability cover toggle.
  orderValueFeeBps: "Order value fee (%)",
  // Zero means a timed window is free. It is on sale the moment capacity allows it, priced or
  // not, so this is the lever that makes the promise worth making.
  timedWindowSurchargeCents: "Timed window (R)",
  timedWindowSurchargeBps: "Timed window (% of distance)",
  weekendSurchargeCents: "Weekend (R)",
  weekendSurchargeBps: "Weekend (% of distance)",
  publicHolidaySurchargeCents: "Public holiday (R)",
  publicHolidaySurchargeBps: "Public holiday (% of distance)",
};

export type LeverForm = Record<LeverField, string>;

/** The default card's numbers, so a new card starts from the house rates rather than zero. */
export function leverForm(from?: RateCard | null): LeverForm {
  const f = {} as LeverForm;
  for (const k of [...MONEY_FIELDS, ...PCT_FIELDS])
    f[k] = ((from ? Number(from[k]) : 0) / 100).toFixed(2);
  return f;
}

/** Back to the engine's units. Rounded here so a typed "1.005" cannot become a fraction of a cent. */
export function leversToPayload(form: LeverForm): Record<LeverField, number> {
  const out = {} as Record<LeverField, number>;
  for (const k of [...MONEY_FIELDS, ...PCT_FIELDS]) out[k] = Math.round(Number(form[k]) * 100);
  return out;
}

export const PRICE_FORMULA =
  "price = distance × cost/km ÷ (1 − margin) × service multiplier + surcharges, floored at the minimum fee, then VAT.";

export function RateLevers({
  form,
  onChange,
  disabled,
}: {
  form: LeverForm;
  onChange: (next: LeverForm) => void;
  disabled?: boolean;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-4">
      {[...MONEY_FIELDS, ...PCT_FIELDS].map((k) => (
        <label key={k} className="block text-sm">
          <span className="field-label">{LABELS[k]}</span>
          <input
            type="number"
            step="0.01"
            value={form[k]}
            disabled={disabled}
            onChange={(e) => onChange({ ...form, [k]: e.target.value })}
            className="mt-1 input w-full px-2 py-1.5 font-mono disabled:opacity-50"
          />
        </label>
      ))}
    </div>
  );
}
