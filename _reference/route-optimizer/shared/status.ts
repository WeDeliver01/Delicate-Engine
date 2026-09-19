// Single source of truth for status vocabularies shared by the driver app,
// the dispatcher/route planner, and the webhook ingest pipeline.
//
// Two historically-divergent per-stop vocabularies existed in the codebase:
//   * driver app  (lowercase):  pending | arrived | completed | failed | skipped
//   * dispatcher  (uppercase):  PENDING | ARRIVED | DONE       | FAILED
// A driver-completed stop ("completed") was therefore not recognised as "DONE"
// by the dispatcher/route planner, and a webhook/dispatcher "DONE" was not
// recognised as "completed" by the driver app. This module normalises both so
// every surface agrees on the current state of a stop.

// ---------------------------------------------------------------------------
// Per-stop status
// ---------------------------------------------------------------------------

// Canonical per-stop status. Lowercase is canonical because it matches the
// `stops.status` schema default and the driver-app convention.
export type StopStatus = "pending" | "arrived" | "completed" | "failed" | "skipped";

// Dispatcher/route-planner view vocabulary.
export type DispatchStopStatus = "PENDING" | "ARRIVED" | "DONE" | "FAILED";

const STOP_ALIASES: Record<string, StopStatus> = {
  pending: "pending",
  arrived: "arrived",
  // "current" is an ephemeral driver-UI marker for the active stop — treat as
  // arrived (the driver is working it) for recognition purposes.
  current: "arrived",
  completed: "completed",
  complete: "completed",
  done: "completed",
  delivered: "completed",
  collected: "completed",
  failed: "failed",
  fail: "failed",
  skipped: "skipped",
  skip: "skipped",
};

/** Normalise any per-stop status (any casing / either vocabulary) to canonical. */
export function normalizeStopStatus(raw: string | null | undefined): StopStatus {
  if (!raw) return "pending";
  const key = String(raw).trim().toLowerCase();
  return STOP_ALIASES[key] ?? "pending";
}

/** True when the stop was successfully completed (driver "completed" or dispatcher "DONE"). */
export function isStopDone(raw: string | null | undefined): boolean {
  return normalizeStopStatus(raw) === "completed";
}

export function isStopArrived(raw: string | null | undefined): boolean {
  return normalizeStopStatus(raw) === "arrived";
}

export function isStopFailed(raw: string | null | undefined): boolean {
  return normalizeStopStatus(raw) === "failed";
}

export function isStopSkipped(raw: string | null | undefined): boolean {
  return normalizeStopStatus(raw) === "skipped";
}

export function isStopPending(raw: string | null | undefined): boolean {
  return normalizeStopStatus(raw) === "pending";
}

/** Stop is closed out (no longer needs the driver) — completed, failed or skipped. */
export function isStopFinished(raw: string | null | undefined): boolean {
  const s = normalizeStopStatus(raw);
  return s === "completed" || s === "failed" || s === "skipped";
}

/** Stop still needs work — pending or arrived. */
export function isStopActive(raw: string | null | undefined): boolean {
  return !isStopFinished(raw);
}

/** Map any per-stop status to the dispatcher/route-planner uppercase vocabulary. */
export function toDispatchStopStatus(raw: string | null | undefined): DispatchStopStatus {
  switch (normalizeStopStatus(raw)) {
    case "arrived": return "ARRIVED";
    case "completed": return "DONE";
    case "failed": return "FAILED";
    // The dispatcher view has no SKIPPED concept; a skipped stop is closed out,
    // so surface it as DONE (no longer pending) rather than re-opening it.
    case "skipped": return "DONE";
    default: return "PENDING";
  }
}

/** Map any per-stop status to the driver-app lowercase canonical vocabulary. */
export function toDriverStopStatus(raw: string | null | undefined): StopStatus {
  return normalizeStopStatus(raw);
}

// ---------------------------------------------------------------------------
// Shipment lifecycle
// ---------------------------------------------------------------------------

// Lifecycle precedence so an out-of-order event (e.g. a late "quote" arriving
// after "delivered") never downgrades the stored status. Terminal states all
// share the highest rank.
export const SHIPMENT_STATUS_RANK: Record<string, number> = {
  "": 0,
  booked: 1,
  submitted: 2,
  quote: 2,
  "collection-assigned": 3,
  "at-collection": 4,
  collected: 5,
  "in-transit": 6,
  "out-for-delivery": 7,
  // Terminal states all share the top rank so none can regress another and a
  // late lower-ranked event can never re-open them.
  delivered: 8,
  cancelled: 8,
  failed: 8,
  skipped: 8,
};

/** Rank of a shipment-lifecycle status for out-of-order precedence checks. */
export function rankShipmentStatus(s?: string | null): number {
  return SHIPMENT_STATUS_RANK[String(s || "").toLowerCase().trim()] ?? 0;
}

// Canonical shipment-lifecycle vocabulary. Every producer (ShipLogic webhooks,
// CSV import, driver actions, inbound/outbound webhooks) maps into these values
// so the Driver App, Ops Portal, Route Planner and Dispatch Dashboard all read
// one vocabulary. `at-collection`/`out-for-delivery` are in-progress states;
// `delivered`/`failed`/`cancelled` are terminal (see `isShipmentTerminal`).
export type ShipmentStatus =
  | "booked"
  | "submitted"
  | "collection-assigned"
  | "at-collection"
  | "collected"
  | "in-transit"
  | "out-for-delivery"
  | "delivered"
  | "failed"
  | "skipped"
  | "cancelled";

/**
 * Map an external ShipLogic tracking-status string (free text, any casing) to a
 * canonical shipment-lifecycle status. Returns `null` when the external status
 * carries no lifecycle signal (so callers can ignore it rather than regress).
 */
export function mapShipLogicToShipmentStatus(status: string | null | undefined): ShipmentStatus | null {
  const s = String(status || "").toLowerCase().trim().replace(/[-_]/g, " ");
  if (!s) return null;
  if (s.includes("collected") || s.includes("collection complete") || s === "picked up") return "collected";
  if (
    s.includes("out for delivery") || s.includes("in transit") || s.includes("on vehicle") ||
    s.includes("en route") || s.includes("with driver") || s.includes("hub departure")
  ) return "out-for-delivery";
  if (s.includes("delivered") || s.includes("proof of delivery") || s === "pod" || s.includes("delivery completed")) return "delivered";
  if (s.includes("fail") || s.includes("return") || s.includes("undeliverable") || s.includes("exception")) return "failed";
  if (s.includes("cancel")) return "cancelled";
  return null;
}

/**
 * Map a driver stop action (`arrive`/`complete`/`fail`/`skip`) plus the stop
 * type (`C` collection / `D` delivery) to the canonical shipment-lifecycle
 * status the dashboards read from.
 */
export function mapDriverActionToShipmentStatus(action: string, stopType: string): string {
  const a = String(action || "").toLowerCase().trim();
  const t = String(stopType || "").toUpperCase().trim();
  if (a === "complete" && t === "C") return "collected";
  if (a === "complete" && t === "D") return "delivered";
  if (a === "arrive" && t === "D") return "out-for-delivery";
  if (a === "arrive" && t === "C") return "at-collection";
  if (a === "fail") return "failed";
  if (a === "skip") return "skipped";
  return a;
}

/**
 * True when a shipment's overall lifecycle is terminal (delivered, failed,
 * cancelled, returned, exception). Matches loosely so free-text ShipLogic
 * status strings are still recognised.
 */
export function isShipmentTerminal(status: string | null | undefined): boolean {
  const raw = String(status || "").toLowerCase().trim();
  if (!raw) return false;
  const n = raw.replace(/[-_]/g, " ");
  return (
    n.includes("delivered") ||
    n.includes("fail") ||
    n.includes("cancel") ||
    n.includes("return") ||
    n.includes("exception") ||
    n.includes("skip")
  );
}

/**
 * True when a shipment has already been picked up (it is physically on the
 * vehicle) but is not yet in a terminal state — i.e. only its delivery leg
 * remains. Covers ShipLogic's "collected", "in transit" and
 * "out for delivery" family of free-text statuses.
 *
 * The route planner uses this to schedule such shipments as DELIVERY-ONLY
 * stops (no collection leg). Without it, an already-collected shipment is
 * forced through a collection batch — which either duplicates a pickup the
 * driver has already made, or, when the collected-state CSV omits collection
 * GPS, anchors the batch at (0,0) and corrupts the whole route so the
 * shipment never produces a usable next-stop ETA.
 */
export function isShipmentCollected(status: string | null | undefined): boolean {
  if (isShipmentTerminal(status)) return false;
  const n = String(status || "").toLowerCase().trim().replace(/[-_]/g, " ");
  if (!n) return false;
  return (
    n.includes("collected") ||
    n.includes("collection complete") ||
    n.includes("picked up") ||
    n.includes("out for delivery") ||
    n.includes("in transit") ||
    n.includes("on vehicle") ||
    n.includes("en route") ||
    n.includes("with driver") ||
    n.includes("hub departure") ||
    n.includes("delivering")
  );
}
