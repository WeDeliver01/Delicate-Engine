import { useState, useEffect, useCallback, useRef } from "react";
import { fetchTripSheet, fetchEtas, getDriverInfo, type TripSheetResponse, type EtaEntry, type DriverStop } from "@/lib/driver-api";

function cacheKey(): string {
  const driver = getDriverInfo();
  const id = driver?.id ?? "unknown";
  return `delicate-driver-trip-cache-${id}`;
}

function getCachedTrip(): TripSheetResponse | null {
  try {
    const raw = localStorage.getItem(cacheKey());
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function setCachedTrip(trip: TripSheetResponse) {
  try {
    localStorage.setItem(cacheKey(), JSON.stringify(trip));
  } catch {
    // storage full — silent
  }
}

export function clearTripCache() {
  try {
    const keys = Object.keys(localStorage);
    for (const k of keys) {
      if (k.startsWith("delicate-driver-trip-cache")) {
        localStorage.removeItem(k);
      }
    }
  } catch {
    // silent
  }
}

export function useDriverTrip(isOnline: boolean) {
  const [trip, setTrip] = useState<TripSheetResponse | null>(null);
  const [etas, setEtas] = useState<EtaEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [usingCache, setUsingCache] = useState(false);
  const etaTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const hasFreshDataRef = useRef(false);

  const loadTrip = useCallback(async () => {
    try {
      setError(null);
      const data = await fetchTripSheet();
      const cached = getCachedTrip();
      if (cached && cached.projectId !== data.projectId) {
        localStorage.removeItem(cacheKey());
      }
      setTrip(data);
      setCachedTrip(data);
      setUsingCache(false);
      hasFreshDataRef.current = true;
    } catch (e) {
      if (!hasFreshDataRef.current) {
        const cached = getCachedTrip();
        if (cached) {
          setTrip(cached);
          setUsingCache(true);
        } else {
          setError(e instanceof Error ? e.message : "Failed to load trip");
        }
      }
    } finally {
      setLoading(false);
    }
  }, []);

  const loadEtas = useCallback(async () => {
    if (!isOnline) return;
    try {
      const data = await fetchEtas();
      setEtas(data.etas || []);
    } catch {
      // silent
    }
  }, [isOnline]);

  useEffect(() => {
    const cached = getCachedTrip();
    if (cached) {
      setTrip(cached);
      setUsingCache(true);
      setLoading(false);
    }
    loadTrip();
  }, [loadTrip]);

  const tripTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!isOnline) {
      if (etaTimerRef.current) { clearInterval(etaTimerRef.current); etaTimerRef.current = null; }
      if (tripTimerRef.current) { clearInterval(tripTimerRef.current); tripTimerRef.current = null; }
      return;
    }
    loadEtas();
    etaTimerRef.current = setInterval(loadEtas, 45000);
    tripTimerRef.current = setInterval(loadTrip, 20000);
    return () => {
      if (etaTimerRef.current) { clearInterval(etaTimerRef.current); etaTimerRef.current = null; }
      if (tripTimerRef.current) { clearInterval(tripTimerRef.current); tripTimerRef.current = null; }
    };
  }, [isOnline, loadEtas, loadTrip]);

  const stopTimestamps = useRef<Map<string, string>>(new Map());

  const updateStopLocally = useCallback((key: string, status: string) => {
    if (status === "completed" || status === "failed" || status === "skipped") {
      stopTimestamps.current.set(key, new Date().toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit" }));
    }
    setTrip((prev) => {
      if (!prev) return prev;
      const updated = {
        ...prev,
        stops: prev.stops.map((s) => (s.key === key ? { ...s, status } : s)),
        completedCount: prev.stops.filter((s) => (s.key === key ? status : s.status) === "completed").length,
        pendingCount: prev.stops.filter((s) => (s.key === key ? status : s.status) === "pending").length,
      };
      setCachedTrip(updated);
      return updated;
    });
  }, []);

  const pendingStops = trip?.stops.filter((s) => s.status === "pending" || s.status === "arrived") || [];
  const completedStops = trip?.stops.filter((s) => s.status === "completed" || s.status === "failed" || s.status === "skipped") || [];
  const activeStop = pendingStops[0] || null;
  const upcomingStops = pendingStops.slice(1);

  const etaMap = new Map<string, EtaEntry>();
  etas.forEach((e) => etaMap.set(e.key, e));

  return {
    trip,
    loading,
    error,
    usingCache,
    activeStop,
    upcomingStops,
    completedStops,
    pendingStops,
    etaMap,
    stopTimestamps: stopTimestamps.current,
    loadTrip,
    loadEtas,
    updateStopLocally,
  };
}
