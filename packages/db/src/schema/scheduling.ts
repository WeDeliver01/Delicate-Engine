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

/**
 * Concurrency, as opposed to volume.
 *
 * `delivery_slots` answers "how much work exists this half-day", which is what drivers on shift
 * can cover. It cannot answer "how many promises are there for 09:00", and those are different
 * constraints: four drivers can cover forty morning stops and still not be in four places at a
 * quarter past nine. One row per band per date, locked in the booking transaction the same way
 * a slot is.
 *
 * Only genuinely timed windows consume a band. A booking that takes the plain half-day slot
 * touches nothing here and behaves exactly as it did before windows existed.
 */
export const windowBands = pgTable(
  "window_bands",
  {
    id: id(),
    date: date("date", { mode: "string" }).notNull(),
    /** Minutes past midnight at which the band starts. Width comes from the policy. */
    startMinute: integer("start_minute").notNull(),
    capacity: integer("capacity").notNull(),
    bookedCount: integer("booked_count").notNull().default(0),
    ...timestamps(),
  },
  (t) => [uniqueIndex("window_bands_date_start_uq").on(t.date, t.startMinute)],
);

export const blackoutDates = pgTable("blackout_dates", {
  date: date("date", { mode: "string" }).primaryKey(),
  reason: text("reason"),
  ...timestamps(),
});
