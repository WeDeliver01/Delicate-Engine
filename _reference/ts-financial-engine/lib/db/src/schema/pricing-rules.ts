import { pgTable, text, integer, real, boolean, timestamp, uuid } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const pricingRules = pgTable("pricing_rules", {
  id: uuid("id").primaryKey().defaultRandom(),
  label: text("label"),
  scopeType: text("scope_type").notNull().default("global"),
  scopeRef: text("scope_ref"),
  distanceMinKm: real("distance_min_km"),
  distanceMaxKm: real("distance_max_km"),
  fuelCostPerKmCents: integer("fuel_cost_per_km_cents").notNull().default(0),
  driverBaseFeeCents: integer("driver_base_fee_cents").notNull().default(0),
  variableCostsCents: integer("variable_costs_cents").notNull().default(0),
  batchingBps: integer("batching_bps").notNull().default(0),
  strategy: text("strategy").notNull().default("share"),
  driverShareBps: integer("driver_share_bps").notNull().default(7000),
  driverPerKmCents: integer("driver_per_km_cents"),
  priority: integer("priority").notNull().default(0),
  active: boolean("active").notNull().default(true),
  effectiveFrom: timestamp("effective_from", { withTimezone: true }),
  effectiveTo: timestamp("effective_to", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertPricingRuleSchema = createInsertSchema(pricingRules).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertPricingRule = z.infer<typeof insertPricingRuleSchema>;
export type PricingRule = typeof pricingRules.$inferSelect;
