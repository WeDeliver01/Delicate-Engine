import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { GeocodeSuggestion, LatLng } from "@delicate/contracts";
import { createHarness, type Harness } from "./harness.js";
import { LocationCacheService } from "../src/infra/geo/location-cache.service.js";
import { CachedGeoProvider } from "../src/infra/geo/cached.provider.js";
import type { GeoProvider } from "../src/infra/geo/geo.provider.js";
import { Clock } from "../src/infra/clock.js";
import { DbService } from "../src/infra/db.module.js";

const DEPOT: LatLng = { lat: -25.7642, lng: 28.2917 };
const MENLYN: LatLng = { lat: -25.7826, lng: 28.2755 };
const CENTURION: LatLng = { lat: -25.8603, lng: 28.1894 };

const suggestion = (formatted: string): GeocodeSuggestion => ({
  formatted,
  location: MENLYN,
  placeId: "geoapify:abc",
  suburb: "Menlyn",
  city: "Pretoria",
  postalCode: "0181",
});

const logger = {
  setContext: () => undefined,
  warn: () => undefined,
  info: () => undefined,
} as unknown as ConstructorParameters<typeof CachedGeoProvider>[4];

describe("location cache", () => {
  let h: Harness;
  let cache: LocationCacheService;
  let clock: Clock;

  beforeAll(async () => {
    h = await createHarness();
    clock = h.app.get(Clock);
    clock.now = () => new Date("2026-10-02T09:00:00Z");
    cache = new LocationCacheService(h.app.get(DbService), clock);
  });
  afterAll(() => h.close());
  beforeEach(() => h.reset());

  /** A vendor that counts how often it was actually called. */
  function countingProvider(over: Partial<GeoProvider> = {}) {
    const calls = { geocode: 0, legs: 0 };
    const provider: GeoProvider = {
      name: "geoapify",
      geocode: async () => {
        calls.geocode++;
        return [suggestion("Menlyn Park, Pretoria")];
      },
      routeLegsKm: async (points: LatLng[]) => {
        calls.legs++;
        return points.slice(1).map(() => 12.5);
      },
      ...over,
    };
    return { provider, calls };
  }

  const free: GeoProvider = {
    name: "haversine",
    geocode: async () => [suggestion("from openstreetmap")],
    routeLegsKm: async (points) => points.slice(1).map(() => 99),
  };

  // ── addresses ──────────────────────────────────────────────────────────────

  describe("addresses", () => {
    it("asks the vendor once, then never again for the same address", async () => {
      const { provider, calls } = countingProvider();
      const cached = new CachedGeoProvider(provider, free, cache, 2_400, logger);

      await cached.geocode("10 Camellia Avenue, Lynnwood, Pretoria");
      await cached.geocode("10 Camellia Avenue, Lynnwood, Pretoria");
      await cached.geocode("10 Camellia Avenue, Lynnwood, Pretoria");

      expect(calls.geocode).toBe(1);
    });

    it("recognises the same address written differently", async () => {
      // This is where the saving is. Three customers typing the same place three ways is one
      // lookup, not three, and the alternative is paying for the same answer repeatedly.
      const { provider, calls } = countingProvider();
      const cached = new CachedGeoProvider(provider, free, cache, 2_400, logger);

      await cached.geocode("10 Camellia Avenue, Lynnwood, Pretoria");
      await cached.geocode("10 Camellia Ave, Lynnwood, Pretoria");
      await cached.geocode("10  camellia   avenue,  lynnwood, pretoria");
      await cached.geocode("10 Camellia Avenue, Lynnwood, Pretoria, South Africa");

      expect(calls.geocode).toBe(1);
    });

    it("does not merge genuinely different addresses", async () => {
      // The fingerprint must be forgiving about spelling and strict about everything else.
      const { provider, calls } = countingProvider();
      const cached = new CachedGeoProvider(provider, free, cache, 2_400, logger);

      await cached.geocode("10 Camellia Avenue, Lynnwood");
      await cached.geocode("12 Camellia Avenue, Lynnwood");
      await cached.geocode("10 Camellia Road, Lynnwood");

      expect(calls.geocode).toBe(3);
    });

    it("returns what the customer actually picked, with its suburb and postcode", async () => {
      const { provider } = countingProvider();
      const cached = new CachedGeoProvider(provider, free, cache, 2_400, logger);
      await cached.geocode("Menlyn Park");

      const [hit] = await cached.geocode("menlyn park");
      expect(hit).toMatchObject({
        formatted: "Menlyn Park, Pretoria",
        suburb: "Menlyn",
        postalCode: "0181",
        placeId: "geoapify:abc",
      });
    });
  });

  // ── distances ──────────────────────────────────────────────────────────────

  describe("distances", () => {
    it("measures a route once and reuses it", async () => {
      const { provider, calls } = countingProvider();
      const cached = new CachedGeoProvider(provider, free, cache, 2_400, logger);

      const first = await cached.routeLegsKm([DEPOT, MENLYN, DEPOT]);
      const second = await cached.routeLegsKm([DEPOT, MENLYN, DEPOT]);

      expect(first).toEqual(second);
      expect(calls.legs).toBe(1);
      // A price reached from cache should say so, not claim the vendor measured it today.
      expect(cached.name).toBe("cache");
    });

    it("reuses the legs it knows when only one stop is new", async () => {
      // A regular collection point and a new customer should cost one measurement, not a
      // re-measurement of the whole loop.
      const { provider, calls } = countingProvider();
      const cached = new CachedGeoProvider(provider, free, cache, 2_400, logger);

      await cached.routeLegsKm([DEPOT, MENLYN, DEPOT]);
      expect(calls.legs).toBe(1);

      await cached.routeLegsKm([DEPOT, MENLYN, CENTURION, DEPOT]);
      expect(calls.legs).toBe(2);

      // And now that loop is known too.
      await cached.routeLegsKm([DEPOT, MENLYN, CENTURION, DEPOT]);
      expect(calls.legs).toBe(2);
    });

    it("treats coordinates a few metres apart as the same leg", async () => {
      // Two doors on one street share a road distance. Keying on exact coordinates would mean
      // the cache never hits and the whole thing is decorative.
      const { provider, calls } = countingProvider();
      const cached = new CachedGeoProvider(provider, free, cache, 2_400, logger);

      await cached.routeLegsKm([DEPOT, MENLYN]);
      await cached.routeLegsKm([
        { lat: DEPOT.lat + 0.00001, lng: DEPOT.lng },
        { lat: MENLYN.lat - 0.00002, lng: MENLYN.lng },
      ]);

      expect(calls.legs).toBe(1);
    });

    it("measures again once a stored distance is too old to trust", async () => {
      // A road layout changes over months. A stale distance is not a stale map, it is a wrong
      // price charged to a real customer, so the cache expires rather than holding forever.
      const { provider, calls } = countingProvider();
      const cached = new CachedGeoProvider(provider, free, cache, 2_400, logger);

      await cached.routeLegsKm([DEPOT, MENLYN]);
      expect(calls.legs).toBe(1);

      clock.now = () => new Date("2026-12-20T09:00:00Z"); // 79 days later
      await cached.routeLegsKm([DEPOT, MENLYN]);
      expect(calls.legs).toBe(2);

      clock.now = () => new Date("2026-10-02T09:00:00Z");
    });
  });

  // ── the daily allowance ────────────────────────────────────────────────────

  describe("the daily allowance", () => {
    it("stops calling the vendor once the budget is spent", async () => {
      const { provider, calls } = countingProvider();
      const cached = new CachedGeoProvider(provider, free, cache, 2, logger);

      await cached.geocode("address one");
      await cached.geocode("address two");
      await cached.geocode("address three");

      expect(calls.geocode).toBe(2);
    });

    it("still answers from the free provider rather than failing the booking", async () => {
      // Running out of a vendor allowance should make the engine cautious, not stop the
      // business taking bookings.
      const { provider } = countingProvider();
      const cached = new CachedGeoProvider(provider, free, cache, 0, logger);

      const results = await cached.geocode("somewhere new");
      expect(results[0]!.formatted).toBe("from openstreetmap");
    });

    it("prices on cached legs plus an estimate for the rest, not on nothing", async () => {
      const { provider } = countingProvider();
      const generous = new CachedGeoProvider(provider, free, cache, 2_400, logger);
      await generous.routeLegsKm([DEPOT, MENLYN]); // 12.5, now cached

      const broke = new CachedGeoProvider(provider, free, cache, 0, logger);
      const legs = await broke.routeLegsKm([DEPOT, MENLYN, CENTURION]);

      // The known leg keeps its measured value; only the unknown one is estimated.
      expect(legs[0]).toBe(12.5);
      expect(legs[1]).toBe(99);
      expect(broke.name).toContain("haversine");
    });

    it("never stores an estimate as if it were a measurement", async () => {
      // The one thing that must not happen: a guess becoming the cached answer for a real
      // road, and every future quote inheriting it.
      const { provider, calls } = countingProvider();
      const broke = new CachedGeoProvider(provider, free, cache, 0, logger);
      await broke.routeLegsKm([DEPOT, CENTURION]);

      const funded = new CachedGeoProvider(provider, free, cache, 2_400, logger);
      const legs = await funded.routeLegsKm([DEPOT, CENTURION]);

      expect(calls.legs).toBe(1); // it had to measure, because nothing was cached
      expect(legs[0]).toBe(12.5); // the real figure, not the 99 estimate
    });

    it("counts a refusal so a day that keeps running out is visible", async () => {
      const { provider } = countingProvider();
      const cached = new CachedGeoProvider(provider, free, cache, 1, logger);
      await cached.geocode("one");
      await cached.geocode("two");
      await cached.geocode("three");

      const usage = await cache.usageToday("geoapify");
      expect(usage.calls).toBe(1);
      expect(usage.skipped).toBe(2);
    });

    it("counts against the Johannesburg day, not the container's UTC one", async () => {
      // 22:30 UTC is already the next morning in SA. A budget that rolls over on the UTC day
      // would reset mid-evening and hand back an allowance the business has already spent.
      clock.now = () => new Date("2026-10-02T22:30:00Z");
      const { provider } = countingProvider();
      const cached = new CachedGeoProvider(provider, free, cache, 2_400, logger);
      await cached.geocode("late night address");

      expect((await cache.usageToday("geoapify")).calls).toBe(1);
      clock.now = () => new Date("2026-10-03T09:00:00Z");
      expect((await cache.usageToday("geoapify")).calls).toBe(1); // same operating day

      clock.now = () => new Date("2026-10-02T09:00:00Z");
    });
  });
});
