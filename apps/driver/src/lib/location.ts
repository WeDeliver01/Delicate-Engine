import * as Location from "expo-location";
import * as TaskManager from "expo-task-manager";
import type { LocationPing } from "@delicate/contracts";
import { api } from "./api";

export const LOCATION_TASK = "delicate-driver-location";

/**
 * Background location while a shift is open. Pings are batched by the OS and posted to the
 * engine, which stores the trail and derives the ACTUAL distance for settlement. Tracking is
 * started explicitly on "start shift" and stopped on "end shift" — never outside a shift.
 */
TaskManager.defineTask(LOCATION_TASK, async ({ data, error }) => {
  if (error || !data) return;
  const { locations } = data as { locations: Location.LocationObject[] };
  if (!locations?.length) return;
  const pings: LocationPing[] = locations.map((l) => ({
    location: { lat: l.coords.latitude, lng: l.coords.longitude },
    accuracyM: l.coords.accuracy ?? null,
    speedKmh:
      l.coords.speed != null && l.coords.speed >= 0 ? Math.round(l.coords.speed * 3.6) : null,
    recordedAt: new Date(l.timestamp).toISOString(),
  }));
  try {
    await api("/v1/driver/location", { method: "POST", json: { pings } });
  } catch {
    // Dropped pings are acceptable: the next batch re-establishes the trail, and settlement
    // falls back to the planned distance if no trail exists.
  }
});

export async function requestPermissions(): Promise<{ foreground: boolean; background: boolean }> {
  const fg = await Location.requestForegroundPermissionsAsync();
  if (!fg.granted) return { foreground: false, background: false };
  const bg = await Location.requestBackgroundPermissionsAsync().catch(() => ({ granted: false }));
  return { foreground: true, background: bg.granted };
}

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
      notificationBody: "Recording your route while you have stops to work",
      notificationColor: "#E84A8A",
    },
  });
}

export async function stopTracking(): Promise<void> {
  const started = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK).catch(() => false);
  if (started) await Location.stopLocationUpdatesAsync(LOCATION_TASK);
}

export async function currentPosition(): Promise<{ lat: number; lng: number } | null> {
  try {
    const p = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
    return { lat: p.coords.latitude, lng: p.coords.longitude };
  } catch {
    return null;
  }
}
