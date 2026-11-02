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

/**
 * What each lever will accept, in the units the form is typed in.
 *
 * Only the ones that are not simply "zero or more" are listed. Road distance is longer than a
 * straight line by definition, so a road factor under 100% would price a journey shorter than
 * the crow flies; a 100% margin is a division by zero in the pricing formula, not an infinite
 * price. Both are enforced on the engine too -- this is so the form says so first, in the
 * words on its own label, rather than after a save.
 */
const BOUNDS: Partial<Record<LeverField, { min: number; max?: number; hint: string }>> = {
  roadFactorBps: {
    min: 100,
    max: 300,
    hint: "100% or more — roads are longer than straight lines",
  },
  marginBps: { min: 0, max: 99.99, hint: "Under 100%" },
  extraDropKmFactorBps: { min: 0, max: 100, hint: "0–100%" },
};

/** The engine's words for a rejected lever, in the label the operator actually sees. */
export function describeRateIssue(issue: { path?: unknown[]; message?: string }): string | null {
  const field = issue.path?.[0];
  if (typeof field !== "string" || !(field in LABELS)) return null;
  const label = LABELS[field as LeverField];
  const bound = BOUNDS[field as LeverField];
  return bound ? `${label}: ${bound.hint}.` : `${label}: ${issue.message ?? "not accepted"}.`;
}

/**
 * The default card's numbers, so a new card starts from the house rates rather than zero.
 *
 * With no default card to copy -- a fresh database, or the query still in flight -- every
 * lever starts at zero except the two that cannot legally be zero. A form that opens in a
 * state the engine would refuse is a form that blames the operator for its own default.
 */
export function leverForm(from?: RateCard | null): LeverForm {
  const f = {} as LeverForm;
  for (const k of [...MONEY_FIELDS, ...PCT_FIELDS])
    f[k] = ((from ? Number(from[k]) : 0) / 100).toFixed(2);
  if (!from) {
    f.roadFactorBps = "130.00";
    f.extraDropKmFactorBps = "60.00";
  }
  return f;
}

/** Back to the engine's units. Rounded here so a typed "1.005" cannot become a fraction of a cent. */
export function leversToPayload(form: LeverForm): Record<LeverField, number> {
  const out = {} as Record<LeverField, number>;
  for (const k of [...MONEY_FIELDS, ...PCT_FIELDS]) out[k] = Math.round(Number(form[k]) * 100);
  return out;
}

/**
 * The switch that lets a card price below what the job costs.
 *
 * Deliberately not one of the levers above: those are numbers somebody negotiates, and this
 * is a safety rail being removed. It reads as a warning because that is what it is -- a card
 * with this on sells a delivery for less than the diesel, which is only ever right for an
 * internal account walking the booking flow.
 */
export function CostFloorExemption({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label
      className={`flex items-start gap-3 rounded-xl border p-3 text-sm ${
        checked ? "border-[#F3C6D9] bg-[#FCEEF4]" : "border-line"
      }`}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="checkbox mt-0.5"
      />
      <span>
        <span className={checked ? "font-semibold text-[#C13B73]" : "text-ink"}>
          Price below cost — testing only
        </span>
        <span className="mt-0.5 block text-xs text-muted">
          Normally every card is lifted to what the trip actually cost in fuel, wear and driver
          time, so a zeroed card still bills for the trip. Switch this off for an internal account
          that needs to book at R0. Never put a paying customer on a card with this on.
        </span>
      </span>
    </label>
  );
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
      {[...MONEY_FIELDS, ...PCT_FIELDS].map((k) => {
        const bound = BOUNDS[k];
        const value = Number(form[k]);
        // Flagged as you type rather than on save: the engine refuses these too, and finding
        // out after filling in twenty boxes is the version of this that wastes an afternoon.
        const bad =
          form[k] !== "" &&
          bound !== undefined &&
          (Number.isNaN(value) ||
            value < bound.min ||
            (bound.max !== undefined && value > bound.max));
        return (
          <label key={k} className="block text-sm">
            <span className="field-label">{LABELS[k]}</span>
            <input
              type="number"
              step="0.01"
              min={bound?.min}
              max={bound?.max}
              value={form[k]}
              disabled={disabled}
              onChange={(e) => onChange({ ...form, [k]: e.target.value })}
              className={`mt-1 input w-full px-2 py-1.5 font-mono disabled:opacity-50 ${bad ? "input-invalid" : ""}`}
            />
            {bad ? (
              <span className="field-error">{bound.hint}</span>
            ) : (
              bound && <span className="field-hint">{bound.hint}</span>
            )}
          </label>
        );
      })}
    </div>
  );
}
