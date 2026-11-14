import * as Location from "expo-location";
import * as TaskManager from "expo-task-manager";
import type { LocationPing } from "@delicate/contracts";
import { api } from "./api";

export const LOCATION_TASK = "delicate-driver-location";

/**
 * Where the van is, sent to the engine, which stores the trail, measures the actual distance
 * for settlement, and shows the recipient a live position once their parcel is out for
 * delivery.
 *
 * Two mechanisms, because one is not enough. Background location (a task the OS runs while the
 * app is in a pocket) is the proper one and the only one that works with the screen off. It
 * needs the "always" permission and a real build — Expo Go cannot do it, and a driver who
 * answered "only while using" to the permission prompt has switched it off without knowing.
 * So there is also a foreground watcher: while the app is open it reports positions itself,
 * whatever the background permission says. The two can run together; the engine keeps the
 * newest position and stores every ping on the trail, so overlap costs nothing.
 *
 * Both run while the driver is working — on shift, or holding outstanding stops — and stop
 * when they are not. A driver's position off the clock is their own.
 */

function toPing(l: Location.LocationObject): LocationPing {
  return {
    location: { lat: l.coords.latitude, lng: l.coords.longitude },
    accuracyM: l.coords.accuracy ?? null,
    speedKmh:
      l.coords.speed != null && l.coords.speed >= 0 ? Math.round(l.coords.speed * 3.6) : null,
    recordedAt: new Date(l.timestamp).toISOString(),
  };
}

async function post(pings: LocationPing[]): Promise<void> {
  if (pings.length === 0) return;
  try {
    await api("/v1/driver/location", { method: "POST", json: { pings } });
  } catch {
    // Dropped pings are acceptable: the next batch re-establishes the trail, and settlement
    // falls back to the planned distance if no trail exists.
  }
}

TaskManager.defineTask(LOCATION_TASK, async ({ data, error }) => {
  if (error || !data) return;
  const { locations } = data as { locations: Location.LocationObject[] };
  if (!locations?.length) return;
  await post(locations.map(toPing));
});

export interface Permissions {
  foreground: boolean;
  background: boolean;
}

export async function requestPermissions(): Promise<Permissions> {
  const fg = await Location.requestForegroundPermissionsAsync();
  if (!fg.granted) return { foreground: false, background: false };
  const bg = await Location.requestBackgroundPermissionsAsync().catch(() => ({ granted: false }));
  return { foreground: true, background: bg.granted };
}

// ── background ────────────────────────────────────────────────────────────────

export async function startTracking(): Promise<void> {
  const started = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK).catch(() => false);
  if (started) return;
  await Location.startLocationUpdatesAsync(LOCATION_TASK, {
    accuracy: Location.Accuracy.Balanced,
    timeInterval: 60_000,
    distanceInterval: 250,
    pausesUpdatesAutomatically: true,
    activityType: Location.ActivityType.AutomotiveNavigation,
    showsBackgroundLocationIndicator: false,
    foregroundService: {
      notificationTitle: "Delicate Courier",
      notificationBody: "Sharing your position with dispatch and your recipients while you work",
      notificationColor: "#E84A8A",
    },
  }).catch(() => {
    // Expo Go, or a build without the background permission: the foreground watcher carries it.
  });
}

export async function stopTracking(): Promise<void> {
  const started = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK).catch(() => false);
  if (started) await Location.stopLocationUpdatesAsync(LOCATION_TASK);
}

// ── foreground ────────────────────────────────────────────────────────────────

let watcher: Location.LocationSubscription | null = null;
let pending: LocationPing[] = [];
let lastPostAt = 0;

/** How often the open app reports, at most. The engine's live map refreshes at this rate too. */
const FOREGROUND_POST_MS = 20_000;

export async function startForegroundWatch(): Promise<void> {
  if (watcher) return;
  try {
    watcher = await Location.watchPositionAsync(
      { accuracy: Location.Accuracy.Balanced, timeInterval: 10_000, distanceInterval: 50 },
      (l) => {
        pending.push(toPing(l));
        const now = Date.now();
        if (now - lastPostAt >= FOREGROUND_POST_MS) {
          lastPostAt = now;
          const batch = pending;
          pending = [];
          void post(batch);
        }
      },
    );
  } catch {
    watcher = null;
  }
}

export function stopForegroundWatch(): void {
  watcher?.remove();
  watcher = null;
  const batch = pending;
  pending = [];
  void post(batch);
}

/**
 * Make tracking match whether the driver is working.
 *
 * Called whenever the day changes. `working` is the one input: on shift, or holding stops that
 * are not done. Permissions are asked for the first time this is true, which is also the first
 * time the request makes sense to the person reading it.
 */
export async function syncTracking(working: boolean): Promise<Permissions | null> {
  if (!working) {
    await stopTracking();
    stopForegroundWatch();
    return null;
  }
  const perms = await requestPermissions();
  if (!perms.foreground) return perms;
  await startForegroundWatch();
  if (perms.background) await startTracking();
  return perms;
}

export async function currentPosition(): Promise<{ lat: number; lng: number } | null> {
  try {
    const p = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
    return { lat: p.coords.latitude, lng: p.coords.longitude };
  } catch {
    return null;
  }
}
