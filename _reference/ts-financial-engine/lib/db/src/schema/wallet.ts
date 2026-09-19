import { pgTable, text, integer, timestamp, uuid, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { drivers } from "./drivers";

export const walletTransactions = pgTable("wallet_transactions", {
  id: uuid("id").primaryKey().defaultRandom(),
  driverId: uuid("driver_id").notNull().references(() => drivers.id),
  account: text("account").notNull(),
  type: text("type").notNull(),
  amountCents: integer("amount_cents").notNull(),
  currency: text("currency").notNull().default("ZAR"),
  deliveryId: uuid("delivery_id"),
  payoutId: uuid("payout_id"),
  availableFrom: timestamp("available_from", { withTimezone: true }),
  description: text("description"),
  metadata: jsonb("metadata"),
  idempotencyKey: text("idempotency_key").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const walletCheckpoints = pgTable("wallet_checkpoints", {
  id: uuid("id").primaryKey().defaultRandom(),
  driverId: uuid("driver_id").notNull().references(() => drivers.id),
  account: text("account").notNull(),
  balanceCents: integer("balance_cents").notNull(),
  checkpointAt: timestamp("checkpoint_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertWalletTransactionSchema = createInsertSchema(walletTransactions).omit({ id: true, createdAt: true });
export type InsertWalletTransaction = z.infer<typeof insertWalletTransactionSchema>;
export type WalletTransaction = typeof walletTransactions.$inferSelect;
