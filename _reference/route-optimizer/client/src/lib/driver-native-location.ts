import { sendLocation, getToken } from "@/lib/driver-api";

interface CapacitorRuntime {
  isNativePlatform?: () => boolean;
  getPlatform?: () => string;
}

interface BgGeoLocation {
  latitude: number;
  longitude: number;
  accuracy: number | null;
  speed: number | null;
  bearing: number | null;
  altitude: number | null;
  time: number;
}

interface BgGeoPlugin {
  addWatcher: (
    options: {
      backgroundMessage?: string;
      backgroundTitle?: string;
      requestPermissions?: boolean;
      stale?: boolean;
      distanceFilter?: number;
    },
    callback: (position: BgGeoLocation | null, error?: { code?: string; message?: string }) => void,
  ) => Promise<string>;
  removeWatcher: (options: { id: string }) => Promise<void>;
  openSettings?: () => Promise<void>;
}

let cachedCapacitor: CapacitorRuntime | null | undefined;
let cachedPlugin: BgGeoPlugin | null | undefined;

async function getCapacitor(): Promise<CapacitorRuntime | null> {
  if (cachedCapacitor !== undefined) return cachedCapacitor;
  try {
    const w = window as any;
    if (w?.Capacitor) {
      cachedCapacitor = w.Capacitor as CapacitorRuntime;
      return cachedCapacitor;
    }
    const corePath = ["@capacitor", "core"].join("/");
    const mod = await import(/* @vite-ignore */ corePath);
    cachedCapacitor = (mod as any).Capacitor || null;
  } catch {
    cachedCapacitor = null;
  }
  return cachedCapacitor;
}

async function getPlugin(): Promise<BgGeoPlugin | null> {
  if (cachedPlugin !== undefined) return cachedPlugin;
  try {
    const cap = await getCapacitor();
    if (!cap || !cap.isNativePlatform || !cap.isNativePlatform()) {
      cachedPlugin = null;
      return cachedPlugin;
    }
    const pluginPath = ["@capacitor-community", "background-geolocation"].join("/");
    const mod = await import(/* @vite-ignore */ pluginPath);
    cachedPlugin = ((mod as any).BackgroundGeolocation || (mod as any).default || null) as BgGeoPlugin | null;
  } catch {
    cachedPlugin = null;
  }
  return cachedPlugin;
}

export async function isCapacitorNative(): Promise<boolean> {
  const cap = await getCapacitor();
  return !!(cap && cap.isNativePlatform && cap.isNativePlatform());
}

export function isCapacitorNativeSync(): boolean {
  if (cachedCapacitor && cachedCapacitor.isNativePlatform) {
    return cachedCapacitor.isNativePlatform();
  }
  return false;
}

export interface NativeLocationState {
  lat: number | null;
  lng: number | null;
  accuracy: number | null;
  speed: number | null;
  heading: number | null;
  lastUpdate: number | null;
  permission: "granted" | "denied" | "prompt" | "unknown";
  error: string | null;
}

export interface NativeWatcherHandle {
  stop: () => Promise<void>;
}

export async function startNativeWatcher(
  onUpdate: (state: NativeLocationState) => void,
): Promise<NativeWatcherHandle | null> {
  const plugin = await getPlugin();
  if (!plugin) return null;

  let watcherId: string | null = null;
  try {
    watcherId = await plugin.addWatcher(
      {
        backgroundTitle: "Delicate Driver — On Duty",
        backgroundMessage: "Tracking your location so dispatch can give accurate ETAs.",
        requestPermissions: true,
        stale: false,
        distanceFilter: 25,
      },
      (position, error) => {
        if (error) {
          const code = (error.code || "").toLowerCase();
          const permission: NativeLocationState["permission"] =
            code.includes("permission") || code.includes("denied") ? "denied" : "unknown";
          onUpdate({
            lat: null,
            lng: null,
            accuracy: null,
            speed: null,
            heading: null,
            lastUpdate: Date.now(),
            permission,
            error: error.message || "Location error",
          });
          return;
        }
        if (!position) return;
        const lat = position.latitude;
        const lng = position.longitude;
        const acc = position.accuracy ?? null;
        const speed = position.speed ?? null;
        const heading = position.bearing ?? null;
        onUpdate({
          lat,
          lng,
          accuracy: acc,
          speed,
          heading,
          lastUpdate: Date.now(),
          permission: "granted",
          error: null,
        });
        if (getToken()) {
          sendLocation(lat, lng, acc ?? 0, speed, heading).catch(() => {});
        }
      },
    );
  } catch (err) {
    onUpdate({
      lat: null,
      lng: null,
      accuracy: null,
      speed: null,
      heading: null,
      lastUpdate: Date.now(),
      permission: "unknown",
      error: err instanceof Error ? err.message : "Failed to start native tracking",
    });
    return null;
  }

  return {
    async stop() {
      if (!watcherId) return;
      try {
        await plugin.removeWatcher({ id: watcherId });
      } catch {}
      watcherId = null;
    },
  };
}

export async function openNativeLocationSettings(): Promise<void> {
  const plugin = await getPlugin();
  if (plugin?.openSettings) {
    try { await plugin.openSettings(); } catch {}
  }
}
