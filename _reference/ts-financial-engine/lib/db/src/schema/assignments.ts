import { pgTable, boolean, timestamp, uuid } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { drivers } from "./drivers";
import { bakeries } from "./bakeries";

export const driverBakeryAssignments = pgTable("driver_bakery_assignments", {
  id: uuid("id").primaryKey().defaultRandom(),
  driverId: uuid("driver_id").notNull().references(() => drivers.id),
  bakeryId: uuid("bakery_id").notNull().references(() => bakeries.id),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertAssignmentSchema = createInsertSchema(driverBakeryAssignments).omit({ id: true, createdAt: true });
export type InsertAssignment = z.infer<typeof insertAssignmentSchema>;
export type Assignment = typeof driverBakeryAssignments.$inferSelect;
