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

/**
 * A promise to be somewhere between two times, in minutes past midnight, local.
 *
 * Distinct from a slot. A slot is half a day and gates how much work exists; a timed window is
 * a narrower promise sold on top of it, and it gates how much work can be in one place at one
 * time. Four drivers cover forty stops across a morning and still cannot be in four places at
 * 09:15, so the two are different constraints and both are checked.
 */
export const TimedWindow = z.object({
  startMinute: z.number().int().min(0).max(1439),
  endMinute: z.number().int().min(1).max(1440),
});
export type TimedWindow = z.infer<typeof TimedWindow>;

/**
 * Whether timed windows are for sale, and within what limits.
 *
 * Off by default. Turning it on is a commercial decision with its own release, the same posture
 * the date-conditional surcharges take.
 */
export const TimedWindowPolicy = z.object({
  enabled: z.boolean().default(false),
  /** The width of each capacity band. An hour, unless the business works to something else. */
  bandMinutes: z.number().int().min(15).max(240).default(60),
  /** The narrowest window that can be sold; anything tighter is a promise we cannot keep. */
  minMinutes: z.number().int().min(15).max(480).default(60),
  /** Beyond this it is not a timed window, it is the slot, and it takes no band capacity. */
  maxMinutes: z.number().int().min(30).max(720).default(120),
  /**
   * Stops one driver can commit to inside a band, times the drivers on shift, is the honest
   * ceiling. Until shift-derived capacity is wired in, this is set directly.
   */
  capacityPerBand: z.number().int().min(0).max(500).default(0),
});
export type TimedWindowPolicy = z.infer<typeof TimedWindowPolicy>;

/** Live state of one capacity band on one date. */
export const WindowBandAvailability = z.object({
  date: IsoDate,
  startMinute: z.number().int(),
  endMinute: z.number().int(),
  capacity: z.number().int(),
  booked: z.number().int(),
  remaining: z.number().int(),
  bookable: z.boolean(),
});
export type WindowBandAvailability = z.infer<typeof WindowBandAvailability>;

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
  horizonDays: z.number().int().min(1).max(400),
  /** Timed windows sold inside a slot. Off until the business turns it on. */
  timedWindow: TimedWindowPolicy.default({
    enabled: false,
    bandMinutes: 60,
    minMinutes: 60,
    maxMinutes: 120,
    capacityPerBand: 0,
  }),
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
  /**
   * Which service the customer is asking about.
   *
   * It changes the answer. A service that dispatches immediately is not bound by the lead
   * time everything else is scheduled around — being able to book it today is the whole
   * point of it — so for one of those the only day on offer is today, and a window is open
   * until it has actually passed rather than two hours before it starts.
   */
  serviceLevel: z.string().min(2).max(32).optional(),
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
