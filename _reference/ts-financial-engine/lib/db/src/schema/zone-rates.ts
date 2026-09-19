import { pgTable, text, integer, timestamp, uuid } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { bakeries } from "./bakeries";

export const zoneRates = pgTable("zone_rates", {
  id: uuid("id").primaryKey().defaultRandom(),
  bakeryId: uuid("bakery_id").references(() => bakeries.id),
  zone: text("zone").notNull(),
  priceCents: integer("price_cents").notNull(),
  currency: text("currency").notNull().default("ZAR"),
  source: text("source"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertZoneRateSchema = createInsertSchema(zoneRates).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertZoneRate = z.infer<typeof insertZoneRateSchema>;
export type ZoneRate = typeof zoneRates.$inferSelect;
