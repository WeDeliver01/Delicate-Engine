export interface GeoPoint {
  lat: number;
  lng: number;
}

export function haversine(a: GeoPoint, b: GeoPoint): number {
  const R = 6371;
  const dLa = ((b.lat - a.lat) * Math.PI) / 180;
  const dLo = ((b.lng - a.lng) * Math.PI) / 180;
  const x = Math.sin(dLa / 2) * Math.sin(dLa / 2) +
    Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) *
    Math.sin(dLo / 2) * Math.sin(dLo / 2);
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

export interface DriveResult {
  km: number;
  min: number;
}

function trafficMultiplier(departMin: number | null | undefined, km: number): number {
  let mult = 1.0;
  if (departMin != null) {
    const isMorningRush = departMin >= 375 && departMin <= 525;
    const isEveningRush = departMin >= 915 && departMin <= 1065;
    const isMidRush = departMin >= 690 && departMin <= 810;
    if (isMorningRush || isEveningRush) {
      if (km > 40) mult = 0.72;
      else if (km > 15) mult = 0.65;
      else mult = 0.68;
    } else if (isMidRush) {
      if (km > 15) mult = 0.85;
      else mult = 0.82;
    }
  }
  return mult;
}

export function calcDrive(
  from: GeoPoint | null,
  to: GeoPoint | null,
  departMin?: number | null,
  observedKmh?: number | null,
): DriveResult {
  if (!from || !to || !from.lat || !to.lat) return { km: 0, min: 3 };
  const s = haversine(from, to);
  let f: number;
  if (s < 3) f = 1.55;
  else if (s < 8) f = 1.45;
  else if (s < 18) f = 1.38;
  else if (s < 35) f = 1.30;
  else if (s < 60) f = 1.22;
  else f = 1.18;
  const km = Math.round(s * f * 10) / 10;
  let sp: number;
  if (km < 4) sp = 25;
  else if (km < 10) sp = 35;
  else if (km < 20) sp = 42;
  else if (km < 40) sp = 55;
  else if (km < 70) sp = 65;
  else sp = 70;

  sp *= trafficMultiplier(departMin, km);

  if (observedKmh != null && observedKmh >= 5 && observedKmh <= 130) {
    const blended = observedKmh * 0.6 + sp * 0.4;
    sp = Math.max(sp * 0.5, Math.min(sp * 2.0, blended));
  }

  const rawMin = km / sp * 60;
  const min = Math.max(Math.round(rawMin) + 2, 3);
  return { km, min };
}

export function currentTimeMinutes(): number {
  const sa = new Date().toLocaleTimeString("en-ZA", { timeZone: "Africa/Johannesburg", hour12: false, hour: "2-digit", minute: "2-digit" });
  const [h, m] = sa.split(":").map(Number);
  return h * 60 + m;
}

export function svcTime(type: string, pcs: number): number {
  if (type === "C") return Math.min(15, Math.max(5, 5 + Math.ceil(pcs * 1.5)));
  return Math.min(15, Math.max(3, 3 + pcs));
}

export function toM(t: string | null | undefined): number | null {
  if (!t) return null;
  const p = String(t).split(":");
  return (parseInt(p[0]) || 0) * 60 + (parseInt(p[1]) || 0);
}

export function fmM(m: number | null): string {
  if (m == null) return "--:--";
  return String(Math.floor(m / 60)).padStart(2, "0") + ":" + String(Math.round(m % 60)).padStart(2, "0");
}
