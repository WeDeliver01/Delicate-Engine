import { PinoLogger } from "nestjs-pino";
import type { GeocodeSuggestion, LatLng } from "@delicate/contracts";
import type { GeoProvider } from "./geo.provider.js";
import { fallbackLegs } from "./google.provider.js";

/**
 * No-key provider for development and as a safety net: OpenStreetMap Nominatim for geocoding
 * (usage policy: identify the app, ≤1 req/s, not for production autocomplete) and straight-line
 * distance × road factor for legs. Production sets GOOGLE_MAPS_API_KEY.
 */
export class FallbackGeoProvider implements GeoProvider {
  readonly name = "haversine";
  private lastCallAt = 0;

  constructor(
    private readonly roadFactorBps: number,
    private readonly userAgent: string,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(FallbackGeoProvider.name);
  }

  async geocode(query: string, limit = 5): Promise<GeocodeSuggestion[]> {
    // Respect Nominatim's 1 request/second policy.
    const wait = 1000 - (Date.now() - this.lastCallAt);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    this.lastCallAt = Date.now();

    const params = new URLSearchParams({
      q: query,
      format: "jsonv2",
      addressdetails: "1",
      countrycodes: "za",
      limit: String(limit),
      viewbox: "27.6,-25.3,28.9,-26.6",
      bounded: "0",
    });
    try {
      const res = await fetch(`https://nominatim.openstreetmap.org/search?${params}`, {
        headers: { "user-agent": this.userAgent, "accept-language": "en" },
      });
      if (!res.ok) return [];
      const rows = (await res.json()) as {
        display_name: string;
        lat: string;
        lon: string;
        place_id: number;
        address?: Record<string, string>;
      }[];
      return rows.map((r) => ({
        formatted: r.display_name,
        location: { lat: Number(r.lat), lng: Number(r.lon) },
        placeId: `osm:${r.place_id}`,
        suburb: r.address?.["suburb"] ?? r.address?.["neighbourhood"] ?? null,
        city: r.address?.["city"] ?? r.address?.["town"] ?? null,
        postalCode: r.address?.["postcode"] ?? null,
      }));
    } catch (err) {
      this.logger.warn({ err }, "nominatim geocode failed");
      return [];
    }
  }

  async routeLegsKm(points: LatLng[]): Promise<number[]> {
    return fallbackLegs(points, this.roadFactorBps);
  }
}
