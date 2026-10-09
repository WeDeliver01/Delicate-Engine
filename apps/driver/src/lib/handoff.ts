/**
 * Links that hand a job to whatever app the driver already uses.
 *
 * Strings in, strings out, and the platform passed in rather than read from `react-native`:
 * every one of these has a platform quirk that is otherwise only discovered on a phone at the
 * roadside, which is the worst place to discover anything. Keeping the module free of native
 * imports is what lets the quirks be tested at all.
 */

export type DevicePlatform = "ios" | "android" | string;

export interface Place {
  lat: number;
  lng: number;
  label?: string | null;
}

/**
 * Open turn-by-turn navigation to a place.
 *
 * Coordinates rather than the address text: an address we geocoded to a point is more
 * dependable than the same words retyped into a different search engine, and a driver who ends
 * up at the wrong Oak Street has lost twenty minutes.
 *
 * Apple Maps on iOS and Google Maps elsewhere, both through their documented URL schemes so
 * neither app has to be installed for the link to resolve to something.
 */
export function navigationUrl(place: Place, platform: DevicePlatform): string {
  const coords = `${place.lat},${place.lng}`;
  if (platform === "ios") {
    const label = place.label ? `&q=${encodeURIComponent(place.label)}` : "";
    return `maps://?daddr=${coords}&dirflg=d${label}`;
  }
  // `google.navigation:` starts guidance rather than showing a pin, which is what a driver with
  // eleven more drops wants from one tap.
  return `google.navigation:q=${coords}&mode=d`;
}

/** A web fallback, for when no maps app answers the scheme above. */
export function mapsWebUrl(place: Place): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${place.lat},${place.lng}&travelmode=driving`;
}

/** A pin rather than directions — for showing where something happened. */
export function mapsPinUrl(place: Place): string {
  return `https://www.google.com/maps/search/?api=1&query=${place.lat},${place.lng}`;
}

export function telUrl(phone: string): string {
  return `tel:${phone.replace(/[^+\d]/g, "")}`;
}

/**
 * The phone's own messaging app, pre-filled.
 *
 * iOS wants `&body=`, Android wants `?body=`, and getting it wrong does not fail loudly — it
 * opens the composer with an empty message, so the driver sends a blank text or gives up.
 */
export function smsUrl(phone: string, body: string, platform: DevicePlatform): string {
  const number = phone.replace(/[^+\d]/g, "");
  const separator = platform === "ios" ? "&" : "?";
  return `sms:${number}${separator}body=${encodeURIComponent(body)}`;
}

export function mailtoUrl(address: string, subject: string, body: string): string {
  return `mailto:${address}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
