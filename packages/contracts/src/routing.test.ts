import { describe, expect, it } from "vitest";
import { optimiseRoute, type RouteStop } from "./routing.js";
import { haversineKm } from "./pricing.js";

const DEPOT = { lat: -25.7642, lng: 28.2917 }; // Lynnwood Ridge
const MENLYN = { lat: -25.7826, lng: 28.2755 };
const HATFIELD = { lat: -25.7487, lng: 28.2384 };
const CENTURION = { lat: -25.8603, lng: 28.1894 };
const SOSHANGUVE = { lat: -25.5333, lng: 28.1 };

const stop = (
  id: string,
  location: { lat: number; lng: number },
  over: Partial<RouteStop> = {},
): RouteStop => ({
  id,
  location,
  ...over,
});

describe("optimiseRoute", () => {
  it("returns an empty route for an empty day", () => {
    const r = optimiseRoute({ depot: DEPOT, stops: [] });
    expect(r).toEqual({ order: [], totalKm: 0, originalKm: 0, savedKm: 0, lateStops: [] });
  });

  it("visits every stop exactly once", () => {
    const stops = [
      stop("a", MENLYN),
      stop("b", HATFIELD),
      stop("c", CENTURION),
      stop("d", SOSHANGUVE),
    ];
    const r = optimiseRoute({ depot: DEPOT, stops });
    expect([...r.order].sort()).toEqual(["a", "b", "c", "d"]);
  });

  it("untangles an order that criss-crosses the city", () => {
    // deliberately alternating far and near, which is what a booking-order route looks like
    const stops = [
      stop("far1", SOSHANGUVE),
      stop("near1", MENLYN),
      stop("far2", CENTURION),
      stop("near2", HATFIELD),
    ];
    const r = optimiseRoute({ depot: DEPOT, stops });
    expect(r.totalKm).toBeLessThan(r.originalKm);
    expect(r.savedKm).toBeGreaterThan(0);
    expect(r.savedKm).toBe(Math.round((r.originalKm - r.totalKm) * 100) / 100);
  });

  it("never delivers a parcel before it has been collected", () => {
    const stops = [
      // the drop is next door to the depot; the collection is across town
      stop("drop", { lat: -25.7644, lng: 28.2919 }, { afterStopId: "collect" }),
      stop("collect", SOSHANGUVE),
    ];
    const r = optimiseRoute({ depot: DEPOT, stops });
    expect(r.order.indexOf("collect")).toBeLessThan(r.order.indexOf("drop"));
  });

  it("holds the rule through several collections and drops", () => {
    const stops = [
      stop("c1", MENLYN),
      stop("d1", CENTURION, { afterStopId: "c1" }),
      stop("c2", HATFIELD),
      stop("d2", SOSHANGUVE, { afterStopId: "c2" }),
      stop("d3", { lat: -25.79, lng: 28.27 }, { afterStopId: "c1" }),
    ];
    const r = optimiseRoute({ depot: DEPOT, stops });
    expect(r.order.indexOf("c1")).toBeLessThan(r.order.indexOf("d1"));
    expect(r.order.indexOf("c1")).toBeLessThan(r.order.indexOf("d3"));
    expect(r.order.indexOf("c2")).toBeLessThan(r.order.indexOf("d2"));
  });

  it("is deterministic: the same day always produces the same route", () => {
    const stops = [
      stop("a", MENLYN),
      stop("b", HATFIELD),
      stop("c", CENTURION),
      stop("d", SOSHANGUVE),
    ];
    const first = optimiseRoute({ depot: DEPOT, stops });
    const second = optimiseRoute({ depot: DEPOT, stops });
    expect(first).toEqual(second);
  });

  it("applies a road factor without changing the order it chooses", () => {
    const stops = [stop("a", SOSHANGUVE), stop("b", MENLYN), stop("c", CENTURION)];
    const straight = optimiseRoute({ depot: DEPOT, stops });
    const roads = optimiseRoute({ depot: DEPOT, stops, roadFactorBps: 13_000 });
    expect(roads.order).toEqual(straight.order);
    expect(roads.totalKm).toBeCloseTo(straight.totalKm * 1.3, 1);
  });

  it("counts the run home, so a route is not made to look cheap by ending far away", () => {
    const r = optimiseRoute({ depot: DEPOT, stops: [stop("a", SOSHANGUVE)] });
    const oneWay = haversineKm(DEPOT, SOSHANGUVE);
    expect(r.totalKm).toBeCloseTo(oneWay * 2, 1);
  });

  it("flags a stop it cannot reach inside its window rather than silently being late", () => {
    const stops = [
      stop("early", SOSHANGUVE, { latestMinute: 5, serviceMinutes: 10 }),
      stop("fine", MENLYN, { latestMinute: 600 }),
    ];
    const r = optimiseRoute({ depot: DEPOT, stops, startMinute: 0, averageSpeedKph: 35 });
    expect(r.lateStops).toContain("early");
    expect(r.lateStops).not.toContain("fine");
  });

  it("waits rather than arriving before a stop is ready", () => {
    const stops = [
      stop("opens-late", MENLYN, { earliestMinute: 480, latestMinute: 540, serviceMinutes: 5 }),
      stop("after", HATFIELD, { latestMinute: 600 }),
    ];
    const r = optimiseRoute({ depot: DEPOT, stops, startMinute: 420, averageSpeedKph: 35 });
    // arriving early is fine; the driver waits, and nothing downstream is reported late
    expect(r.lateStops).toEqual([]);
  });

  it("does not hang or lose a stop when precedence is circular", () => {
    const stops = [
      stop("a", MENLYN, { afterStopId: "b" }),
      stop("b", HATFIELD, { afterStopId: "a" }),
    ];
    const r = optimiseRoute({ depot: DEPOT, stops });
    expect([...r.order].sort()).toEqual(["a", "b"]);
  });

  it("ignores a dependency on a stop that is not on today's run", () => {
    const stops = [stop("drop", MENLYN, { afterStopId: "collected-yesterday" })];
    const r = optimiseRoute({ depot: DEPOT, stops });
    expect(r.order).toEqual(["drop"]);
  });

  it("copes with a realistic day without taking an age", () => {
    const stops: RouteStop[] = Array.from({ length: 40 }, (_, i) =>
      stop(`s${i}`, {
        lat: -25.6 - (i % 8) * 0.03,
        lng: 28.1 + ((i * 7) % 11) * 0.03,
      }),
    );
    const started = Date.now();
    const r = optimiseRoute({ depot: DEPOT, stops });
    expect(r.order).toHaveLength(40);
    expect(r.totalKm).toBeLessThanOrEqual(r.originalKm);
    expect(Date.now() - started).toBeLessThan(1000);
  });
});

describe("haversineKm", () => {
  it("is zero for the same point and symmetric between two", () => {
    expect(haversineKm(MENLYN, MENLYN)).toBe(0);
    expect(haversineKm(MENLYN, CENTURION)).toBeCloseTo(haversineKm(CENTURION, MENLYN), 9);
  });

  it("matches a known distance across Pretoria", () => {
    // Menlyn to Centurion is roughly 12 km as the crow flies
    expect(haversineKm(MENLYN, CENTURION)).toBeGreaterThan(9);
    expect(haversineKm(MENLYN, CENTURION)).toBeLessThan(15);
  });
});
