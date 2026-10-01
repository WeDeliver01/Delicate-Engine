import { describe, expect, it, vi } from "vitest";
import type { GeocodeSuggestion, LatLng } from "@delicate/contracts";
import { ChainGeoProvider } from "../src/infra/geo/chain.provider.js";
import type { GeoProvider } from "../src/infra/geo/geo.provider.js";

const logger = {
  setContext: () => undefined,
  warn: () => undefined,
  info: () => undefined,
  error: () => undefined,
} as unknown as ConstructorParameters<typeof ChainGeoProvider>[1];

const suggestion = (formatted: string): GeocodeSuggestion => ({
  formatted,
  location: { lat: -25.74, lng: 28.22 },
  placeId: null,
  suburb: null,
  city: "Pretoria",
  postalCode: null,
});

/** A provider that does whatever the test needs it to do. */
function stub(name: string, over: Partial<GeoProvider> = {}): GeoProvider {
  return {
    name,
    geocode: async () => [suggestion(name)],
    routeLegsKm: async (points: LatLng[]) => points.slice(1).map(() => 10),
    ...over,
  } as GeoProvider;
}

const LOOP: LatLng[] = [
  { lat: -25.76, lng: 28.29 },
  { lat: -25.78, lng: 28.27 },
  { lat: -25.76, lng: 28.29 },
];

describe("geo provider chain", () => {
  describe("addresses", () => {
    it("uses the first provider that answers", async () => {
      const chain = new ChainGeoProvider([stub("geoapify"), stub("locationiq")], logger);
      expect((await chain.geocode("church st"))[0]!.formatted).toBe("geoapify");
    });

    it("moves on when a provider knows nothing, not only when it errs", async () => {
      // An empty list and an outage are the same to the person typing: no address appears.
      // A vendor that is up but has never heard of a new estate must not end the search.
      const chain = new ChainGeoProvider(
        [stub("geoapify", { geocode: async () => [] }), stub("locationiq")],
        logger,
      );
      expect((await chain.geocode("new estate"))[0]!.formatted).toBe("locationiq");
    });

    it("moves on when a provider throws", async () => {
      const chain = new ChainGeoProvider(
        [
          stub("geoapify", {
            geocode: async () => {
              throw new Error("429 rate limited");
            },
          }),
          stub("locationiq"),
        ],
        logger,
      );
      expect((await chain.geocode("church st"))[0]!.formatted).toBe("locationiq");
    });

    it("returns nothing rather than throwing when no provider can help", async () => {
      // A booking form that explodes because an address lookup failed is worse than one that
      // offers no suggestions and lets the customer carry on typing.
      const chain = new ChainGeoProvider(
        [stub("a", { geocode: async () => [] }), stub("b", { geocode: async () => [] })],
        logger,
      );
      expect(await chain.geocode("nowhere")).toEqual([]);
    });
  });

  describe("distance", () => {
    it("prices on the first provider that measures the route", async () => {
      const chain = new ChainGeoProvider([stub("geoapify"), stub("locationiq")], logger);
      expect(await chain.routeLegsKm(LOOP)).toEqual([10, 10]);
      expect(chain.name).toBe("geoapify");
    });

    it("falls through to the next vendor when one cannot route", async () => {
      const chain = new ChainGeoProvider(
        [
          stub("geoapify", {
            routeLegsKm: async () => {
              throw new Error("no route");
            },
          }),
          stub("locationiq", { routeLegsKm: async () => [7, 7] }),
        ],
        logger,
      );
      expect(await chain.routeLegsKm(LOOP)).toEqual([7, 7]);
      // Recorded against the quote, so a price can be explained by which vendor measured it.
      expect(chain.name).toBe("locationiq");
    });

    it("never treats an empty result as a free delivery", async () => {
      // The asymmetry that matters: for addresses, nothing means try the next one. For
      // distance, a provider returning nothing would price the trip at zero kilometres, so
      // only a thrown error moves on and an empty answer is taken at its word.
      const chain = new ChainGeoProvider(
        [stub("geoapify", { routeLegsKm: async () => [] })],
        logger,
      );
      expect(await chain.routeLegsKm(LOOP)).toEqual([]);
    });

    it("refuses to guess when every provider fails", async () => {
      // Better a booking that cannot be priced than one priced on a number nobody measured.
      const boom = {
        routeLegsKm: async () => {
          throw new Error("down");
        },
      };
      const chain = new ChainGeoProvider([stub("a", boom), stub("b", boom)], logger);
      await expect(chain.routeLegsKm(LOOP)).rejects.toThrow(/no distance provider/i);
    });

    it("reports the provider that actually answered, not the one configured first", async () => {
      const chain = new ChainGeoProvider(
        [
          stub("geoapify", {
            routeLegsKm: vi
              .fn()
              .mockResolvedValueOnce([5, 5])
              .mockRejectedValueOnce(new Error("down")),
          }),
          stub("locationiq", { routeLegsKm: async () => [9, 9] }),
        ],
        logger,
      );
      await chain.routeLegsKm(LOOP);
      expect(chain.name).toBe("geoapify");
      await chain.routeLegsKm(LOOP);
      expect(chain.name).toBe("locationiq");
    });
  });
});
