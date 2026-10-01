import { PinoLogger } from "nestjs-pino";
import type { GeocodeSuggestion, LatLng } from "@delicate/contracts";
import type { GeoProvider } from "./geo.provider.js";

/**
 * LocationIQ: the second opinion behind Geoapify.
 *
 * Same two jobs, a different vendor and a different network path, which is the point — a
 * fallback sharing an outage with the thing it backs up is not a fallback. It is reached only
 * when Geoapify refuses or errs, so its rate limits are not the binding constraint.
 *
 * Built against the published API: `GET /v1/autocomplete` and
 * `GET /v1/matrix/driving/{coords}`, documented at docs.locationiq.com. Coordinates in the
 * matrix path are longitude,latitude and semicolon-separated — the reverse of the order the
 * autocomplete response returns them in, which is an easy and silent mistake to make.
 */
export class LocationIqProvider implements GeoProvider {
  readonly name = "locationiq";
  private static readonly GEOCODE = "https://api.locationiq.com";
  private static readonly ROUTING = "https://us1.locationiq.com";

  constructor(
    private readonly apiKey: string,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(LocationIqProvider.name);
  }

  async geocode(query: string, limit = 5): Promise<GeocodeSuggestion[]> {
    const params = new URLSearchParams({
      key: this.apiKey,
      q: query,
      limit: String(Math.min(limit, 20)),
      countrycodes: "za",
      normalizecity: "1",
      "accept-language": "en",
    });

    try {
      const res = await fetch(`${LocationIqProvider.GEOCODE}/v1/autocomplete?${params}`, {
        signal: AbortSignal.timeout(8_000),
      });
      // A query matching nothing answers 404 rather than an empty list, which is not a failure
      // worth logging every time someone types the first two letters of a street.
      if (res.status === 404) return [];
      if (!res.ok) {
        this.logger.warn({ status: res.status }, "locationiq autocomplete refused");
        return [];
      }

      const rows = (await res.json()) as LocationIqPlace[];
      return rows.map((r) => ({
        formatted: r.display_name,
        location: { lat: Number(r.lat), lng: Number(r.lon) },
        placeId: r.place_id ? `locationiq:${r.place_id}` : null,
        suburb: r.address?.suburb ?? r.address?.neighbourhood ?? null,
        city: r.address?.city ?? r.address?.town ?? r.address?.village ?? null,
        postalCode: r.address?.postcode ?? null,
      }));
    } catch (err) {
      this.logger.warn({ err }, "locationiq autocomplete failed");
      return [];
    }
  }

  async routeLegsKm(points: LatLng[]): Promise<number[]> {
    if (points.length < 2) return [];

    const coords = points.map((p) => `${p.lng},${p.lat}`).join(";");
    const params = new URLSearchParams({ key: this.apiKey, annotations: "distance" });

    const res = await fetch(`${LocationIqProvider.ROUTING}/v1/matrix/driving/${coords}?${params}`, {
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) throw new Error(`locationiq matrix ${res.status}`);

    const body = (await res.json()) as { code?: string; distances?: (number | null)[][] };
    if (body.code && body.code !== "Ok") throw new Error(`locationiq matrix: ${body.code}`);
    if (!body.distances) throw new Error("locationiq matrix returned no distances");

    // The full square matrix comes back; the legs of our loop are the cells just above the
    // diagonal — point i to point i+1.
    return points.slice(0, -1).map((_p, i) => {
      const metres = body.distances?.[i]?.[i + 1];
      if (metres == null) throw new Error(`locationiq found no route for leg ${i}`);
      return metres / 1000;
    });
  }
}

/** The fields we read; the response carries more. */
interface LocationIqPlace {
  place_id?: string;
  lat: string;
  lon: string;
  display_name: string;
  address?: {
    suburb?: string;
    neighbourhood?: string;
    city?: string;
    town?: string;
    village?: string;
    postcode?: string;
  };
}
