/**
 * What is left of a driver's day, and what is behind them.
 *
 * Pure, because the two sides have to agree. The engine stamps `done` on each stop it serves;
 * the app groups and counts with the same rules. If "done" meant one thing in the API and
 * another in the app, a driver would be told they had finished while a drop was still open, or
 * left staring at a list of stops they had already delivered.
 */
import type { DriverStop } from "./dto/dispatch.js";

/** A drop the driver cannot act on again: delivered, or failed and now dispatch's problem. */
const FINISHED_DROP = new Set(["delivered", "failed", "cancelled"]);

/**
 * Has this stop been worked?
 *
 * A drop is done when it has been delivered, or when the attempt failed — a failed drop is
 * reassigned by dispatch, so there is nothing further the driver can do with it today.
 *
 * A collection is done when nothing on the booking is still waiting to be picked up. It is
 * judged from the shipments rather than from the stop's own status, which is always null for a
 * collection: one collection stop covers every shipment on the booking, and the driver loads
 * them into the van together.
 */
export function stopIsDone(stop: DriverStop): boolean {
  if (stop.kind === "drop") return stop.status != null && FINISHED_DROP.has(stop.status);
  return !stop.shipments.some((s) => s.status === "assigned" || s.status === "booked");
}

export interface StopTally {
  total: number;
  done: number;
  /** Still to be worked. `total - done`, named so a caller cannot get the subtraction wrong. */
  outstanding: number;
}

export interface DayProgress {
  all: StopTally;
  collections: StopTally;
  deliveries: StopTally;
  /**
   * Every stop worked, and there was at least one.
   *
   * The "at least one" matters: an empty day is not a finished day. A driver who has been
   * given nothing yet needs to hear that dispatch will send work, and a driver who has
   * cleared six drops needs to hear that they are finished. Collapsing the two into one
   * empty-list message is what made the old screen say "No stops yet" to a driver who had
   * just spent the morning delivering.
   */
  allDone: boolean;
}

function tally(stops: DriverStop[]): StopTally {
  const done = stops.filter(stopIsDone).length;
  return { total: stops.length, done, outstanding: stops.length - done };
}

export function dayProgress(stops: DriverStop[]): DayProgress {
  const all = tally(stops);
  return {
    all,
    collections: tally(stops.filter((s) => s.kind === "collection")),
    deliveries: tally(stops.filter((s) => s.kind === "drop")),
    allDone: all.total > 0 && all.outstanding === 0,
  };
}
