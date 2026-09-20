import { z } from "zod";

/**
 * Scheduling. A policy describes the recurring week; concrete slots are materialised per date
 * on demand and carry the live counts. Standard-service bookings must land in a bookable slot.
 */

export const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD");

export const SlotWindow = z.object({
  key: z.string().min(2).max(32), // "morning", "afternoon"
  label: z.string().min(2).max(60),
  startMinutes: z.number().int().min(0).max(1439),
  endMinutes: z.number().int().min(1).max(1440),
  capacity: z.number().int().min(0).max(500).nullable(), // null = policy default
});
export type SlotWindow = z.infer<typeof SlotWindow>;

export const SlotPolicy = z.object({
  /** 0 = Sunday … 6 = Saturday */
  operatingDays: z.array(z.number().int().min(0).max(6)).min(1),
  windows: z.array(SlotWindow).min(1).max(12),
  defaultCapacity: z.number().int().min(0).max(500),
  /** Minimum whole days between booking and delivery date (Standard: 1). */
  minLeadDays: z.number().int().min(0).max(30),
  /** Bookings close this many minutes before a window starts. */
  cutoffMinutesBefore: z.number().int().min(0).max(1440),
  /** How far ahead slots are offered. */
  horizonDays: z.number().int().min(1).max(90),
});
export type SlotPolicy = z.infer<typeof SlotPolicy>;

export const SlotStatus = z.enum(["open", "closed_full", "closed_manual"]);

export const SlotAvailability = z.object({
  date: IsoDate,
  windowKey: z.string(),
  label: z.string(),
  startMinutes: z.number().int(),
  endMinutes: z.number().int(),
  capacity: z.number().int(),
  booked: z.number().int(),
  remaining: z.number().int(),
  bookable: z.boolean(),
  closedReason: z.enum(["full", "closed", "blackout", "cutoff_passed", "lead_time"]).nullable(),
});
export type SlotAvailability = z.infer<typeof SlotAvailability>;

export const AvailabilityQuery = z.object({
  dateFrom: IsoDate.optional(),
  dateTo: IsoDate.optional(),
});
export type AvailabilityQuery = z.infer<typeof AvailabilityQuery>;

export const SlotRef = z.object({ date: IsoDate, windowKey: z.string().min(2).max(32) });
export type SlotRef = z.infer<typeof SlotRef>;

export const SetSlotRequest = SlotRef.extend({
  closed: z.boolean().optional(),
  capacity: z.number().int().min(0).max(500).optional(),
});
export type SetSlotRequest = z.infer<typeof SetSlotRequest>;

export const BlackoutDate = z.object({ date: IsoDate, reason: z.string().max(200).nullable() });
export type BlackoutDate = z.infer<typeof BlackoutDate>;
