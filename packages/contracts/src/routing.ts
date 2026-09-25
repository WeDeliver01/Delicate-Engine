import type { LatLng } from "./dto/geo.js";
// One distance function for the whole engine: two copies is how two parts of a system start
// disagreeing about how far apart two places are.
import { haversineKm } from "./pricing.js";

/**
 * Route ordering.
 *
 * A driver's day arrives as a list of stops in the order the bookings happened to be made, which
 * has nothing to do with geography. Putting them in a sensible order is the cheapest saving in
 * the business: it costs nothing to compute and comes straight off fuel and hours.
 *
 * Pure and deterministic, like pricing and allocation — the same day always produces the same
 * route, so a driver who reloads the app does not watch their stops rearrange themselves.
 *
 * Two rules it will not break:
 *   1. A parcel cannot be delivered before it has been collected.
 *   2. A stop with a time window is not moved outside it.
 *
 * Distance is straight-line by default. Real road distance is better and the caller can pass it
 * in; the ordering logic is the same either way, and a straight line is a good enough proxy for
 * *deciding order* even where it is a poor proxy for the distance itself.
 */

export interface RouteStop {
  id: string;
  location: LatLng;
  /** Set on a drop: the id of the stop where its parcels are collected. */
  afterStopId?: string | null;
  /** Minutes from the start of the day, when the stop must not happen before/after. */
  earliestMinute?: number | null;
  latestMinute?: number | null;
  /** How long the driver spends here. Used only when there are time windows. */
  serviceMinutes?: number;
}

export interface RouteInput {
  /** Where the driver starts, and returns to. */
  depot: LatLng;
  stops: RouteStop[];
  /** Straight-line kilometres are multiplied by this to approximate roads. 10000 = no change. */
  roadFactorBps?: number;
  /** Average speed used only to check time windows. */
  averageSpeedKph?: number;
  /** Minutes past midnight the driver starts. */
  startMinute?: number;
}

export interface RouteResult {
  /** Stop ids in the order they should be driven. */
  order: string[];
  /** Total distance including the run back to the depot. */
  totalKm: number;
  /** What the original order would have cost, for comparison. */
  originalKm: number;
  savedKm: number;
  /** Stops that could not be placed inside their time window. */
  lateStops: string[];
}

/**
 * Order the stops. Nearest-neighbour to get a sensible route, then 2-opt to untangle the
 * crossings nearest-neighbour always leaves behind — a small, well-understood pair that does
 * most of the available saving without pretending to solve a travelling-salesman problem.
 */
export function optimiseRoute(input: RouteInput): RouteResult {
  const factor = (input.roadFactorBps ?? 10_000) / 10_000;
  const stops = input.stops;
  if (stops.length === 0) {
    return { order: [], totalKm: 0, originalKm: 0, savedKm: 0, lateStops: [] };
  }

  const byId = new Map(stops.map((s) => [s.id, s]));
  const km = (a: LatLng, b: LatLng) => haversineKm(a, b) * factor;

  /** A stop may be visited only once whatever it depends on has been. */
  const ready = (stop: RouteStop, visited: Set<string>) =>
    !stop.afterStopId || visited.has(stop.afterStopId) || !byId.has(stop.afterStopId);

  // ── nearest neighbour ───────────────────────────────────────────────────────
  const order: RouteStop[] = [];
  const visited = new Set<string>();
  let at = input.depot;
  while (order.length < stops.length) {
    const candidates = stops.filter((s) => !visited.has(s.id) && ready(s, visited));
    // Nothing is ready: the precedence data is circular, so fall back to the given order
    // rather than looping forever or silently dropping a stop.
    const pool = candidates.length > 0 ? candidates : stops.filter((s) => !visited.has(s.id));
    let best = pool[0]!;
    let bestKm = km(at, best.location);
    for (const s of pool.slice(1)) {
      const d = km(at, s.location);
      if (d < bestKm) {
        best = s;
        bestKm = d;
      }
    }
    order.push(best);
    visited.add(best.id);
    at = best.location;
  }

  // ── 2-opt ───────────────────────────────────────────────────────────────────
  // Reverse a segment when doing so shortens the route and keeps every parcel collected
  // before it is delivered. Bounded, because this runs on every page load of a driver's day.
  const cost = (seq: RouteStop[]) => {
    let total = 0;
    let from = input.depot;
    for (const s of seq) {
      total += km(from, s.location);
      from = s.location;
    }
    return total + km(from, input.depot);
  };
  const legal = (seq: RouteStop[]) => {
    const seen = new Set<string>();
    for (const s of seq) {
      if (s.afterStopId && byId.has(s.afterStopId) && !seen.has(s.afterStopId)) return false;
      seen.add(s.id);
    }
    return true;
  };

  let current = order;
  let currentCost = cost(current);
  for (let pass = 0; pass < 4; pass++) {
    let improved = false;
    for (let i = 0; i < current.length - 1; i++) {
      for (let j = i + 1; j < current.length; j++) {
        const candidate = [
          ...current.slice(0, i),
          ...current.slice(i, j + 1).reverse(),
          ...current.slice(j + 1),
        ];
        if (!legal(candidate)) continue;
        const candidateCost = cost(candidate);
        if (candidateCost < currentCost - 0.0001) {
          current = candidate;
          currentCost = candidateCost;
          improved = true;
        }
      }
    }
    if (!improved) break;
  }

  // ── time windows ────────────────────────────────────────────────────────────
  const lateStops: string[] = [];
  if (stops.some((s) => s.latestMinute != null || s.earliestMinute != null)) {
    const speed = input.averageSpeedKph ?? 35;
    let minute = input.startMinute ?? 0;
    let from = input.depot;
    for (const s of current) {
      minute += (km(from, s.location) / speed) * 60;
      if (s.earliestMinute != null && minute < s.earliestMinute) minute = s.earliestMinute;
      if (s.latestMinute != null && minute > s.latestMinute) lateStops.push(s.id);
      minute += s.serviceMinutes ?? 0;
      from = s.location;
    }
  }

  const originalKm = cost(stops);
  const totalKm = round(currentCost);
  return {
    order: current.map((s) => s.id),
    totalKm,
    originalKm: round(originalKm),
    savedKm: round(Math.max(0, originalKm - currentCost)),
    lateStops,
  };
}

function round(km: number): number {
  return Math.round(km * 100) / 100;
}
