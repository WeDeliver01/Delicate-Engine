export const API_TYPES = {
  ROUTES_TRAFFIC: "routes_traffic",
  ROUTES_TRAFFIC_BATCH: "routes_traffic_batch",
  ROUTES_DRIVER_ETA: "routes_driver_eta",
  ROUTES_POLYLINE: "routes_polyline",
  PLACES_AUTOCOMPLETE: "places_autocomplete",
  PLACES_DETAILS: "places_details",
  PLACES_GEOCODE: "places_geocode",
  ROUTES_DISPATCHER_ETA: "routes_dispatcher_eta",
} as const;

interface ApiCallRecord {
  apiType: string;
  cacheHit: boolean;
  timestamp: number;
  error?: boolean;
}

interface ApiCallCount {
  total: number;
  cacheHits: number;
  errors: number;
  billable: number;
}

const MAX_RECENT_RECORDS = 200;
const recentCalls: ApiCallRecord[] = [];
const dailyCounts = new Map<string, ApiCallCount>();
let currentDay = "";

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

function ensureDay() {
  const day = todayKey();
  if (day !== currentDay) {
    dailyCounts.clear();
    recentCalls.length = 0;
    currentDay = day;
  }
}

function getCounter(apiType: string): ApiCallCount {
  ensureDay();
  if (!dailyCounts.has(apiType)) {
    dailyCounts.set(apiType, { total: 0, cacheHits: 0, errors: 0, billable: 0 });
  }
  return dailyCounts.get(apiType)!;
}

function logApiCall(apiType: string, cacheHit: boolean) {
  const c = getCounter(apiType);
  c.total++;
  if (cacheHit) {
    c.cacheHits++;
  } else {
    c.billable++;
  }
  const record: ApiCallRecord = { apiType, cacheHit, timestamp: Date.now() };
  recentCalls.push(record);
  if (recentCalls.length > MAX_RECENT_RECORDS) recentCalls.shift();
}

function logApiError(apiType: string) {
  const c = getCounter(apiType);
  c.errors++;
  const record: ApiCallRecord = { apiType, cacheHit: false, timestamp: Date.now(), error: true };
  recentCalls.push(record);
  if (recentCalls.length > MAX_RECENT_RECORDS) recentCalls.shift();
}

export function getUsageReport() {
  ensureDay();
  const summary: Record<string, ApiCallCount> = {};
  for (const [type, counts] of dailyCounts) {
    summary[type] = { ...counts };
  }
  const recent = recentCalls.slice(-50).map(r => ({
    type: r.apiType,
    cached: r.cacheHit,
    error: r.error || false,
    time: new Date(r.timestamp).toISOString(),
  }));
  return { summary, recent };
}

interface TtlCacheEntry<T> {
  data: T;
  expiresAt: number;
}

function ttlGet<T>(cache: Map<string, TtlCacheEntry<T>>, key: string): T | undefined {
  const entry = cache.get(key);
  if (entry && entry.expiresAt > Date.now()) return entry.data;
  if (entry) cache.delete(key);
  return undefined;
}

function ttlSet<T>(cache: Map<string, TtlCacheEntry<T>>, key: string, data: T, ttlMs: number, maxSize: number) {
  cache.set(key, { data, expiresAt: Date.now() + ttlMs });
  if (cache.size > maxSize) {
    const now = Date.now();
    for (const [k, v] of cache) {
      if (v.expiresAt < now) cache.delete(k);
    }
  }
}

const inflight = new Map<string, Promise<any>>();

function routesDedupeKey(
  oLat: number, oLng: number, dLat: number, dLng: number, fieldMask: string,
  departureTime?: string, routingPreference?: string
): string {
  const dep = departureTime ? departureTime.slice(0, 16) : "";
  const rp = routingPreference || "TA";
  return `r:${oLat.toFixed(4)},${oLng.toFixed(4)}|${dLat.toFixed(4)},${dLng.toFixed(4)}|${fieldMask.slice(0, 30)}|${dep}|${rp}`;
}

export async function callGoogleRoutesAPI(
  originLat: number,
  originLng: number,
  destLat: number,
  destLng: number,
  opts?: {
    departureTime?: string;
    fieldMask?: string;
    routingPreference?: string;
    apiType?: string;
  }
): Promise<any> {
  const apiKey = process.env.GOOGLE_ROUTES_API_KEY;
  if (!apiKey) throw new Error("GOOGLE_ROUTES_API_KEY not configured");

  const apiType = opts?.apiType || API_TYPES.ROUTES_TRAFFIC;
  const fieldMask = opts?.fieldMask || [
    "routes.duration",
    "routes.staticDuration",
    "routes.distanceMeters",
    "routes.legs.duration",
    "routes.legs.staticDuration",
    "routes.legs.distanceMeters",
  ].join(",");
  const routingPref = opts?.routingPreference || "TRAFFIC_AWARE";

  const dedupeKey = routesDedupeKey(originLat, originLng, destLat, destLng, fieldMask, opts?.departureTime, routingPref);
  const existing = inflight.get(dedupeKey);
  if (existing) {
    logApiCall(apiType, true);
    return existing;
  }

  logApiCall(apiType, false);

  const body: any = {
    origin: { location: { latLng: { latitude: originLat, longitude: originLng } } },
    destination: { location: { latLng: { latitude: destLat, longitude: destLng } } },
    travelMode: "DRIVE",
    routingPreference: routingPref,
    computeAlternativeRoutes: false,
    languageCode: "en-ZA",
    units: "METRIC",
  };

  if (opts?.departureTime) {
    const depDate = new Date(opts.departureTime);
    if (depDate > new Date()) {
      body.departureTime = opts.departureTime;
    }
  }

  const promise = (async () => {
    try {
      const response = await fetch(
        "https://routes.googleapis.com/directions/v2:computeRoutes",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Goog-Api-Key": apiKey,
            "X-Goog-FieldMask": fieldMask,
          },
          body: JSON.stringify(body),
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[Google Routes API] Error: ${response.status}`, errorText);
        throw new Error(`Google Routes API error: ${response.status}`);
      }

      return await response.json();
    } catch (err) {
      logApiError(apiType);
      throw err;
    } finally {
      inflight.delete(dedupeKey);
    }
  })();

  inflight.set(dedupeKey, promise);
  return promise;
}

export function parseGoogleRoute(data: any): {
  distanceKm: number;
  durationMin: number;
  staticDurationMin: number;
  trafficDelayMin: number;
  congestionLevel: "NORMAL" | "SLOW" | "HEAVY" | "STANDSTILL";
  speedReadings: Array<{ speed: string; fraction: number }>;
} {
  const route = data.routes?.[0];
  if (!route) {
    return { distanceKm: 0, durationMin: 0, staticDurationMin: 0, trafficDelayMin: 0, congestionLevel: "NORMAL", speedReadings: [] };
  }

  const distanceMeters = route.distanceMeters || 0;
  const distanceKm = Math.round(distanceMeters / 100) / 10;
  const durationSec = parseInt(String(route.duration || "0s").replace("s", ""));
  const durationMin = Math.round(durationSec / 60 * 10) / 10;
  const staticSec = parseInt(String(route.staticDuration || "0s").replace("s", ""));
  const staticDurationMin = Math.round(staticSec / 60 * 10) / 10;
  const trafficDelayMin = Math.max(0, Math.round((durationMin - staticDurationMin) * 10) / 10);

  let congestionLevel: "NORMAL" | "SLOW" | "HEAVY" | "STANDSTILL" = "NORMAL";
  const delayRatio = staticDurationMin > 0 ? trafficDelayMin / staticDurationMin : 0;
  if (delayRatio > 0.5) congestionLevel = "STANDSTILL";
  else if (delayRatio > 0.3) congestionLevel = "HEAVY";
  else if (delayRatio > 0.1) congestionLevel = "SLOW";

  return { distanceKm, durationMin, staticDurationMin, trafficDelayMin, congestionLevel, speedReadings: [] };
}

const autocompleteCache = new Map<string, TtlCacheEntry<any>>();
const AUTOCOMPLETE_CACHE_TTL = 5 * 60 * 1000;
const geocodeCache = new Map<string, TtlCacheEntry<any>>();
const GEOCODE_CACHE_TTL = 24 * 60 * 60 * 1000;
const placeDetailsCache = new Map<string, TtlCacheEntry<any>>();
const PLACE_DETAILS_CACHE_TTL = 24 * 60 * 60 * 1000;

const placesInflight = new Map<string, Promise<any>>();

export async function callPlacesAutocomplete(input: string, sessionToken?: string): Promise<any> {
  const apiKey = process.env.GOOGLE_ROUTES_API_KEY;
  if (!apiKey) throw new Error("GOOGLE_ROUTES_API_KEY not configured");

  const cacheKey = input.toLowerCase().trim();
  const cached = ttlGet(autocompleteCache, cacheKey);
  if (cached) {
    logApiCall(API_TYPES.PLACES_AUTOCOMPLETE, true);
    return cached;
  }

  const dedupeKey = `ac:${cacheKey}:${sessionToken || ""}`;
  const existing = placesInflight.get(dedupeKey);
  if (existing) {
    logApiCall(API_TYPES.PLACES_AUTOCOMPLETE, true);
    return existing;
  }

  logApiCall(API_TYPES.PLACES_AUTOCOMPLETE, false);

  const body: any = {
    input,
    locationBias: {
      circle: {
        center: { latitude: -25.75, longitude: 28.18 },
        radius: 50000.0,
      },
    },
    includedRegionCodes: ["ZA"],
    languageCode: "en",
  };
  if (sessionToken) body.sessionToken = sessionToken;

  const promise = (async () => {
    try {
      const response = await fetch("https://places.googleapis.com/v1/places:autocomplete", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": apiKey,
        },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        const errorText = await response.text();
        console.error("[Google Places Autocomplete] Error:", response.status, errorText);
        throw new Error(`Google Places Autocomplete error: ${response.status}`);
      }
      const data = await response.json();
      ttlSet(autocompleteCache, cacheKey, data, AUTOCOMPLETE_CACHE_TTL, 200);
      return data;
    } catch (err) {
      logApiError(API_TYPES.PLACES_AUTOCOMPLETE);
      throw err;
    } finally {
      placesInflight.delete(dedupeKey);
    }
  })();

  placesInflight.set(dedupeKey, promise);
  return promise;
}

export async function callPlacesGeocode(address: string): Promise<any> {
  const apiKey = process.env.GOOGLE_ROUTES_API_KEY;
  if (!apiKey) throw new Error("GOOGLE_ROUTES_API_KEY not configured");

  const cacheKey = address.toLowerCase().trim();
  const cached = ttlGet(geocodeCache, cacheKey);
  if (cached) {
    logApiCall(API_TYPES.PLACES_GEOCODE, true);
    return cached;
  }

  const dedupeKey = `geo:${cacheKey}`;
  const existing = placesInflight.get(dedupeKey);
  if (existing) {
    logApiCall(API_TYPES.PLACES_GEOCODE, true);
    return existing;
  }

  logApiCall(API_TYPES.PLACES_GEOCODE, false);

  const promise = (async () => {
    try {
      const response = await fetch("https://places.googleapis.com/v1/places:searchText", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": apiKey,
          "X-Goog-FieldMask": "places.location,places.formattedAddress,places.displayName",
        },
        body: JSON.stringify({
          textQuery: address,
          maxResultCount: 1,
          regionCode: "ZA",
          languageCode: "en",
        }),
      });
      if (!response.ok) {
        const errorText = await response.text();
        console.error("[Google Places Geocode] Error:", response.status, errorText);
        throw new Error(`Google Places Geocode error: ${response.status}`);
      }
      const data = await response.json();
      ttlSet(geocodeCache, cacheKey, data, GEOCODE_CACHE_TTL, 500);
      return data;
    } catch (err) {
      logApiError(API_TYPES.PLACES_GEOCODE);
      throw err;
    } finally {
      placesInflight.delete(dedupeKey);
    }
  })();

  placesInflight.set(dedupeKey, promise);
  return promise;
}

export async function callPlaceDetails(placeId: string, sessionToken?: string): Promise<any> {
  const apiKey = process.env.GOOGLE_ROUTES_API_KEY;
  if (!apiKey) throw new Error("GOOGLE_ROUTES_API_KEY not configured");

  const cached = ttlGet(placeDetailsCache, placeId);
  if (cached) {
    logApiCall(API_TYPES.PLACES_DETAILS, true);
    return cached;
  }

  const dedupeKey = `det:${placeId}:${sessionToken || ""}`;
  const existing = placesInflight.get(dedupeKey);
  if (existing) {
    logApiCall(API_TYPES.PLACES_DETAILS, true);
    return existing;
  }

  logApiCall(API_TYPES.PLACES_DETAILS, false);

  const promise = (async () => {
    try {
      const fieldMask = "id,displayName,formattedAddress,location";
      let url = `https://places.googleapis.com/v1/places/${placeId}`;
      if (sessionToken) url += `?sessionToken=${encodeURIComponent(sessionToken)}`;

      const response = await fetch(url, {
        method: "GET",
        headers: {
          "X-Goog-Api-Key": apiKey,
          "X-Goog-FieldMask": fieldMask,
        },
      });
      if (!response.ok) {
        const errorText = await response.text();
        console.error("[Google Places Details] Error:", response.status, errorText);
        throw new Error(`Google Places Details error: ${response.status}`);
      }
      const data = await response.json();
      ttlSet(placeDetailsCache, placeId, data, PLACE_DETAILS_CACHE_TTL, 500);
      return data;
    } catch (err) {
      logApiError(API_TYPES.PLACES_DETAILS);
      throw err;
    } finally {
      placesInflight.delete(dedupeKey);
    }
  })();

  placesInflight.set(dedupeKey, promise);
  return promise;
}

export async function callGoogleRoutesMultiWaypoint(
  waypoints: Array<{ lat: number; lng: number }>,
  opts?: { apiType?: string }
): Promise<any> {
  const apiKey = process.env.GOOGLE_ROUTES_API_KEY;
  if (!apiKey) throw new Error("GOOGLE_ROUTES_API_KEY not configured");
  if (waypoints.length < 2) throw new Error("Need at least 2 waypoints");

  const apiType = opts?.apiType || API_TYPES.ROUTES_POLYLINE;
  logApiCall(apiType, false);

  const origin = { location: { latLng: { latitude: waypoints[0].lat, longitude: waypoints[0].lng } } };
  const destination = { location: { latLng: { latitude: waypoints[waypoints.length - 1].lat, longitude: waypoints[waypoints.length - 1].lng } } };
  const intermediates = waypoints.slice(1, -1).map(w => ({
    location: { latLng: { latitude: w.lat, longitude: w.lng } },
  }));
  const body: any = { origin, destination, travelMode: "DRIVE" };
  if (intermediates.length > 0) body.intermediates = intermediates;

  try {
    const response = await fetch("https://routes.googleapis.com/directions/v2:computeRoutes", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": "routes.polyline.encodedPolyline",
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const errorText = await response.text();
      console.error("[Google Routes Multi-Waypoint] Error:", response.status, errorText);
      throw new Error(`Google Routes API error: ${response.status}`);
    }
    return await response.json();
  } catch (err) {
    logApiError(apiType);
    throw err;
  }
}

export function getCacheSizes() {
  return {
    autocomplete: autocompleteCache.size,
    geocode: geocodeCache.size,
    placeDetails: placeDetailsCache.size,
    inflight: inflight.size + placesInflight.size,
  };
}
