import { and, eq, isNull, lte, gte, or } from "drizzle-orm";
import { db, pricingRules } from "@workspace/db";

export interface Settlement {
  fuelCents: number;
  variableCents: number;
  driverPayoutCents: number;
  companyRevenueCents: number;
  cogsCents: number;
  marginBps: number;
  pricingRuleId: string;
  distanceKm: number;
}

export interface RuleFilter {
  driverId: string;
  bakeryId: string;
  zone: string | null;
  distanceKm: number;
}

export class PricingService {
  async resolveRule(tx: typeof db, filter: RuleFilter) {
    const now = new Date();
    const rows = await tx
      .select()
      .from(pricingRules)
      .where(
        and(
          eq(pricingRules.active, true),
          or(isNull(pricingRules.effectiveFrom), lte(pricingRules.effectiveFrom!, now)),
          or(isNull(pricingRules.effectiveTo), gte(pricingRules.effectiveTo!, now)),
        ),
      );

    const scopePriority = (scopeType: string, scopeRef: string | null) => {
      if (scopeType === "driver" && scopeRef === filter.driverId) return 40;
      if (scopeType === "bakery" && scopeRef === filter.bakeryId) return 30;
      if (scopeType === "zone" && scopeRef === filter.zone) return 20;
      if (scopeType === "global") return 10;
      return -1;
    };

    const applicable = rows.filter((r) => {
      const sp = scopePriority(r.scopeType, r.scopeRef);
      if (sp < 0) return false;
      if (r.distanceMinKm != null && filter.distanceKm < r.distanceMinKm) return false;
      if (r.distanceMaxKm != null && filter.distanceKm > r.distanceMaxKm) return false;
      return true;
    });

    applicable.sort((a, b) => {
      const spA = scopePriority(a.scopeType, a.scopeRef);
      const spB = scopePriority(b.scopeType, b.scopeRef);
      if (spA !== spB) return spB - spA;
      return b.priority - a.priority;
    });

    const rule = applicable[0];
    if (!rule) throw new Error("No applicable pricing rule found");
    return rule;
  }

  computeSettlement(priceCents: number, distanceKm: number, rule: typeof pricingRules.$inferSelect): Settlement {
    const fuelCents = Math.round(rule.fuelCostPerKmCents * distanceKm);
    const variableCents = rule.variableCostsCents;
    const pool = Math.max(0, priceCents - fuelCents);
    const cogsCents = fuelCents + variableCents;

    let driverPayoutCents: number;
    if (rule.strategy === "per_km" && rule.driverPerKmCents != null) {
      driverPayoutCents = Math.round(rule.driverPerKmCents * distanceKm);
    } else {
      driverPayoutCents = Math.round((pool * rule.driverShareBps) / 10000);
    }
    driverPayoutCents = Math.min(driverPayoutCents, Math.max(0, pool - variableCents));

    const companyRevenueCents = priceCents - fuelCents - driverPayoutCents;
    const marginBps = priceCents > 0 ? Math.round((companyRevenueCents / priceCents) * 10000) : 0;

    return {
      fuelCents,
      variableCents,
      driverPayoutCents,
      companyRevenueCents,
      cogsCents,
      marginBps,
      pricingRuleId: rule.id,
      distanceKm,
    };
  }
}

export const pricingService = new PricingService();
