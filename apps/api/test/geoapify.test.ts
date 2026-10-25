import { describe, expect, it, vi } from "vitest";
import { GeoapifyProvider } from "../src/infra/geo/geoapify.provider.js";

const logger = {
  setContext: () => undefined,
  warn: () => undefined,
  info: () => undefined,
  error: () => undefined,
} as unknown as ConstructorParameters<typeof GeoapifyProvider>[2];

const DEPOT = { lat: -25.7642, lng: 28.2917 };

function autocomplete(results: unknown[]) {
  return vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValue(new Response(JSON.stringify({ results }), { status: 200 }));
}

/*
  Geoapify's own live response to "Broadacres Shopping Centre, Cedar Road, Maroeladal,
  Randburg" (captured 2026-10-25, the query that first surfaced this): five street-only matches,
  the venue itself absent, and a confidence spread that already tells the two Ekurhuleni rows --
  the wrong city entirely -- apart from the three merely-ambiguous Randburg ones.
*/
const AMBIGUOUS_VENUE_QUERY = [
  {
    formatted: "Cedar Road, Johannesburg Ward 96, Randburg, 2055, South Africa",
    lat: -25.9782893,
    lon: 27.9622597,
    result_type: "amenity",
    rank: { confidence: 0.5, match_type: "full_match" },
  },
  {
    formatted: "Cedar Road, Broadacres AH, Randburg, 2055, South Africa",
    lat: -25.9826282,
    lon: 27.9758272,
    result_type: "street",
    rank: { confidence: 0.5, match_type: "match_by_street" },
  },
  {
    formatted: "Cedar Road, Johannesburg Ward 96, Randburg, 1748, South Africa",
    lat: -25.9772505,
    lon: 27.9584423,
    result_type: "street",
    rank: { confidence: 0.5, match_type: "match_by_street" },
  },
  {
    formatted: "Cedar Road, Ekurhuleni Ward 25, Ekurhuleni, 1509, South Africa",
    lat: -26.0556126,
    lon: 28.3790149,
    result_type: "street",
    rank: { confidence: 0.10714285714285714, match_type: "match_by_street" },
  },
  {
    formatted: "Cedar Road, Ekurhuleni Ward 100, Ekurhuleni, 1509, South Africa",
    lat: -26.1034366,
    lon: 28.3465915,
    result_type: "street",
    rank: { confidence: 0.11764705882352941, match_type: "match_by_street" },
  },
];

/** The same vendor's response to a precise, numbered street address. */
const EXACT_MATCH_QUERY = [
  {
    formatted: "14 Camellia Avenue South, Lynnwood Park, Pretoria, 0081, South Africa",
    lat: -25.7651,
    lon: 28.2923,
    result_type: "building",
    rank: { confidence: 1, match_type: "full_match" },
  },
];

describe("Geoapify autocomplete", () => {
  it("drops the results Geoapify itself scores as noise -- a different city entirely", async () => {
    autocomplete(AMBIGUOUS_VENUE_QUERY);
    const provider = new GeoapifyProvider("key", DEPOT, logger);
    const out = await provider.geocode("Broadacres Shopping Centre, Cedar Road, Randburg");
    expect(out.every((s) => !s.formatted.includes("Ekurhuleni"))).toBe(true);
  });

  /*
    Nothing in the response clears 0.6, because none of it is the venue the customer actually
    typed -- so this hands the query on empty-handed, which is what sends it to LocationIQ next
    in the chain (see geo-chain.test.ts), the provider that actually found "Broadacres Shopping
    Centre" by name on this exact query.
  */
  it("gives up rather than returning a page of guesses, when nothing is a good match", async () => {
    autocomplete(AMBIGUOUS_VENUE_QUERY);
    const provider = new GeoapifyProvider("key", DEPOT, logger);
    expect(await provider.geocode("Broadacres Shopping Centre, Cedar Road, Randburg")).toEqual([]);
  });

  it("still answers directly when the address is precise enough to be unambiguous", async () => {
    autocomplete(EXACT_MATCH_QUERY);
    const provider = new GeoapifyProvider("key", DEPOT, logger);
    const out = await provider.geocode("14 Camellia Avenue, Lynnwood Ridge, Pretoria");
    expect(out).toHaveLength(1);
    expect(out[0]!.formatted).toContain("Camellia Avenue");
  });

  it("keeps a result with no confidence field at all, rather than treating absence as failure", async () => {
    autocomplete([
      {
        formatted: "Somewhere, South Africa",
        lat: -25.7,
        lon: 28.2,
        // no `rank` at all -- some result types do not carry one
      },
    ]);
    const provider = new GeoapifyProvider("key", DEPOT, logger);
    expect(await provider.geocode("Somewhere")).toHaveLength(1);
  });
});
