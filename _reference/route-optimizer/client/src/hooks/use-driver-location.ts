import { useState, useEffect, useRef, useCallback } from "react";
import { sendLocation, goOffline, goOnlineWithRetry, sendLocationBeacon, getToken } from "@/lib/driver-api";
import {
  ensureDriverSwRegistered,
  queueLocationViaSw,
  flushQueueViaSw,
  setDriverSwToken,
} from "@/lib/driver-sw-client";
import {
  isCapacitorNative,
  isCapacitorNativeSync,
  startNativeWatcher,
  type NativeWatcherHandle,
  type NativeLocationState,
} from "@/lib/driver-native-location";

interface WakeLockSentinelLike extends EventTarget {
  release(): Promise<void>;
}
interface WakeLockNavigator extends Navigator {
  wakeLock?: { request(type: "screen"): Promise<WakeLockSentinelLike> };
}
interface PlaysInlineMedia extends HTMLMediaElement {
  playsInline: boolean;
}

export interface LocationState {
  lat: number | null;
  lng: number | null;
  accuracy: number | null;
  speed: number | null;
  heading: number | null;
  lastUpdate: number | null;
  gpsLost: boolean;
  tracking: boolean;
  error: string | null;
  isBackground: boolean;
  wasBackgrounded: boolean;
  movementMode: "moving" | "stationary";
  native: boolean;
  permission: "granted" | "denied" | "prompt" | "unknown";
}

export interface DriverTrackingSettings {
  batterySaver: boolean;
  audioKeepAlive: boolean;
}

const FG_MOVING_INTERVAL = 15000;
const FG_STATIONARY_INTERVAL = 60000;
const SAVER_INTERVAL = 120000;
const BG_INTERVAL = 60000;
const GPS_LOST_TIMEOUT = 60000;
const AUTO_OFFLINE_TIMEOUT = 600000;
const HEARTBEAT_MAX_MS = 5 * 60 * 1000;
const MIN_MOVE_M = 25;
const MIN_MOVE_SPEED_KMH = 5;
const STATIONARY_HOLD_MS = 60000;
const LAST_LOC_KEY = "dc_driver_last_location";
const SETTINGS_KEY = "dc_driver_tracking_settings";
const SILENT_AUDIO_DATA_URL =
  "data:audio/mpeg;base64,//uQxAAAAAAAAAAAAAAAAAAAAAAAWGluZwAAAA8AAAACAAACcQCAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgID///////////////////////////////////////////8AAAA5TEFNRTMuMTAwAc0AAAAAAAAAABSAJAJAQgAAgAAAAnGmRMHpAAAAAAD/+xDEAAPAAAGkAAAAIAAANIAAAARMQU1FMy4xMDBVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV//sQxFKDwAABpAAAACAAADSAAAAEVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV//sQxKQDwAABpAAAACAAADSAAAAEVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV//sQxPYDwAABpAAAACAAADSAAAAEVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV";

export function loadDriverTrackingSettings(): DriverTrackingSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { batterySaver: false, audioKeepAlive: false };
    const parsed = JSON.parse(raw);
    return {
      batterySaver: !!parsed.batterySaver,
      audioKeepAlive: !!parsed.audioKeepAlive,
    };
  } catch {
    return { batterySaver: false, audioKeepAlive: false };
  }
}

export function saveDriverTrackingSettings(settings: DriverTrackingSettings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {}
}

function saveLastLocation(lat: number, lng: number, accuracy: number | null) {
  try {
    localStorage.setItem(LAST_LOC_KEY, JSON.stringify({ lat, lng, accuracy, ts: Date.now() }));
  } catch {}
}

export function getLastSavedLocation(): { lat: number; lng: number; accuracy: number | null; ts: number } | null {
  try {
    const raw = localStorage.getItem(LAST_LOC_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed.lat && parsed.lng) return parsed;
  } catch {}
  return null;
}

function haversineMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371000;
  const toRad = (x: number) => (x * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

interface TrackingMode {
  interval: number;
  highAccuracy: boolean;
}

function resolveMode(opts: {
  isBackground: boolean;
  batterySaver: boolean;
  movement: "moving" | "stationary";
}): TrackingMode {
  if (opts.batterySaver) {
    // Battery saver: always low-accuracy + 2-min uploads (regardless of movement / fg / bg).
    return { interval: SAVER_INTERVAL, highAccuracy: false };
  }
  if (opts.isBackground) {
    return { interval: BG_INTERVAL, highAccuracy: false };
  }
  if (opts.movement === "moving") {
    return { interval: FG_MOVING_INTERVAL, highAccuracy: true };
  }
  return { interval: FG_STATIONARY_INTERVAL, highAccuracy: false };
}

export function useDriverLocation(isOnline: boolean) {
  const [location, setLocation] = useState<LocationState>({
    lat: null, lng: null, accuracy: null, speed: null, heading: null,
    lastUpdate: null, gpsLost: false, tracking: false, error: null,
    isBackground: false, wasBackgrounded: false, movementMode: "stationary",
    native: isCapacitorNativeSync(), permission: "unknown",
  });
  const [settings, setSettings] = useState<DriverTrackingSettings>(() => loadDriverTrackingSettings());
  const nativeWatcherRef = useRef<NativeWatcherHandle | null>(null);
  const isNativeRef = useRef<boolean>(isCapacitorNativeSync());

  const watchIdRef = useRef<number | null>(null);
  const pendingRef = useRef<GeolocationPosition | null>(null);
  const lastSentRef = useRef<{ lat: number; lng: number; ts: number } | null>(null);
  const lastMoveTsRef = useRef<number>(0);
  const movementRef = useRef<"moving" | "stationary">("stationary");
  const batchTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const gpsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoOfflineTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wakeLockRef = useRef<WakeLockSentinelLike | null>(null);
  const onAutoOfflineRef = useRef<(() => void) | null>(null);
  const isBackgroundRef = useRef(false);
  const isOnlineRef = useRef(isOnline);
  isOnlineRef.current = isOnline;
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const currentModeRef = useRef<TrackingMode | null>(null);

  const updateSettings = useCallback((patch: Partial<DriverTrackingSettings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      saveDriverTrackingSettings(next);
      return next;
    });
  }, []);
  const acknowledgeBackgroundWarning = useCallback(() => {
    setLocation((prev) => ({ ...prev, wasBackgrounded: false }));
  }, []);

  const clearGpsTimer = useCallback(() => {
    if (gpsTimerRef.current) { clearTimeout(gpsTimerRef.current); gpsTimerRef.current = null; }
  }, []);

  const clearAutoOfflineTimer = useCallback(() => {
    if (autoOfflineTimerRef.current) { clearTimeout(autoOfflineTimerRef.current); autoOfflineTimerRef.current = null; }
  }, []);

  const startGpsTimer = useCallback(() => {
    clearGpsTimer();
    gpsTimerRef.current = setTimeout(() => {
      setLocation((prev) => ({ ...prev, gpsLost: true }));
    }, GPS_LOST_TIMEOUT);
  }, [clearGpsTimer]);

  const startAutoOfflineTimer = useCallback(() => {
    clearAutoOfflineTimer();
    autoOfflineTimerRef.current = setTimeout(() => {
      goOffline().catch(() => {});
      if (onAutoOfflineRef.current) onAutoOfflineRef.current();
    }, AUTO_OFFLINE_TIMEOUT);
  }, [clearAutoOfflineTimer]);

  const sendPending = useCallback(async (force = false) => {
    const pos = pendingRef.current;
    if (!pos) return;
    const lat = pos.coords.latitude;
    const lng = pos.coords.longitude;
    const speedMs = pos.coords.speed;
    const speedKmh = speedMs != null ? speedMs * 3.6 : null;
    const now = Date.now();

    if (!force && lastSentRef.current) {
      const movedM = haversineMeters({ lat, lng }, { lat: lastSentRef.current.lat, lng: lastSentRef.current.lng });
      const ageMs = now - lastSentRef.current.ts;
      const heartbeatDue = ageMs >= HEARTBEAT_MAX_MS;
      const moving = (speedKmh != null && speedKmh >= MIN_MOVE_SPEED_KMH);
      const movedEnough = movedM >= MIN_MOVE_M;
      if (!heartbeatDue && !moving && !movedEnough) {
        return;
      }
    }

    pendingRef.current = null;
    saveLastLocation(lat, lng, pos.coords.accuracy);

    const body: Record<string, number | null | undefined> = {
      lat,
      lng,
      accuracy: pos.coords.accuracy,
    };
    if (speedMs != null) body.speed = speedMs;
    if (pos.coords.heading != null) body.heading = pos.coords.heading;

    // SW reads JWT from its own IndexedDB (seeded by setDriverSwToken on
    // hook init / login), so we no longer pass the token per-message.
    let queued = await queueLocationViaSw(body);
    if (!queued) {
      try {
        await sendLocation(lat, lng, pos.coords.accuracy, speedMs, pos.coords.heading);
      } catch {
        return;
      }
    }
    lastSentRef.current = { lat, lng, ts: now };
  }, []);

  const updateMovementMode = useCallback((pos: GeolocationPosition) => {
    const speedMs = pos.coords.speed;
    const speedKmh = speedMs != null ? speedMs * 3.6 : null;
    const now = Date.now();

    let movedFar = false;
    if (lastSentRef.current) {
      const movedM = haversineMeters(
        { lat: pos.coords.latitude, lng: pos.coords.longitude },
        { lat: lastSentRef.current.lat, lng: lastSentRef.current.lng },
      );
      movedFar = movedM >= MIN_MOVE_M;
    }
    const fastEnough = speedKmh != null && speedKmh >= MIN_MOVE_SPEED_KMH;

    if (fastEnough || movedFar) {
      lastMoveTsRef.current = now;
      if (movementRef.current !== "moving") {
        movementRef.current = "moving";
        setLocation((prev) => ({ ...prev, movementMode: "moving" }));
      }
    } else if (movementRef.current === "moving" && now - lastMoveTsRef.current > STATIONARY_HOLD_MS) {
      movementRef.current = "stationary";
      setLocation((prev) => ({ ...prev, movementMode: "stationary" }));
    }
  }, []);

  const handlePosition = useCallback((pos: GeolocationPosition) => {
    pendingRef.current = pos;
    updateMovementMode(pos);
    setLocation((prev) => ({
      ...prev,
      lat: pos.coords.latitude,
      lng: pos.coords.longitude,
      accuracy: pos.coords.accuracy,
      speed: pos.coords.speed,
      heading: pos.coords.heading,
      lastUpdate: Date.now(),
      gpsLost: false,
      tracking: true,
      error: null,
    }));
    saveLastLocation(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy);
    clearGpsTimer();
    startGpsTimer();
    clearAutoOfflineTimer();
    startAutoOfflineTimer();
  }, [clearGpsTimer, startGpsTimer, clearAutoOfflineTimer, startAutoOfflineTimer, updateMovementMode]);

  const requestWakeLock = useCallback(async () => {
    if (wakeLockRef.current) return;
    try {
      const nav = navigator as WakeLockNavigator;
      if (nav.wakeLock) {
        const lock = await nav.wakeLock.request("screen");
        wakeLockRef.current = lock;
        lock.addEventListener("release", () => {
          if (wakeLockRef.current === lock) wakeLockRef.current = null;
          if (isOnlineRef.current && !isBackgroundRef.current && document.visibilityState === "visible") {
            requestWakeLock().catch(() => {});
          }
        });
      }
    } catch {}
  }, []);

  const releaseWakeLock = useCallback(() => {
    if (wakeLockRef.current) {
      try { wakeLockRef.current.release(); } catch {}
      wakeLockRef.current = null;
    }
  }, []);

  const startAudioKeepAlive = useCallback(() => {
    if (!settingsRef.current.audioKeepAlive) return;
    if (audioRef.current) return;
    try {
      const audio = new Audio(SILENT_AUDIO_DATA_URL);
      audio.loop = true;
      audio.volume = 0.0001;
      audio.muted = false;
      (audio as PlaysInlineMedia).playsInline = true;
      audio.setAttribute("playsinline", "true");
      audioRef.current = audio;
      audio.play().catch(() => {
        audioRef.current = null;
      });
    } catch {
      audioRef.current = null;
    }
  }, []);

  const stopAudioKeepAlive = useCallback(() => {
    if (audioRef.current) {
      try { audioRef.current.pause(); } catch {}
      try { audioRef.current.src = ""; } catch {}
      audioRef.current = null;
    }
  }, []);

  /**
   * Re-arms the geolocation watcher and the upload-batch timer based on the
   * current (isBackground, batterySaver, movementMode) tuple. Idempotent — no-op
   * if the resolved mode hasn't changed.
   */
  const applyTrackingMode = useCallback((force = false) => {
    if (isNativeRef.current) return;
    if (!isOnlineRef.current) return;
    if (!navigator.geolocation) return;

    const mode = resolveMode({
      isBackground: isBackgroundRef.current,
      batterySaver: settingsRef.current.batterySaver,
      movement: movementRef.current,
    });

    if (!force && currentModeRef.current
        && currentModeRef.current.interval === mode.interval
        && currentModeRef.current.highAccuracy === mode.highAccuracy) {
      return;
    }
    currentModeRef.current = mode;

    if (batchTimerRef.current) { clearInterval(batchTimerRef.current); batchTimerRef.current = null; }
    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }

    const onError = (err: GeolocationPositionError) =>
      setLocation((prev) => ({ ...prev, error: err.message, gpsLost: true }));

    if (mode.highAccuracy && !isBackgroundRef.current) {
      // Foreground + moving + saver-off -> high-accuracy continuous watch.
      watchIdRef.current = navigator.geolocation.watchPosition(
        handlePosition,
        onError,
        { enableHighAccuracy: true, maximumAge: 10000, timeout: 30000 },
      );
    } else {
      // Stationary FG, any BG, or battery saver -> low-accuracy poll-then-upload at interval.
      const pollAndSend = () => {
        if (!isOnlineRef.current) return;
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            handlePosition(pos);
            // Force-send so 60s/120s upload cadence is actually honored even
            // when the driver is stationary and would otherwise be debounced
            // by the distance/speed gating in sendPending().
            sendPending(true).catch(() => {});
          },
          onError,
          { enableHighAccuracy: false, maximumAge: 30000, timeout: 15000 },
        );
      };
      // Prime immediately so dispatcher sees a fresh sample at mode-switch time.
      pollAndSend();
      batchTimerRef.current = setInterval(pollAndSend, mode.interval);
      return;
    }

    batchTimerRef.current = setInterval(() => { sendPending().catch(() => {}); }, mode.interval);
  }, [handlePosition, sendPending]);

  // Re-evaluate tracking mode whenever movement / battery saver / background changes.
  useEffect(() => {
    if (!location.tracking || !isOnline) return;
    applyTrackingMode();
  }, [location.movementMode, location.isBackground, settings.batterySaver, location.tracking, isOnline, applyTrackingMode]);

  useEffect(() => {
    if (!isOnline) {
      if (nativeWatcherRef.current) {
        nativeWatcherRef.current.stop().catch(() => {});
        nativeWatcherRef.current = null;
      }
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
      if (batchTimerRef.current) { clearInterval(batchTimerRef.current); batchTimerRef.current = null; }
      currentModeRef.current = null;
      clearGpsTimer();
      clearAutoOfflineTimer();
      releaseWakeLock();
      stopAudioKeepAlive();
      lastSentRef.current = null;
      movementRef.current = "stationary";
      setLocation((prev) => ({ ...prev, tracking: false, isBackground: false, wasBackgrounded: false, movementMode: "stationary" }));
      goOffline().catch(() => {});
      return;
    }

    // Explicit presence: announce go-online immediately so dispatch sees the
    // driver as online (with onlineSince set) even before the first GPS fix,
    // and so any pending ops "force-online" request is cleared. Retry with
    // backoff so a transient failure doesn't strand the driver offline
    // server-side — the exact failure mode the force-online flow guards against.
    goOnlineWithRetry().catch(() => {});

    let cancelled = false;
    isCapacitorNative().then((native) => {
      if (cancelled) return;
      isNativeRef.current = native;
      if (!native) return;
      setLocation((prev) => ({ ...prev, native: true, tracking: true }));
      startNativeWatcher((s: NativeLocationState) => {
        setLocation((prev) => ({
          ...prev,
          native: true,
          tracking: true,
          lat: s.lat ?? prev.lat,
          lng: s.lng ?? prev.lng,
          accuracy: s.accuracy ?? prev.accuracy,
          speed: s.speed ?? prev.speed,
          heading: s.heading ?? prev.heading,
          lastUpdate: s.lastUpdate ?? prev.lastUpdate,
          gpsLost: false,
          isBackground: false,
          error: s.error,
          permission: s.permission,
        }));
        if (s.lat != null && s.lng != null) {
          saveLastLocation(s.lat, s.lng, s.accuracy);
          clearAutoOfflineTimer();
          startAutoOfflineTimer();
        }
      }).then((handle) => {
        if (cancelled && handle) { handle.stop().catch(() => {}); return; }
        nativeWatcherRef.current = handle;
      }).catch(() => {});
    });

    if (isNativeRef.current) {
      // Skip browser fallbacks entirely on native — the plugin handles background/foreground itself.
      return () => {
        cancelled = true;
        if (nativeWatcherRef.current) {
          nativeWatcherRef.current.stop().catch(() => {});
          nativeWatcherRef.current = null;
        }
        clearAutoOfflineTimer();
      };
    }

    if (!navigator.geolocation) {
      setLocation((prev) => ({ ...prev, error: "Geolocation not supported", tracking: false }));
      return;
    }

    ensureDriverSwRegistered()
      .then(() => {
        // Seed the SW's IndexedDB with the current JWT so it can authenticate
        // queued/replayed location uploads (including Background Sync runs)
        // without the page passing the token on every message.
        const tok = getToken();
        if (tok) setDriverSwToken(tok).catch(() => {});
      })
      .catch(() => {});

    startAudioKeepAlive();

    const savedLoc = getLastSavedLocation();
    if (savedLoc && Date.now() - savedLoc.ts < 3600000) {
      const fakePos = {
        coords: { latitude: savedLoc.lat, longitude: savedLoc.lng, accuracy: savedLoc.accuracy || 50, speed: null, heading: null },
        timestamp: savedLoc.ts,
      } as GeolocationPosition;
      pendingRef.current = fakePos;
      sendPending(true).catch(() => {});
    }

    setLocation((prev) => ({ ...prev, tracking: true }));

    sendPending(true).catch(() => {});
    applyTrackingMode(true);
    startGpsTimer();
    startAutoOfflineTimer();
    requestWakeLock();

    const handleVisibility = () => {
      if (!isOnlineRef.current) return;
      if (document.hidden) {
        isBackgroundRef.current = true;
        setLocation((prev) => ({ ...prev, isBackground: true, wasBackgrounded: true }));
        sendPending(true).catch(() => {});
        releaseWakeLock();
      } else {
        isBackgroundRef.current = false;
        // Note: wasBackgrounded stays true until the driver acknowledges the warning.
        setLocation((prev) => ({ ...prev, isBackground: false }));
        flushQueueViaSw();
        requestWakeLock();
      }
      applyTrackingMode(true);
    };

    const handlePageHide = () => {
      const pos = pendingRef.current;
      if (pos && isOnlineRef.current) {
        sendLocationBeacon(
          pos.coords.latitude,
          pos.coords.longitude,
          pos.coords.accuracy,
          pos.coords.speed,
          pos.coords.heading,
        );
        return;
      }
      const saved = getLastSavedLocation();
      if (saved && isOnlineRef.current) {
        sendLocationBeacon(saved.lat, saved.lng, saved.accuracy, null, null);
      }
    };

    document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener("pagehide", handlePageHide);
    window.addEventListener("beforeunload", handlePageHide);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("pagehide", handlePageHide);
      window.removeEventListener("beforeunload", handlePageHide);
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
      if (nativeWatcherRef.current) {
        nativeWatcherRef.current.stop().catch(() => {});
        nativeWatcherRef.current = null;
      }
      if (batchTimerRef.current) { clearInterval(batchTimerRef.current); batchTimerRef.current = null; }
      currentModeRef.current = null;
      clearGpsTimer();
      clearAutoOfflineTimer();
      releaseWakeLock();
      stopAudioKeepAlive();
    };
  }, [isOnline, sendPending, clearGpsTimer, startGpsTimer,
      clearAutoOfflineTimer, startAutoOfflineTimer,
      requestWakeLock, releaseWakeLock,
      startAudioKeepAlive, stopAudioKeepAlive, applyTrackingMode]);

  useEffect(() => {
    if (!isOnline) return;
    if (settings.audioKeepAlive) {
      startAudioKeepAlive();
    } else {
      stopAudioKeepAlive();
    }
  }, [settings.audioKeepAlive, isOnline, startAudioKeepAlive, stopAudioKeepAlive]);

  return {
    location,
    settings,
    updateSettings,
    acknowledgeBackgroundWarning,
    setAutoOfflineCallback: (cb: () => void) => { onAutoOfflineRef.current = cb; },
  };
}
