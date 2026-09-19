import { pgTable, text, real, boolean, timestamp, uuid } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const drivers = pgTable("drivers", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  phone: text("phone"),
  email: text("email"),
  depotLabel: text("depot_label"),
  depotLat: real("depot_lat").notNull().default(0),
  depotLng: real("depot_lng").notNull().default(0),
  vehicleKmPerLitre: real("vehicle_km_per_litre"),
  fuelCardId: text("fuel_card_id"),
  portalToken: text("portal_token").unique(),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertDriverSchema = createInsertSchema(drivers).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertDriver = z.infer<typeof insertDriverSchema>;
export type Driver = typeof drivers.$inferSelect;
