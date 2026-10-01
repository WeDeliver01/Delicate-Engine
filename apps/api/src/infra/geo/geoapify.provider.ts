import { PinoLogger } from "nestjs-pino";
import type { GeocodeSuggestion, LatLng } from "@delicate/contracts";
import type { GeoProvider } from "./geo.provider.js";

/**
 * Geoapify: address autocomplete and road distance.
 *
 * Autocomplete is filtered to South Africa and biased toward the depot, because a courier
 * operating in Tshwane typing "church st" means the one in Pretoria, and an unbiased geocoder
 * will happily offer Cape Town first.
 *
 * Distances come from the Route Matrix rather than a routing call. We only ever need each leg
 * of one loop, which is the diagonal of a matrix built from the points shifted by one — so the
 * request asks for exactly the legs we price on and nothing else.
 *
 * Built against the published API: `GET /v1/geocode/autocomplete` and `POST /v1/routematrix`,
 * documented at apidocs.geoapify.com.
 */
export class GeoapifyProvider implements GeoProvider {
  readonly name = "geoapify";
  private static readonly BASE = "https://api.geoapify.com";

  /**
   * The matrix is capped at 1,000 cells. With sources and targets both one shorter than the
   * point list, 32 points is the ceiling — a collection plus thirty drops, far beyond the
   * twenty a booking allows. Anything larger falls through to the next provider rather than
   * being silently truncated into a wrong price.
   */
  private static readonly MAX_POINTS = 32;

  constructor(
    private readonly apiKey: string,
    private readonly depot: LatLng,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(GeoapifyProvider.name);
  }

  async geocode(query: string, limit = 5): Promise<GeocodeSuggestion[]> {
    const params = new URLSearchParams({
      text: query,
      apiKey: this.apiKey,
      // Hard limit to South Africa; a delivery we cannot drive to is not a useful suggestion.
      filter: "countrycode:za",
      // Soft preference for things near the depot. Longitude first, as the API expects.
      bias: `proximity:${this.depot.lng},${this.depot.lat}`,
      limit: String(limit),
      lang: "en",
      format: "json",
    });

    try {
      const res = await fetch(`${GeoapifyProvider.BASE}/v1/geocode/autocomplete?${params}`, {
        signal: AbortSignal.timeout(8_000),
      });
      if (!res.ok) {
        this.logger.warn({ status: res.status }, "geoapify autocomplete refused");
        return [];
      }
      const body = (await res.json()) as { results?: GeoapifyPlace[] };
      return (body.results ?? []).map((r) => ({
        formatted: r.formatted ?? [r.address_line1, r.address_line2].filter(Boolean).join(", "),
        location: { lat: r.lat, lng: r.lon },
        placeId: r.place_id ? `geoapify:${r.place_id}` : null,
        // Geoapify does not always name a suburb; the district or county is the next best
        // thing, and the suburb is what our rate bands and the driver's run are organised by.
        suburb: r.suburb ?? r.district ?? r.county ?? null,
        city: r.city ?? r.town ?? r.village ?? null,
        postalCode: r.postcode ?? null,
      }));
    } catch (err) {
      this.logger.warn({ err }, "geoapify autocomplete failed");
      return [];
    }
  }

  async routeLegsKm(points: LatLng[]): Promise<number[]> {
    if (points.length < 2) return [];
    if (points.length > GeoapifyProvider.MAX_POINTS) {
      throw new Error(`route of ${points.length} points exceeds the matrix limit`);
    }

    // Leg i runs from point i to point i+1, which is cell [i][i] of a matrix whose sources are
    // every point but the last and whose targets are every point but the first.
    const sources = points.slice(0, -1).map((p) => ({ location: [p.lng, p.lat] }));
    const targets = points.slice(1).map((p) => ({ location: [p.lng, p.lat] }));

    const res = await fetch(`${GeoapifyProvider.BASE}/v1/routematrix?apiKey=${this.apiKey}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode: "drive", sources, targets }),
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) {
      throw new Error(`geoapify routematrix ${res.status}`);
    }

    const body = (await res.json()) as {
      sources_to_targets?: {
        distance?: number | null;
        source_index: number;
        target_index: number;
      }[][];
    };
    const matrix = body.sources_to_targets;
    if (!matrix) throw new Error("geoapify routematrix returned no distances");

    return sources.map((_s, i) => {
      const cell = matrix[i]?.find((c) => c.target_index === i) ?? matrix[i]?.[i];
      // A null distance means no drivable route between those two points. Pricing a delivery
      // at zero kilometres because the roads could not be found is worse than failing.
      if (cell?.distance == null) {
        throw new Error(`geoapify found no route for leg ${i}`);
      }
      return cell.distance / 1000;
    });
  }
}

/** The fields we read from an autocomplete result; the response carries many more. */
interface GeoapifyPlace {
  formatted?: string;
  address_line1?: string;
  address_line2?: string;
  lat: number;
  lon: number;
  place_id?: string;
  suburb?: string;
  district?: string;
  county?: string;
  city?: string;
  town?: string;
  village?: string;
  postcode?: string;
}
