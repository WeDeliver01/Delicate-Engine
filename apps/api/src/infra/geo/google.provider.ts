import { PinoLogger } from "nestjs-pino";
import { haversineKm, type GeocodeSuggestion, type LatLng } from "@delicate/contracts";
import type { GeoProvider } from "./geo.provider.js";

/**
 * Google Maps Platform: Places (New) text search for geocoding, Routes API for road distance.
 * Requires GOOGLE_MAPS_API_KEY with Places API (New) and Routes API enabled. Results are
 * biased to Gauteng. Any API failure falls back to straight-line × road factor for that call
 * so a Google outage degrades quotes rather than blocking bookings.
 */
export class GoogleGeoProvider implements GeoProvider {
  readonly name = "google";

  constructor(
    private readonly apiKey: string,
    private readonly roadFactorBps: number,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(GoogleGeoProvider.name);
  }

  async geocode(query: string, limit = 5): Promise<GeocodeSuggestion[]> {
    const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-Goog-Api-Key": this.apiKey,
        "X-Goog-FieldMask":
          "places.id,places.formattedAddress,places.location,places.addressComponents",
      },
      body: JSON.stringify({
        textQuery: query,
        regionCode: "ZA",
        languageCode: "en",
        pageSize: limit,
        locationBias: {
          rectangle: {
            low: { latitude: -26.6, longitude: 27.6 },
            high: { latitude: -25.3, longitude: 28.9 },
          },
        },
      }),
    });
    if (!res.ok) {
      this.logger.warn({ status: res.status }, "places search failed");
      return [];
    }
    const body = (await res.json()) as {
      places?: {
        id: string;
        formattedAddress: string;
        location: { latitude: number; longitude: number };
        addressComponents?: { longText: string; types: string[] }[];
      }[];
    };
    return (body.places ?? []).map((p) => {
      const comp = (type: string) =>
        p.addressComponents?.find((c) => c.types.includes(type))?.longText ?? null;
      return {
        formatted: p.formattedAddress,
        location: { lat: p.location.latitude, lng: p.location.longitude },
        placeId: p.id,
        suburb: comp("sublocality") ?? comp("sublocality_level_1"),
        city: comp("locality"),
        postalCode: comp("postal_code"),
      };
    });
  }

  async routeLegsKm(points: LatLng[]): Promise<number[]> {
    if (points.length < 2) return [];
    const [origin, ...rest] = points;
    const destination = rest[rest.length - 1]!;
    const intermediates = rest.slice(0, -1);
    try {
      const res = await fetch("https://routes.googleapis.com/directions/v2:computeRoutes", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "X-Goog-Api-Key": this.apiKey,
          "X-Goog-FieldMask": "routes.legs.distanceMeters",
        },
        body: JSON.stringify({
          origin: toWaypoint(origin!),
          destination: toWaypoint(destination),
          intermediates: intermediates.map(toWaypoint),
          travelMode: "DRIVE",
          routingPreference: "TRAFFIC_UNAWARE",
          regionCode: "ZA",
        }),
      });
      if (!res.ok) throw new Error(`routes api ${res.status}`);
      const body = (await res.json()) as { routes?: { legs: { distanceMeters: number }[] }[] };
      const legs = body.routes?.[0]?.legs;
      if (!legs || legs.length !== points.length - 1) throw new Error("unexpected legs");
      return legs.map((l) => Math.round(l.distanceMeters / 10) / 100);
    } catch (err) {
      this.logger.warn({ err }, "routes api failed; using straight-line fallback");
      return fallbackLegs(points, this.roadFactorBps);
    }
  }
}

function toWaypoint(p: LatLng) {
  return { location: { latLng: { latitude: p.lat, longitude: p.lng } } };
}

export function fallbackLegs(points: LatLng[], roadFactorBps: number): number[] {
  const legs: number[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const straight = haversineKm(points[i]!, points[i + 1]!);
    legs.push(Math.round(straight * (roadFactorBps / 10_000) * 100) / 100);
  }
  return legs;
}
