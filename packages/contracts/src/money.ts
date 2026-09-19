import { z } from "zod";

/**
 * Money is ALWAYS integer cents (ZAR). Never floats. This is invariant #1.
 * `Cents` is the only money type that crosses a service boundary.
 */
export const Cents = z.number().int().safe();
export type Cents = z.infer<typeof Cents>;

export const NonNegativeCents = Cents.nonnegative();
export const PositiveCents = Cents.positive();

/** Basis points: 10000 = 100%. Used for shares, margins and rates. */
export const Bps = z.number().int().min(0).max(10_000);
export type Bps = z.infer<typeof Bps>;

export const Currency = z.literal("ZAR");

export function randsToCents(rands: number): Cents {
  return Math.round(rands * 100);
}

export function centsToRands(cents: Cents): number {
  return cents / 100;
}

export function formatCents(cents: Cents, locale = "en-ZA"): string {
  return new Intl.NumberFormat(locale, { style: "currency", currency: "ZAR" }).format(cents / 100);
}

/** Apply basis points to an amount, rounding half-up to the nearest cent. */
export function applyBps(cents: Cents, bps: Bps): Cents {
  return Math.round((cents * bps) / 10_000);
}
