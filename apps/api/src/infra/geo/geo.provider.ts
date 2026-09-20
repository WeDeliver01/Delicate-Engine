import type { GeocodeSuggestion, LatLng } from "@delicate/contracts";

/**
 * Geocoding + road distance behind one interface, so the quote engine never knows which
 * provider produced the numbers (it only records the provider name for audit).
 */
export interface GeoProvider {
  readonly name: string;
  /** Address autocomplete / lookup. Returns up to `limit` candidates, best first. */
  geocode(query: string, limit?: number): Promise<GeocodeSuggestion[]>;
  /** Road distance for consecutive legs of a route, in km. Returns one number per leg. */
  routeLegsKm(points: LatLng[]): Promise<number[]>;
}

export const GEO_PROVIDER = Symbol("GEO_PROVIDER");
