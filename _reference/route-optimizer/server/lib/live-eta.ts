import { calcDrive, currentTimeMinutes, fmM } from "./geo";
import { firstLegEta, recentMovingSpeedKmh } from "../routes/driver";

// A single pending stop to be reached from a driver's live position. Covers
// both collection (C) and delivery (D) stops.
export interface LiveStopInput {
  key: string;
  addr: string;
  lat: number;
  lng: number;
  type: "C" | "D";
  waybills: string[];
}

// Per-stop live ETA. Shape matches the dispatcher's AllStopsEtaEntry so the
// existing UI/itinerary panel can consume it unchanged.
export interface LiveStopEta {
  stopKey: string;
  addr: string;
  lat: number;
  lng: number;
  type: "C" | "D";
  etaMin: number;
  etaClockTime: string;
  distanceFromDriverKm: number;
  legDriveMin: number;
  legDistanceKm: number;
  dwellMin: number;
  trafficDelayMin: number;
  congestionLevel: string;
  isTrafficAware: boolean;
  waybills: string[];
}

export interface LiveEtaOptions {
  dwellCollectionMin: number;
  dwellDeliveryMin: number;
  /** Override "now" (minutes since midnight, SAST) — defaults to current time. */
  nowMinutes?: number;
}

/**
 * Compute a per-stop arrival-ETA chain for a driver's remaining ordered stops,
 * grounded in the driver's LIVE GPS position.
 *
 * Cost model (matches the documented Google API cost-optimization principle):
 *   - The ACTIVE first leg (driver -> next pending stop) is traffic-aware via
 *     `firstLegEta`, which shares the 45s first-leg cache with the driver app
 *     and the position pusher — so only ONE Google Routes call per driver per
 *     cache window is made regardless of how many surfaces ask.
 *   - Every subsequent leg uses fast offline math (`calcDrive`, haversine +
 *     bucket speed blended with the driver's recently-observed GPS speed). No
 *     per-stop Google calls.
 *
 * Each stop's ETA is its ARRIVAL time (not arrival + that stop's own service
 * time), matching driver-app ETA semantics. Dwell (service) time is added to
 * the running clock only AFTER the stop, so it pushes out downstream stops.
 */
export async function computeLiveStopEtas(
  driver: { id: number; currentLat: number; currentLng: number },
  pendingStops: LiveStopInput[],
  opts: LiveEtaOptions,
): Promise<LiveStopEta[]> {
  if (pendingStops.length === 0) return [];

  const observedKmh = recentMovingSpeedKmh(driver.id);
  const nowMinutes = opts.nowMinutes ?? currentTimeMinutes();

  const result: LiveStopEta[] = [];
  let cumulativeMin = 0;
  let cumulativeKm = 0;
  let prevLat = driver.currentLat;
  let prevLng = driver.currentLng;

  for (let i = 0; i < pendingStops.length; i++) {
    const stop = pendingStops[i];

    let legDriveMin: number;
    let legDistanceKm: number;
    let trafficDelayMin = 0;
    let congestionLevel = "UNKNOWN";
    let isTrafficAware = false;

    if (i === 0) {
      // Active leg: traffic-aware Google (shared 45s cache).
      const leg = await firstLegEta(
        driver.id,
        prevLat, prevLng,
        stop.lat, stop.lng,
        stop.key,
        observedKmh,
        nowMinutes,
      );
      legDriveMin = leg.min;
      legDistanceKm = leg.km;
      trafficDelayMin = leg.trafficDelayMin;
      congestionLevel = leg.congestionLevel;
      isTrafficAware = leg.isTrafficAware;
    } else {
      // Downstream legs: offline math, blended with observed GPS speed.
      const fb = calcDrive(
        { lat: prevLat, lng: prevLng },
        { lat: stop.lat, lng: stop.lng },
        nowMinutes + cumulativeMin,
        observedKmh,
      );
      legDriveMin = fb.min;
      legDistanceKm = fb.km;
    }

    cumulativeMin += legDriveMin;
    cumulativeKm += legDistanceKm;

    const dwellMin = stop.type === "C" ? opts.dwellCollectionMin : opts.dwellDeliveryMin;
    const arrivalMinFromNow = cumulativeMin;

    result.push({
      stopKey: stop.key,
      addr: stop.addr,
      lat: stop.lat,
      lng: stop.lng,
      type: stop.type,
      etaMin: arrivalMinFromNow,
      etaClockTime: fmM(nowMinutes + arrivalMinFromNow),
      distanceFromDriverKm: Math.round(cumulativeKm * 10) / 10,
      legDriveMin,
      legDistanceKm: Math.round(legDistanceKm * 10) / 10,
      dwellMin,
      trafficDelayMin,
      congestionLevel,
      isTrafficAware,
      waybills: stop.waybills,
    });

    cumulativeMin += dwellMin;
    prevLat = stop.lat;
    prevLng = stop.lng;
  }

  return result;
}
