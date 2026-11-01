import type { MembershipPlan } from "@delicate/contracts";

/**
 * Turning a plan into the words the marketing pages show.
 *
 * Shared because the home page and the membership page were each carrying their own copy of
 * the three tiers, typed out by hand, and they had already drifted from the engine and from
 * each other -- the home page offered Starter "Flat-rate pricing" and the membership page
 * offered it a dedicated account manager, neither of which the plan has ever included.
 * Deriving both from the same function is what stops that happening again.
 */

/** Which card wears the badge. Presentation, not something the engine models. */
export const POPULAR = "growth";

/** Whole rands: a marketing price with cents on it looks like a mistake. */
export function priceLabel(cents: number): string {
  return `R${Math.round(cents / 100).toLocaleString("en-ZA")}`;
}

/** "Ideal for clients doing 20+ deliveries a month", which the plan already carries. */
export function suitedLine(plan: MembershipPlan): string | null {
  if (plan.suitedFromDeliveries <= 0) return null;
  return `Ideal for clients doing ${plan.suitedFromDeliveries}+ deliveries a month.`;
}

/**
 * The feature bullets, in the order a reader cares about them: what it saves, what it
 * includes, what it unlocks.
 *
 * Only ever says what the plan actually grants. A benefit switched off in the console stops
 * being advertised on the next revalidate rather than waiting for somebody to notice.
 */
export function featuresOf(plan: MembershipPlan): string[] {
  const out = [`${(plan.discountBps / 100).toFixed(0)}% off default rates`];
  if (plan.freeShipmentsPerPeriod > 0) {
    const n = plan.freeShipmentsPerPeriod;
    out.push(`${n} free shipment${n === 1 ? "" : "s"} a month`);
  }
  if (plan.waivesAllSurcharges) out.push("Zero surcharges");
  else if (plan.waivesHolidaySurcharge) out.push("Public holiday delivery");
  if (plan.includesApiAccess) out.push("API integration");
  if (plan.prioritySupport) out.push("Priority support");
  if (plan.dedicatedManager) out.push("Dedicated account manager");
  return out;
}

/**
 * The longer paragraph, which is the one thing about a plan that is not in the database.
 *
 * Copywriting rather than configuration, so it stays in the code, keyed by plan code. A plan
 * with no entry renders without one instead of showing a gap or a placeholder.
 */
export const BLURB: Record<string, string> = {
  starter:
    "Perfect for small businesses or individuals sending a few deliveries per week. Discounted same-day courier rates and priority support for your perishable goods.",
  growth:
    "Designed for growing bakeries, restaurants, and florists with regular delivery needs. Larger discounts, weekly billing, and dedicated account support.",
  enterprise:
    "Built for high-volume clients with complex delivery requirements. Custom pricing, fleet priority, API integration, and a dedicated operations manager.",
};
