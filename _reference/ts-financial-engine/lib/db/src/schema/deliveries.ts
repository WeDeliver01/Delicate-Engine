import { pgTable, text, integer, real, timestamp, uuid } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { drivers } from "./drivers";
import { bakeries } from "./bakeries";

export const deliveries = pgTable("deliveries", {
  id: uuid("id").primaryKey().defaultRandom(),
  bakeryId: uuid("bakery_id").notNull().references(() => bakeries.id),
  driverId: uuid("driver_id").notNull().references(() => drivers.id),
  customerAddress: text("customer_address"),
  customerLat: real("customer_lat").notNull().default(0),
  customerLng: real("customer_lng").notNull().default(0),
  zone: text("zone"),
  priceCents: integer("price_cents").notNull(),
  currency: text("currency").notNull().default("ZAR"),
  status: text("status").notNull().default("created"),
  pricingRuleId: uuid("pricing_rule_id"),
  distanceKm: real("distance_km"),
  fuelCents: integer("fuel_cents"),
  variableCents: integer("variable_cents"),
  driverPayoutCents: integer("driver_payout_cents"),
  companyRevenueCents: integer("company_revenue_cents"),
  cogsCents: integer("cogs_cents"),
  marginBps: integer("margin_bps"),
  idempotencyKey: text("idempotency_key").notNull().unique(),
  settledAt: timestamp("settled_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const routes = pgTable("routes", {
  id: uuid("id").primaryKey().defaultRandom(),
  deliveryId: uuid("delivery_id").notNull().unique().references(() => deliveries.id),
  distanceKm: real("distance_km").notNull(),
  durationSeconds: integer("duration_seconds"),
  provider: text("provider").notNull().default("mock"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertDeliverySchema = createInsertSchema(deliveries).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertDelivery = z.infer<typeof insertDeliverySchema>;
export type Delivery = typeof deliveries.$inferSelect;
export type Route = typeof routes.$inferSelect;
