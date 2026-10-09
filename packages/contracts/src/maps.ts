import type { LatLng } from "./dto/geo.js";

/**
 * A link to a point on a map, for an email or an SMS.
 *
 * A link rather than an embedded picture of a map: a static map image costs an API call for
 * every message and a monthly quota, where the link is free and opens in whatever the reader
 * already has installed. Google's `search` form is used because it resolves on every platform
 * — iOS, Android and the desktop web all honour it — while `geo:` and `maps:` URIs are ignored
 * by mail clients.
 */
export function mapsUrl(at: LatLng): string {
  return `https://www.google.com/maps/search/?api=1&query=${at.lat},${at.lng}`;
}
