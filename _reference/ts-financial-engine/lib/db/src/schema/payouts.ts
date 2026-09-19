import { pgTable, text, integer, timestamp, uuid } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { drivers } from "./drivers";

export const payoutRequests = pgTable("payout_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  driverId: uuid("driver_id").notNull().references(() => drivers.id),
  amountCents: integer("amount_cents").notNull(),
  status: text("status").notNull().default("pending"),
  note: text("note"),
  processedAt: timestamp("processed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const rateImports = pgTable("rate_imports", {
  id: uuid("id").primaryKey().defaultRandom(),
  filename: text("filename"),
  rowsImported: integer("rows_imported").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertPayoutRequestSchema = createInsertSchema(payoutRequests).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertPayoutRequest = z.infer<typeof insertPayoutRequestSchema>;
export type PayoutRequest = typeof payoutRequests.$inferSelect;
