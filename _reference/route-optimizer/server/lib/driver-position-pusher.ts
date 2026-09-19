import crypto from "crypto";
import { storage } from "../storage";
import { calcDrive, currentTimeMinutes } from "./geo";
import {
  getActiveProjectAndStops,
  recentMovingSpeedKmh,
  peekFirstLegCache,
} from "../routes/driver";

export interface DriverPositionPayload {
  event: "driver_position";
  driverAccountId: number;
  driverName: string;
  lat: number;
  lng: number;
  speed: number | null;
  heading: number | null;
  recentSpeedKmh: number | null;
  isMoving: boolean;
  isOnline: boolean;
  nextStop: {
    waybill: string;
    address: string;
    lat: number;
    lng: number;
    type: "C" | "D" | string;
    etaMinutes: number;
    etaIso: string;
    distanceKm: number;
    isTrafficAware: boolean;
  } | null;
  timestamp: string;
}

const DEFAULT_INTERVAL_MS = 15 * 1000;
const ONLINE_WINDOW_MIN = 10;
let timer: NodeJS.Timeout | null = null;
let inflight = false;

export async function getCrmWebhookConfig(): Promise<{ url: string | null; secret: string | null }> {
  const urlSetting = await storage.getAppSetting("crm_webhook_url");
  const url = urlSetting
    ? (typeof urlSetting.value === "string" ? urlSetting.value : String(urlSetting.value)).replace(/^"+|"+$/g, "")
    : null;
  let secret: string | null = process.env.SHIPMENT_WEBHOOK_SECRET || null;
  if (!secret) {
    const s = await storage.getAppSetting("crm_webhook_secret");
    secret = s
      ? (typeof s.value === "string" ? s.value : String(s.value)).replace(/^"+|"+$/g, "")
      : null;
  }
  return { url, secret };
}

async function isPushEnabled(): Promise<boolean> {
  const setting = await storage.getAppSetting("driver_position_push_enabled");
  if (!setting) return true;
  const v = typeof setting.value === "string" ? setting.value : String(setting.value);
  const cleaned = v.replace(/^"+|"+$/g, "").toLowerCase();
  return cleaned !== "false" && cleaned !== "0" && cleaned !== "off";
}

async function buildPayloadForDriver(driver: {
  id: number;
  driverName: string;
  currentLat: number | null;
  currentLng: number | null;
  currentSpeed: number | null;
  currentHeading: number | null;
  isOnline: boolean;
}): Promise<DriverPositionPayload | null> {
  if (driver.currentLat == null || driver.currentLng == null) return null;
  if (driver.currentLat === 0 && driver.currentLng === 0) return null;

  const recentKmh = recentMovingSpeedKmh(driver.id);
  const isMoving = !!(driver.currentSpeed != null && driver.currentSpeed * 3.6 >= 3);

  let nextStop: DriverPositionPayload["nextStop"] = null;
  try {
    const projects = await storage.getProjects();
    const result = getActiveProjectAndStops(projects, driver.driverName);
    const pending = result?.stops.find((s) => s.status === "pending") || null;
    if (pending && pending.lat && pending.lng) {
      const cached = peekFirstLegCache(driver.id, driver.currentLat, driver.currentLng, pending.key);
      let etaMin: number;
      let distKm: number;
      let isTrafficAware: boolean;
      if (cached) {
        etaMin = cached.min;
        distKm = cached.km;
        isTrafficAware = cached.isTrafficAware;
      } else {
        const drv = calcDrive(
          { lat: driver.currentLat, lng: driver.currentLng },
          { lat: pending.lat, lng: pending.lng },
          currentTimeMinutes(),
          recentKmh,
        );
        etaMin = drv.min;
        distKm = drv.km;
        isTrafficAware = false;
      }
      nextStop = {
        waybill: pending.wbs?.[0] || pending.ids?.[0] || "",
        address: pending.addr || "",
        lat: pending.lat,
        lng: pending.lng,
        type: pending.type,
        etaMinutes: etaMin,
        etaIso: new Date(Date.now() + etaMin * 60_000).toISOString(),
        distanceKm: distKm,
        isTrafficAware,
      };
    }
  } catch (err) {
    console.error(
      `[Driver Position Pusher] next-stop compute failed for driver=${driver.driverName}:`,
      err instanceof Error ? err.message : err,
    );
  }

  return {
    event: "driver_position",
    driverAccountId: driver.id,
    driverName: driver.driverName,
    lat: driver.currentLat,
    lng: driver.currentLng,
    speed: driver.currentSpeed,
    heading: driver.currentHeading,
    recentSpeedKmh: recentKmh,
    isMoving,
    isOnline: driver.isOnline,
    nextStop,
    timestamp: new Date().toISOString(),
  };
}

async function postPayload(url: string, secret: string, payload: DriverPositionPayload): Promise<void> {
  const body = JSON.stringify(payload);
  const signature = crypto.createHmac("sha256", secret).update(body).digest("hex");
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-hub-signature-256": `sha256=${signature}`,
      "X-Signature": signature,
      "X-Webhook-Event": "driver_position",
    },
    body,
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
}

export async function pushDriverPositionsOnce(): Promise<{
  attempted: number;
  delivered: number;
  skipped: number;
  reason?: string;
  errors: Array<{ driver: string; message: string }>;
}> {
  const { url, secret } = await getCrmWebhookConfig();
  if (!url) {
    return { attempted: 0, delivered: 0, skipped: 0, reason: "no-url", errors: [] };
  }
  if (!secret) {
    return { attempted: 0, delivered: 0, skipped: 0, reason: "no-secret", errors: [] };
  }
  if (!(await isPushEnabled())) {
    return { attempted: 0, delivered: 0, skipped: 0, reason: "disabled", errors: [] };
  }

  const drivers = await storage.getOnlineDrivers(ONLINE_WINDOW_MIN);
  let delivered = 0;
  let skipped = 0;
  const errors: Array<{ driver: string; message: string }> = [];

  await Promise.all(
    drivers.map(async (d) => {
      try {
        const payload = await buildPayloadForDriver({
          id: d.id,
          driverName: d.driverName,
          currentLat: d.currentLat ?? null,
          currentLng: d.currentLng ?? null,
          currentSpeed: d.currentSpeed ?? null,
          currentHeading: d.currentHeading ?? null,
          isOnline: d.isOnline,
        });
        if (!payload) {
          skipped++;
          return;
        }
        await postPayload(url, secret, payload);
        delivered++;
      } catch (err) {
        errors.push({
          driver: d.driverName,
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }),
  );

  return { attempted: drivers.length, delivered, skipped, errors };
}

export function startDriverPositionPusher(intervalMs: number = DEFAULT_INTERVAL_MS): void {
  if (timer) return;
  console.log(`[Driver Position Pusher] Starting — interval ${Math.round(intervalMs / 1000)}s, online window ${ONLINE_WINDOW_MIN}m`);
  const tick = async () => {
    if (inflight) return;
    inflight = true;
    try {
      const result = await pushDriverPositionsOnce();
      if (result.reason === "no-url" || result.reason === "no-secret" || result.reason === "disabled") {
        return;
      }
      if (result.delivered > 0 || result.errors.length > 0) {
        console.log(
          `[Driver Position Pusher] tick: attempted=${result.attempted} delivered=${result.delivered} skipped=${result.skipped} errors=${result.errors.length}`,
        );
      }
      if (result.errors.length > 0) {
        for (const e of result.errors.slice(0, 3)) {
          console.warn(`[Driver Position Pusher] ${e.driver}: ${e.message}`);
        }
      }
    } catch (err) {
      console.error(
        "[Driver Position Pusher] tick error:",
        err instanceof Error ? err.message : err,
      );
    } finally {
      inflight = false;
    }
  };
  timer = setInterval(tick, intervalMs);
  if (typeof timer.unref === "function") timer.unref();
  setTimeout(tick, 5_000);
}

export function stopDriverPositionPusher(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
