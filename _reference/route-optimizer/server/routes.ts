import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { insertTripArchiveSchema, insertCsvImportSchema, insertAuditLogSchema, insertProjectSchema } from "@shared/schema";
import driverRouter, { ensureTestDriverAccount, cleanupLocationHistory, pruneDriverNotifications, getActiveProjectAndStops, recentMovingSpeedKmh } from "./routes/driver";
import { ensureDefaultDispatcher } from "./routes/auth";
import authRouter from "./routes/auth";
import webhookRouter, { seedClientAccounts, ensureWebhookAuthKey, broadcastWebhookEvent } from "./routes/webhooks";
import shipmentAlertRouter, { ensureCrmWebhookSecret } from "./routes/shipment-alerts";
import twilioRouter from "./routes/twilio";
import analyticsRouter from "./routes/analytics";
import { runAnalyticsBackfill, syncShipmentToAnalytics, syncArchiveToAnalytics } from "./lib/analytics-backfill";
import { db } from "./db";
import { tripArchives } from "@shared/schema";
import { requireDispatcherAuth } from "./middleware/dispatcher-auth";
import { calcDrive, currentTimeMinutes, fmM } from "./lib/geo";
import { computeLiveStopEtas } from "./lib/live-eta";
import { rankShipmentStatus, normalizeStopStatus, isStopActive } from "@shared/status";
import {
  getUsageReport, getCacheSizes,
  callGoogleRoutesAPI, parseGoogleRoute,
  callPlacesAutocomplete, callPlacesGeocode, callPlaceDetails,
  API_TYPES,
} from "./lib/google-api";
import { fireCrmWebhook } from "./lib/crm-webhook";
import { broadcastShipmentAlert } from "./routes/shipment-alerts";
import { sendToDriverByName, sendToDriver } from "./services/push";

interface TrafficCacheEntry {
  result: any;
  expiresAt: number;
}

const trafficCache = new Map<string, TrafficCacheEntry>();
const CACHE_TTL_MS = 120 * 1000;

interface DriverEtaCacheEntry {
  driverName: string;
  etaMin: number;
  distanceKm: number;
  trafficDelayMin: number;
  congestionLevel: string;
  isTrafficAware: boolean;
  expiresAt: number;
}
const driverEtaCache = new Map<string, DriverEtaCacheEntry>();
const DISPATCHER_ETA_CACHE_TTL_MS = 300 * 1000;

interface AllStopsEtaEntry {
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

interface AllStopsEtaCacheEntry {
  driverName: string;
  stops: AllStopsEtaEntry[];
  expiresAt: number;
}

const allStopsEtaCache = new Map<string, AllStopsEtaCacheEntry>();
// Short TTL: live ETAs must track the driver's GPS on the ~15s pusher cadence.
// The engine self-throttles Google to one call per driver per 45s first-leg
// cache window, so a short recompute window here only re-runs cheap offline
// math and coalesces concurrent dispatcher pollers.
const ALL_STOPS_ETA_CACHE_TTL_MS = 12 * 1000;

let DWELL_TIME_COLLECTION_MIN = 10;
let DWELL_TIME_DELIVERY_MIN = 5;
let ETA_DRIFT_THRESHOLD_MIN = 15;

async function loadEtaConfig() {
  try {
    const setting = await storage.getAppSetting("eta_config");
    if (setting?.value) {
      const cfg = typeof setting.value === "string" ? JSON.parse(setting.value) : setting.value;
      if (typeof cfg === "object" && cfg !== null) {
        if (typeof (cfg as any).dwellCollectionMin === "number") DWELL_TIME_COLLECTION_MIN = (cfg as any).dwellCollectionMin;
        if (typeof (cfg as any).dwellDeliveryMin === "number") DWELL_TIME_DELIVERY_MIN = (cfg as any).dwellDeliveryMin;
        if (typeof (cfg as any).driftThresholdMin === "number") ETA_DRIFT_THRESHOLD_MIN = (cfg as any).driftThresholdMin;
      }
    }
  } catch {}
}

const previousEtaByDriver = new Map<string, Map<string, number>>();

async function notifyProjectChanges(previous: any, current: any): Promise<void> {
  const prevAsgn = (previous?.assignments || {}) as Record<string, string>;
  const newAsgn = (current?.assignments || {}) as Record<string, string>;
  const prevSeq = (previous?.driverStopSequences || {}) as Record<string, string[]>;
  const newSeq = (current?.driverStopSequences || {}) as Record<string, string[]>;
  const prevStopStatuses = (previous?.stopStatuses || {}) as Record<string, string>;
  const newStopStatuses = (current?.stopStatuses || {}) as Record<string, string>;
  const projectName: string = current?.name || "trip";
  const projectId: string = current?.id || "";

  const newlyAssignedCountByDriver = new Map<string, number>();
  for (const [shipId, drv] of Object.entries(newAsgn)) {
    if (!drv) continue;
    if (prevAsgn[shipId] !== drv) {
      newlyAssignedCountByDriver.set(drv, (newlyAssignedCountByDriver.get(drv) || 0) + 1);
    }
  }

  const routeChangedDrivers = new Set<string>();
  for (const driverName of new Set([...Object.keys(prevSeq), ...Object.keys(newSeq)])) {
    const a = prevSeq[driverName] || [];
    const b = newSeq[driverName] || [];
    if (a.length !== b.length || a.some((v, i) => v !== b[i])) {
      routeChangedDrivers.add(driverName);
    }
  }

  const cancelledKeys: string[] = [];
  for (const [k, v] of Object.entries(newStopStatuses)) {
    if (v === "cancelled" && prevStopStatuses[k] !== "cancelled") {
      cancelledKeys.push(k);
    }
  }
  const cancelledByDriver = new Map<string, string[]>();
  if (cancelledKeys.length > 0) {
    for (const [driverName, seq] of Object.entries(newSeq)) {
      const hits = cancelledKeys.filter((k) => seq.includes(k));
      if (hits.length > 0) cancelledByDriver.set(driverName, hits);
    }
  }

  const tasks: Promise<unknown>[] = [];
  for (const [driverName, count] of newlyAssignedCountByDriver) {
    tasks.push(sendToDriverByName(driverName, {
      kind: "assignment_new",
      title: count === 1 ? "New stop assigned" : `${count} new stops assigned`,
      body: `Project ${projectName}: open the app to view your trip sheet.`,
      data: { projectId, count: String(count) },
    }));
    routeChangedDrivers.delete(driverName);
  }
  for (const driverName of routeChangedDrivers) {
    tasks.push(sendToDriverByName(driverName, {
      kind: "route_changed",
      title: "Your route was updated",
      body: `Dispatcher reordered stops on ${projectName}.`,
      data: { projectId },
    }));
  }
  for (const [driverName, keys] of cancelledByDriver) {
    tasks.push(sendToDriverByName(driverName, {
      kind: "stop_cancelled",
      title: keys.length === 1 ? "A stop was cancelled" : `${keys.length} stops cancelled`,
      body: `Dispatcher cancelled ${keys.length === 1 ? "a stop" : "stops"} on ${projectName}.`,
      data: { projectId, count: String(keys.length) },
    }));
  }

  await Promise.allSettled(tasks);

  // Instant reassignment cascade: when assignments actually changed, re-ground
  // every downstream surface against live position right away instead of
  // waiting for the next 15s pusher wake.
  //  1. Drop the live-ETA caches so the next dispatcher poll recomputes from
  //     the new assignments.
  //  2. Fire one position-push cycle — this refreshes the CRM Client Care
  //     alerts (the inbound driver_position handler recomputes per-recipient
  //     ETAs) and the driver-app next-stop ETAs.
  //  3. Broadcast an SSE event carrying the changed shipment->driver map so
  //     every open dispatcher tab merges the move into its local state and
  //     re-derives KPIs/totals/ETAs without a reload.
  const changedAssignments: Record<string, string> = {};
  for (const [shipId, drv] of Object.entries(newAsgn)) {
    if (drv && prevAsgn[shipId] !== drv) changedAssignments[shipId] = drv;
  }
  const assignmentsChanged = Object.keys(changedAssignments).length > 0;
  if (assignmentsChanged) {
    allStopsEtaCache.clear();
    driverEtaCache.clear();
    try {
      const { pushDriverPositionsOnce } = await import("./lib/driver-position-pusher");
      pushDriverPositionsOnce().catch((err) => {
        console.error("[Reassign Cascade] position push failed:", err instanceof Error ? err.message : err);
      });
    } catch (err) {
      console.error("[Reassign Cascade] could not trigger position push:", err instanceof Error ? err.message : err);
    }
    try {
      broadcastWebhookEvent({
        topic: "assignments_changed",
        projectId,
        assignments: changedAssignments,
        message: `${Object.keys(changedAssignments).length} shipment(s) reassigned on ${projectName}`,
      });
    } catch (err) {
      console.error("[Reassign Cascade] SSE broadcast failed:", err instanceof Error ? err.message : err);
    }
  }
}

interface DriftAlertState {
  lastAlertedAt: number;
  wasLate: boolean;
  lastAlertedEta: number;
}
const driftAlertThrottle = new Map<string, DriftAlertState>();
const DRIFT_ALERT_COOLDOWN_MS = 30 * 60 * 1000;

function getCacheKey(originLat: number, originLng: number, destLat: number, destLng: number, departureTime?: string): string {
  let timeBucket = "now";
  if (departureTime) {
    const d = new Date(departureTime);
    const mins = d.getUTCHours() * 60 + d.getUTCMinutes();
    timeBucket = `${d.toISOString().slice(0, 10)}_${Math.floor(mins / 5) * 5}`;
  }
  return `${originLat.toFixed(4)},${originLng.toFixed(4)}|${destLat.toFixed(4)},${destLng.toFixed(4)}|${timeBucket}`;
}

function pruneCache() {
  const now = Date.now();
  for (const [key, entry] of trafficCache) {
    if (entry.expiresAt < now) trafficCache.delete(key);
  }
  for (const [key, entry] of driverEtaCache) {
    if (entry.expiresAt < now) driverEtaCache.delete(key);
  }
  for (const [key, entry] of allStopsEtaCache) {
    if (entry.expiresAt < now) allStopsEtaCache.delete(key);
  }
}

async function getActiveProjectId(): Promise<string | undefined> {
  const projects = await storage.getProjects();
  if (projects.length === 0) return undefined;
  if (projects.length === 1) return projects[0].id;
  const sorted = [...projects].sort((a, b) => {
    const aTime = a.updatedAt ? new Date(a.updatedAt).getTime() : new Date(a.createdAt).getTime();
    const bTime = b.updatedAt ? new Date(b.updatedAt).getTime() : new Date(b.createdAt).getTime();
    return bTime - aTime;
  });
  return sorted[0].id;
}

async function checkEtaDriftAndNotify(
  driver: { id: number; driverName: string; currentLat: number | null; currentLng: number | null },
  allStopsResult: AllStopsEtaEntry[],
  pendingStops: Array<{ key: string; type: "C" | "D"; waybills: string[]; contactName: string; contactPhone: string; timeAfter?: string; timeBefore: string; addr: string }>,
  shipments: Array<any>,
  _assignments: Record<string, string>
): Promise<void> {
  if (!previousEtaByDriver.has(driver.driverName)) {
    previousEtaByDriver.set(driver.driverName, new Map());
  }
  const prevEtas = previousEtaByDriver.get(driver.driverName)!;
  const nowMinutes = currentTimeMinutes();

  for (let i = 0; i < allStopsResult.length; i++) {
    const stop = allStopsResult[i];
    const stopInfo = pendingStops[i];
    if (!stopInfo || stop.waybills.length === 0) continue;

    const prevEta = prevEtas.get(stop.stopKey);
    const currentEta = stop.etaMin;
    let shouldAlert = false;
    let reason = "";

    if (prevEta != null && Math.abs(currentEta - prevEta) >= ETA_DRIFT_THRESHOLD_MIN) {
      shouldAlert = true;
      const direction = currentEta > prevEta ? "later" : "earlier";
      reason = `ETA shifted ${Math.abs(currentEta - prevEta)} min ${direction} (was ${prevEta} min, now ${currentEta} min)`;
    }

    if (stopInfo.timeBefore) {
      const [h, m] = stopInfo.timeBefore.split(":").map(Number);
      if (!isNaN(h) && !isNaN(m)) {
        const windowEndMin = h * 60 + m;
        const arrivalMin = nowMinutes + currentEta;
        if (arrivalMin > windowEndMin) {
          shouldAlert = true;
          reason = reason || `Running late: ETA ${fmM(arrivalMin)} exceeds window end ${stopInfo.timeBefore}`;
        }
      }
    }

    prevEtas.set(stop.stopKey, currentEta);

    if (shouldAlert) {
      const throttleKey = `${driver.driverName}:${stop.stopKey}`;
      const throttleState = driftAlertThrottle.get(throttleKey);
      const now = Date.now();

      const isLateNow = reason.startsWith("Running late");
      const wasLateBefore = throttleState?.wasLate ?? false;
      const isStateTransition = isLateNow !== wasLateBefore;

      if (throttleState && !isStateTransition && (now - throttleState.lastAlertedAt) < DRIFT_ALERT_COOLDOWN_MS) {
        continue;
      }

      driftAlertThrottle.set(throttleKey, {
        lastAlertedAt: now,
        wasLate: isLateNow,
        lastAlertedEta: currentEta,
      });

      for (const wb of stop.waybills) {
        try {
          const driftStatus = stop.type === "C" ? "collection-eta-drift" : "delivery-eta-drift";
          const matchedShipment = shipments.find((s: any) => s.wb === wb);

          const existingAlert = await storage.getActiveAlertByWaybill(wb);
          let alert;
          if (existingAlert) {
            alert = await storage.updateShipmentAlert(existingAlert.id, {
              shipmentStatus: driftStatus,
              driverName: driver.driverName,
              driverAccountId: driver.id,
              driverLat: driver.currentLat,
              driverLng: driver.currentLng,
              deliveryLat: stop.lat,
              deliveryLng: stop.lng,
              etaMinutes: currentEta,
            });
            alert = alert || existingAlert;
          } else {
            alert = await storage.createShipmentAlert({
              waybill: wb,
              recipientName: stopInfo.contactName || "",
              recipientPhone: stopInfo.contactPhone || "",
              deliveryAddress: stop.addr,
              driverName: driver.driverName,
              driverAccountId: driver.id,
              shipmentStatus: driftStatus,
              etaMinutes: currentEta,
              driverLat: driver.currentLat,
              driverLng: driver.currentLng,
              deliveryLat: stop.lat,
              deliveryLng: stop.lng,
              contactStatus: "pending-contact",
            });
          }

          await storage.createNotification({
            type: "eta_drift",
            title: `ETA Alert: ${wb}`,
            message: `Driver ${driver.driverName} — ${stop.type === "C" ? "Collection" : "Delivery"} at ${stop.addr}. ${reason}. New ETA: ${stop.etaClockTime}`,
            targetRole: "client_care",
            alertId: alert.id,
            waybill: wb,
          });

          broadcastShipmentAlert({
            type: "eta_drift",
            alertId: alert.id,
            waybill: wb,
            recipientName: stopInfo.contactName || "",
            shipmentStatus: driftStatus,
            message: `ETA Alert: ${wb} — ${reason}`,
          });

          await fireCrmWebhook({
            waybill: wb,
            recipientName: stopInfo.contactName || "",
            recipientPhone: stopInfo.contactPhone || "",
            deliveryAddress: stop.addr,
            driverAccountId: driver.id,
            driverName: driver.driverName,
            shipmentStatus: driftStatus,
            driverLat: driver.currentLat,
            driverLng: driver.currentLng,
            deliveryLat: stop.lat,
            deliveryLng: stop.lng,
            clientName: matchedShipment?.acc || "",
            etaMinutes: currentEta,
            // pendingStops are derived via getActiveProjectAndStops which
            // already patches d-windows from project.deliveryOverrides, so
            // stopInfo.timeAfter/timeBefore are the effective requested window.
            requestedDeliveryAfter: stop.type === "D" ? (stopInfo.timeAfter || matchedShipment?.dAfter || null) : null,
            requestedDeliveryBefore: stop.type === "D" ? (stopInfo.timeBefore || matchedShipment?.dBefore || null) : null,
          }, { skipLocal: true });

          console.log(`[ETA Drift] Alert fired for ${wb} (driver=${driver.driverName}): ${reason}`);
        } catch (err) {
          console.error(`[ETA Drift] Failed to fire alert for ${wb}:`, err instanceof Error ? err.message : err);
        }
      }
    }
  }
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  app.use(authRouter);
  app.use(webhookRouter);
  app.use(shipmentAlertRouter);
  app.use(twilioRouter);
  app.use(analyticsRouter);
  setTimeout(() => { runAnalyticsBackfill().catch(() => {}); }, 5000);

  app.get("/api/health", (_req, res) => {
    res.json({
      status: "ok",
      version: "6.2.0",
      timestamp: new Date().toISOString(),
    });
  });

  app.use("/api/places", requireDispatcherAuth);
  app.use("/api/routes", requireDispatcherAuth);
  app.use("/api/projects", requireDispatcherAuth);
  app.use("/api/archives", requireDispatcherAuth);
  app.use("/api/imports", requireDispatcherAuth);
  app.use("/api/audit", requireDispatcherAuth);
  app.use("/api/settings", requireDispatcherAuth);
  app.use("/api/session", requireDispatcherAuth);
  app.use("/api/dispatch", requireDispatcherAuth);
  app.use("/api/shipment-alerts", requireDispatcherAuth);
  app.use("/api/notifications", requireDispatcherAuth);

  app.post("/api/places/geocode", async (req, res) => {
    try {
      const { address } = req.body;
      if (!address || typeof address !== "string" || !address.trim()) {
        return res.status(400).json({ message: "Missing address" });
      }
      const data = await callPlacesGeocode(address.trim());
      const place = data.places?.[0];
      if (!place || !place.location) {
        return res.json({ lat: null, lng: null, formattedAddress: null, found: false });
      }
      res.json({
        lat: place.location.latitude,
        lng: place.location.longitude,
        formattedAddress: place.formattedAddress || address,
        name: place.displayName?.text || "",
        found: true,
      });
    } catch (error: any) {
      console.error("[Places Geocode]", error.message);
      res.status(502).json({ lat: null, lng: null, found: false, error: error.message });
    }
  });

  app.get("/api/places/autocomplete", async (req, res) => {
    try {
      const input = String(req.query.input || "").trim();
      const sessionToken = String(req.query.session_token || "").trim() || undefined;
      if (!input || input.length < 3) return res.json({ suggestions: [] });
      const data = await callPlacesAutocomplete(input, sessionToken);
      const suggestions = (data.suggestions || []).map((s: any) => {
        const pred = s.placePrediction;
        return {
          placeId: pred?.placeId || "",
          description: pred?.text?.text || "",
          mainText: pred?.structuredFormat?.mainText?.text || pred?.text?.text || "",
          secondaryText: pred?.structuredFormat?.secondaryText?.text || "",
        };
      }).filter((s: any) => s.placeId);
      res.json({ suggestions });
    } catch (error: any) {
      console.error("[Places Autocomplete]", error.message);
      res.status(502).json({ suggestions: [], error: error.message });
    }
  });

  app.get("/api/places/details", async (req, res) => {
    try {
      const placeId = String(req.query.place_id || "").trim();
      const sessionToken = String(req.query.session_token || "").trim() || undefined;
      if (!placeId) return res.status(400).json({ message: "Missing place_id" });
      const data = await callPlaceDetails(placeId, sessionToken);
      res.json({
        placeId: data.id || placeId,
        name: data.displayName?.text || "",
        address: data.formattedAddress || "",
        lat: data.location?.latitude ?? null,
        lng: data.location?.longitude ?? null,
      });
    } catch (error: any) {
      console.error("[Places Details]", error.message);
      res.status(502).json({ message: error.message });
    }
  });

  app.post("/api/routes/traffic", async (req, res) => {
    try {
      const { originLat, originLng, destLat, destLng, departureTime } = req.body;
      const oLat = Number(originLat), oLng = Number(originLng), dLat = Number(destLat), dLng = Number(destLng);
      if (!Number.isFinite(oLat) || !Number.isFinite(oLng) || !Number.isFinite(dLat) || !Number.isFinite(dLng)) {
        return res.status(400).json({ message: "Missing or invalid origin/destination coordinates" });
      }
      if (Math.abs(oLat) > 90 || Math.abs(dLat) > 90 || Math.abs(oLng) > 180 || Math.abs(dLng) > 180) {
        return res.status(400).json({ message: "Coordinates out of valid range" });
      }

      const validDep = departureTime && new Date(departureTime) > new Date() ? departureTime : undefined;
      const cacheKey = getCacheKey(oLat, oLng, dLat, dLng, validDep);
      const now = Date.now();
      const cached = trafficCache.get(cacheKey);
      if (cached && cached.expiresAt > now) {
        return res.json({ ...cached.result, cached: true });
      }

      const data = await callGoogleRoutesAPI(oLat, oLng, dLat, dLng, { departureTime, apiType: API_TYPES.ROUTES_TRAFFIC });
      const result = parseGoogleRoute(data);

      trafficCache.set(cacheKey, { result, expiresAt: now + CACHE_TTL_MS });
      if (trafficCache.size > 500) pruneCache();

      res.json({ ...result, cached: false });
    } catch (error: any) {
      console.error("[Traffic API]", error.message);
      res.status(502).json({ message: error.message, fallback: true });
    }
  });

  app.post("/api/routes/traffic/batch", async (req, res) => {
    try {
      const { legs } = req.body;
      if (!Array.isArray(legs) || legs.length === 0) {
        return res.status(400).json({ message: "Missing legs array" });
      }

      if (legs.length > 30) {
        return res.status(400).json({ message: "Max 30 legs per batch" });
      }

      const now = Date.now();
      const results: any[] = [];
      const uncachedIndices: number[] = [];

      const validLegs = legs.map((leg: any) => {
        const oLat = Number(leg.originLat), oLng = Number(leg.originLng);
        const dLat = Number(leg.destLat), dLng = Number(leg.destLng);
        if (!Number.isFinite(oLat) || !Number.isFinite(oLng) || !Number.isFinite(dLat) || !Number.isFinite(dLng)) return null;
        if (Math.abs(oLat) > 90 || Math.abs(dLat) > 90 || Math.abs(oLng) > 180 || Math.abs(dLng) > 180) return null;
        return { ...leg, originLat: oLat, originLng: oLng, destLat: dLat, destLng: dLng };
      });

      validLegs.forEach((leg: any, idx: number) => {
        if (!leg) { results[idx] = { error: "Invalid coordinates", fallback: true }; return; }
        const validDep = leg.departureTime && new Date(leg.departureTime) > new Date() ? leg.departureTime : undefined;
        const cacheKey = getCacheKey(leg.originLat, leg.originLng, leg.destLat, leg.destLng, validDep);
        const cached = trafficCache.get(cacheKey);
        if (cached && cached.expiresAt > now) {
          results[idx] = { ...cached.result, cached: true };
        } else {
          results[idx] = null;
          uncachedIndices.push(idx);
        }
      });

      const batchSize = 5;
      for (let i = 0; i < uncachedIndices.length; i += batchSize) {
        const chunk = uncachedIndices.slice(i, i + batchSize);
        const promises = chunk.map(async (idx) => {
          const leg = validLegs[idx];
          const validDep = leg.departureTime && new Date(leg.departureTime) > new Date() ? leg.departureTime : undefined;
          try {
            const data = await callGoogleRoutesAPI(leg.originLat, leg.originLng, leg.destLat, leg.destLng, { departureTime: validDep, apiType: API_TYPES.ROUTES_TRAFFIC_BATCH });
            const result = parseGoogleRoute(data);
            const cacheKey = getCacheKey(leg.originLat, leg.originLng, leg.destLat, leg.destLng, validDep);
            trafficCache.set(cacheKey, { result, expiresAt: now + CACHE_TTL_MS });
            results[idx] = { ...result, cached: false };
          } catch (err: any) {
            results[idx] = { error: err.message, fallback: true };
          }
        });
        await Promise.all(promises);
      }

      if (trafficCache.size > 500) pruneCache();
      res.json({ legs: results });
    } catch (error: any) {
      console.error("[Traffic Batch API]", error.message);
      res.status(502).json({ message: error.message });
    }
  });

  const polylineBatchCache = new Map<string, { encoded: string; ts: number }>();
  const POLYLINE_CACHE_TTL = 30 * 60 * 1000;

  app.post("/api/routes/polylines/batch", async (req, res) => {
    try {
      const { legs } = req.body as { legs: Array<{ originLat: number; originLng: number; destLat: number; destLng: number }> };
      if (!Array.isArray(legs) || legs.length === 0) {
        return res.status(400).json({ message: "Missing legs array" });
      }
      if (legs.length > 60) {
        return res.status(400).json({ message: "Max 60 legs per batch" });
      }
      const now = Date.now();
      const out: (string | null)[] = new Array(legs.length).fill(null);
      const todo: number[] = [];
      legs.forEach((leg, i) => {
        const oLat = Number(leg?.originLat), oLng = Number(leg?.originLng);
        const dLat = Number(leg?.destLat), dLng = Number(leg?.destLng);
        if (!Number.isFinite(oLat) || !Number.isFinite(oLng) || !Number.isFinite(dLat) || !Number.isFinite(dLng)) return;
        if (oLat < -35 || oLat > -22 || oLng < 16 || oLng > 33) return;
        if (dLat < -35 || dLat > -22 || dLng < 16 || dLng > 33) return;
        const key = `${oLat.toFixed(4)},${oLng.toFixed(4)}|${dLat.toFixed(4)},${dLng.toFixed(4)}`;
        const cached = polylineBatchCache.get(key);
        if (cached && now - cached.ts < POLYLINE_CACHE_TTL) {
          out[i] = cached.encoded;
        } else {
          todo.push(i);
        }
      });

      const concurrency = 6;
      for (let i = 0; i < todo.length; i += concurrency) {
        const chunk = todo.slice(i, i + concurrency);
        await Promise.all(chunk.map(async (idx) => {
          const leg = legs[idx];
          const oLat = Number(leg.originLat), oLng = Number(leg.originLng);
          const dLat = Number(leg.destLat), dLng = Number(leg.destLng);
          const key = `${oLat.toFixed(4)},${oLng.toFixed(4)}|${dLat.toFixed(4)},${dLng.toFixed(4)}`;
          try {
            const url = `https://router.project-osrm.org/route/v1/driving/${oLng},${oLat};${dLng},${dLat}?overview=full&geometries=polyline`;
            const r = await fetch(url, { signal: AbortSignal.timeout(6000) });
            if (!r.ok) return;
            const data: any = await r.json();
            const encoded = data?.routes?.[0]?.geometry;
            if (typeof encoded === "string" && encoded.length > 0) {
              polylineBatchCache.set(key, { encoded, ts: now });
              out[idx] = encoded;
            }
          } catch {
            // OSRM failed for this leg — leave null, client falls back to straight line
          }
        }));
      }

      if (polylineBatchCache.size > 800) {
        const entries = Array.from(polylineBatchCache.entries()).sort((a, b) => a[1].ts - b[1].ts);
        for (let i = 0; i < 200; i++) polylineBatchCache.delete(entries[i][0]);
      }

      res.json({ polylines: out });
    } catch (error: any) {
      console.error("[Polylines Batch]", error.message);
      res.status(502).json({ message: error.message });
    }
  });

  app.get("/api/routes/traffic/status", (_req, res) => {
    const hasKey = !!process.env.GOOGLE_ROUTES_API_KEY;
    res.json({
      enabled: hasKey,
      cacheSize: trafficCache.size,
      cacheTTL: CACHE_TTL_MS / 1000,
    });
  });

  app.get("/api/admin/api-usage", requireDispatcherAuth, (_req, res) => {
    const report = getUsageReport();
    const centralCaches = getCacheSizes();
    res.json({
      date: new Date().toISOString().slice(0, 10),
      ...report,
      caches: {
        traffic: trafficCache.size,
        driverEta: driverEtaCache.size,
        allStopsEta: allStopsEtaCache.size,
        ...centralCaches,
      },
    });
  });

  app.get("/api/projects", async (_req, res) => {
    try {
      const projects = await storage.getProjects();
      res.json(projects);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/projects/:id", async (req, res) => {
    try {
      const project = await storage.getProject(req.params.id);
      if (!project) {
        return res.status(404).json({ message: "Project not found" });
      }
      res.json(project);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/projects", async (req, res) => {
    try {
      const project = await storage.createProject(req.body);
      res.status(201).json(project);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.patch("/api/projects/:id", async (req, res) => {
    try {
      const needsAnalyticsSync = !!(req.body?.shipments || req.body?.assignments);
      const { db } = await import("./db");
      const { projects } = await import("@shared/schema");
      const { eq } = await import("drizzle-orm");
      const { syncProjectToAnalytics } = await import("./lib/analytics-backfill");

      const previous = await storage.getProject(req.params.id);

      const project = await db.transaction(async (tx) => {
        const [updated] = await tx.update(projects)
          .set({ ...req.body, updatedAt: new Date() })
          .where(eq(projects.id, req.params.id))
          .returning();
        if (!updated) return undefined;
        if (needsAnalyticsSync) {
          await syncProjectToAnalytics(updated, tx);
        }
        return updated;
      });

      if (!project) {
        return res.status(404).json({ message: "Project not found" });
      }

      res.json(project);

      // Fire-and-forget AFTER the response has been written so a slow push
      // pipeline can never delay the dispatcher's PATCH round-trip.
      if (previous) {
        notifyProjectChanges(previous, project).catch((err) => {
          console.error("[push] notifyProjectChanges error:", err?.message || err);
        });
      }
    } catch (error: any) {
      console.error("[projects.patch] failed (analytics-tx rolled back):", error?.message);
      res.status(500).json({ message: error.message });
    }
  });

  app.delete("/api/projects/:id", async (req, res) => {
    try {
      await storage.deleteProject(req.params.id);
      res.status(204).send();
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/archives", async (req, res) => {
    try {
      const search = req.query.search as string | undefined;
      const archives = await storage.listArchives(search);
      res.json(archives);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/archives/:id", async (req, res) => {
    try {
      const archive = await storage.getArchive(req.params.id);
      if (!archive) {
        return res.status(404).json({ message: "Archive not found" });
      }
      res.json(archive);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/archives", async (req, res) => {
    try {
      const parsed = insertTripArchiveSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid archive data", errors: parsed.error.flatten() });
      }
      // Wrap archive insert + analytics sync in a single transaction so the
      // operational write and the analytics rows commit (or roll back) atomically.
      const archive = await db.transaction(async (tx) => {
        const [created] = await tx.insert(tripArchives).values(parsed.data).returning();
        await syncArchiveToAnalytics(created, tx);
        return created;
      });
      res.status(201).json(archive);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.delete("/api/archives/:id", async (req, res) => {
    try {
      await storage.deleteArchive(req.params.id);
      res.status(204).send();
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // ── Autosave: upsert the current working session ──────────────────────────
  app.post("/api/session/save", async (req, res) => {
    try {
      const { projectId, ...rest } = req.body;
      // Dedupe by waybill and re-derive date/window fields for every
      // webhook-sourced shipment from the latest stored webhook payload
      // BEFORE persisting. Without this a stale dispatcher autosave will
      // revive shipments that the webhook auto-import already re-bucketed
      // to their correct date project and will leave duplicates of the
      // same waybill behind whenever the in-memory state drifts.
      if (rest && Array.isArray((rest as any).shipments)) {
        try {
          const { dedupeAndEnrichShipmentsFromWebhooks } = await import("./lib/webhook-import");
          const enriched = await dedupeAndEnrichShipmentsFromWebhooks((rest as any).shipments);
          (rest as any).shipments = enriched.shipments;
          if (enriched.removedDuplicates > 0 || enriched.correctedWaybills.length > 0) {
            console.log(`[Session Save] Deduped ${enriched.removedDuplicates} duplicate waybills, corrected dates for ${enriched.correctedWaybills.length}: ${enriched.correctedWaybills.slice(0, 10).join(", ")}${enriched.correctedWaybills.length > 10 ? "…" : ""}`);
          }
        } catch (err: any) {
          console.error("[Session Save] Webhook enrichment failed:", err?.message || err);
        }
      }
      if (projectId) {
        const existing = await storage.getProject(projectId);
        if (existing) {
          // Clobber-safe stopStatuses merge: preserve any terminal
          // (DONE/FAILED/completed/failed) stop statuses already in the DB
          // — these are typically written by ShipLogic webhooks or driver
          // app actions and must not be overwritten by a stale dispatcher
          // autosave whose React state hasn't yet received the SSE patch.
          if (rest && typeof rest === "object" && "stopStatuses" in rest && rest.stopStatuses && typeof rest.stopStatuses === "object") {
            const incoming = rest.stopStatuses as Record<string, string>;
            const dbStops = (existing.stopStatuses || {}) as Record<string, string>;
            const merged: Record<string, string> = { ...incoming };
            for (const [k, v] of Object.entries(dbStops)) {
              const vl = String(v).toLowerCase();
              if (vl === "done" || vl === "failed" || vl === "completed" || vl === "skipped") {
                merged[k] = v;
              }
            }
            (rest as any).stopStatuses = merged;
          }
          const updated = await storage.updateProject(projectId, rest);
          return res.json({ id: updated?.id ?? projectId, saved: true });
        }
      }
      const parsed = insertProjectSchema.safeParse({ name: "session", ...rest });
      if (!parsed.success) return res.status(400).json({ message: "Invalid session data" });
      const created = await storage.createProject(parsed.data);
      res.status(201).json({ id: created.id, saved: true });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/session/:id", async (req, res) => {
    try {
      const project = await storage.getProject(req.params.id);
      if (!project) return res.status(404).json({ message: "Session not found" });
      res.json(project);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // ── CSV Import History ─────────────────────────────────────────────────────
  app.get("/api/imports", async (_req, res) => {
    try {
      const records = await storage.listCsvImports(100);
      res.json(records);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/imports/:id", async (req, res) => {
    try {
      const record = await storage.getCsvImport(req.params.id);
      if (!record) return res.status(404).json({ message: "Import not found" });
      res.json(record);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/imports", async (req, res) => {
    try {
      const parsed = insertCsvImportSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid import data", errors: parsed.error.flatten() });
      }
      const record = await storage.createCsvImport(parsed.data);
      res.status(201).json(record);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // ── Audit Log ─────────────────────────────────────────────────────────────
  app.get("/api/audit", async (req, res) => {
    try {
      const entityId = req.query.entityId as string | undefined;
      const limit = req.query.limit ? parseInt(req.query.limit as string) : 200;
      const logs = await storage.listAuditLogs(entityId, limit);
      res.json(logs);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/audit", async (req, res) => {
    try {
      const parsed = insertAuditLogSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid audit entry", errors: parsed.error.flatten() });
      }
      const entry = await storage.createAuditLog(parsed.data);
      res.status(201).json(entry);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/settings/:key", async (req, res) => {
    try {
      const { key } = req.params;
      const setting = await storage.getAppSetting(key);
      if (!setting) return res.status(404).json({ message: "Setting not found" });
      res.json({ key: setting.key, value: setting.value, updatedAt: setting.updatedAt });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.put("/api/settings/:key", async (req, res) => {
    try {
      const { key } = req.params;
      const { value } = req.body;
      if (value === undefined) return res.status(400).json({ message: "Missing value" });

      if (key === "fleet" && value?.drivers && Array.isArray(value.drivers)) {
        const oldSetting = await storage.getAppSetting("fleet");
        const oldDrivers: any[] = (oldSetting?.value as any)?.drivers || [];
        const newDrivers: any[] = value.drivers;
        const allAccounts = await storage.getAllDriverAccounts();

        for (const account of allAccounts) {
          const oldMatch = oldDrivers.find((d: any) =>
            d.name?.toLowerCase().trim() === account.driverName?.toLowerCase().trim()
          );
          const newMatch = oldMatch
            ? newDrivers.find((d: any) => d.id === oldMatch.id)
            : newDrivers.find((d: any) =>
                d.name?.toLowerCase().trim() === account.driverName?.toLowerCase().trim()
              );

          if (newMatch) {
            const updates: any = {};
            if (newMatch.name && newMatch.name !== account.driverName) {
              updates.driverName = newMatch.name;
            }
            if (newMatch.color && newMatch.color !== account.fleetColor) {
              updates.fleetColor = newMatch.color;
            }
            if (newMatch.plate !== undefined && newMatch.plate !== account.vehiclePlate) {
              updates.vehiclePlate = newMatch.plate || "";
            }
            if (newMatch.type !== undefined && newMatch.type !== account.vehicleType) {
              updates.vehicleType = newMatch.type || "";
            }
            if (Object.keys(updates).length > 0) {
              await storage.updateDriverAccount(account.id, updates);
            }
          }
        }
      }

      const setting = await storage.upsertAppSetting(key, value);
      res.json({ key: setting.key, value: setting.value, updatedAt: setting.updatedAt });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Persisted shipment totals (read from the source-of-truth project shipments).
  // Aggregates by canonical status so the dashboard reflects driver actions
  // AND webhook tracking updates regardless of import origin (CSV or webhook).
  // Wipe CSV-imported shipments only. Webhook-imported shipments
  // (source === "webhook") are preserved — those are live tracking data from
  // ShipLogic and must not be lost. For shipments that came from BOTH sources
  // (source === "csv+webhook") we keep the row but flip its source to
  // "webhook" so the live tracking lineage stays intact. Assignment, stop
  // status, stop notes and sequence entries that reference removed shipments
  // are pruned; entries referencing surviving shipments are kept.
  app.post("/api/dispatch/wipe-shipments", requireDispatcherAuth, async (_req, res) => {
    try {
      const projects = await storage.getProjects();
      let projectsTouched = 0;
      let shipmentsRemoved = 0;
      let shipmentsKept = 0;
      for (const p of projects) {
        const ships = ((p.shipments as any[]) || []);
        if (ships.length === 0) continue;
        const survivors: any[] = [];
        const removedIds = new Set<string>();
        for (const s of ships) {
          const src = String(s.source || "").toLowerCase();
          const hasCsv = src.includes("csv");
          const hasWebhook = src.includes("webhook");
          if (hasWebhook) {
            // Keep, but strip CSV lineage so a re-imported CSV doesn't double up.
            survivors.push(hasCsv ? { ...s, source: "webhook" } : s);
            shipmentsKept++;
          } else {
            // Pure CSV (or unknown source) — remove.
            removedIds.add(s.id);
            if (s.wb) removedIds.add(s.wb);
            shipmentsRemoved++;
          }
        }
        if (removedIds.size === 0 && shipmentsKept === ships.length) continue;

        const oldAsgn = (p.assignments as Record<string, string>) || {};
        const newAsgn: Record<string, string> = {};
        for (const [shipId, driverId] of Object.entries(oldAsgn)) {
          if (!removedIds.has(shipId)) newAsgn[shipId] = driverId;
        }

        const oldSeqs = (p.driverStopSequences as Record<string, string[]>) || {};
        const newSeqs: Record<string, string[]> = {};
        for (const [driverId, seq] of Object.entries(oldSeqs)) {
          newSeqs[driverId] = (seq || []).filter((sid) => !removedIds.has(sid));
        }

        const oldStops = (p.stopStatuses as Record<string, string>) || {};
        const newStops: Record<string, string> = {};
        for (const [key, val] of Object.entries(oldStops)) {
          // Stop keys look like "C_<id>" / "D_<id>" / "C_<id1>_<id2>" for groups.
          const ids = key.replace(/^[CD]_/, "").split("_");
          if (!ids.some((id) => removedIds.has(id))) newStops[key] = val;
        }

        const oldNotes = (p.stopNotes as Record<string, string>) || {};
        const newNotes: Record<string, string> = {};
        for (const [key, val] of Object.entries(oldNotes)) {
          const ids = key.replace(/^[CD]_/, "").split("_");
          if (!ids.some((id) => removedIds.has(id))) newNotes[key] = val;
        }

        await storage.updateProject(p.id, {
          shipments: survivors,
          assignments: newAsgn,
          stopStatuses: newStops,
          stopNotes: newNotes,
          driverStopSequences: newSeqs,
        } as any);
        projectsTouched++;
      }
      console.log(`[Wipe CSV] Removed ${shipmentsRemoved} CSV shipments, kept ${shipmentsKept} webhook shipments across ${projectsTouched} projects`);
      res.json({ ok: true, projectsTouched, shipmentsRemoved, shipmentsKept });
    } catch (error: any) {
      console.error("[Wipe CSV] failed:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/dispatch/shipment-totals", requireDispatcherAuth, async (req, res) => {
    try {
      const from = (req.query.from as string) || "";
      const to = (req.query.to as string) || "";
      const projects = await storage.getProjects();
      const totals = { received: 0, collected: 0, outForDelivery: 0, delivered: 0, failed: 0, skipped: 0, fromCsv: 0, fromWebhook: 0, fromBoth: 0 };
      for (const p of projects) {
        const ships = ((p.shipments as any[]) || []);
        for (const s of ships) {
          const date = (s.delDate || s.colDate || s.created || "").toString().slice(0, 10);
          if (from && date && date < from) continue;
          if (to && date && date > to) continue;
          totals.received++;
          const src = (s.source || "").toString();
          if (src.includes("csv") && src.includes("webhook")) totals.fromBoth++;
          else if (src.includes("webhook")) totals.fromWebhook++;
          else if (src.includes("csv")) totals.fromCsv++;
          const status = (s.status || "").toString().toLowerCase();
          if (status.includes("deliver")) totals.delivered++;
          else if (status.includes("fail") || status.includes("return") || status.includes("exception")) totals.failed++;
          else if (status.includes("skip")) totals.skipped++;
          else if (status.includes("out-for-delivery") || status.includes("out for delivery") || status.includes("in transit") || status.includes("on vehicle")) totals.outForDelivery++;
          else if (status.includes("collect") || status === "picked up") totals.collected++;
        }
      }
      res.json(totals);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Manual close-out: mark the given shipment ids as delivered everywhere
  // (status="delivered" on the row in every project that contains it, plus
  // stopStatuses["D_<id>"]="DONE"), and optionally purge any row whose
  // stored status is "quote". Used to close out a day when ShipLogic never
  // sent a delivered webhook for a CSV-only shipment, or to drop stray
  // quote rows. Broadcasts an SSE event so dispatcher tabs update live.
  //
  // POST /api/dispatch/mark-shipments-delivered
  // body: { shipmentIds: string[], purgeQuotes?: boolean }
  app.post("/api/dispatch/mark-shipments-delivered", requireDispatcherAuth, async (req, res) => {
    try {
      const shipmentIds: string[] = Array.isArray(req.body?.shipmentIds)
        ? req.body.shipmentIds.filter((s: any) => typeof s === "string" && s)
        : [];
      const purgeQuotes: boolean = !!req.body?.purgeQuotes;
      if (shipmentIds.length === 0 && !purgeQuotes) {
        return res.status(400).json({ message: "shipmentIds[] or purgeQuotes required" });
      }
      const targetIds = new Set(shipmentIds);
      const nowIso = new Date().toISOString();
      const projects = await storage.getProjects();

      let markedCount = 0;
      let purgedCount = 0;
      const touchedProjects: Array<{ projectId: string; name: string; marked: string[]; purged: string[] }> = [];

      for (const proj of projects) {
        const ships = ((proj.shipments as any[]) || []);
        if (ships.length === 0) continue;
        const stopStatuses = { ...((proj.stopStatuses || {}) as Record<string, string>) };
        const marked: string[] = [];
        const purged: string[] = [];
        const purgedRows: any[] = [];
        let mutated = false;

        const nextShips: any[] = [];
        for (const s of ships) {
          // Quote purge first — drop the row outright.
          if (purgeQuotes && String(s?.status || "").toLowerCase().trim() === "quote") {
            purged.push(s.wb || s.id);
            purgedRows.push(s);
            purgedCount++;
            mutated = true;
            continue;
          }
          // Mark delivered if id is in the target set.
          if (s?.id && targetIds.has(s.id)) {
            const ev = {
              timestamp: nowIso,
              status: "delivered",
              source: "dispatcher-manual",
              note: "Manually marked delivered by dispatcher",
            };
            const existingEvents = Array.isArray(s.webhookEvents) ? s.webhookEvents : [];
            nextShips.push({
              ...s,
              status: "delivered",
              webhookEvents: [...existingEvents, ev],
            });
            stopStatuses[`D_${s.id}`] = "DONE";
            marked.push(s.wb || s.id);
            markedCount++;
            mutated = true;
            continue;
          }
          nextShips.push(s);
        }

        if (!mutated) continue;

        // Prune orphaned assignments / driverStopSequences for purged ids.
        const keptIds = new Set(nextShips.map((s: any) => s.id).filter(Boolean));
        const assignments = { ...((proj.assignments || {}) as Record<string, string>) };
        for (const id of Object.keys(assignments)) {
          if (!keptIds.has(id)) delete assignments[id];
        }
        const driverStopSequences = { ...((proj.driverStopSequences || {}) as Record<string, string[]>) };
        for (const dId of Object.keys(driverStopSequences)) {
          driverStopSequences[dId] = (driverStopSequences[dId] || []).filter((id) => keptIds.has(id));
        }
        // Also drop stopStatuses keys whose ids no longer exist.
        for (const k of Object.keys(stopStatuses)) {
          if (!k.startsWith("C_") && !k.startsWith("D_")) continue;
          const parts = k.slice(2).split("_");
          if (!parts.some((p) => keptIds.has(p))) delete stopStatuses[k];
        }

        await storage.updateProject(proj.id, {
          shipments: nextShips,
          assignments,
          driverStopSequences,
          stopStatuses,
        } as any);

        // Broadcast one SSE per marked shipment using the existing
        // `webhook_shipment_updated` topic so the client's existing handler
        // (a) patches the row's status to delivered via setShips, and
        // (b) applies the D_<id>=DONE stopStatuses patch. Without this the
        // tile won't drop until the user reloads.
        if (marked.length > 0) {
          for (const id of shipmentIds) {
            if (!keptIds.has(id)) continue;
            const row = nextShips.find((x: any) => x.id === id);
            if (!row) continue;
            broadcastWebhookEvent({
              topic: "webhook_shipment_updated",
              processed: true,
              message: `Manually marked ${row.wb || id} delivered`,
              projectId: proj.id,
              waybill: row.wb || id,
              stopStatusesPatch: { [`D_${id}`]: "DONE" },
              updatedShipment: {
                id,
                wb: row.wb,
                trackingRef: row.trackingRef,
                customRef: row.customRef,
                status: "delivered",
              },
            });
          }
        }
        // For purged quote rows, emit a per-row update flipping the row to
        // "cancelled" so the existing client SSE handler patches local
        // ships state. isShipmentOpen treats "cancelled" as terminal, so
        // the row falls out of openDayShips and the tile updates. The DB
        // row is already removed above.
        for (const s of purgedRows) {
          broadcastWebhookEvent({
            topic: "webhook_shipment_updated",
            processed: true,
            message: `Purged quote ${s.wb || s.id}`,
            projectId: proj.id,
            waybill: s.wb || s.id,
            updatedShipment: {
              id: s.id,
              wb: s.wb,
              trackingRef: s.trackingRef,
              customRef: s.customRef,
              status: "cancelled",
            },
          });
        }

        touchedProjects.push({ projectId: proj.id, name: proj.name, marked, purged });
      }

      res.json({ ok: true, markedCount, purgedCount, projects: touchedProjects });
    } catch (error: any) {
      console.error("[mark-shipments-delivered] failed:", error?.message || error);
      res.status(500).json({ message: error?.message || "mark-delivered failed" });
    }
  });

  // Undo a previous manual close-out. Walks every project, finds shipments
  // whose most recent webhookEvents entry has source="dispatcher-manual",
  // and reverts them:
  //   - status reset to the status of the prior event (or "collection-assigned" fallback)
  //   - the manual event is removed from webhookEvents
  //   - stopStatuses["D_<id>"] cleared (back to PENDING)
  // Optional body filter: { shipmentIds?: string[], waybills?: string[] } —
  // when provided, only those rows are reverted. Otherwise every manually
  // marked row across all projects is reverted.
  //
  // POST /api/dispatch/unmark-shipments-delivered
  app.post("/api/dispatch/unmark-shipments-delivered", requireDispatcherAuth, async (req, res) => {
    try {
      const idFilter: Set<string> | null = Array.isArray(req.body?.shipmentIds) && req.body.shipmentIds.length > 0
        ? new Set(req.body.shipmentIds.filter((s: any) => typeof s === "string"))
        : null;
      const wbFilter: Set<string> | null = Array.isArray(req.body?.waybills) && req.body.waybills.length > 0
        ? new Set(req.body.waybills.filter((s: any) => typeof s === "string"))
        : null;

      const projects = await storage.getProjects();
      let revertedCount = 0;
      const touchedProjects: Array<{ projectId: string; name: string; reverted: string[] }> = [];

      for (const proj of projects) {
        const ships = ((proj.shipments as any[]) || []);
        if (ships.length === 0) continue;
        const stopStatuses = { ...((proj.stopStatuses || {}) as Record<string, string>) };
        const reverted: string[] = [];
        let mutated = false;

        const nextShips = ships.map((s: any) => {
          if (idFilter && !idFilter.has(s.id)) return s;
          if (wbFilter && !wbFilter.has(s.wb)) return s;
          const events = Array.isArray(s.webhookEvents) ? s.webhookEvents : [];
          // Look for ANY dispatcher-manual event in history, not just the
          // last entry — a later webhook may have appended after the manual
          // mark, leaving `last` non-manual. We still want to undo.
          const hasManual = events.some((e: any) => e && e.source === "dispatcher-manual");
          // Also catch rows that are clearly stale-delivered with no events
          // at all (CSV-only rows that we marked via the popover).
          const isOrphanedDelivered = !hasManual
            && (idFilter || wbFilter)  // only when explicitly targeted
            && String(s?.status || "").toLowerCase() === "delivered";
          if (!hasManual && !isOrphanedDelivered) return s;
          const trimmed = events.filter((e: any) => !(e && e.source === "dispatcher-manual"));
          // Prior status: walk backwards for the most recent non-manual event.
          let priorStatus = "";
          for (let i = trimmed.length - 1; i >= 0; i--) {
            if (trimmed[i] && trimmed[i].status) {
              priorStatus = trimmed[i].status;
              break;
            }
          }
          if (!priorStatus) priorStatus = "collection-assigned";
          delete stopStatuses[`D_${s.id}`];
          reverted.push(s.wb || s.id);
          revertedCount++;
          mutated = true;
          return { ...s, status: priorStatus, webhookEvents: trimmed };
        });

        if (!mutated) continue;
        await storage.updateProject(proj.id, {
          shipments: nextShips,
          stopStatuses,
        } as any);

        for (const row of nextShips) {
          if (!reverted.includes(row.wb || row.id)) continue;
          broadcastWebhookEvent({
            topic: "webhook_shipment_updated",
            processed: true,
            message: `Restored ${row.wb || row.id} to ${row.status}`,
            projectId: proj.id,
            waybill: row.wb || row.id,
            stopStatusesPatch: { [`D_${row.id}`]: "PENDING" },
            updatedShipment: {
              id: row.id,
              wb: row.wb,
              trackingRef: row.trackingRef,
              customRef: row.customRef,
              status: row.status,
            },
          });
        }

        touchedProjects.push({ projectId: proj.id, name: proj.name, reverted });
      }

      res.json({ ok: true, revertedCount, projects: touchedProjects });
    } catch (error: any) {
      console.error("[unmark-shipments-delivered] failed:", error?.message || error);
      res.status(500).json({ message: error?.message || "unmark failed" });
    }
  });

  // One-shot maintenance: scan every project's shipments[], collapse any
  // duplicate-by-reference rows (same wb / id / trackingRef / customRef),
  // and persist the cleaned list. Then run a CROSS-PROJECT pass that
  // collapses the same parcel appearing in both a dispatcher "session"
  // project and a webhook auto-created date-bucket project. Returns a
  // per-project report.
  app.post("/api/dispatch/dedupe-projects", requireDispatcherAuth, async (_req, res) => {
    try {
      const { dedupeAndEnrichShipmentsFromWebhooks } = await import("./lib/webhook-import");
      let projects = await storage.getProjects();
      const report: Array<{ projectId: string; name: string; before: number; after: number; removed: number; corrected: string[] }> = [];
      let totalRemoved = 0;
      for (const proj of projects) {
        const ships = ((proj.shipments as any[]) || []);
        if (ships.length === 0) continue;
        const enriched = await dedupeAndEnrichShipmentsFromWebhooks(ships);
        if (enriched.removedDuplicates > 0 || enriched.correctedWaybills.length > 0) {
          // Also drop assignments/sequences/stopStatuses keyed by removed shipment ids.
          const keptIds = new Set(enriched.shipments.map((s: any) => s.id).filter(Boolean));
          const assignments = { ...((proj.assignments || {}) as Record<string, string>) };
          for (const id of Object.keys(assignments)) {
            if (!keptIds.has(id)) delete assignments[id];
          }
          const driverStopSequences = { ...((proj.driverStopSequences || {}) as Record<string, string[]>) };
          for (const dId of Object.keys(driverStopSequences)) {
            driverStopSequences[dId] = (driverStopSequences[dId] || []).filter((id) => keptIds.has(id));
          }
          const stopStatuses = { ...((proj.stopStatuses || {}) as Record<string, string>) };
          for (const k of Object.keys(stopStatuses)) {
            if (!k.startsWith("C_") && !k.startsWith("D_")) continue;
            // Stop keys are "C_<id>" / "D_<id>" or "C_<idA>_<idB>" (grouped).
            const parts = k.slice(2).split("_");
            if (!parts.some((p) => keptIds.has(p))) delete stopStatuses[k];
          }
          await storage.updateProject(proj.id, {
            shipments: enriched.shipments,
            assignments,
            driverStopSequences,
            stopStatuses,
          } as any);
          totalRemoved += enriched.removedDuplicates;
        }
        report.push({
          projectId: proj.id,
          name: proj.name,
          before: ships.length,
          after: enriched.shipments.length,
          removed: enriched.removedDuplicates,
          corrected: enriched.correctedWaybills,
        });
      }

      // CROSS-PROJECT PASS — collapse the same parcel appearing in a
      // dispatcher "session" project AND a webhook auto-bucket project.
      // This happens when a CSV-imported shipment also has a ShipLogic
      // webhook flow: the auto-import lands in the date bucket, the CSV
      // intake lands in the session, and neither sees the other. Only the
      // session-AND-bucket pairing is collapsed here — bucket-only
      // duplicates would already have been folded in the per-project pass.
      //
      // Policy: the SESSION copy is canonical (it's where the dispatcher
      // works, holds manual assignments and edits). The bucket copy's
      // webhook history is merged into the session copy, and the bucket
      // copy is then removed. Bucket projects with no session twin are
      // left alone — they belong to a date the dispatcher hasn't loaded yet.
      projects = await storage.getProjects(); // re-read after per-project writes
      const sessionProjects = projects.filter((p) => p.name === "session");
      const bucketProjects = projects.filter((p) => /^\d{4}-\d{2}-\d{2} /.test(p.name) || /Deliveries$/.test(p.name));

      // Build a map: waybill/id/ref -> { project, shipment } for session shipments.
      type Locator = { proj: any; ship: any };
      const sessionIndex = new Map<string, Locator>();
      for (const proj of sessionProjects) {
        for (const s of ((proj.shipments as any[]) || [])) {
          const refs = [s.wb, s.id, s.trackingRef, s.customRef].filter(Boolean);
          for (const r of refs) {
            if (!sessionIndex.has(r)) sessionIndex.set(r, { proj, ship: s });
          }
        }
      }

      const crossReport: Array<{ bucketProjectId: string; bucketName: string; removedWaybills: string[]; mergedIntoSession: string }> = [];

      // For each bucket project, find shipments that are also in the session.
      // Within the per-bucket pass, accumulate edits then write once.
      for (const bucket of bucketProjects) {
        const bucketShips = ((bucket.shipments as any[]) || []);
        if (bucketShips.length === 0) continue;
        const removedWaybills: string[] = [];
        const keptShips: any[] = [];
        // Group shipment updates by session project so we batch writes per
        // session project (there's typically only one anyway).
        const sessionEdits = new Map<string, { proj: any; shipById: Map<string, any> }>();

        for (const bShip of bucketShips) {
          const refs = [bShip.wb, bShip.id, bShip.trackingRef, bShip.customRef].filter(Boolean);
          let twin: Locator | null = null;
          for (const r of refs) {
            const hit = sessionIndex.get(r);
            if (hit) { twin = hit; break; }
          }
          if (!twin) {
            keptShips.push(bShip);
            continue;
          }
          // Found a session twin. Merge webhook events history + the latest
          // status forward onto the session copy. Don't touch dispatcher-
          // edited fields like assignments (handled outside the shipment row).
          const sessProj = twin.proj;
          const sessShip = twin.ship;
          let edit = sessionEdits.get(sessProj.id);
          if (!edit) {
            edit = { proj: sessProj, shipById: new Map() };
            sessionEdits.set(sessProj.id, edit);
          }
          const current = edit.shipById.get(sessShip.id) || sessShip;
          // Merge webhook events by timestamp+status (de-dupe identical entries).
          const eventsA = Array.isArray(current.webhookEvents) ? current.webhookEvents : [];
          const eventsB = Array.isArray(bShip.webhookEvents) ? bShip.webhookEvents : [];
          const seen = new Set<string>();
          const mergedEvents: any[] = [];
          for (const e of [...eventsA, ...eventsB]) {
            const k = `${e.timestamp || ""}|${e.status || ""}|${e.source || ""}`;
            if (seen.has(k)) continue;
            seen.add(k);
            mergedEvents.push(e);
          }
          mergedEvents.sort((a, b) => String(a.timestamp || "").localeCompare(String(b.timestamp || "")));
          // Pick the most advanced status between the two.
          const winningStatus = rankShipmentStatus(bShip.status) > rankShipmentStatus(current.status) ? bShip.status : current.status;
          const merged: any = { ...current, webhookEvents: mergedEvents, status: winningStatus };
          // Mark source so audits can see this row absorbed a webhook bucket twin.
          const srcParts = new Set([
            ...String(current.source || "").split("+").map((p) => p.trim()).filter(Boolean),
            ...String(bShip.source || "").split("+").map((p) => p.trim()).filter(Boolean),
          ]);
          merged.source = Array.from(srcParts).join("+") || "webhook";
          edit.shipById.set(sessShip.id, merged);
          removedWaybills.push(bShip.wb || bShip.id);
        }

        if (removedWaybills.length === 0) continue;

        // Persist the session-side merged shipments.
        for (const edit of Array.from(sessionEdits.values())) {
          const sessShips = ((edit.proj.shipments as any[]) || []).map((s: any) =>
            edit.shipById.has(s.id) ? edit.shipById.get(s.id) : s
          );
          // Carry forward bucket's stop-status entries that reference the
          // session twin's id (in case the dispatcher already routed them).
          await storage.updateProject(edit.proj.id, { shipments: sessShips } as any);
        }

        // Now write the bucket with the de-duplicated shipments list. Also
        // strip assignments/sequences/stopStatuses keyed by removed ids.
        const removedIds = new Set(bucketShips.filter((bs: any) => !keptShips.includes(bs)).map((bs: any) => bs.id).filter(Boolean));
        const keptIds = new Set(keptShips.map((s: any) => s.id).filter(Boolean));
        const bAsgn = { ...((bucket.assignments || {}) as Record<string, string>) };
        for (const id of Object.keys(bAsgn)) if (removedIds.has(id)) delete bAsgn[id];
        const bSeqs = { ...((bucket.driverStopSequences || {}) as Record<string, string[]>) };
        for (const dId of Object.keys(bSeqs)) bSeqs[dId] = (bSeqs[dId] || []).filter((id) => !removedIds.has(id));
        const bStops = { ...((bucket.stopStatuses || {}) as Record<string, string>) };
        for (const k of Object.keys(bStops)) {
          if (!k.startsWith("C_") && !k.startsWith("D_")) continue;
          const parts = k.slice(2).split("_");
          if (parts.some((p) => removedIds.has(p)) && !parts.some((p) => keptIds.has(p))) {
            delete bStops[k];
          }
        }
        await storage.updateProject(bucket.id, {
          shipments: keptShips,
          assignments: bAsgn,
          driverStopSequences: bSeqs,
          stopStatuses: bStops,
        } as any);

        crossReport.push({
          bucketProjectId: bucket.id,
          bucketName: bucket.name,
          removedWaybills,
          mergedIntoSession: Array.from(sessionEdits.values()).map((e) => e.proj.name).join(", "),
        });
        totalRemoved += removedWaybills.length;
      }

      res.json({ ok: true, totalRemoved, projects: report, crossProject: crossReport });
    } catch (error: any) {
      console.error("[dedupe-projects] failed:", error?.message || error);
      res.status(500).json({ message: error?.message || "dedupe failed" });
    }
  });

  // Diagnostic: for a given date (default "today" in Africa/Johannesburg),
  // walk every shipment landing in that date bucket and report:
  //   - storedStatus       — the status field saved on the shipment row
  //   - latestWebhookStatus — newest entry in shipment.webhookEvents[]
  //   - latestWebhookEventDb — newest matching row in webhook_events table,
  //                            with how it matched (wb/id/trackingRef/...)
  //   - stopStatusD         — value in project.stopStatuses for the D_<id>
  //                           (or grouped) key, if any
  //   - openByLifecycle     — would dispatch.tsx count this as "open" right now?
  //
  // Use this to triage why specific shipments still show open after delivery.
  // GET /api/dispatch/diag/today-shipments?date=2026-05-22
  app.get("/api/dispatch/diag/today-shipments", requireDispatcherAuth, async (req, res) => {
    try {
      const reqDate = (req.query.date as string || "").slice(0, 10);
      const todayDate = reqDate || new Date().toLocaleDateString("en-CA", { timeZone: "Africa/Johannesburg" });
      const projects = await storage.getProjects();
      const { webhookEvents: webhookEventsTable } = await import("@shared/schema");
      const { sql: dsql, desc } = await import("drizzle-orm");
      const { db } = await import("./db");

      const isOpen = (raw: string): boolean => {
        const n = String(raw || "").toLowerCase().trim().replace(/[-_]/g, " ");
        if (!n) return true;
        if (n.includes("delivered")) return false;
        if (n.includes("fail")) return false;
        if (n.includes("cancel")) return false;
        if (n.includes("return")) return false;
        if (n.includes("exception")) return false;
        return true;
      };

      type Row = {
        projectId: string; projectName: string;
        shipmentId: string; wb: string; trackingRef: string; customRef: string;
        delDate: string; colDate: string; createdAt: string;
        storedStatus: string; storedSource: string;
        latestWebhookStatus: string; latestWebhookAt: string;
        latestWebhookEventDb: { id: number; topic: string; status: string; receivedAt: string; matchedBy: string } | null;
        stopStatusD: string; stopStatusC: string;
        openByLifecycle: boolean;
      };
      const rows: Row[] = [];
      const allRefs = new Set<string>();

      for (const proj of projects) {
        const ships = (proj.shipments as any[]) || [];
        const stopStatuses = (proj.stopStatuses || {}) as Record<string, string>;
        const groupings = (proj.stopGroupings || {}) as Record<string, Array<{ ids: string[]; type: string }>>;
        for (const s of ships) {
          const d = (s.delDate || s.colDate || "").slice(0, 10);
          if (d !== todayDate) continue;
          const refs = [s.wb, s.id, s.trackingRef, s.customRef].filter(Boolean);
          refs.forEach((r) => allRefs.add(String(r)));
          const events = Array.isArray(s.webhookEvents) ? s.webhookEvents : [];
          const sorted = [...events].sort((a: any, b: any) => String(b.timestamp || "").localeCompare(String(a.timestamp || "")));
          const lastEv = sorted[0] || null;

          // Resolve grouped D-stop key if any.
          let groupedDKey: string | null = null;
          let groupedCKey: string | null = null;
          for (const driverId of Object.keys(groupings)) {
            for (const g of groupings[driverId] || []) {
              if (!g?.ids?.includes(s.id)) continue;
              const key = `${g.type}_${[...g.ids].sort().join("_")}`;
              if (g.type === "D") groupedDKey = key;
              if (g.type === "C") groupedCKey = key;
            }
          }
          const directD = s.id ? `D_${s.id}` : "";
          const directC = s.id ? `C_${s.id}` : "";
          const stopStatusD = (stopStatuses[directD] || (groupedDKey ? stopStatuses[groupedDKey] : "") || "").toUpperCase();
          const stopStatusC = (stopStatuses[directC] || (groupedCKey ? stopStatuses[groupedCKey] : "") || "").toUpperCase();

          rows.push({
            projectId: proj.id, projectName: proj.name,
            shipmentId: s.id || "", wb: s.wb || "",
            trackingRef: s.trackingRef || "", customRef: s.customRef || "",
            delDate: s.delDate || "", colDate: s.colDate || "",
            createdAt: s.created || "",
            storedStatus: s.status || "",
            storedSource: s.source || "",
            latestWebhookStatus: lastEv?.status || "",
            latestWebhookAt: lastEv?.timestamp || "",
            latestWebhookEventDb: null,
            stopStatusD, stopStatusC,
            openByLifecycle: isOpen(s.status || ""),
          });
        }
      }

      // For each row, look up the latest webhook_events DB row whose `waybill`
      // matches ANY of the shipment's reference fields, so we can spot rows
      // whose webhooks arrived under a different ref than is stored locally.
      if (allRefs.size > 0) {
        const refsArr = Array.from(allRefs);
        const dbRows = await db.execute<{ id: number; topic: string; waybill: string; payload: any; received_at: string; processed: boolean; error: string | null }>(dsql`
          SELECT id, topic, waybill, payload, received_at, processed, error
          FROM ${webhookEventsTable}
          WHERE waybill IN (${dsql.join(refsArr.map((r) => dsql`${r}`), dsql`, `)})
          ORDER BY received_at DESC
        `);
        const byRef = new Map<string, Array<{ id: number; topic: string; status: string; receivedAt: string; waybill: string }>>();
        for (const r of (dbRows as any).rows || (dbRows as any)) {
          if (!r?.waybill) continue;
          const status = String(
            r.payload?.status
            || r.payload?.event_status
            || r.payload?.tracking_status
            || r.payload?.data?.status
            || ""
          );
          if (!byRef.has(r.waybill)) byRef.set(r.waybill, []);
          byRef.get(r.waybill)!.push({ id: r.id, topic: r.topic, status, receivedAt: r.received_at, waybill: r.waybill });
        }
        for (const row of rows) {
          const tried: Array<{ ref: string; field: string; events: Array<{ id: number; topic: string; status: string; receivedAt: string }> }> = [];
          const fieldsToTry: Array<[string, string]> = [
            ["wb", row.wb], ["id", row.shipmentId],
            ["trackingRef", row.trackingRef], ["customRef", row.customRef],
          ];
          let chosen: { id: number; topic: string; status: string; receivedAt: string; matchedBy: string } | null = null;
          for (const [field, ref] of fieldsToTry) {
            if (!ref) continue;
            const events = byRef.get(ref);
            if (!events || events.length === 0) continue;
            tried.push({ ref, field, events: events.slice(0, 3) });
            // Use the newest event seen across any ref.
            const newest = events[0];
            if (!chosen || newest.receivedAt > chosen.receivedAt) {
              chosen = { ...newest, matchedBy: field };
            }
          }
          row.latestWebhookEventDb = chosen;
          (row as any)._refsTried = tried; // diagnostic detail
        }
      }

      const summary = {
        date: todayDate,
        total: rows.length,
        openByLifecycle: rows.filter((r) => r.openByLifecycle).length,
        markedDoneAtStopLevel: rows.filter((r) => r.stopStatusD === "DONE").length,
        webhookSaysDeliveredButStoredOpen: rows.filter((r) => {
          const s = (r.latestWebhookEventDb?.status || r.latestWebhookStatus || "").toLowerCase();
          return r.openByLifecycle && (s.includes("deliver") || s.includes("pod"));
        }).length,
        noWebhookFoundForRow: rows.filter((r) => !r.latestWebhookEventDb && !r.latestWebhookStatus).length,
        sources: rows.reduce((m: Record<string, number>, r) => { m[r.storedSource || "(none)"] = (m[r.storedSource || "(none)"] || 0) + 1; return m; }, {} as Record<string, number>),
      };

      res.json({ summary, rows });
    } catch (error: any) {
      console.error("[diag/today-shipments] failed:", error?.message || error);
      res.status(500).json({ message: error?.message || "diagnostic failed" });
    }
  });

  app.get("/api/dispatch/all-shipments", requireDispatcherAuth, async (req, res) => {
    try {
      const projects = await storage.getProjects();
      const search = ((req.query.search as string) || "").trim().toLowerCase();
      const statusFilter = ((req.query.status as string) || "").trim().toLowerCase();
      const sourceFilter = ((req.query.source as string) || "").trim().toLowerCase();
      const projectFilter = ((req.query.project as string) || "").trim();
      const page = Math.max(1, parseInt(req.query.page as string) || 1);
      const limit = Math.min(100, Math.max(10, parseInt(req.query.limit as string) || 20));

      interface AggShipment {
        id: string; wb: string; acc: string; client: string; clientName: string;
        pcs: number; kg: number; svc: string; rate: number; perish: boolean;
        cAddr: string; cSub: string; cCity: string; cPostal: string;
        cLat: number; cLng: number; cContact: string; cPhone: string;
        dAddr: string; dSub: string; dCity: string; dPostal: string;
        dLat: number; dLng: number; dContact: string; dPhone: string;
        dAfter: string; dBefore: string;
        origDAfter: string; origDBefore: string;
        hasDeliveryOverride: boolean;
        zone: string; status: string; source: string;
        colDate: string; delDate: string; lDelDate: string; created: string;
        trackUrl: string; parcelType: string; parcelCategory: string;
        webhookEvents: Array<{timestamp: string; status: string; source: string; message: string}>;
        projectName: string; projectId: string;
        assignedDriver: string;
        stopStatus: string;
      }

      const allShipments: AggShipment[] = [];

      for (const proj of projects) {
        const shipments = (proj.shipments || []) as any[];
        const assignments = (proj.assignments || {}) as Record<string, string>;
        const stopStatuses = (proj.stopStatuses || {}) as Record<string, string>;
        // Apply dispatcher delivery-window overrides so the Shipments tab
        // shows the effective dAfter/dBefore (and surfaces the original
        // sender-requested window via origDAfter/origDBefore for the badge).
        const overrides = (proj.deliveryOverrides || {}) as Record<string, { dAfter?: string; dBefore?: string }>;

        for (const s of shipments) {
          const assignedDriver = s.id ? (assignments[s.id] || "") : "";
          // FIX: stopStatuses keys are stored as `D_<shipment.id>` (single)
          // or `D_<idA>_<idB>_...` (grouped, ids sorted). The previous key
          // format `${dSub}_${dCity}_D` never matched anything in storage,
          // so this aggregator always reported "pending" — delivered
          // shipments looked undelivered to anything that read this field.
          const sid = s.id || "";
          let resolvedStopStatus = "";
          if (sid) {
            const directDKey = `D_${sid}`;
            if (stopStatuses[directDKey]) {
              resolvedStopStatus = stopStatuses[directDKey];
            } else {
              // Look up grouped delivery stop keys that include this id.
              // Grouped keys look like "D_<idA>_<idB>_..." with ids sorted.
              for (const k of Object.keys(stopStatuses)) {
                if (!k.startsWith("D_")) continue;
                const parts = k.slice(2).split("_");
                if (parts.includes(sid)) { resolvedStopStatus = stopStatuses[k]; break; }
              }
            }
          }
          const stopStatus = normalizeStopStatus(resolvedStopStatus);
          const ov = s.id ? overrides[s.id] : undefined;
          const effDAfter = ov?.dAfter ?? s.dAfter ?? "";
          const effDBefore = ov?.dBefore ?? s.dBefore ?? "";

          allShipments.push({
            id: s.id || "", wb: s.wb || "", acc: s.acc || "", client: s.client || "",
            clientName: s.clientName || s.client || "",
            pcs: s.pcs || 0, kg: s.kg || 0, svc: s.svc || "", rate: s.rate || 0,
            perish: !!s.perish,
            cAddr: s.cAddr || "", cSub: s.cSub || "", cCity: s.cCity || "", cPostal: s.cPostal || "",
            cLat: s.cLat || 0, cLng: s.cLng || 0, cContact: s.cContact || "", cPhone: s.cPhone || "",
            dAddr: s.dAddr || "", dSub: s.dSub || "", dCity: s.dCity || "", dPostal: s.dPostal || "",
            dLat: s.dLat || 0, dLng: s.dLng || 0, dContact: s.dContact || "", dPhone: s.dPhone || "",
            dAfter: effDAfter,
            dBefore: effDBefore,
            origDAfter: ov ? (s.dAfter || "") : "",
            origDBefore: ov ? (s.dBefore || "") : "",
            hasDeliveryOverride: !!ov,
            zone: s.zone || "", status: s.status || "",
            source: s.source || "csv",
            colDate: s.colDate || "", delDate: s.delDate || "", lDelDate: s.lDelDate || "",
            created: s.created || "",
            trackUrl: s.trackUrl || "", parcelType: s.parcelType || "", parcelCategory: s.parcelCategory || "",
            webhookEvents: s.webhookEvents || [],
            projectName: proj.name, projectId: proj.id,
            assignedDriver,
            stopStatus,
          });
        }
      }

      let filtered = allShipments;

      if (search) {
        filtered = filtered.filter((s) =>
          s.wb.toLowerCase().includes(search) ||
          s.acc.toLowerCase().includes(search) ||
          s.clientName.toLowerCase().includes(search) ||
          s.dContact.toLowerCase().includes(search) ||
          s.dAddr.toLowerCase().includes(search) ||
          s.dSub.toLowerCase().includes(search) ||
          s.cAddr.toLowerCase().includes(search) ||
          s.assignedDriver.toLowerCase().includes(search)
        );
      }

      if (statusFilter) {
        filtered = filtered.filter((s) => {
          const latestWebhookStatus = s.webhookEvents.length > 0
            ? s.webhookEvents[s.webhookEvents.length - 1].status.toLowerCase()
            : "";
          const shipStatus = s.status.toLowerCase();
          const combined = latestWebhookStatus || shipStatus || s.stopStatus;
          // The "done" filter historically matched a stop-level "done" value;
          // stop statuses are now canonicalised to "completed", so treat the
          // two as equivalent to preserve the filter's behaviour.
          if (statusFilter === "done") return combined.includes("done") || combined.includes("completed");
          return combined.includes(statusFilter);
        });
      }

      if (sourceFilter) {
        filtered = filtered.filter((s) => s.source.toLowerCase().includes(sourceFilter));
      }

      if (projectFilter) {
        filtered = filtered.filter((s) => s.projectId === projectFilter);
      }

      filtered.sort((a, b) => {
        const aTime = a.created ? new Date(a.created).getTime() : 0;
        const bTime = b.created ? new Date(b.created).getTime() : 0;
        return bTime - aTime;
      });

      const total = filtered.length;
      const totalPages = Math.ceil(total / limit);
      const start = (page - 1) * limit;
      const pageItems = filtered.slice(start, start + limit);

      const projectOptions = projects.map((p) => ({ id: p.id, name: p.name }));

      res.json({
        shipments: pageItems,
        page,
        limit,
        total,
        totalPages,
        projects: projectOptions,
      });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : "Unknown error";
      res.status(500).json({ message: msg });
    }
  });

  // Set or clear a delivery-window override for a single shipment in a project.
  // Used by ShipmentsListTab (cross-project) and any other surface that doesn't
  // hold the dispatch in-memory state.
  app.patch("/api/dispatch/projects/:projectId/delivery-overrides", requireDispatcherAuth, async (req, res) => {
    try {
      const projectId = req.params.projectId;
      const { shipmentId, dAfter, dBefore, pinnedTime, clear } = req.body as {
        shipmentId?: string; dAfter?: string; dBefore?: string; pinnedTime?: string; clear?: boolean;
      };
      if (!shipmentId) return res.status(400).json({ message: "shipmentId required" });

      const project = await storage.getProject(projectId);
      if (!project) return res.status(404).json({ message: "Project not found" });

      const existing = ((project as unknown as {
        deliveryOverrides?: Record<string, { dAfter?: string; dBefore?: string; pinnedTime?: string; setAt?: string; setBy?: string }>;
      }).deliveryOverrides) || {};
      const next: Record<string, { dAfter?: string; dBefore?: string; pinnedTime?: string; setAt: string; setBy?: string }> = { ...existing } as any;

      const hhmm = /^\d{2}:\d{2}$/;
      const parseHHMM = (s: string, isEnd: boolean): number | null => {
        const [hStr, mStr] = s.split(":");
        const h = Number(hStr); const m = Number(mStr);
        if (!Number.isInteger(h) || !Number.isInteger(m)) return null;
        if (m < 0 || m > 59) return null;
        if (h === 24) return isEnd && m === 0 ? 24 * 60 : null;
        if (h < 0 || h > 23) return null;
        return h * 60 + m;
      };

      if (clear) {
        delete next[shipmentId];
      } else if (pinnedTime) {
        if (!hhmm.test(pinnedTime) || parseHHMM(pinnedTime, false) == null) {
          return res.status(400).json({ message: "pinnedTime must be HH:MM (00:00–23:59)" });
        }
        let setBy: string | undefined;
        try {
          const uid = (req as any).session?.userId;
          if (uid) {
            const u = await storage.getUser(uid);
            setBy = u?.displayName || u?.email || String(uid);
          }
        } catch { /* non-fatal */ }
        next[shipmentId] = { pinnedTime, setAt: new Date().toISOString(), ...(setBy ? { setBy } : {}) };
      } else {
        if (!dAfter || !dBefore || !hhmm.test(dAfter) || !hhmm.test(dBefore)) {
          return res.status(400).json({ message: "dAfter and dBefore must be HH:MM" });
        }
        const aMin = parseHHMM(dAfter, false);
        const bMin = parseHHMM(dBefore, true);
        if (aMin == null || bMin == null) {
          return res.status(400).json({ message: "Times must be 00:00–23:59 (or 24:00 as end)" });
        }
        if (aMin >= bMin) {
          return res.status(400).json({ message: "dAfter must be before dBefore" });
        }
        let setBy: string | undefined;
        try {
          const uid = (req as any).session?.userId;
          if (uid) {
            const u = await storage.getUser(uid);
            setBy = u?.displayName || u?.email || String(uid);
          }
        } catch { /* non-fatal */ }
        next[shipmentId] = { dAfter, dBefore, setAt: new Date().toISOString(), ...(setBy ? { setBy } : {}) };
      }

      // Persist the override AND clear the saved per-driver stop sequence so
      // the next dispatcher session re-optimizes against the new window
      // (mirrors what dispatch.tsx does in-memory via runOptimizer after a
      // local override). Active Ops sessions also poll/refresh project state.
      await storage.updateProject(projectId, {
        deliveryOverrides: next,
        driverStopSequences: {},
      } as any);

      // Invalidate ETA caches keyed off project sequencing/windows so the
      // driver app + Live Map reflect the new window on next poll instead
      // of waiting for TTL expiry.
      driverEtaCache.clear();
      allStopsEtaCache.clear();

      // Audit trail so this mutation is visible alongside in-page overrides.
      try {
        await storage.createAuditLog({
          eventType: clear ? "DELIVERY_WINDOW_OVERRIDE_CLEARED" : "DELIVERY_WINDOW_OVERRIDDEN",
          entityType: "shipment",
          entityId: shipmentId,
          previousValue: existing[shipmentId] ?? null,
          newValue: clear ? null : next[shipmentId],
          details: `Project ${projectId}: ${clear ? "override cleared" : pinnedTime ? `pinned ${pinnedTime}` : `set ${dAfter}–${dBefore}`} (via Shipments tab)`,
        } as any);
      } catch { /* non-fatal */ }

      // Push to any open Dispatch sessions via the existing webhook SSE channel
      // so they can update in-memory state and re-run the optimizer immediately.
      try {
        broadcastWebhookEvent({
          topic: "delivery_override_changed",
          projectId,
          shipmentId,
          deliveryOverride: clear ? null : next[shipmentId],
          message: clear
            ? `Delivery override cleared for shipment ${shipmentId}`
            : pinnedTime
              ? `Delivery for ${shipmentId} pinned to ${pinnedTime}`
              : `Delivery window for ${shipmentId} set to ${dAfter}–${dBefore}`,
        });
      } catch (err) {
        console.warn("[delivery-override PATCH] SSE broadcast failed:", err);
      }

      res.json({ ok: true, deliveryOverrides: next, reoptimizeRequested: true });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : "Unknown error";
      res.status(500).json({ message: msg });
    }
  });

  // Symmetric override endpoint for the collection (pickup) side.
  app.patch("/api/dispatch/projects/:projectId/collection-overrides", requireDispatcherAuth, async (req, res) => {
    try {
      const projectId = req.params.projectId;
      const { shipmentId, cAfter, cBefore, pinnedTime, clear } = req.body as {
        shipmentId?: string; cAfter?: string; cBefore?: string; pinnedTime?: string; clear?: boolean;
      };
      if (!shipmentId) return res.status(400).json({ message: "shipmentId required" });

      const project = await storage.getProject(projectId);
      if (!project) return res.status(404).json({ message: "Project not found" });

      const existing = ((project as unknown as {
        collectionOverrides?: Record<string, { cAfter?: string; cBefore?: string; pinnedTime?: string; setAt?: string; setBy?: string }>;
      }).collectionOverrides) || {};
      const next: Record<string, { cAfter?: string; cBefore?: string; pinnedTime?: string; setAt: string; setBy?: string }> = { ...existing } as any;

      const hhmm = /^\d{2}:\d{2}$/;
      const parseHHMM = (s: string, isEnd: boolean): number | null => {
        const [hStr, mStr] = s.split(":");
        const h = Number(hStr); const m = Number(mStr);
        if (!Number.isInteger(h) || !Number.isInteger(m)) return null;
        if (m < 0 || m > 59) return null;
        if (h === 24) return isEnd && m === 0 ? 24 * 60 : null;
        if (h < 0 || h > 23) return null;
        return h * 60 + m;
      };

      let setBy: string | undefined;
      try {
        const uid = (req as any).session?.userId;
        if (uid) {
          const u = await storage.getUser(uid);
          setBy = u?.displayName || u?.email || String(uid);
        }
      } catch { /* non-fatal */ }

      if (clear) {
        delete next[shipmentId];
      } else if (pinnedTime) {
        if (!hhmm.test(pinnedTime) || parseHHMM(pinnedTime, false) == null) {
          return res.status(400).json({ message: "pinnedTime must be HH:MM (00:00–23:59)" });
        }
        next[shipmentId] = { pinnedTime, setAt: new Date().toISOString(), ...(setBy ? { setBy } : {}) };
      } else {
        if (!cAfter || !cBefore || !hhmm.test(cAfter) || !hhmm.test(cBefore)) {
          return res.status(400).json({ message: "cAfter and cBefore must be HH:MM" });
        }
        const aMin = parseHHMM(cAfter, false);
        const bMin = parseHHMM(cBefore, true);
        if (aMin == null || bMin == null) {
          return res.status(400).json({ message: "Times must be 00:00–23:59 (or 24:00 as end)" });
        }
        if (aMin >= bMin) {
          return res.status(400).json({ message: "cAfter must be before cBefore" });
        }
        next[shipmentId] = { cAfter, cBefore, setAt: new Date().toISOString(), ...(setBy ? { setBy } : {}) };
      }

      await storage.updateProject(projectId, {
        collectionOverrides: next,
        driverStopSequences: {},
      } as any);

      driverEtaCache.clear();
      allStopsEtaCache.clear();

      try {
        await storage.createAuditLog({
          eventType: clear ? "COLLECTION_WINDOW_OVERRIDE_CLEARED" : "COLLECTION_WINDOW_OVERRIDDEN",
          entityType: "shipment",
          entityId: shipmentId,
          previousValue: existing[shipmentId] ?? null,
          newValue: clear ? null : next[shipmentId],
          details: `Project ${projectId}: ${clear ? "override cleared" : pinnedTime ? `pinned ${pinnedTime}` : `set ${cAfter}–${cBefore}`}`,
        } as any);
      } catch { /* non-fatal */ }

      try {
        broadcastWebhookEvent({
          topic: "collection_override_changed",
          projectId,
          shipmentId,
          collectionOverride: clear ? null : next[shipmentId],
          message: clear
            ? `Collection override cleared for shipment ${shipmentId}`
            : pinnedTime
              ? `Collection for ${shipmentId} pinned to ${pinnedTime}`
              : `Collection window for ${shipmentId} set to ${cAfter}–${cBefore}`,
        });
      } catch (err) {
        console.warn("[collection-override PATCH] SSE broadcast failed:", err);
      }

      res.json({ ok: true, collectionOverrides: next, reoptimizeRequested: true });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : "Unknown error";
      res.status(500).json({ message: msg });
    }
  });

  app.get("/api/dispatch/driver-locations", async (_req, res) => {
    try {
      await loadEtaConfig();
      const allDrivers = await storage.getAllDriverAccounts();
      const projects = await storage.getProjects();
      const fleetSetting = await storage.getAppSetting("fleet");
      interface FleetDriver { name?: string; plate?: string; color?: string }
      interface FleetSettingsShape { drivers?: FleetDriver[] }
      const fleetData: FleetSettingsShape = fleetSetting?.value
        ? (typeof fleetSetting.value === "string" ? JSON.parse(fleetSetting.value) : fleetSetting.value) as FleetSettingsShape
        : { drivers: [] };

      interface StopInfo {
        key: string; addr: string; lat: number; lng: number; type: "C" | "D";
        waybills: string[];
        contactName: string; contactPhone: string;
        timeAfter: string;
        timeBefore: string;
      }
      const stopsByDriver = new Map<string, StopInfo[]>();

      for (const d of allDrivers) {
        const result = getActiveProjectAndStops(projects, d.driverName);
        if (!result || result.stops.length === 0) continue;

        const pendingStops = result.stops.filter((s) => isStopActive(s.status));

        const stops: StopInfo[] = pendingStops.map((s) => ({
          key: s.key,
          addr: s.addr || `${s.sub}, ${s.city}`,
          lat: s.lat,
          lng: s.lng,
          type: s.type as "C" | "D",
          waybills: s.wbs || [],
          contactName: s.contact || "",
          contactPhone: s.phone || "",
          timeAfter: s.win ? s.win.split("-")[0] || "" : "",
          timeBefore: s.win ? s.win.split("-")[1] || "" : "",
        }));

        stopsByDriver.set(d.driverName, stops);
      }

      const apiKey = process.env.GOOGLE_ROUTES_API_KEY;
      const now = Date.now();
      const nowMinutes = currentTimeMinutes();

      const driverDataList = allDrivers.map((d) => {
        const fleetMatch = (fleetData.drivers || []).find(
          (fd) => fd.name?.toLowerCase() === d.driverName.toLowerCase()
        );
        const hasCoords = d.currentLat != null && d.currentLng != null;
        const updatedMs = d.locationUpdatedAt ? new Date(d.locationUpdatedAt).getTime() : 0;
        const ageMs = updatedMs ? now - updatedMs : Infinity;
        const tenMinAgo = 10 * 60 * 1000;
        const idleAfterMs = 90 * 1000;
        // Explicit presence: `d.isOnline` is set true only by an explicit
        // go-online (driver-initiated, ops-confirmed, or a live location ping)
        // and false only by an explicit go-offline. Freshness is derived here
        // from the last location timestamp rather than silently flipping the
        // stored flag, so dispatchers can distinguish a driver who is online
        // but momentarily stale from one who has genuinely gone offline.
        const fresh = d.isOnline && hasCoords && ageMs < tenMinAgo;
        const presence: "fresh" | "stale" | "offline" =
          !d.isOnline ? "offline" : fresh ? "fresh" : "stale";
        const lastSeenMin = updatedMs ? Math.floor(ageMs / 60000) : null;
        // Keep `isOnline` meaning "fresh" for back-compat with the live map.
        const isOnline = fresh;
        const isIdle = isOnline && ageMs >= idleAfterMs;

        const pendingStops = stopsByDriver.get(d.driverName) || [];
        const nextStop = pendingStops[0] || null;

        return { d, fleetMatch, isOnline, isIdle, presence, lastSeenMin, nextStop, pendingStops };
      });

      const allStopsPromises = driverDataList.map(async ({ d, pendingStops, isOnline }) => {
        if (pendingStops.length === 0 || !isOnline || d.currentLat == null || d.currentLng == null) return null;

        const allStopsCacheKey = `alleta:${d.driverName}:${d.currentLat?.toFixed(3)},${d.currentLng?.toFixed(3)}:${pendingStops.map(s => s.key).join(",")}`;
        const cachedAll = allStopsEtaCache.get(allStopsCacheKey);
        if (cachedAll && cachedAll.expiresAt > now) {
          checkEtaDriftAndNotify(d, cachedAll.stops, pendingStops, [], {}).catch(err => {
            console.error(`[ETA Drift] Error for ${d.driverName}:`, err instanceof Error ? err.message : err);
          });
          return cachedAll;
        }

        // Live ETA chain grounded in the driver's current GPS position.
        // Traffic-aware Google ONLY for the active first leg (shared 45s
        // first-leg cache); offline math (blended with observed GPS speed)
        // for every downstream leg — keeping Google spend at one call per
        // driver per cache window regardless of route length.
        const allStopsResult: AllStopsEtaEntry[] = await computeLiveStopEtas(
          { id: d.id, currentLat: d.currentLat!, currentLng: d.currentLng! },
          pendingStops.map((s) => ({
            key: s.key,
            addr: s.addr,
            lat: s.lat,
            lng: s.lng,
            type: s.type,
            waybills: s.waybills,
          })),
          {
            dwellCollectionMin: DWELL_TIME_COLLECTION_MIN,
            dwellDeliveryMin: DWELL_TIME_DELIVERY_MIN,
            nowMinutes,
          },
        );

        const cacheEntry: AllStopsEtaCacheEntry = {
          driverName: d.driverName,
          stops: allStopsResult,
          expiresAt: now + ALL_STOPS_ETA_CACHE_TTL_MS,
        };
        allStopsEtaCache.set(allStopsCacheKey, cacheEntry);

        checkEtaDriftAndNotify(d, allStopsResult, pendingStops, [], {}).catch(err => {
          console.error(`[ETA Drift] Error for ${d.driverName}:`, err instanceof Error ? err.message : err);
        });

        return cacheEntry;
      });

      const allStopsResults = await Promise.all(allStopsPromises);
      const allStopsByDriver = new Map<string, AllStopsEtaEntry[]>();
      for (const entry of allStopsResults) {
        if (entry) allStopsByDriver.set(entry.driverName, entry.stops);
      }

      const result = driverDataList.map(({ d, fleetMatch, isOnline, isIdle, presence, lastSeenMin, nextStop }) => {
        const allStops = allStopsByDriver.get(d.driverName) || [];
        const firstStopEta = allStops.length > 0 ? allStops[0] : null;

        return {
          id: d.id,
          driverName: d.driverName,
          lat: d.currentLat,
          lng: d.currentLng,
          speed: d.currentSpeed,
          heading: d.currentHeading,
          updatedAt: d.locationUpdatedAt,
          isOnline,
          isIdle,
          presence,
          lastSeenMin,
          onlineSince: d.onlineSince,
          opsOnlinePending: d.opsOnlinePending,
          opsOnlineRequestedAt: d.opsOnlineRequestedAt,
          color: d.fleetColor || fleetMatch?.color || "#4a9eff",
          plate: d.vehiclePlate || fleetMatch?.plate || "",
          nextStopAddress: nextStop?.addr || "",
          nextStopType: nextStop?.type || null,
          nextStopEta: firstStopEta ? `${firstStopEta.etaMin} min (${firstStopEta.distanceFromDriverKm.toFixed(1)} km)` : "",
          etaMin: firstStopEta?.etaMin ?? null,
          distanceKm: firstStopEta?.distanceFromDriverKm ?? null,
          trafficDelayMin: firstStopEta?.trafficDelayMin ?? null,
          congestionLevel: firstStopEta?.congestionLevel ?? null,
          isTrafficAware: firstStopEta?.isTrafficAware ?? false,
          allStops,
        };
      });

      res.json(result);
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : "Unknown error";
      res.status(500).json({ message: msg });
    }
  });

  // Auto reassignment suggestions: flag stops whose CURRENTLY-assigned driver is
  // significantly farther (by live position) from the stop than another online,
  // active driver. These are advisory only — the dispatcher must approve via the
  // apply endpoint; nothing is ever auto-moved. All proximity math is offline
  // (`calcDrive`, blended with each driver's observed GPS speed) so this costs
  // ZERO Google API calls regardless of fleet size.
  const SUGGESTION_MIN_IMPROVEMENT_MIN = 10;
  app.get("/api/dispatch/reassignment-suggestions", requireDispatcherAuth, async (_req, res) => {
    try {
      await loadEtaConfig();
      const allDrivers = await storage.getAllDriverAccounts();
      const projects = await storage.getProjects();
      const now = Date.now();
      const nowMinutes = currentTimeMinutes();
      const tenMinAgo = 10 * 60 * 1000;

      // ---- Operational-constraint inputs (mirrors client routing.ts) -------
      // A suggested reassignment must respect the same hard constraints the
      // optimizer enforces: vehicle compatibility, driver availability, and
      // Saturday delivery caps. We classify each driver's vehicle from the
      // stored fleet config (vehicle string) and look up per-shipment parcel
      // metadata so we can gate candidates BEFORE surfacing a suggestion.
      // Mirror routing.ts: SAT_MORNING_CAP/SAT_AFTERNOON_CAP split at noon, and
      // VITZ_RULES (maxParcels / maxPlatterConsignments). Kept in lockstep with
      // client/src/lib/routing.ts + client/src/lib/fleet.ts.
      const SAT_MORNING_CAP = 12;
      const SAT_AFTERNOON_CAP = 8;
      const SAT_MORNING_END = 720; // 12:00 in minutes-from-midnight
      const VITZ_MAX_PARCELS = 6;
      const VITZ_MAX_PLATTER = 3;
      const SIM_DWELL_MIN = 10; // approx per-stop service time for cap bucketing
      const sast = new Date(now + 2 * 60 * 60 * 1000);
      const isSaturday = sast.getUTCDay() === 6;

      const fleetSetting = await storage.getAppSetting("fleet");
      const fleetCfg = fleetSetting?.value
        ? (typeof fleetSetting.value === "string" ? JSON.parse(fleetSetting.value) : fleetSetting.value)
        : { drivers: [] };
      const vehicleClassByName = new Map<string, "VITZ" | "I10" | "OTHER">();
      for (const fd of ((fleetCfg.drivers || []) as Array<{ name?: string; vehicle?: string }>)) {
        if (!fd.name) continue;
        const v = (fd.vehicle || "").toLowerCase();
        const cls: "VITZ" | "I10" | "OTHER" = v.includes("vitz") ? "VITZ" : (v.includes("i10") ? "I10" : "OTHER");
        vehicleClassByName.set(fd.name.toLowerCase().trim(), cls);
      }
      const classOf = (driverName: string): "VITZ" | "I10" | "OTHER" =>
        vehicleClassByName.get(driverName.toLowerCase().trim()) ?? "OTHER";

      const shipMetaById = new Map<string, { acc: string; pcs: number; isCake: boolean; isPlatter: boolean }>();
      for (const p of projects) {
        for (const s of ((p.shipments || []) as Array<{ id: string; parcelType?: string; parcelCategory?: string; acc?: string; pcs?: number }>)) {
          const pt = (s.parcelType || "").toLowerCase();
          const pc = (s.parcelCategory || "").toLowerCase();
          shipMetaById.set(s.id, {
            acc: s.acc || "",
            pcs: s.pcs || 0,
            isCake: pt.includes("3-tier") || pt.includes("3 tier") || pc.includes("3-tier") || pc.includes("3 tier"),
            isPlatter: pt.includes("platter") || pc.includes("platter"),
          });
        }
      }

      // Can `targetClass` vehicle legally carry these shipment ids? Mirrors the
      // hard (effectively-forbidden) penalties in routing.ts#evalVehicleConstraints:
      //   - 3-tier cakes must NOT go on the Vitz.
      //   - SWE001-account parcels must go on an i10 (panel van).
      const vehicleCanCarry = (targetClass: "VITZ" | "I10" | "OTHER", ids: string[]): boolean => {
        for (const id of ids) {
          const m = shipMetaById.get(id);
          if (!m) continue;
          if (m.isCake && targetClass === "VITZ") return false;
          if (m.acc === "SWE001" && targetClass !== "I10") return false;
        }
        return true;
      };

      // VITZ capacity: total parcels and platter consignments across the
      // driver's entire load (existing pending + the candidate stop). Mirrors
      // the VITZ_RULES.maxParcels / maxPlatterConsignments penalties.
      const vitzWithinCapacity = (existingIds: Set<string>, addIds: string[]): boolean => {
        const all = new Set(existingIds);
        addIds.forEach((id) => all.add(id));
        let totalParcels = 0;
        let platterPcs = 0;
        all.forEach((id) => {
          const m = shipMetaById.get(id);
          if (!m) return;
          totalParcels += m.pcs;
          if (m.isPlatter) platterPcs += m.pcs;
        });
        return totalParcels <= VITZ_MAX_PARCELS && platterPcs <= VITZ_MAX_PLATTER;
      };

      interface Candidate {
        id: number;
        driverName: string;
        assignmentId: string;
        projectId: string;
        lat: number;
        lng: number;
        observedKmh: number | null;
        pending: Array<{ key: string; type: "C" | "D"; lat: number; lng: number; addr: string; sub: string; city: string; wbs: string[]; ids: string[] }>;
      }

      const candidates: Candidate[] = [];
      for (const d of allDrivers) {
        const hasCoords = d.currentLat != null && d.currentLng != null;
        const updatedMs = d.locationUpdatedAt ? new Date(d.locationUpdatedAt).getTime() : 0;
        const fresh = d.isOnline && hasCoords && (now - updatedMs) < tenMinAgo;
        if (!fresh) continue;
        // Availability: a driver still awaiting ops confirmation of their
        // go-online request is not yet dispatchable, so never suggest moving
        // work onto them.
        if (d.opsOnlinePending) continue;
        const r = getActiveProjectAndStops(projects, d.driverName);
        if (!r || !r.driverId) continue;
        const pending = r.stops
          .filter((s) => isStopActive(s.status) && s.lat && s.lng)
          .map((s) => ({
            key: s.key,
            type: s.type as "C" | "D",
            lat: s.lat,
            lng: s.lng,
            addr: s.addr || `${s.sub}, ${s.city}`,
            sub: s.sub,
            city: s.city,
            wbs: s.wbs || [],
            ids: s.ids || [],
          }));
        candidates.push({
          id: d.id,
          driverName: d.driverName,
          assignmentId: r.driverId,
          projectId: r.project.id,
          lat: d.currentLat!,
          lng: d.currentLng!,
          observedKmh: recentMovingSpeedKmh(d.id),
          pending,
        });
      }

      interface Suggestion {
        id: string;
        projectId: string;
        stopKey: string;
        stopType: "C" | "D";
        stopAddr: string;
        waybills: string[];
        shipmentIds: string[];
        fromDriverName: string;
        fromAssignmentId: string;
        currentEtaMin: number;
        currentDistanceKm: number;
        toDriverName: string;
        toAssignmentId: string;
        suggestedEtaMin: number;
        suggestedDistanceKm: number;
        improvementMin: number;
      }

      const suggestions: Suggestion[] = [];
      for (const a of candidates) {
        if (a.pending.length === 0) continue;
        // Only the driver's NEXT pending stop is a sensible re-route target — a
        // stop deeper in the route is sequenced and harder to hand off cleanly.
        const next = a.pending[0];
        const aDrive = calcDrive({ lat: a.lat, lng: a.lng }, { lat: next.lat, lng: next.lng }, nowMinutes, a.observedKmh);

        let best: { cand: Candidate; driveMin: number; driveKm: number; improvement: number } | null = null;
        for (const b of candidates) {
          if (b.assignmentId === a.assignmentId) continue;
          const bClass = classOf(b.driverName);
          // Vehicle compatibility: the target's vehicle must legally carry the
          // stop's parcels (no 3-tier cakes on the Vitz, SWE001 only on i10).
          if (!vehicleCanCarry(bClass, next.ids)) continue;
          // VITZ capacity: total parcels + platter consignments across the
          // target's whole load (existing pending + the moved stop) must stay
          // within VITZ_RULES limits.
          if (bClass === "VITZ") {
            const bIds = new Set<string>();
            b.pending.forEach((s) => (s.ids || []).forEach((id) => bIds.add(id)));
            if (!vitzWithinCapacity(bIds, next.ids)) continue;
          }
          const bDrive = calcDrive({ lat: b.lat, lng: b.lng }, { lat: next.lat, lng: next.lng }, nowMinutes, b.observedKmh);
          // Saturday cap: deliveries are capped per half-day (morning before
          // 12:00, afternoon after). Classify the moved delivery by its arrival
          // time and count the target's existing deliveries in the same period
          // (simulated from the live position, mirroring evalAssignment).
          if (isSaturday && next.type === "D") {
            const movedArrival = nowMinutes + bDrive.min;
            const movedMorning = movedArrival < SAT_MORNING_END;
            let tt = nowMinutes, pl = b.lat, pg = b.lng, morn = 0, aft = 0;
            for (const ps of b.pending) {
              const leg = calcDrive({ lat: pl, lng: pg }, { lat: ps.lat, lng: ps.lng }, tt, b.observedKmh);
              tt += leg.min;
              if (ps.type === "D") { if (tt < SAT_MORNING_END) morn++; else aft++; }
              tt += SIM_DWELL_MIN;
              pl = ps.lat; pg = ps.lng;
            }
            if (movedMorning && morn >= SAT_MORNING_CAP) continue;
            if (!movedMorning && aft >= SAT_AFTERNOON_CAP) continue;
          }
          const improvement = aDrive.min - bDrive.min;
          if (improvement >= SUGGESTION_MIN_IMPROVEMENT_MIN && (!best || bDrive.min < best.driveMin)) {
            best = { cand: b, driveMin: bDrive.min, driveKm: bDrive.km, improvement };
          }
        }

        if (best) {
          suggestions.push({
            id: `${a.projectId}:${next.key}`,
            projectId: a.projectId,
            stopKey: next.key,
            stopType: next.type,
            stopAddr: next.addr,
            waybills: next.wbs,
            shipmentIds: next.ids,
            fromDriverName: a.driverName,
            fromAssignmentId: a.assignmentId,
            currentEtaMin: Math.round(aDrive.min),
            currentDistanceKm: Math.round(aDrive.km * 10) / 10,
            toDriverName: best.cand.driverName,
            toAssignmentId: best.cand.assignmentId,
            suggestedEtaMin: Math.round(best.driveMin),
            suggestedDistanceKm: Math.round(best.driveKm * 10) / 10,
            improvementMin: Math.round(best.improvement),
          });
        }
      }

      suggestions.sort((x, y) => y.improvementMin - x.improvementMin);
      res.json(suggestions);
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : "Unknown error";
      res.status(500).json({ message: msg });
    }
  });

  // Approve one reassignment suggestion: move the shipment(s) to the suggested
  // driver and fire the same instant cascade a manual reassign does (live ETAs
  // recompute, CRM alerts refresh, driver apps + every dispatcher tab update via
  // SSE). Never called automatically — only on dispatcher approval.
  app.post("/api/dispatch/reassignment-suggestions/apply", requireDispatcherAuth, async (req, res) => {
    try {
      const { projectId, shipmentIds, toAssignmentId } = req.body as {
        projectId?: string; shipmentIds?: string[]; toAssignmentId?: string;
      };
      if (!projectId || !Array.isArray(shipmentIds) || !shipmentIds.length || !toAssignmentId) {
        return res.status(400).json({ message: "projectId, shipmentIds and toAssignmentId are required" });
      }

      const { db } = await import("./db");
      const { projects } = await import("@shared/schema");
      const { eq, and } = await import("drizzle-orm");
      const { syncProjectToAnalytics } = await import("./lib/analytics-backfill");

      // Optimistic-concurrency apply: re-read the latest assignments, merge our
      // move on top, and only commit if the project row hasn't changed since we
      // read it (WHERE updatedAt = previous.updatedAt). A concurrent manual edit
      // or autosave bumps updatedAt, so our write is rejected and we retry on the
      // fresh snapshot — never clobbering the dispatcher's own changes.
      let previous: Awaited<ReturnType<typeof storage.getProject>> | undefined;
      let updated: typeof projects.$inferSelect | undefined;
      let moved = 0;

      for (let attempt = 0; attempt < 4; attempt++) {
        previous = await storage.getProject(projectId);
        if (!previous) return res.status(404).json({ message: "Project not found" });

        const currentAsgn = { ...((previous.assignments || {}) as Record<string, string>) };
        moved = 0;
        for (const sid of shipmentIds) {
          if (currentAsgn[sid] !== toAssignmentId) { currentAsgn[sid] = toAssignmentId; moved++; }
        }
        if (moved === 0) {
          return res.json({ ok: true, moved: 0, message: "Already assigned to that driver" });
        }

        const prevUpdatedAt = previous.updatedAt;
        const result = await db.transaction(async (tx) => {
          const [row] = await tx.update(projects)
            .set({ assignments: currentAsgn, updatedAt: new Date() })
            .where(
              prevUpdatedAt
                ? and(eq(projects.id, projectId), eq(projects.updatedAt, prevUpdatedAt))
                : eq(projects.id, projectId),
            )
            .returning();
          if (row) await syncProjectToAnalytics(row, tx);
          return row;
        });

        if (result) { updated = result; break; }
        // Row changed under us (CAS miss) — loop to re-read and re-merge.
      }

      if (!previous) return res.status(404).json({ message: "Project not found" });
      if (!updated) {
        return res.status(409).json({ message: "Project is being edited concurrently — please retry" });
      }

      res.json({ ok: true, moved, assignments: updated.assignments });

      // Fire-and-forget cascade after the response (same as the PATCH route).
      notifyProjectChanges(previous, updated).catch((err) => {
        console.error("[reassign-apply] notifyProjectChanges error:", err?.message || err);
      });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : "Unknown error";
      res.status(500).json({ message: msg });
    }
  });

  // Ops-initiated "force online" fallback: ask a driver to come online when
  // their app's own online/location flow is broken. This does NOT flip the
  // driver online directly — it raises a pending request plus a push/inbox
  // prompt that the driver must confirm on their device (which then calls
  // POST /api/driver/go-online). Dispatchers see the pending state live.
  app.post("/api/dispatch/drivers/:id/request-online", requireDispatcherAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) return res.status(400).json({ message: "Invalid driver id" });
      const account = await storage.getDriverAccount(id);
      if (!account) return res.status(404).json({ message: "Driver account not found" });

      let requestedBy = "Dispatcher";
      const sessionUserId = (req.session as any)?.userId;
      if (sessionUserId) {
        const sessionUser = await storage.getUser(sessionUserId);
        if (sessionUser?.username) requestedBy = sessionUser.username;
      }

      const updated = await storage.requestDriverOnline(id, requestedBy);

      // Reuse the existing push + in-app inbox channel. sendToDriver always
      // persists an inbox row even if FCM is unconfigured, so the prompt still
      // surfaces via the driver app's 30s inbox poll as a fallback.
      await sendToDriver(id, {
        kind: "online_request",
        title: "Dispatch needs you online",
        body: `${requestedBy} is asking you to go online. Tap to confirm.`,
        data: { kind: "online_request", requestedBy },
      }).catch(() => {});

      // Notify dispatcher UIs to refresh presence immediately.
      broadcastWebhookEvent({ topic: "driver_presence_changed", message: `Online requested for ${account.driverName}` });

      res.json({ ok: true, opsOnlinePending: updated?.opsOnlinePending ?? true });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : "Unknown error";
      res.status(500).json({ message: msg });
    }
  });

  // Ops can cancel a pending online request, or force a driver offline.
  app.post("/api/dispatch/drivers/:id/force-offline", requireDispatcherAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) return res.status(400).json({ message: "Invalid driver id" });
      const account = await storage.getDriverAccount(id);
      if (!account) return res.status(404).json({ message: "Driver account not found" });

      await storage.setDriverOffline(id);
      broadcastWebhookEvent({ topic: "driver_presence_changed", message: `${account.driverName} set offline` });

      res.json({ ok: true });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : "Unknown error";
      res.status(500).json({ message: msg });
    }
  });

  app.get("/api/dispatch/reorder-requests", async (req, res) => {
    try {
      const projectId = req.query.projectId as string | undefined;
      const includeHistory = req.query.history === "true";
      if (includeHistory) {
        const scopeProjectId = projectId || await getActiveProjectId();
        const requests = await storage.getRecentReorderRequests(scopeProjectId, 50);
        return res.json(requests);
      }
      const requests = await storage.getPendingReorderRequests(projectId || await getActiveProjectId());
      res.json(requests);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.patch("/api/dispatch/reorder-requests/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ message: "Invalid request ID" });

      const { action, reviewNote } = req.body;
      if (action !== "approve" && action !== "reject") {
        return res.status(400).json({ message: "action must be 'approve' or 'reject'" });
      }

      const request = await storage.getReorderRequest(id);
      if (!request) return res.status(404).json({ message: "Reorder request not found" });
      if (request.status !== "pending") return res.status(409).json({ message: "Request already reviewed" });

      let reviewerName = "dispatcher";
      const sessionUserId = (req.session as any)?.userId;
      if (sessionUserId) {
        const sessionUser = await storage.getUser(sessionUserId);
        if (sessionUser) {
          reviewerName = sessionUser.displayName || sessionUser.username;
        }
      }

      if (action === "approve") {
        const project = await storage.getProject(request.projectId);
        if (!project) return res.status(404).json({ message: "Project not found" });

        const driverStopSequences = (project.driverStopSequences || {}) as Record<string, string[]>;
        const canonicalDriverKey = request.driverName;
        const proposedOrder = request.proposedOrder as string[];

        const stopStatuses = (project.stopStatuses || {}) as Record<string, string>;
        const validKeys = proposedOrder.filter((key) => isStopActive(stopStatuses[key]));

        if (validKeys.length === 0) {
          await storage.updateReorderRequestStatus(id, "expired", reviewerName, "All stops already completed");
          return res.json({ message: "Request expired — all stops already completed", status: "expired" });
        }

        const existingSeq = driverStopSequences[canonicalDriverKey] || [];
        const proposedSet = new Set(validKeys);

        let fullSequence: string[];
        if (existingSeq.length > 0) {
          fullSequence = existingSeq;
        } else {
          const driverResult = getActiveProjectAndStops([project], request.driverName);
          if (driverResult && driverResult.stops.length > 0) {
            fullSequence = driverResult.stops.map((s) => s.key);
          } else {
            const currentOrder = request.currentOrder as string[];
            fullSequence = currentOrder;
          }
        }

        const prefixStops: string[] = [];
        const suffixStops: string[] = [];
        let foundFirstReorderable = false;
        for (const k of fullSequence) {
          if (proposedSet.has(k)) {
            foundFirstReorderable = true;
          } else if (!foundFirstReorderable) {
            prefixStops.push(k);
          } else {
            suffixStops.push(k);
          }
        }

        const newSeq = [...prefixStops, ...validKeys, ...suffixStops];

        driverStopSequences[canonicalDriverKey] = newSeq;
        await storage.updateProject(request.projectId, { driverStopSequences: driverStopSequences as any });
      }

      const updated = await storage.updateReorderRequestStatus(id, action === "approve" ? "approved" : "rejected", reviewerName, reviewNote);

      res.json(updated);

      // Fire-and-forget AFTER the response is sent.
      sendToDriverByName(request.driverName, action === "approve"
        ? {
            kind: "reorder_approved",
            title: "Reorder approved",
            body: `Your reorder request was approved by ${reviewerName}.`,
            data: { projectId: request.projectId, requestId: String(id) },
          }
        : {
            kind: "reorder_rejected",
            title: "Reorder rejected",
            body: reviewNote
              ? `Rejected by ${reviewerName}: ${String(reviewNote).slice(0, 120)}`
              : `Your reorder request was rejected by ${reviewerName}.`,
            data: { projectId: request.projectId, requestId: String(id) },
          },
      ).catch((err) => console.error("[push] reorder notify error:", err?.message || err));
    } catch (error: any) {
      console.error("[Dispatch Reorder]", error.message);
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/vehicle-logs/trips", requireDispatcherAuth, async (req, res) => {
    try {
      const driverAccountId = req.query.driverId
        ? Number(req.query.driverId)
        : req.query.driverAccountId
          ? Number(req.query.driverAccountId)
          : undefined;
      const status = typeof req.query.status === "string" ? req.query.status : undefined;
      const limit = Math.min(Number(req.query.limit) || 100, 500);
      let from: Date | undefined;
      let to: Date | undefined;
      if (typeof req.query.from === "string" && req.query.from.length > 0) {
        const d = new Date(req.query.from);
        if (Number.isNaN(d.getTime())) {
          return res.status(400).json({ message: "Invalid 'from' date" });
        }
        from = d;
      }
      if (typeof req.query.to === "string" && req.query.to.length > 0) {
        const d = new Date(req.query.to);
        if (Number.isNaN(d.getTime())) {
          return res.status(400).json({ message: "Invalid 'to' date" });
        }
        to = d;
      }

      const trips = await storage.listDriverTrips({ driverAccountId, status, limit, from, to });
      const tripIds = trips.map((t) => t.id);
      const [stops, expenses, accounts] = await Promise.all([
        storage.listDriverTripStopsBatch(tripIds),
        storage.listDriverTripExpensesBatch(tripIds),
        storage.getAllDriverAccounts(),
      ]);
      const stopsByTrip = new Map<number, typeof stops>();
      const expensesByTrip = new Map<number, typeof expenses>();
      stops.forEach((s) => {
        if (!stopsByTrip.has(s.tripId)) stopsByTrip.set(s.tripId, []);
        stopsByTrip.get(s.tripId)!.push(s);
      });
      expenses.forEach((e) => {
        if (!expensesByTrip.has(e.tripId)) expensesByTrip.set(e.tripId, []);
        expensesByTrip.get(e.tripId)!.push(e);
      });
      const accountById = new Map(accounts.map((a) => [a.id, a]));

      const result = trips.map((t) => {
        const tripStops = stopsByTrip.get(t.id) || [];
        const tripExpenses = expensesByTrip.get(t.id) || [];
        const startOdo = t.startOdometer != null ? Number(t.startOdometer) : 0;
        const endOdo = t.endOdometer != null ? Number(t.endOdometer) : null;
        const distanceKm = endOdo != null ? endOdo - startOdo : null;
        const fuelTotal = tripExpenses
          .filter((e) => e.expenseType === "fuel")
          .reduce((s, e) => s + Number(e.amount || 0), 0);
        const litresTotal = tripExpenses
          .filter((e) => e.expenseType === "fuel")
          .reduce((s, e) => s + Number(e.litres || 0), 0);
        const acc = accountById.get(t.driverAccountId);
        const startOcr = t.startOdometerOcr != null ? Number(t.startOdometerOcr) : null;
        const endOcr = t.endOdometerOcr != null ? Number(t.endOdometerOcr) : null;
        const hasStartPhoto = !!t.startClusterPhoto;
        const hasEndPhoto = t.status === "closed" ? !!t.endClusterPhoto : true;
        const startDelta = startOcr != null && startOdo ? Math.abs(startOcr - startOdo) / Math.max(1, startOdo) : null;
        const endDelta = endOcr != null && endOdo ? Math.abs(endOcr - endOdo) / Math.max(1, endOdo) : null;
        const tolerance = 0.05;
        const startMismatch = startDelta != null && startDelta > tolerance;
        const endMismatch = endDelta != null && endDelta > tolerance;
        const fuelUnverified = tripExpenses.filter((e) => e.expenseType === "fuel" && !e.receiptUrl).length;
        const verified = hasStartPhoto && hasEndPhoto && !startMismatch && !endMismatch && fuelUnverified === 0;
        return {
          id: t.id,
          driverAccountId: t.driverAccountId,
          driverName: acc?.driverName || `Driver ${t.driverAccountId}`,
          vehiclePlate: t.vehiclePlate,
          vehicleType: t.vehicleType,
          projectId: t.projectId,
          startTime: t.startTime,
          endTime: t.endTime,
          startOdometer: startOdo,
          endOdometer: endOdo,
          startFuelLevel: t.startFuelLevel,
          endFuelLevel: t.endFuelLevel,
          status: t.status,
          notes: t.notes,
          stopCount: tripStops.length,
          fuelTotal,
          litresTotal,
          distanceKm,
          startOdometerOcr: startOcr,
          endOdometerOcr: endOcr,
          hasStartPhoto,
          hasEndPhoto,
          startMismatch,
          endMismatch,
          fuelExpenseCount: tripExpenses.filter((e) => e.expenseType === "fuel").length,
          fuelMissingReceipts: fuelUnverified,
          ocrProcessedAt: t.ocrProcessedAt,
          ocrError: t.ocrError,
          verified,
        };
      });

      res.json({ trips: result });
    } catch (error: any) {
      console.error("[Vehicle Logs Trips]", error?.message || error);
      res.status(500).json({ message: error?.message || "Internal error" });
    }
  });

  app.get("/api/vehicle-logs/trips/:id", requireDispatcherAuth, async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) return res.status(400).json({ message: "Invalid trip id" });
      const detail = await storage.getTripDetail(id);
      if (!detail) return res.status(404).json({ message: "Trip not found" });
      const { trip, stops, expenses } = detail;
      const account = await storage.getDriverAccount(trip.driverAccountId);
      const startOdo = trip.startOdometer != null ? Number(trip.startOdometer) : 0;
      const endOdo = trip.endOdometer != null ? Number(trip.endOdometer) : null;
      const startOcr = trip.startOdometerOcr != null ? Number(trip.startOdometerOcr) : null;
      const endOcr = trip.endOdometerOcr != null ? Number(trip.endOdometerOcr) : null;
      const hasStartPhoto = !!trip.startClusterPhoto;
      const hasEndPhoto = trip.status === "closed" ? !!trip.endClusterPhoto : true;
      const startDelta = startOcr != null && startOdo ? Math.abs(startOcr - startOdo) / Math.max(1, startOdo) : null;
      const endDelta = endOcr != null && endOdo ? Math.abs(endOcr - endOdo) / Math.max(1, endOdo) : null;
      const tol = 0.05;
      const startMismatch = startDelta != null && startDelta > tol;
      const endMismatch = endDelta != null && endDelta > tol;
      const expensesOut = expenses.map((e) => {
        const amt = e.amount != null ? Number(e.amount) : 0;
        const lit = e.litres != null ? Number(e.litres) : null;
        const ocrAmt = e.ocrAmount != null ? Number(e.ocrAmount) : null;
        const ocrLit = e.ocrLitres != null ? Number(e.ocrLitres) : null;
        const amtDelta = ocrAmt != null && amt > 0 ? Math.abs(ocrAmt - amt) / amt : null;
        const litDelta = ocrLit != null && lit && lit > 0 ? Math.abs(ocrLit - lit) / lit : null;
        return {
          ...e,
          amount: amt,
          litres: lit,
          ocrAmount: ocrAmt,
          ocrLitres: ocrLit,
          hasReceipt: !!e.receiptUrl,
          amountMismatch: amtDelta != null && amtDelta > 0.1,
          litresMismatch: litDelta != null && litDelta > 0.1,
        };
      });
      const fuelMissingReceipts = expenses.filter((e) => e.expenseType === "fuel" && !e.receiptUrl).length;
      const verified = hasStartPhoto && hasEndPhoto && !startMismatch && !endMismatch && fuelMissingReceipts === 0;
      res.json({
        trip: {
          ...trip,
          startOdometer: startOdo,
          endOdometer: endOdo,
          startOdometerOcr: startOcr,
          endOdometerOcr: endOcr,
        },
        driver: account ? { id: account.id, driverName: account.driverName, phone: account.phone } : null,
        stops,
        expenses: expensesOut,
        verification: {
          hasStartPhoto,
          hasEndPhoto,
          startMismatch,
          endMismatch,
          fuelMissingReceipts,
          verified,
        },
        summary: {
          stopCount: stops.length,
          distanceKm: endOdo != null ? endOdo - startOdo : null,
          fuelTotal: expenses.filter((e) => e.expenseType === "fuel").reduce((s, e) => s + Number(e.amount || 0), 0),
          litresTotal: expenses.filter((e) => e.expenseType === "fuel").reduce((s, e) => s + Number(e.litres || 0), 0),
        },
      });
    } catch (error: any) {
      console.error("[Vehicle Logs Trip Detail]", error?.message || error);
      res.status(500).json({ message: error?.message || "Internal error" });
    }
  });

  app.use("/api/driver", driverRouter);

  ensureDefaultDispatcher().catch((err) =>
    console.error("[Auth] Default dispatcher setup error:", err.message)
  );

  ensureTestDriverAccount().catch((err) =>
    console.error("[Driver App] Test account setup error:", err.message)
  );

  seedClientAccounts().catch((err) =>
    console.error("[Webhooks] Client accounts seed error:", err.message)
  );

  ensureWebhookAuthKey().catch((err) =>
    console.error("[Webhooks] Auth key setup error:", err.message)
  );

  ensureCrmWebhookSecret().catch((err) =>
    console.error("[CRM] Webhook secret setup error:", err.message)
  );

  cleanupLocationHistory().catch((err) =>
    console.error("[Driver App] Initial cleanup error:", err.message)
  );
  pruneDriverNotifications().catch((err) =>
    console.error("[Driver App] Initial notification prune error:", err.message)
  );

  setInterval(() => {
    cleanupLocationHistory().catch(() => {});
    pruneDriverNotifications().catch(() => {});
  }, 24 * 60 * 60 * 1000);

  if (process.env.NODE_ENV !== "test" && process.env.DRIVER_POSITION_PUSH_DISABLE !== "1") {
    const { startDriverPositionPusher } = await import("./lib/driver-position-pusher");
    startDriverPositionPusher(15_000);
  }

  return httpServer;
}
