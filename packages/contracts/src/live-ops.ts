import type { LatLng } from "./dto/geo.js";
import { haversineKm } from "./pricing.js";
import { serviceMinutes, type StopKind } from "./operations.js";

/**
 * Live operations: what the day is actually doing, as opposed to what it was planned to do.
 *
 * All pure, like the rest of the operational logic, so the projections can be tested against
 * made-up days rather than only observed in production at 11am on a Friday.
 *
 * What is deliberately *not* here: traffic. The planner this came from had a table of Pretoria
 * corridors and a traffic condition the dispatcher set by hand, and both would be inventions
 * in this engine — there is no feed, and a hard-coded list of which road to avoid at what hour
 * is exactly the kind of knowledge that rots silently. When a traffic source exists, it belongs
 * in the `roadFactor` these functions already take.
 */

export interface RemainingStop {
  id: string;
  kind: StopKind;
  location: LatLng;
  pieces?: number;
  windowStartMinute?: number | null;
  windowEndMinute?: number | null;
  plannedArrivalMinute?: number | null;
}

export interface ProjectArrivalsInput {
  /** Where the driver is now. */
  at: LatLng;
  /** Minutes past midnight, local, now. */
  nowMinute: number;
  /** Stops still to do, in the order they will be driven. */
  stops: RemainingStop[];
  averageSpeedKph?: number;
  roadFactor?: number;
}

export interface ProjectedStop {
  id: string;
  etaMinute: number;
  /** Minutes later than the plan said. Negative is ahead of it. Null when there was no plan. */
  varianceMinutes: number | null;
  /** Minutes past the promised window. Zero when it will be made in time. */
  lateMinutes: number;
  willMissWindow: boolean;
}

/**
 * When the driver will actually reach each remaining stop.
 *
 * Straight-line distance times a road factor, from where they are right now, down the order
 * they are going to drive. Crude, and still far better than the planned time once a day has
 * slipped: the plan was computed at 6am from the depot and has not known where the van is since.
 *
 * A window the driver cannot now make is reported rather than quietly absorbed. That is the
 * difference between telling a customer at eleven and apologising at two.
 */
export function projectArrivals(input: ProjectArrivalsInput): ProjectedStop[] {
  const speed = input.averageSpeedKph ?? 35;
  const factor = input.roadFactor ?? 1.3;
  const out: ProjectedStop[] = [];

  let at = input.at;
  let clock = input.nowMinute;
  for (const stop of input.stops) {
    const km = haversineKm(at, stop.location) * factor;
    clock += (km / speed) * 60;
    // A driver who arrives before the window opens waits for it, so the ETA is the opening.
    if (stop.windowStartMinute != null && clock < stop.windowStartMinute) {
      clock = stop.windowStartMinute;
    }
    const eta = Math.round(clock);
    const late = stop.windowEndMinute == null ? 0 : Math.max(0, eta - stop.windowEndMinute);
    out.push({
      id: stop.id,
      etaMinute: Math.min(1440, eta),
      varianceMinutes: stop.plannedArrivalMinute == null ? null : eta - stop.plannedArrivalMinute,
      lateMinutes: late,
      willMissWindow: late > 0,
    });
    clock += serviceMinutes(stop.kind, stop.pieces ?? 1);
    at = stop.location;
  }
  return out;
}

export interface DeviationInput {
  at: LatLng;
  /** The stop they are on their way to. */
  heading: LatLng | null;
  /** Where they were last known to be working from. */
  from: LatLng | null;
}

export interface Deviation {
  /** How far off the straight line between the last stop and the next one they are. */
  offRouteKm: number;
  /** How far they still have to go. */
  remainingKm: number;
  /** True when they are far enough off the line to be worth a phone call. */
  notable: boolean;
}

/**
 * How far off the line between two stops a driver is.
 *
 * Perpendicular distance to the segment, not to either end: a driver halfway along a straight
 * road is far from both stops and perfectly on route, and measuring to the endpoints would call
 * that a deviation every time.
 *
 * It does not know about one-way streets or a closed bridge, so the threshold is deliberately
 * generous — this is for spotting a van that has gone to the wrong suburb, not for grading
 * someone's choice of road.
 */
export function routeDeviation(input: DeviationInput, thresholdKm = 3): Deviation {
  const { at, heading, from } = input;
  const remainingKm = heading ? haversineKm(at, heading) : 0;
  if (!heading || !from) return { offRouteKm: 0, remainingKm, notable: false };

  const offRouteKm = distanceToSegmentKm(at, from, heading);
  return {
    offRouteKm: Math.round(offRouteKm * 100) / 100,
    remainingKm: Math.round(remainingKm * 100) / 100,
    notable: offRouteKm > thresholdKm,
  };
}

export type AdvisoryCategory = "route" | "fuel" | "punctuality" | "capacity" | "silence";
export type AdvisorySeverity = "info" | "tip" | "warning";

export interface Advisory {
  category: AdvisoryCategory;
  severity: AdvisorySeverity;
  driverId: string | null;
  title: string;
  detail: string;
}

export interface AdvisoryDriver {
  driverId: string;
  name: string;
  stopsTotal: number;
  stopsDone: number;
  /** Minutes since the last position ping, when there has ever been one. */
  silentMinutes: number | null;
  /** Longest single leg on their day, in km. */
  longestLegKm: number;
  /** Distance from depot to their first stop plus the run home: km that carry no parcel. */
  deadKm: number;
  plannedKm: number;
  stopsBehind: number;
  willMissCount: number;
  offRouteKm: number;
  capacity: number;
}

export interface AdvisoryInput {
  drivers: AdvisoryDriver[];
  unassignedCount: number;
  nowMinute: number;
}

/**
 * What a dispatcher should look at next, in the order it matters.
 *
 * Ported from the old planner's insight generator, minus everything the engine cannot honestly
 * support: the Pretoria corridor table and the hand-set traffic condition are gone, because a
 * list of which road to avoid at which hour is knowledge that goes stale without anyone
 * noticing, and there is no feed behind it.
 *
 * Each one names a driver and says what to do. An advisory that only states a number is a
 * statistic, and statistics do not get acted on at eleven in the morning.
 */
export function operationalAdvisories(input: AdvisoryInput): Advisory[] {
  const out: Advisory[] = [];

  for (const d of input.drivers) {
    if (d.willMissCount > 0) {
      out.push({
        category: "punctuality",
        severity: "warning",
        driverId: d.driverId,
        title: `${d.name} will miss ${d.willMissCount} window${d.willMissCount === 1 ? "" : "s"}`,
        detail:
          "On their current position and order they arrive after the promise. Reorder their remaining stops, move one to another driver, or tell the customer now.",
      });
    } else if (d.stopsBehind > 0) {
      out.push({
        category: "punctuality",
        severity: "warning",
        driverId: d.driverId,
        title: `${d.name} is behind on ${d.stopsBehind} stop${d.stopsBehind === 1 ? "" : "s"}`,
        detail: "The window has already closed on these. They need a call, in order of promise.",
      });
    }

    // A van nobody has heard from is the one case where no news is not good news.
    if (d.silentMinutes != null && d.silentMinutes > 45 && d.stopsDone < d.stopsTotal) {
      out.push({
        category: "silence",
        severity: "warning",
        driverId: d.driverId,
        title: `No position from ${d.name} for ${d.silentMinutes} minutes`,
        detail:
          "Either the app has stopped reporting or the van has stopped moving. Both are worth a phone call before the next window.",
      });
    }

    if (d.offRouteKm > 3) {
      out.push({
        category: "route",
        severity: "tip",
        driverId: d.driverId,
        title: `${d.name} is ${d.offRouteKm.toFixed(1)} km off the line to their next stop`,
        detail:
          "Could be a detour around something, could be the wrong suburb. Worth a glance at the map before it costs a window.",
      });
    }

    if (d.longestLegKm > 15) {
      out.push({
        category: "route",
        severity: "tip",
        driverId: d.driverId,
        title: `${d.name} has a ${d.longestLegKm.toFixed(0)} km leg`,
        detail:
          "One long hop usually means a stop that belongs on somebody else's day. Worth checking before tomorrow's plan repeats it.",
      });
    }

    // Kilometres that carry no parcel are the cheapest saving in the business.
    if (d.plannedKm > 10 && d.deadKm / d.plannedKm > 0.3) {
      const pct = Math.round((d.deadKm / d.plannedKm) * 100);
      out.push({
        category: "fuel",
        severity: "tip",
        driverId: d.driverId,
        title: `${pct}% of ${d.name}'s day carries nothing`,
        detail: `${d.deadKm.toFixed(0)} km of ${d.plannedKm.toFixed(0)} km is getting to the first stop and coming home. A nearer first collection is the cheapest saving available.`,
      });
    }

    if (d.stopsTotal > d.capacity) {
      out.push({
        category: "capacity",
        severity: "warning",
        driverId: d.driverId,
        title: `${d.name} has ${d.stopsTotal} stops against a capacity of ${d.capacity}`,
        detail: "Something will not get done today. Decide which, rather than finding out at five.",
      });
    }
  }

  if (input.unassignedCount > 0) {
    const idle = input.drivers.filter((d) => d.stopsTotal === 0);
    out.push({
      category: "capacity",
      severity: input.nowMinute > 600 ? "warning" : "info",
      driverId: null,
      title: `${input.unassignedCount} shipment${input.unassignedCount === 1 ? "" : "s"} with no driver`,
      detail:
        idle.length > 0
          ? `${idle.map((d) => d.name).join(", ")} ${idle.length === 1 ? "has" : "have"} nothing on today.`
          : "Everyone on shift already has work. This needs another driver or another day.",
    });
  }

  // Warnings first: a dispatcher reads the top of a list and acts, then reads the rest if there
  // is time. Burying a missed window under a fuel tip is how the list stops being read.
  const rank = { warning: 0, tip: 1, info: 2 };
  return out.sort((a, b) => rank[a.severity] - rank[b.severity]);
}

/** Perpendicular distance from a point to the segment between two others, in km. */
function distanceToSegmentKm(point: LatLng, a: LatLng, b: LatLng): number {
  // Flat-earth projection is plenty at city scale, and keeps this a pure arithmetic function.
  const toXy = (p: LatLng) => ({
    x: p.lng * Math.cos((point.lat * Math.PI) / 180),
    y: p.lat,
  });
  const p = toXy(point);
  const start = toXy(a);
  const end = toXy(b);
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return haversineKm(point, a);

  // How far along the segment the closest point lies, clamped to its ends.
  const t = Math.max(0, Math.min(1, ((p.x - start.x) * dx + (p.y - start.y) * dy) / lengthSquared));
  const closest = { lat: a.lat + t * (b.lat - a.lat), lng: a.lng + t * (b.lng - a.lng) };
  return haversineKm(point, closest);
}
