import { describe, expect, it } from "vitest";
import {
  operationalAdvisories,
  projectArrivals,
  routeDeviation,
  type AdvisoryDriver,
  type RemainingStop,
} from "./live-ops.js";

const DEPOT = { lat: -25.7479, lng: 28.2293 };
const MENLYN = { lat: -25.7826, lng: 28.2755 };
const HATFIELD = { lat: -25.7487, lng: 28.2384 };
const SOSHANGUVE = { lat: -25.5233, lng: 28.1083 };

const stop = (
  id: string,
  location = HATFIELD,
  over: Partial<RemainingStop> = {},
): RemainingStop => ({
  id,
  kind: "drop",
  location,
  pieces: 1,
  ...over,
});

describe("projecting arrivals", () => {
  it("works forward from where the driver is now, not from the depot", () => {
    const [first] = projectArrivals({
      at: HATFIELD,
      nowMinute: 600,
      stops: [stop("a", HATFIELD)],
    });
    // Standing on the stop: they arrive about now, not at whatever 6am said.
    expect(first!.etaMinute).toBeGreaterThanOrEqual(600);
    expect(first!.etaMinute).toBeLessThan(605);
  });

  it("accumulates travel and service down the day", () => {
    const out = projectArrivals({
      at: DEPOT,
      nowMinute: 600,
      stops: [stop("a", MENLYN), stop("b", SOSHANGUVE)],
    });
    expect(out[1]!.etaMinute).toBeGreaterThan(out[0]!.etaMinute);
  });

  it("waits for a window rather than arriving before it opens", () => {
    const [only] = projectArrivals({
      at: HATFIELD,
      nowMinute: 600,
      stops: [stop("a", HATFIELD, { windowStartMinute: 700, windowEndMinute: 760 })],
    });
    expect(only!.etaMinute).toBe(700);
    expect(only!.willMissWindow).toBe(false);
  });

  it("says a window will be missed rather than quietly absorbing it", () => {
    const [only] = projectArrivals({
      at: SOSHANGUVE,
      nowMinute: 600,
      stops: [stop("a", MENLYN, { windowStartMinute: 540, windowEndMinute: 601 })],
    });
    expect(only!.willMissWindow).toBe(true);
    expect(only!.lateMinutes).toBeGreaterThan(0);
  });

  it("measures the gap against the plan, and says nothing when there was no plan", () => {
    const planned = projectArrivals({
      at: SOSHANGUVE,
      nowMinute: 600,
      stops: [stop("a", MENLYN, { plannedArrivalMinute: 540 })],
    });
    expect(planned[0]!.varianceMinutes).toBeGreaterThan(0);

    const unplanned = projectArrivals({ at: MENLYN, nowMinute: 600, stops: [stop("a", MENLYN)] });
    expect(unplanned[0]!.varianceMinutes).toBeNull();
  });

  it("handles a finished day", () => {
    expect(projectArrivals({ at: DEPOT, nowMinute: 600, stops: [] })).toEqual([]);
  });
});

describe("route deviation", () => {
  it("calls a driver on the line between two stops on route, however far from both", () => {
    // Exactly halfway along, which is far from each end and perfectly on route.
    const middle = {
      lat: (DEPOT.lat + SOSHANGUVE.lat) / 2,
      lng: (DEPOT.lng + SOSHANGUVE.lng) / 2,
    };
    const d = routeDeviation({ at: middle, from: DEPOT, heading: SOSHANGUVE });
    expect(d.offRouteKm).toBeLessThan(0.5);
    expect(d.notable).toBe(false);
    // And it still knows they have a long way to go.
    expect(d.remainingKm).toBeGreaterThan(10);
  });

  it("notices a van in the wrong part of town", () => {
    const d = routeDeviation({ at: SOSHANGUVE, from: DEPOT, heading: MENLYN });
    expect(d.offRouteKm).toBeGreaterThan(3);
    expect(d.notable).toBe(true);
  });

  it("says nothing when there is nowhere to be heading", () => {
    expect(routeDeviation({ at: MENLYN, from: null, heading: null })).toMatchObject({
      offRouteKm: 0,
      notable: false,
    });
  });

  it("does not divide by zero when the two stops are the same place", () => {
    const d = routeDeviation({ at: MENLYN, from: HATFIELD, heading: HATFIELD });
    expect(Number.isFinite(d.offRouteKm)).toBe(true);
    expect(d.offRouteKm).toBeGreaterThan(0);
  });
});

describe("advisories", () => {
  const driver = (over: Partial<AdvisoryDriver> = {}): AdvisoryDriver => ({
    driverId: "d1",
    name: "Sipho",
    stopsTotal: 6,
    stopsDone: 2,
    silentMinutes: 2,
    longestLegKm: 5,
    deadKm: 4,
    plannedKm: 60,
    stopsBehind: 0,
    willMissCount: 0,
    offRouteKm: 0,
    capacity: 10,
    ...over,
  });

  it("says nothing when the day is going fine", () => {
    expect(
      operationalAdvisories({ drivers: [driver()], unassignedCount: 0, nowMinute: 600 }),
    ).toEqual([]);
  });

  it("puts a window about to be missed at the top", () => {
    const out = operationalAdvisories({
      drivers: [driver({ willMissCount: 2, longestLegKm: 40, deadKm: 40 })],
      unassignedCount: 0,
      nowMinute: 600,
    });
    // Warnings before tips: a missed window buried under a fuel tip is how the list stops
    // being read.
    expect(out[0]!.severity).toBe("warning");
    expect(out[0]!.category).toBe("punctuality");
    expect(out[0]!.title).toContain("will miss 2 windows");
  });

  it("prefers the prediction to the history when both are true", () => {
    const out = operationalAdvisories({
      drivers: [driver({ willMissCount: 1, stopsBehind: 3 })],
      unassignedCount: 0,
      nowMinute: 600,
    });
    const punctual = out.filter((a) => a.category === "punctuality");
    // One message, about what can still be changed, not two about the same driver.
    expect(punctual).toHaveLength(1);
    expect(punctual[0]!.title).toContain("will miss");
  });

  it("treats a silent van as worth a call, but not one that has finished", () => {
    const working = operationalAdvisories({
      drivers: [driver({ silentMinutes: 90 })],
      unassignedCount: 0,
      nowMinute: 600,
    });
    expect(working.some((a) => a.category === "silence")).toBe(true);

    const finished = operationalAdvisories({
      drivers: [driver({ silentMinutes: 90, stopsDone: 6, stopsTotal: 6 })],
      unassignedCount: 0,
      nowMinute: 600,
    });
    expect(finished.some((a) => a.category === "silence")).toBe(false);
  });

  it("flags kilometres that carry nothing", () => {
    const out = operationalAdvisories({
      drivers: [driver({ deadKm: 30, plannedKm: 60 })],
      unassignedCount: 0,
      nowMinute: 600,
    });
    const fuel = out.find((a) => a.category === "fuel")!;
    expect(fuel.title).toContain("50%");
  });

  it("names who is idle when work has no driver", () => {
    const out = operationalAdvisories({
      drivers: [driver(), driver({ driverId: "d2", name: "Thabo", stopsTotal: 0, stopsDone: 0 })],
      unassignedCount: 3,
      nowMinute: 540,
    });
    const capacity = out.find((a) => a.category === "capacity")!;
    expect(capacity.title).toContain("3 shipments");
    expect(capacity.detail).toContain("Thabo");
  });

  it("gets louder about unassigned work as the day goes on", () => {
    const morning = operationalAdvisories({
      drivers: [driver()],
      unassignedCount: 1,
      nowMinute: 540,
    });
    const afternoon = operationalAdvisories({
      drivers: [driver()],
      unassignedCount: 1,
      nowMinute: 660,
    });
    expect(morning.find((a) => a.category === "capacity")!.severity).toBe("info");
    expect(afternoon.find((a) => a.category === "capacity")!.severity).toBe("warning");
  });

  it("says plainly when a driver has more stops than they can do", () => {
    const out = operationalAdvisories({
      drivers: [driver({ stopsTotal: 14, capacity: 10 })],
      unassignedCount: 0,
      nowMinute: 600,
    });
    expect(out.some((a) => a.category === "capacity" && a.title.includes("14 stops"))).toBe(true);
  });
});
