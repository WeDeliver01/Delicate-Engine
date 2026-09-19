import { pgTable, text, real, boolean, timestamp, uuid } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const bakeries = pgTable("bakeries", {
  id: uuid("id").primaryKey().defaultRandom(),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  pickupAddress: text("pickup_address"),
  pickupLat: real("pickup_lat").notNull().default(0),
  pickupLng: real("pickup_lng").notNull().default(0),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertBakerySchema = createInsertSchema(bakeries).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertBakery = z.infer<typeof insertBakerySchema>;
export type Bakery = typeof bakeries.$inferSelect;
