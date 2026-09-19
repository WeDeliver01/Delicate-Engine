import { calcDrive, type DriveResult } from "./geo";
import type { GeoPoint } from "./geo-data";

export interface TrafficResult extends DriveResult {
  staticMin: number;
  trafficDelayMin: number;
  congestionLevel: "NORMAL" | "SLOW" | "HEAVY" | "STANDSTILL";
  isLive: boolean;
  speedReadings?: Array<{ speed: string; fraction: number }>;
}

export interface TrafficLeg {
  originLat: number;
  originLng: number;
  destLat: number;
  destLng: number;
  departureTime?: string;
}

export interface TrafficStatus {
  enabled: boolean;
  lastRefresh: number | null;
  isRefreshing: boolean;
}

const _status: TrafficStatus = {
  enabled: false,
  lastRefresh: null,
  isRefreshing: false,
};

let _listeners: Array<() => void> = [];

export function getTrafficStatus(): TrafficStatus {
  return { ..._status };
}

export function onTrafficStatusChange(fn: () => void): () => void {
  _listeners.push(fn);
  return () => { _listeners = _listeners.filter((l) => l !== fn); };
}

function notify() { _listeners.forEach((fn) => fn()); }

export async function checkTrafficEnabled(): Promise<boolean> {
  try {
    const res = await fetch("/api/routes/traffic/status");
    if (!res.ok) return false;
    const data = await res.json();
    _status.enabled = data.enabled;
    notify();
    return data.enabled;
  } catch {
    _status.enabled = false;
    notify();
    return false;
  }
}

export async function calcDriveTraffic(
  from: GeoPoint | null,
  to: GeoPoint | null,
  departMin?: number | null
): Promise<TrafficResult> {
  const fallback = calcDrive(from, to, departMin);
  const fallbackResult: TrafficResult = {
    ...fallback,
    staticMin: fallback.min,
    trafficDelayMin: 0,
    congestionLevel: "NORMAL",
    isLive: false,
  };

  if (!from || !to || from.lat == null || from.lng == null || to.lat == null || to.lng == null) return fallbackResult;

  try {
    let departureTime: string | undefined;
    if (departMin != null) {
      const now = new Date();
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const depTime = new Date(todayStart.getTime() + departMin * 60 * 1000);
      if (depTime > now) {
        departureTime = depTime.toISOString();
      }
    }

    const res = await fetch("/api/routes/traffic", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        originLat: from.lat,
        originLng: from.lng,
        destLat: to.lat,
        destLng: to.lng,
        departureTime,
      }),
    });

    if (!res.ok) return fallbackResult;

    const data = await res.json();
    if (data.fallback) return fallbackResult;

    return {
      km: data.distanceKm || fallback.km,
      min: Math.max(Math.round(data.durationMin), 1),
      staticMin: Math.max(Math.round(data.staticDurationMin), 1),
      trafficDelayMin: Math.round(data.trafficDelayMin * 10) / 10,
      congestionLevel: data.congestionLevel || "NORMAL",
      isLive: true,
    };
  } catch {
    return fallbackResult;
  }
}

export interface BatchTrafficResult {
  legs: TrafficResult[];
}

function legFingerprint(leg: TrafficLeg): string {
  return `${leg.originLat.toFixed(4)},${leg.originLng.toFixed(4)}|${leg.destLat.toFixed(4)},${leg.destLng.toFixed(4)}`;
}

const _prevBatchResults = new Map<string, TrafficResult>();
const _prevBatchTime = { ts: 0 };
const BATCH_RESULT_TTL = 90 * 1000;

export async function calcDriveTrafficBatch(legs: TrafficLeg[]): Promise<BatchTrafficResult> {
  const fallbacks = legs.map((leg) =>
    calcDrive({ lat: leg.originLat, lng: leg.originLng }, { lat: leg.destLat, lng: leg.destLng })
  );

  const fallbackResults: TrafficResult[] = fallbacks.map((f) => ({
    ...f,
    staticMin: f.min,
    trafficDelayMin: 0,
    congestionLevel: "NORMAL" as const,
    isLive: false,
  }));

  if (legs.length === 0) return { legs: [] };

  const now = Date.now();
  const prevStillValid = now - _prevBatchTime.ts < BATCH_RESULT_TTL;

  const fingerprints = legs.map(legFingerprint);
  const needsFetch: number[] = [];
  const allResults: TrafficResult[] = [...fallbackResults];

  for (let i = 0; i < legs.length; i++) {
    const fp = fingerprints[i];
    if (prevStillValid && _prevBatchResults.has(fp)) {
      allResults[i] = _prevBatchResults.get(fp)!;
    } else {
      needsFetch.push(i);
    }
  }

  if (needsFetch.length === 0) {
    return { legs: allResults };
  }

  const fetchLegs = needsFetch.map((i) => legs[i]);
  const CHUNK_SIZE = 30;

  try {
    for (let offset = 0; offset < fetchLegs.length; offset += CHUNK_SIZE) {
      const chunk = fetchLegs.slice(offset, offset + CHUNK_SIZE);
      const res = await fetch("/api/routes/traffic/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ legs: chunk }),
      });

      if (!res.ok) continue;

      const data = await res.json();
      (data.legs || []).forEach((r: any, chunkIdx: number) => {
        const origIdx = needsFetch[offset + chunkIdx];
        if (!r || r.error || r.fallback || origIdx >= allResults.length) return;
        const result: TrafficResult = {
          km: r.distanceKm || fallbackResults[origIdx].km,
          min: Math.max(Math.round(r.durationMin), 1),
          staticMin: Math.max(Math.round(r.staticDurationMin), 1),
          trafficDelayMin: Math.round(r.trafficDelayMin * 10) / 10,
          congestionLevel: r.congestionLevel || "NORMAL",
          isLive: true,
          speedReadings: r.speedReadings || [],
        };
        allResults[origIdx] = result;
        _prevBatchResults.set(fingerprints[origIdx], result);
      });
    }

    _prevBatchTime.ts = now;
    return { legs: allResults };
  } catch {
    return { legs: fallbackResults };
  }
}

export interface LegSpeedReading {
  speed: string;
  fraction: number;
}

export interface DriverTrafficData {
  driverId: string;
  totalDelayMin: number;
  worstCongestion: "NORMAL" | "SLOW" | "HEAVY" | "STANDSTILL";
  legDetails: Array<{
    fromLabel: string;
    toLabel: string;
    km: number;
    trafficMin: number;
    staticMin: number;
    delayMin: number;
    congestion: string;
    speedReadings?: LegSpeedReading[];
    avgSpeedKmh?: number;
  }>;
  lastUpdated: number;
}

let _driverTrafficData = new Map<string, DriverTrafficData>();
let _refreshInterval: ReturnType<typeof setInterval> | null = null;
let _refreshCallback: ((data: Map<string, DriverTrafficData>) => void) | null = null;

export function getDriverTrafficData(): Map<string, DriverTrafficData> {
  return _driverTrafficData;
}

export function setRefreshCallback(cb: (data: Map<string, DriverTrafficData>) => void) {
  _refreshCallback = cb;
}

export interface ScheduleStop {
  driverId: string;
  fromLat: number;
  fromLng: number;
  toLat: number;
  toLng: number;
  fromLabel: string;
  toLabel: string;
  departMin: number;
}

export async function refreshTrafficForSchedule(stops: ScheduleStop[]): Promise<Map<string, DriverTrafficData>> {
  _status.isRefreshing = true;
  notify();

  try {
    const legs: TrafficLeg[] = stops.map((s) => {
      const now = new Date();
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const depTime = new Date(todayStart.getTime() + s.departMin * 60 * 1000);
      return {
        originLat: s.fromLat,
        originLng: s.fromLng,
        destLat: s.toLat,
        destLng: s.toLng,
        departureTime: depTime > now ? depTime.toISOString() : undefined,
      };
    });

    const batch = await calcDriveTrafficBatch(legs);

    const driverMap = new Map<string, DriverTrafficData>();

    stops.forEach((stop, i) => {
      const result = batch.legs[i];
      if (!driverMap.has(stop.driverId)) {
        driverMap.set(stop.driverId, {
          driverId: stop.driverId,
          totalDelayMin: 0,
          worstCongestion: "NORMAL",
          legDetails: [],
          lastUpdated: Date.now(),
        });
      }
      const dd = driverMap.get(stop.driverId)!;
      dd.totalDelayMin += result.trafficDelayMin;
      const avgSpeedKmh = result.min > 0 ? Math.round((result.km / result.min) * 60) : 0;
      dd.legDetails.push({
        fromLabel: stop.fromLabel,
        toLabel: stop.toLabel,
        km: result.km,
        trafficMin: result.min,
        staticMin: result.staticMin,
        delayMin: result.trafficDelayMin,
        congestion: result.congestionLevel,
        speedReadings: result.speedReadings || [],
        avgSpeedKmh,
      });

      const levels = ["NORMAL", "SLOW", "HEAVY", "STANDSTILL"];
      if (levels.indexOf(result.congestionLevel) > levels.indexOf(dd.worstCongestion)) {
        dd.worstCongestion = result.congestionLevel;
      }
    });

    _driverTrafficData = driverMap;
    _status.lastRefresh = Date.now();

    if (_refreshCallback) _refreshCallback(driverMap);

    return driverMap;
  } finally {
    _status.isRefreshing = false;
    notify();
  }
}

export function startAutoRefresh(getStops: () => ScheduleStop[], intervalMs: number = 10 * 60 * 1000, isVisible?: () => boolean) {
  stopAutoRefresh();
  _refreshInterval = setInterval(() => {
    if (isVisible && !isVisible()) return;
    const stops = getStops();
    if (stops.length > 0) {
      refreshTrafficForSchedule(stops);
    }
  }, intervalMs);
}

export function stopAutoRefresh() {
  if (_refreshInterval) {
    clearInterval(_refreshInterval);
    _refreshInterval = null;
  }
}
