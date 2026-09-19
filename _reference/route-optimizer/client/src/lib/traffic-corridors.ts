export interface CorridorProbe {
  id: string;
  name: string;
  description: string;
  altRoute: string;
  originLat: number;
  originLng: number;
  destLat: number;
  destLng: number;
  altOriginLat: number;
  altOriginLng: number;
  altDestLat: number;
  altDestLng: number;
}

export const CORRIDOR_PROBES: CorridorProbe[] = [
  { id: "n1_south", name: "N1 South", description: "Centurion to Hatfield via N1", altRoute: "Lynnwood Rd via Menlyn", originLat: -25.8603, originLng: 28.1894, destLat: -25.7475, destLng: 28.2360, altOriginLat: -25.8310, altOriginLng: 28.3200, altDestLat: -25.7700, altDestLng: 28.2800 },
  { id: "n4_west", name: "N4 West / Rosslyn", description: "Rosslyn to Pretoria North via N4", altRoute: "Rachel De Beer St", originLat: -25.6730, originLng: 28.0750, destLat: -25.6950, destLng: 28.2100, altOriginLat: -25.6700, altOriginLng: 28.1200, altDestLat: -25.7100, altDestLng: 28.1880 },
  { id: "garsfontein", name: "Garsfontein Rd", description: "Atterbury to Lynnwood via Garsfontein Rd", altRoute: "De Villebois Mareuil Dr", originLat: -25.7830, originLng: 28.2780, destLat: -25.7700, destLng: 28.2800, altOriginLat: -25.8050, altOriginLng: 28.3020, altDestLat: -25.7650, altDestLng: 28.3100 },
  { id: "r21", name: "R21 Airport", description: "R21 Irene to Silverton", altRoute: "Simon Vermooten Rd", originLat: -25.8680, originLng: 28.2450, destLat: -25.7370, destLng: 28.3020, altOriginLat: -25.8720, altOriginLng: 28.2200, altDestLat: -25.7650, altDestLng: 28.3100 },
  { id: "church_st", name: "Church St CBD", description: "Church St through Pretoria CBD", altRoute: "Stanza Bopape / Steve Biko", originLat: -25.7460, originLng: 28.1880, destLat: -25.7475, destLng: 28.2360, altOriginLat: -25.7450, altOriginLng: 28.1500, altDestLat: -25.7475, altDestLng: 28.2360 },
  { id: "n14", name: "N14 Centurion", description: "N14 Centurion to Midrand", altRoute: "R101 Old Johannesburg Rd", originLat: -25.8550, originLng: 28.1600, destLat: -25.9870, destLng: 28.1270, altOriginLat: -25.8603, altOriginLng: 28.1894, altDestLat: -25.9870, altDestLng: 28.1270 },
  { id: "zambezi", name: "Zambezi Dr", description: "Zambezi Dr to Montana Park", altRoute: "Atterbury Rd to Simon Vermooten", originLat: -25.6800, originLng: 28.1950, destLat: -25.6890, destLng: 28.2100, altOriginLat: -25.6950, altOriginLng: 28.2100, altDestLat: -25.6890, altDestLng: 28.2100 },
];

// --- Geographic matching helpers --------------------------------------------------

// Convert lat/lng to local planar km using equirectangular approximation
// good enough for short distances at South African latitudes.
function llToXY(lat: number, lng: number, refLat: number): [number, number] {
  const k = Math.cos((refLat * Math.PI) / 180);
  return [lng * 111.32 * k, lat * 111.32];
}

function distanceToSegmentKm(
  plat: number,
  plng: number,
  alat: number,
  alng: number,
  blat: number,
  blng: number,
): number {
  const ref = (alat + blat) / 2;
  const [px, py] = llToXY(plat, plng, ref);
  const [ax, ay] = llToXY(alat, alng, ref);
  const [bx, by] = llToXY(blat, blng, ref);
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * dx;
  const cy = ay + t * dy;
  return Math.hypot(px - cx, py - cy);
}

function distanceToPolylineKm(
  plat: number,
  plng: number,
  poly: ReadonlyArray<[number, number]>,
): number {
  let min = Infinity;
  for (let i = 1; i < poly.length; i++) {
    const [alat, alng] = poly[i - 1];
    const [blat, blng] = poly[i];
    const d = distanceToSegmentKm(plat, plng, alat, alng, blat, blng);
    if (d < min) min = d;
  }
  return min === Infinity ? 0 : min;
}

function samplePolyline(
  poly: ReadonlyArray<[number, number]>,
  maxSamples = 14,
): Array<[number, number]> {
  if (poly.length === 0) return [];
  if (poly.length <= maxSamples) return poly.map((p) => [p[0], p[1]] as [number, number]);
  const step = (poly.length - 1) / (maxSamples - 1);
  const out: Array<[number, number]> = [];
  for (let i = 0; i < maxSamples; i++) {
    const idx = Math.round(i * step);
    out.push([poly[idx][0], poly[idx][1]]);
  }
  return out;
}

function median(values: number[]): number {
  if (values.length === 0) return Infinity;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/**
 * Decode a Google/OSRM encoded polyline string into [lat, lng] pairs.
 * Lives here so both the matcher and UI consumers can share it.
 */
export function decodePolyline(str: string, precision = 5): Array<[number, number]> {
  let index = 0, lat = 0, lng = 0;
  const coords: Array<[number, number]> = [];
  const factor = Math.pow(10, precision);
  while (index < str.length) {
    let b: number, shift = 0, result = 0;
    do { b = str.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
    lat += (result & 1) ? ~(result >> 1) : (result >> 1);
    shift = 0; result = 0;
    do { b = str.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
    lng += (result & 1) ? ~(result >> 1) : (result >> 1);
    coords.push([lat / factor, lng / factor]);
  }
  return coords;
}

export interface NearestCorridorOptions {
  /** Sampled OSRM-decoded road polyline for the driver leg, when available. */
  legPolyline?: ReadonlyArray<[number, number]>;
  /** Real road polylines for corridors, keyed by corridor id. */
  corridorPolylines?: ReadonlyMap<string, ReadonlyArray<[number, number]>>;
  /** Override the match threshold (km). Defaults: 1.2 with polylines, 3 without. */
  maxKm?: number;
}

/**
 * Find the corridor probe that the given driver leg most likely runs on.
 *
 * When `options.legPolyline` is provided, samples ~14 points along the actual
 * OSRM road geometry and measures distance to each corridor's real polyline
 * (when available in `options.corridorPolylines`) or falls back to the
 * corridor's straight origin->destination segment. The match metric is the
 * median sample distance, which tolerates brief detours through interchanges
 * but rejects suburban side-road legs.
 *
 * When no leg polyline is available it preserves the original behaviour:
 * three straight-line samples (start, mid, end) measured against the
 * corridor's straight segment, taking the worst sample distance.
 */
export function nearestCorridor(
  fromLat: number,
  fromLng: number,
  toLat: number,
  toLng: number,
  options?: NearestCorridorOptions | number,
): CorridorProbe | null {
  if (![fromLat, fromLng, toLat, toLng].every(Number.isFinite)) return null;

  const opts: NearestCorridorOptions =
    typeof options === "number" ? { maxKm: options } : options ?? {};

  const haveLegPoly = !!(opts.legPolyline && opts.legPolyline.length >= 2);
  const polySamples: Array<[number, number]> | null = haveLegPoly
    ? samplePolyline(opts.legPolyline!)
    : null;
  const straightSamples: Array<[number, number]> = [
    [fromLat, fromLng],
    [(fromLat + toLat) / 2, (fromLng + toLng) / 2],
    [toLat, toLng],
  ];

  // Tighter threshold when matching real road geometry on both sides:
  // OSRM polylines hug the actual road, so legs that genuinely run on a
  // corridor sit within ~1km. The legacy 3km worst-sample threshold is
  // kept whenever either side falls back to a straight segment.
  const polyMaxKm = opts.maxKm ?? 1.2;
  const straightMaxKm = opts.maxKm ?? 3;

  type Candidate = { corridor: CorridorProbe; metric: number; threshold: number; usePolyMode: boolean };
  let best: Candidate | null = null;
  for (const c of CORRIDOR_PROBES) {
    const cpoly = opts.corridorPolylines?.get(c.id);
    const haveCorPoly = !!(cpoly && cpoly.length >= 2);
    // Only switch to polyline mode for this candidate when BOTH the leg
    // and the corridor have real road geometry. If either is missing we
    // fall back to the legacy 3-sample / worst-distance / 3km / straight-
    // segment behaviour for that candidate so legs are not unfairly
    // disqualified and fallback exactly reproduces the original matcher.
    const usePolyMode = haveLegPoly && haveCorPoly;
    const samples = usePolyMode ? polySamples! : straightSamples;
    const distances: number[] = [];
    for (const [lat, lng] of samples) {
      const d = usePolyMode
        ? distanceToPolylineKm(lat, lng, cpoly!)
        : distanceToSegmentKm(lat, lng, c.originLat, c.originLng, c.destLat, c.destLng);
      distances.push(d);
    }
    // Median is robust to brief off-corridor segments (entry/exit ramps)
    // when we have many real samples. Worst preserves the original strict
    // behaviour for the 3-straight-sample fallback.
    const metric = usePolyMode ? median(distances) : Math.max(...distances);
    const threshold = usePolyMode ? polyMaxKm : straightMaxKm;
    const candidate: Candidate = { corridor: c, metric, threshold, usePolyMode };
    if (!best || preferCandidate(candidate, best)) {
      best = candidate;
    }
  }
  return best && best.metric <= best.threshold ? best.corridor : null;
}

/**
 * Pick between two corridor candidates. Polyline-mode candidates that
 * pass their tight threshold always beat straight-line candidates, even
 * mid-load when only some corridors have road geometry yet. Within the
 * same mode, the smaller metric wins; across modes when neither has a
 * polyline pass, we fall back to threshold-normalised distance so a tight
 * straight match beats a loose one.
 */
function preferCandidate(a: { metric: number; threshold: number; usePolyMode: boolean }, b: { metric: number; threshold: number; usePolyMode: boolean }): boolean {
  const aPolyHit = a.usePolyMode && a.metric <= a.threshold;
  const bPolyHit = b.usePolyMode && b.metric <= b.threshold;
  if (aPolyHit && !bPolyHit) return true;
  if (bPolyHit && !aPolyHit) return false;
  if (a.usePolyMode === b.usePolyMode) return a.metric < b.metric;
  return a.metric / a.threshold < b.metric / b.threshold;
}

export interface CorridorTrafficResult {
  corridorId: string;
  mainRoute: { durationMin: number; distanceKm: number; congestion: string; delayMin: number } | null;
  altRoute: { durationMin: number; distanceKm: number; congestion: string; delayMin: number } | null;
  error?: string;
}

export interface KnownIncident {
  id: string;
  type: "closure" | "construction" | "incident";
  corridor: string;
  location: string;
  description: string;
  severity: "high" | "medium" | "low";
  timeRestriction?: string;
  detour?: string;
  affectedSuburbs: string[];
}

export const PRETORIA_KNOWN_INCIDENTS: KnownIncident[] = [
  { id: "inc_1", type: "construction", corridor: "N1 South", location: "Solomon Mahlangu Dr interchange", description: "Ongoing interchange upgrade — lane reductions during peak hours", severity: "high", timeRestriction: "06:00-09:00, 15:30-18:30", detour: "Use Lynnwood Rd via Menlyn or Simon Vermooten", affectedSuburbs: ["centurion", "lyttelton", "wierdapark"] },
  { id: "inc_2", type: "construction", corridor: "N14", location: "N14/N1 Centurion interchange", description: "Bridge widening project — reduced lanes and temporary barriers", severity: "medium", timeRestriction: "All day, worse during peak", detour: "R101 Old Johannesburg Rd", affectedSuburbs: ["centurion", "midrand"] },
  { id: "inc_3", type: "closure", corridor: "Church St CBD", location: "Church St between Paul Kruger & Nelson Mandela", description: "Periodic road closures for BRT construction and cable maintenance", severity: "medium", timeRestriction: "Weekdays 08:00-16:00", detour: "Stanza Bopape St or Pretorius St", affectedSuburbs: ["pretoria central", "sunnyside"] },
  { id: "inc_4", type: "incident", corridor: "Garsfontein Rd", location: "Garsfontein & Atterbury intersection", description: "Frequent accidents at this intersection — exercise caution", severity: "low", detour: "De Villebois Mareuil Dr via Woodlands", affectedSuburbs: ["garsfontein", "moreleta park", "faerie glen"] },
  { id: "inc_5", type: "construction", corridor: "R21", location: "R21 between Hans Strijdom & N1", description: "Road surface rehabilitation — speed restrictions 60km/h", severity: "medium", timeRestriction: "Ongoing", detour: "Simon Vermooten Rd or Hans Strijdom Dr", affectedSuburbs: ["irene", "rooihuiskraal", "erasmuskloof"] },
  { id: "inc_6", type: "closure", corridor: "Zambezi Dr", location: "Zambezi Dr near school zones", description: "Temporary road closures during school drop-off/pick-up times", severity: "low", timeRestriction: "07:00-08:00, 13:30-14:30", detour: "Brits Rd to N4", affectedSuburbs: ["montana", "sinoville", "zambezi"] },
  { id: "inc_7", type: "incident", corridor: "N4 West", location: "N4 Quagga Rd off-ramp", description: "Heavy truck area — frequent slow-downs and minor collisions", severity: "low", detour: "Lavender Rd or Rachel De Beer St", affectedSuburbs: ["rosslyn", "akasia", "karenpark"] },
];
