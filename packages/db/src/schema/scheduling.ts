import { date, integer, pgEnum, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";
import { id, timestamps } from "./_shared.js";

/**
 * Scheduling. The slot policy lives in `settings` ("scheduling.policy"); these tables hold the
 * per-date state that the policy alone cannot: live counts, manual overrides and blackouts.
 */

export const slotStatusEnum = pgEnum("slot_status", ["open", "closed_full", "closed_manual"]);

export const deliverySlots = pgTable(
  "delivery_slots",
  {
    id: id(),
    date: date("date", { mode: "string" }).notNull(),
    windowKey: text("window_key").notNull(),
    capacity: integer("capacity").notNull(),
    bookedCount: integer("booked_count").notNull().default(0),
    status: slotStatusEnum("status").notNull().default("open"),
    ...timestamps(),
  },
  (t) => [uniqueIndex("delivery_slots_date_window_uq").on(t.date, t.windowKey)],
);

export const blackoutDates = pgTable("blackout_dates", {
  date: date("date", { mode: "string" }).primaryKey(),
  reason: text("reason"),
  ...timestamps(),
});
