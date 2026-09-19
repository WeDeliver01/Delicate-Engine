import { Router, type Request, type Response } from "express";
import bcrypt from "bcryptjs";
import * as installFs from "fs";
import * as installPath from "path";
import { storage } from "../storage";
import { db } from "../db";
import { requireDriverAuth, signDriverToken, verifyDriverToken } from "../middleware/driver-auth";
import { calcDrive, svcTime, toM, fmM, currentTimeMinutes, type GeoPoint } from "../lib/geo";
import { API_TYPES, callGoogleRoutesAPI as centralCallRoutes, callGoogleRoutesMultiWaypoint } from "../lib/google-api";
import type { Stop, Project, InsertDriverAccount, InsertDriverReorderRequest, InsertDriverTrip, InsertDriverTripStop, InsertDriverTripExpense, DriverTrip, DriverTripExpense, StopGroupings, StopGrouping } from "@shared/schema";
import { insertDriverTripSchema, insertDriverTripStopSchema, insertDriverTripExpenseSchema, driverTripStops, projects as projectsTable } from "@shared/schema";
import { eq, and as andOp } from "drizzle-orm";
import { syncShipmentToAnalytics } from "../lib/analytics-backfill";
import { z } from "zod";
import { fireCrmWebhook, mapStopActionToCrmStatus, type CrmWebhookPayload } from "../lib/crm-webhook";
import type { DriverAccountUpdate } from "../storage";
import { sendToDriver, isPushConfigured } from "../services/push";
import { requireDispatcherAuth } from "../middleware/dispatcher-auth";
import { broadcastWebhookEvent } from "./webhooks";
import { toDriverStopStatus, mapDriverActionToShipmentStatus } from "@shared/status";

const router = Router();
const BCRYPT_ROUNDS = 10;

async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

async function verifyPassword(password: string, hash: string): Promise<boolean> {
  if (hash.length === 64 && !hash.startsWith("$2")) {
    const crypto = await import("crypto");
    const legacyHash = crypto.createHash("sha256").update(password).digest("hex");
    return legacyHash === hash;
  }
  return bcrypt.compare(password, hash);
}

const SA_LAT_MIN = -35;
const SA_LAT_MAX = -22;
const SA_LNG_MIN = 16;
const SA_LNG_MAX = 33;

function isInSouthAfrica(lat: number, lng: number): boolean {
  return lat >= SA_LAT_MIN && lat <= SA_LAT_MAX && lng >= SA_LNG_MIN && lng <= SA_LNG_MAX;
}

const loginAttempts = new Map<string, { count: number; resetAt: number }>();
const LOGIN_RATE_LIMIT = 5;
const LOGIN_RATE_WINDOW_MS = 60 * 1000;

function checkLoginRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = loginAttempts.get(ip);
  if (!entry || now > entry.resetAt) {
    loginAttempts.set(ip, { count: 1, resetAt: now + LOGIN_RATE_WINDOW_MS });
    return true;
  }
  entry.count++;
  return entry.count <= LOGIN_RATE_LIMIT;
}

const locationTimestamps = new Map<number, number>();
const LOCATION_RATE_LIMIT_MS = 10 * 1000;

const locationCallCounts = new Map<number, number>();

interface EtaCacheEntry {
  result: { etas: EtaEntry[] };
  expiresAt: number;
}

interface EtaEntry {
  key: string;
  legKm: number;
  legMin: number;
  etaMin: number;
  eta: string;
}

const etaCache = new Map<string, EtaCacheEntry>();
const ETA_CACHE_TTL = 45 * 1000;

interface SpeedSample { t: number; kmh: number; }
const SPEED_SAMPLES_KEEP = 30;
const SPEED_SAMPLE_WINDOW_MS = 10 * 60 * 1000;
const driverSpeedSamples = new Map<number, SpeedSample[]>();

export function pushSpeedSample(driverId: number, speedMs: number | null | undefined) {
  if (speedMs == null || !Number.isFinite(speedMs) || speedMs < 0) return;
  const kmh = speedMs * 3.6;
  const buf = driverSpeedSamples.get(driverId) || [];
  buf.push({ t: Date.now(), kmh });
  while (buf.length > SPEED_SAMPLES_KEEP) buf.shift();
  driverSpeedSamples.set(driverId, buf);
}

export function recentMovingSpeedKmh(driverId: number): number | null {
  const buf = driverSpeedSamples.get(driverId);
  if (!buf || buf.length === 0) return null;
  const cutoff = Date.now() - SPEED_SAMPLE_WINDOW_MS;
  const recent = buf.filter((s) => s.t >= cutoff && s.kmh >= 3);
  if (recent.length < 2) return null;
  let weight = 0;
  let sum = 0;
  recent.forEach((s, i) => {
    const w = i + 1;
    weight += w;
    sum += s.kmh * w;
  });
  return sum / weight;
}

export interface FirstLegResult {
  km: number;
  min: number;
  isTrafficAware: boolean;
  trafficDelayMin: number;
  congestionLevel: string;
}
interface FirstLegCacheEntry extends FirstLegResult { expiresAt: number; }
const FIRST_LEG_CACHE_TTL = 45 * 1000;
const firstLegCache = new Map<string, FirstLegCacheEntry>();

export function peekFirstLegCache(
  driverId: number,
  fromLat: number, fromLng: number,
  stopKey: string,
): FirstLegResult | null {
  const cacheKey = `firstleg:${driverId}:${stopKey}`;
  const entry = firstLegCache.get(cacheKey);
  if (!entry || entry.expiresAt <= Date.now()) return null;
  return {
    km: entry.km,
    min: entry.min,
    isTrafficAware: entry.isTrafficAware,
    trafficDelayMin: entry.trafficDelayMin,
    congestionLevel: entry.congestionLevel,
  };
}

// Traffic-aware ETA for a driver's CURRENT (active) leg only. Cached 45s and
// keyed by driver + active stop (NOT live position), so a moving driver does
// not churn the cache: the dispatcher all-stops chain, the driver-app ETA, and
// the 15s position pusher all share a SINGLE Google Routes call per driver per
// active stop per cache window. The live origin is still sent on the actual
// call; we just reuse the last result for 45s. Downstream legs use offline math.
export async function firstLegEta(
  driverId: number,
  fromLat: number, fromLng: number,
  toLat: number, toLng: number,
  stopKey: string,
  observedKmh: number | null,
  nowMin: number,
): Promise<FirstLegResult> {
  const cacheKey = `firstleg:${driverId}:${stopKey}`;
  const now = Date.now();
  const cached = firstLegCache.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    return {
      km: cached.km,
      min: cached.min,
      isTrafficAware: cached.isTrafficAware,
      trafficDelayMin: cached.trafficDelayMin,
      congestionLevel: cached.congestionLevel,
    };
  }
  const apiKey = process.env.GOOGLE_ROUTES_API_KEY;
  if (apiKey) {
    try {
      const { parseGoogleRoute } = await import("../lib/google-api");
      const data = await centralCallRoutes(fromLat, fromLng, toLat, toLng, {
        apiType: API_TYPES.ROUTES_DRIVER_ETA,
        routingPreference: "TRAFFIC_AWARE",
      });
      const parsed = parseGoogleRoute(data);
      if (parsed.distanceKm > 0 && parsed.durationMin > 0) {
        const result: FirstLegResult = {
          km: parsed.distanceKm,
          min: Math.max(2, Math.round(parsed.durationMin)),
          isTrafficAware: true,
          trafficDelayMin: parsed.trafficDelayMin,
          congestionLevel: parsed.congestionLevel,
        };
        firstLegCache.set(cacheKey, { ...result, expiresAt: now + FIRST_LEG_CACHE_TTL });
        return result;
      }
    } catch (err) {
      console.error(`[Driver First-Leg ETA] Google Routes failed for driver=${driverId}, stop=${stopKey}:`, err instanceof Error ? err.message : err);
    }
  }
  const fb = calcDrive({ lat: fromLat, lng: fromLng }, { lat: toLat, lng: toLng }, nowMin, observedKmh);
  const result: FirstLegResult = { km: fb.km, min: fb.min, isTrafficAware: false, trafficDelayMin: 0, congestionLevel: "UNKNOWN" };
  firstLegCache.set(cacheKey, { ...result, expiresAt: now + FIRST_LEG_CACHE_TTL });
  return result;
}

interface DriverLastEtaPos {
  lat: number;
  lng: number;
  timestamp: number;
}
const lastEtaPositions = new Map<number, DriverLastEtaPos>();
const ETA_MIN_MOVE_METERS = 50;

function findDriverNameInProject(project: Project, username: string): string | null {
  const normalizedUsername = username.toLowerCase().trim();
  const assignments = (project.assignments || {}) as Record<string, string>;

  const driverIds = new Set<string>();
  Object.values(assignments).forEach((v) => {
    if (typeof v === "string") driverIds.add(v);
  });

  for (const did of Array.from(driverIds)) {
    if (did.toLowerCase().trim() === normalizedUsername) {
      return did;
    }
  }

  return null;
}

router.post("/login", async (req: Request, res: Response) => {
  try {
    const ip = req.ip || req.socket.remoteAddress || "unknown";
    if (!checkLoginRateLimit(ip)) {
      return res.status(429).json({ message: "Too many login attempts. Try again in 1 minute." });
    }

    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ message: "Username and password required" });
    }

    const normalizedUsername = username.toLowerCase().trim();
    let account = await storage.getDriverAccountByUsername(normalizedUsername);

    if (!account) {
      return res.status(401).json({ message: "Invalid credentials. Ask your dispatcher to create your account." });
    } else {
      const valid = await verifyPassword(password, account.passwordHash);
      if (!valid) {
        return res.status(401).json({ message: "Invalid credentials" });
      }
      const needsRehash = account.passwordHash.length === 64 && !account.passwordHash.startsWith("$2");
      if (needsRehash) {
        const newHash = await hashPassword(password);
        await storage.updateDriverAccount(account.id, { passwordHash: newHash, lastLoginAt: new Date() });
      } else {
        await storage.updateDriverAccount(account.id, { lastLoginAt: new Date() });
      }
    }

    const token = signDriverToken({
      driverAccountId: account.id,
      driverName: account.driverName,
      username: account.username,
    });

    res.json({
      token,
      driver: {
        id: account.id,
        username: account.username,
        driverName: account.driverName,
        phone: account.phone,
        vehiclePlate: account.vehiclePlate || "",
        vehicleType: account.vehicleType || "",
      },
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Login failed";
    console.error("[Driver Login]", msg);
    res.status(500).json({ message: "Login failed" });
  }
});

router.get("/profile", requireDriverAuth, async (req: Request, res: Response) => {
  try {
    const account = await storage.getDriverAccount(req.driver!.driverAccountId);
    if (!account) return res.status(404).json({ message: "Account not found" });
    res.json({
      id: account.id,
      username: account.username,
      driverName: account.driverName,
      phone: account.phone,
      vehiclePlate: account.vehiclePlate || "",
      vehicleType: account.vehicleType || "",
      isOnline: account.isOnline,
      currentLat: account.currentLat,
      currentLng: account.currentLng,
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    res.status(500).json({ message: msg });
  }
});

router.patch("/profile", requireDriverAuth, async (req: Request, res: Response) => {
  try {
    const { phone } = req.body;
    const updates: DriverAccountUpdate = {};
    if (phone !== undefined) updates.phone = phone;
    const updated = await storage.updateDriverAccount(req.driver!.driverAccountId, updates);
    if (!updated) return res.status(404).json({ message: "Account not found" });
    res.json({
      id: updated.id,
      username: updated.username,
      driverName: updated.driverName,
      phone: updated.phone,
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    res.status(500).json({ message: msg });
  }
});

router.post("/location", requireDriverAuth, async (req: Request, res: Response) => {
  try {
    const driverId = req.driver!.driverAccountId;

    const { lat, lng, accuracy, speed, heading } = req.body;
    if (lat == null || lng == null) {
      return res.status(400).json({ message: "lat and lng required" });
    }
    if (!isInSouthAfrica(lat, lng)) {
      return res.status(400).json({ message: "Coordinates outside South Africa" });
    }

    const now = Date.now();
    const lastUpdate = locationTimestamps.get(driverId) || 0;
    if (now - lastUpdate < LOCATION_RATE_LIMIT_MS) {
      return res.status(429).json({ message: "Location updates limited to once per 10 seconds" });
    }
    locationTimestamps.set(driverId, now);

    await storage.updateDriverAccount(driverId, {
      currentLat: lat,
      currentLng: lng,
      currentAccuracy: accuracy ?? null,
      currentSpeed: speed ?? null,
      currentHeading: heading ?? null,
      isOnline: true,
      locationUpdatedAt: new Date(),
      // A live location ping is proof the driver is online, so clear any
      // pending ops "force-online" request — it has been satisfied.
      opsOnlinePending: false,
      opsOnlineRequestedAt: null,
      opsOnlineRequestedBy: null,
    });

    pushSpeedSample(driverId, speed);

    const callCount = (locationCallCounts.get(driverId) || 0) + 1;
    locationCallCounts.set(driverId, callCount);

    if (callCount % 3 === 0) {
      await storage.createLocationHistory({
        driverAccountId: driverId,
        lat,
        lng,
        accuracy: accuracy ?? null,
        speed: speed ?? null,
        heading: heading ?? null,
      });
    }

    res.json({ ok: true });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    console.error("[Driver Location]", msg);
    res.status(500).json({ message: msg });
  }
});

router.post("/location-beacon", async (req: Request, res: Response) => {
  try {
    const { token, lat, lng, accuracy, speed, heading } = req.body || {};
    if (!token || typeof token !== "string") {
      return res.status(401).json({ message: "Missing token" });
    }
    const decoded = verifyDriverToken(token);
    if (!decoded) {
      return res.status(401).json({ message: "Invalid token" });
    }
    if (lat == null || lng == null) {
      return res.status(400).json({ message: "lat and lng required" });
    }
    if (!isInSouthAfrica(lat, lng)) {
      return res.status(400).json({ message: "Coordinates outside South Africa" });
    }

    const driverId = decoded.driverAccountId;
    const now = Date.now();
    const lastUpdate = locationTimestamps.get(driverId) || 0;
    if (now - lastUpdate < LOCATION_RATE_LIMIT_MS) {
      return res.status(204).end();
    }
    locationTimestamps.set(driverId, now);

    await storage.updateDriverAccount(driverId, {
      currentLat: lat,
      currentLng: lng,
      currentAccuracy: accuracy ?? null,
      currentSpeed: speed ?? null,
      currentHeading: heading ?? null,
      isOnline: true,
      locationUpdatedAt: new Date(),
      // A live location ping is proof the driver is online, so clear any
      // pending ops "force-online" request — it has been satisfied.
      opsOnlinePending: false,
      opsOnlineRequestedAt: null,
      opsOnlineRequestedBy: null,
    });

    pushSpeedSample(driverId, speed);

    res.status(204).end();
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    console.error("[Driver Beacon]", msg);
    res.status(500).json({ message: msg });
  }
});

router.post("/go-online", requireDriverAuth, async (req: Request, res: Response) => {
  try {
    const updated = await storage.setDriverOnline(req.driver!.driverAccountId);
    broadcastWebhookEvent({ topic: "driver_presence_changed", message: `${req.driver!.driverName} went online` });
    res.json({ ok: true, isOnline: updated?.isOnline ?? true });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    res.status(500).json({ message: msg });
  }
});

router.post("/decline-online", requireDriverAuth, async (req: Request, res: Response) => {
  try {
    await storage.clearOpsOnlineRequest(req.driver!.driverAccountId);
    broadcastWebhookEvent({ topic: "driver_presence_changed", message: `${req.driver!.driverName} declined online request` });
    res.json({ ok: true });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    res.status(500).json({ message: msg });
  }
});

router.post("/go-offline", requireDriverAuth, async (req: Request, res: Response) => {
  try {
    await storage.setDriverOffline(req.driver!.driverAccountId);
    broadcastWebhookEvent({ topic: "driver_presence_changed", message: `${req.driver!.driverName} went offline` });
    res.json({ ok: true });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    res.status(500).json({ message: msg });
  }
});

router.get("/locations/all", requireDriverAuth, async (_req: Request, res: Response) => {
  try {
    const drivers = await storage.getOnlineDrivers(10);
    res.json(drivers.map((d) => ({
      id: d.id,
      driverName: d.driverName,
      lat: d.currentLat,
      lng: d.currentLng,
      accuracy: d.currentAccuracy,
      speed: d.currentSpeed,
      heading: d.currentHeading,
      updatedAt: d.locationUpdatedAt,
      fleetColor: d.fleetColor || "#4a9eff",
      vehiclePlate: d.vehiclePlate || "",
    })));
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    res.status(500).json({ message: msg });
  }
});

interface ShipmentLike {
  id: string;
  wb: string;
  acc: string;
  pcs: number;
  kg: number;
  svc: string;
  colDate: string;
  delDate: string;
  cSub: string;
  cCity: string;
  cAddr: string;
  cAfter: string;
  cBefore: string;
  cLat: number;
  cLng: number;
  cContact: string;
  cPhone: string;
  iCol: string;
  dSub: string;
  dCity: string;
  dAddr: string;
  dAfter: string;
  dBefore: string;
  dLat: number;
  dLng: number;
  dContact: string;
  dPhone: string;
  iDel: string;
  preDelDriver: string;
  preColDriver: string;
}

function getTodayDateString(): string {
  const sa = new Date().toLocaleDateString("en-ZA", { timeZone: "Africa/Johannesburg", year: "numeric", month: "2-digit", day: "2-digit" });
  return sa.replace(/\//g, "-");
}

export function getActiveProjectAndStops(
  projects: Project[],
  driverName: string
): { project: Project; stops: Stop[]; driverId: string } | null {
  if (!projects.length) return null;
  const project = projects.sort((a, b) =>
    new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  )[0];

  const assignments = (project.assignments || {}) as Record<string, string>;
  const rawShipments = (project.shipments || []) as ShipmentLike[];
  // Apply dispatcher delivery-window overrides (deliveries only — collections
  // are never moved). Mirrors client/src/lib/routing.ts#applyDeliveryOverrides
  // so trip-sheet / ETA windows match what the dispatcher sees.
  const dovRaw = (project as unknown as { deliveryOverrides?: Record<string, { dAfter?: string; dBefore?: string }> }).deliveryOverrides || {};
  const shipments: ShipmentLike[] = rawShipments.map((s) => {
    const ov = dovRaw[s.id];
    if (!ov) return s;
    return {
      ...s,
      dAfter: ov.dAfter ?? s.dAfter,
      dBefore: ov.dBefore ?? s.dBefore,
    };
  });

  const normalizedName = driverName.toLowerCase().trim();

  const driverIds = new Set<string>();
  Object.values(assignments).forEach((v) => {
    if (typeof v === "string") driverIds.add(v);
  });

  let matchedDriverId = "";
  for (const did of Array.from(driverIds)) {
    if (did.toLowerCase().trim() === normalizedName) {
      matchedDriverId = did;
      break;
    }
  }

  if (!matchedDriverId) return { project, stops: [], driverId: "" };

  const myShipmentIds = Object.entries(assignments)
    .filter(([, dId]) => dId === matchedDriverId)
    .map(([shipId]) => shipId);

  const today = getTodayDateString();
  const todayParts = today.split("-").map(Number);
  const todayDate = new Date(todayParts[0], todayParts[1] - 1, todayParts[2]);
  const yesterdayDate = new Date(todayDate.getTime() - 86400000);
  const yesterday = `${yesterdayDate.getFullYear()}-${String(yesterdayDate.getMonth() + 1).padStart(2, "0")}-${String(yesterdayDate.getDate()).padStart(2, "0")}`;

  let myShipments = shipments.filter((s) => {
    if (!myShipmentIds.includes(s.id)) return false;
    const shipDate = s.delDate || s.colDate || "";
    if (!shipDate) return true;
    return shipDate === today;
  });

  if (myShipments.length === 0) {
    myShipments = shipments.filter((s) => {
      if (!myShipmentIds.includes(s.id)) return false;
      const shipDate = s.delDate || s.colDate || "";
      if (!shipDate) return true;
      return shipDate === yesterday || shipDate === today;
    });
  }

  const stopStatuses = (project.stopStatuses || {}) as Record<string, string>;

  const stopsByKey = new Map<string, Stop>();

  for (const s of myShipments) {
    const colKey = `C_${s.id}`;
    stopsByKey.set(colKey, {
      seq: 0,
      type: "C",
      key: colKey,
      wbs: [s.wb],
      ids: [s.id],
      sub: s.cSub || "",
      city: s.cCity || "",
      addr: s.cAddr || "",
      acc: s.acc || "",
      pcs: s.pcs || 1,
      kg: s.kg || 0,
      win: `${s.cAfter || "06:00"}-${s.cBefore || "18:00"}`,
      eta: "",
      etaM: 0,
      legKm: 0,
      legMin: 0,
      svcMin: svcTime("C", s.pcs || 1),
      fromLoc: "",
      contact: s.cContact || "",
      phone: s.cPhone || "",
      instr: s.iCol || "",
      spx: s.svc === "SPX",
      late: false,
      lat: s.cLat || 0,
      lng: s.cLng || 0,
      status: toDriverStopStatus(stopStatuses[colKey]),
    });

    const delKey = `D_${s.id}`;
    stopsByKey.set(delKey, {
      seq: 0,
      type: "D",
      key: delKey,
      wbs: [s.wb],
      ids: [s.id],
      sub: s.dSub || "",
      city: s.dCity || "",
      addr: s.dAddr || "",
      acc: s.acc || "",
      pcs: s.pcs || 1,
      kg: s.kg || 0,
      win: `${s.dAfter || "06:00"}-${s.dBefore || "18:00"}`,
      eta: "",
      etaM: 0,
      legKm: 0,
      legMin: 0,
      svcMin: svcTime("D", s.pcs || 1),
      fromLoc: "",
      contact: s.dContact || "",
      phone: s.dPhone || "",
      instr: s.iDel || "",
      spx: s.svc === "SPX",
      late: false,
      lat: s.dLat || 0,
      lng: s.dLng || 0,
      status: toDriverStopStatus(stopStatuses[delKey]),
    });
  }

  const driverStopSequences = (project.driverStopSequences || {}) as Record<string, string[]>;
  const dispatcherOrder = driverStopSequences[matchedDriverId];

  let allStops: Stop[];

  if (dispatcherOrder && dispatcherOrder.length > 0) {
    allStops = [];
    for (const key of dispatcherOrder) {
      const stop = stopsByKey.get(key);
      if (stop) {
        allStops.push(stop);
        stopsByKey.delete(key);
      }
    }
    stopsByKey.forEach((stop) => {
      allStops.push(stop);
    });
  } else {
    const iter: Stop[] = [];
    stopsByKey.forEach((v) => iter.push(v));
    allStops = iter;
    allStops.sort((a, b) => {
      const aStart = toM(a.win.split("-")[0]) || 0;
      const bStart = toM(b.win.split("-")[0]) || 0;
      return aStart - bStart;
    });
  }

  // Apply dispatcher-pinned groupings so the driver app, CRM webhooks,
  // position pusher, and ETA cache all see the same combined stops the
  // dispatcher configured. Groupings whose shipments aren't present (e.g.
  // reassigned to another driver) are silently skipped.
  const stopGroupings = (project.stopGroupings || {}) as StopGroupings;
  const myGroupings = stopGroupings[matchedDriverId];
  if (myGroupings && myGroupings.length > 0) {
    allStops = applyDriverStopGroupings(allStops, myGroupings);
  }

  allStops.forEach((s, i) => { s.seq = i + 1; });

  return { project, stops: allStops, driverId: matchedDriverId };
}

// Server-side equivalent of client/src/lib/routing.ts:applyStopGroupings.
// Kept inline so the driver routes file has no client-lib import path.
function applyDriverStopGroupings(stops: Stop[], groupings: StopGrouping[]): Stop[] {
  let work = stops.slice();
  for (const g of groupings) {
    if (!g.ids || g.ids.length < 2) continue;
    const wanted = new Set(g.ids);
    const matchedIdxs: number[] = [];
    work.forEach((s, i) => {
      if (s.type !== g.type) return;
      const sids = s.ids || [];
      if (sids.length === 0) return;
      if (!sids.some((id) => wanted.has(id))) return;
      if (!sids.every((id) => wanted.has(id))) return;
      matchedIdxs.push(i);
    });
    if (matchedIdxs.length < 2) continue;
    const matched = matchedIdxs.map((i) => work[i]);
    const first = matched[0];
    let lo = 0, hi = 1440, unionLo = 1440, unionHi = 0;
    let combinedPcs = 0, combinedKg = 0, maxSvc = 0;
    const ids: string[] = [];
    const wbs: string[] = [];
    const unmergedIds: string[][] = [];
    for (const s of matched) {
      const ws = toM(s.win?.split("-")[0] || "") || 0;
      const we = toM(s.win?.split("-")[1] || "") || 1440;
      lo = Math.max(lo, ws); hi = Math.min(hi, we);
      unionLo = Math.min(unionLo, ws); unionHi = Math.max(unionHi, we);
      combinedPcs += s.pcs || 0;
      combinedKg += s.kg || 0;
      maxSvc = Math.max(maxSvc, s.svcMin);
      ids.push(...s.ids);
      wbs.push(...s.wbs);
      unmergedIds.push(s.ids.slice());
    }
    const win = hi > lo ? `${fmM(lo)}-${fmM(hi)}` : `${fmM(unionLo)}-${fmM(unionHi)}`;
    const combined: Stop = {
      ...first,
      ids,
      wbs,
      pcs: combinedPcs,
      kg: Math.round(combinedKg * 10) / 10,
      win,
      svcMin: maxSvc + Math.max(0, ids.length - 1) * 1,
      key: matched.map((s) => s.key).join("+"),
      unmergedIds,
      grouped: true,
    };
    const firstIdx = matchedIdxs[0];
    const removeSet = new Set(matchedIdxs.slice(1));
    work = work.map((s, i) => (i === firstIdx ? combined : s)).filter((_, i) => !removeSet.has(i));
  }
  return work;
}

router.get("/trip-sheet", requireDriverAuth, async (req: Request, res: Response) => {
  try {
    const projects = await storage.getProjects();
    const result = getActiveProjectAndStops(projects, req.driver!.driverName);
    if (!result) {
      return res.json({ projectId: null, stops: [], driverName: req.driver!.driverName });
    }

    const driverAccount = await storage.getDriverAccount(req.driver!.driverAccountId);
    const driverLat = driverAccount?.currentLat ?? null;
    const driverLng = driverAccount?.currentLng ?? null;

    console.log(`[Trip Sheet] driver=${req.driver!.driverName} accountId=${req.driver!.driverAccountId} gps=${driverLat},${driverLng} stops=${result.stops.length} pending=${result.stops.filter(s => s.status === "pending").length} driverId=${result.driverId} today=${getTodayDateString()}`);

    const pendingStops = result.stops.filter((s) => s.status === "pending");
    if (pendingStops.length > 0) {
      const nowMin = currentTimeMinutes();
      const haveDriverGps = driverLat != null && driverLat !== 0 && driverLng != null && driverLng !== 0;
      let prevLat = haveDriverGps ? (driverLat as number) : pendingStops[0].lat;
      let prevLng = haveDriverGps ? (driverLng as number) : pendingStops[0].lng;
      let cumMin = 0;
      const observedKmh = recentMovingSpeedKmh(req.driver!.driverAccountId);

      for (let i = 0; i < pendingStops.length; i++) {
        const stop = pendingStops[i];
        const departAt = nowMin + cumMin;
        let km: number;
        let min: number;
        if (i === 0 && haveDriverGps) {
          const first = await firstLegEta(
            req.driver!.driverAccountId,
            prevLat, prevLng,
            stop.lat, stop.lng,
            stop.key,
            observedKmh,
            departAt,
          );
          km = first.km;
          min = first.min;
        } else {
          const drive = calcDrive(
            { lat: prevLat, lng: prevLng },
            { lat: stop.lat, lng: stop.lng },
            departAt,
            observedKmh,
          );
          km = drive.km;
          min = drive.min;
        }
        stop.legKm = km;
        stop.legMin = min;
        const arriveAt = nowMin + cumMin + min;
        const winStart = toM(stop.win.split("-")[0]) || 0;
        const serviceStart = Math.max(arriveAt, winStart);
        cumMin = serviceStart - nowMin + stop.svcMin;
        stop.eta = fmM(serviceStart);
        stop.etaM = serviceStart;
        stop.arriveM = arriveAt;
        stop.waitMin = Math.max(0, serviceStart - arriveAt);
        const winEnd = toM(stop.win.split("-")[1]) || 1440;
        stop.late = stop.etaM > winEnd;
        prevLat = stop.lat;
        prevLng = stop.lng;
      }
    }

    interface FleetDriver {
      name?: string;
      plate?: string;
      color?: string;
      type?: string;
    }
    interface FleetSettings {
      drivers?: FleetDriver[];
    }

    let vehiclePlate = driverAccount?.vehiclePlate || "";
    let fleetColor = driverAccount?.fleetColor || "#4a9eff";
    let vehicleType = driverAccount?.vehicleType || "";
    try {
      const fleetSetting = await storage.getAppSetting("fleet");
      if (fleetSetting?.value) {
        const raw = typeof fleetSetting.value === "string" ? JSON.parse(fleetSetting.value) : fleetSetting.value;
        const fleet = raw as FleetSettings;
        const drivers = fleet?.drivers || [];
        const match = drivers.find((d) =>
          d.name?.toLowerCase() === req.driver!.driverName.toLowerCase()
        );
        if (match) {
          if (match.plate) vehiclePlate = match.plate;
          if (match.color) fleetColor = match.color;
          if (match.type) vehicleType = match.type;
        }
      }
    } catch {}

    res.json({
      projectId: result.project.id,
      driverId: result.driverId,
      driverName: req.driver!.driverName,
      vehiclePlate,
      fleetColor,
      vehicleType,
      stops: result.stops,
      stopCount: result.stops.length,
      completedCount: result.stops.filter((s) => s.status === "completed").length,
      pendingCount: result.stops.filter((s) => s.status === "pending").length,
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    console.error("[Driver Trip Sheet]", msg);
    res.status(500).json({ message: msg });
  }
});

router.get("/trip-sheet/remaining-etas", requireDriverAuth, async (req: Request, res: Response) => {
  try {
    const driverId = req.driver!.driverAccountId;
    const cacheKey = `etas_${driverId}`;

    const driverAccount = await storage.getDriverAccount(driverId);
    const curLat = driverAccount?.currentLat || 0;
    const curLng = driverAccount?.currentLng || 0;

    const lastPos = lastEtaPositions.get(driverId);
    const cached = etaCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now() && lastPos && curLat && curLng) {
      const dLat = curLat - lastPos.lat;
      const dLng = curLng - lastPos.lng;
      const approxMeters = Math.sqrt(dLat * dLat + dLng * dLng) * 111000;
      if (approxMeters < ETA_MIN_MOVE_METERS) {
        return res.json(cached.result);
      }
    }

    const projects = await storage.getProjects();
    const result = getActiveProjectAndStops(projects, req.driver!.driverName);
    if (!result) return res.json({ etas: [] });

    const haveDriverGps = curLat !== 0 && curLng !== 0;
    let prevLat = curLat;
    let prevLng = curLng;
    const observedKmh = recentMovingSpeedKmh(driverId);

    const pendingStops = result.stops.filter((s) => s.status === "pending");
    const etas: EtaEntry[] = [];
    let cumulativeMin = 0;
    const currentMin = currentTimeMinutes();

    for (let i = 0; i < pendingStops.length; i++) {
      const stop = pendingStops[i];
      const departAt = currentMin + cumulativeMin;
      let km: number;
      let min: number;
      if (i === 0 && haveDriverGps) {
        const first = await firstLegEta(
          driverId,
          prevLat, prevLng,
          stop.lat, stop.lng,
          stop.key,
          observedKmh,
          departAt,
        );
        km = first.km;
        min = first.min;
      } else {
        const drive = calcDrive(
          { lat: prevLat, lng: prevLng },
          { lat: stop.lat, lng: stop.lng },
          departAt,
          observedKmh,
        );
        km = drive.km;
        min = drive.min;
      }

      const arrivalAbs = currentMin + cumulativeMin + min;
      const winStart = toM(stop.win.split("-")[0]) || 0;
      const serviceStart = Math.max(arrivalAbs, winStart);
      cumulativeMin = serviceStart - currentMin + stop.svcMin;
      const arrivalMin = serviceStart - currentMin;
      etas.push({
        key: stop.key,
        legKm: km,
        legMin: min,
        etaMin: arrivalMin,
        eta: fmM(serviceStart),
      });

      prevLat = stop.lat;
      prevLng = stop.lng;
    }

    const response = { etas };
    etaCache.set(cacheKey, { result: response, expiresAt: Date.now() + ETA_CACHE_TTL });
    if (curLat && curLng) {
      lastEtaPositions.set(driverId, { lat: curLat, lng: curLng, timestamp: Date.now() });
    }

    res.json(response);
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    console.error("[Driver ETAs]", msg);
    res.status(500).json({ message: msg });
  }
});

router.get("/trip-sheet/route-overview", requireDriverAuth, async (req: Request, res: Response) => {
  try {
    const projects = await storage.getProjects();
    const result = getActiveProjectAndStops(projects, req.driver!.driverName);
    if (!result) return res.json({ waypoints: [] });

    const driverAccount = await storage.getDriverAccount(req.driver!.driverAccountId);
    const waypoints: Array<{ lat: number; lng: number; key: string; type: string; status: string }> = [];

    if (driverAccount?.currentLat && driverAccount?.currentLng) {
      waypoints.push({
        lat: driverAccount.currentLat,
        lng: driverAccount.currentLng,
        key: "driver_location",
        type: "driver",
        status: "current",
      });
    }

    for (const stop of result.stops) {
      waypoints.push({
        lat: stop.lat,
        lng: stop.lng,
        key: stop.key,
        type: stop.type,
        status: stop.status,
      });
    }

    res.json({ waypoints });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    res.status(500).json({ message: msg });
  }
});

const VALID_ACTIONS = ["arrive", "complete", "fail", "skip"];

router.post("/stop/:waybill/:action", requireDriverAuth, async (req: Request, res: Response) => {
  try {
    const waybill = req.params.waybill as string;
    const action = req.params.action as string;
    if (!VALID_ACTIONS.includes(action)) {
      return res.status(400).json({ message: `Invalid action. Must be one of: ${VALID_ACTIONS.join(", ")}` });
    }

    const { lat, lng, notes, recipientName, signature, stopType, photoUrl: stopPhotoUrl } = req.body;

    const projects = await storage.getProjects();
    const result = getActiveProjectAndStops(projects, req.driver!.driverName);
    if (!result || !result.project) {
      return res.status(404).json({ message: "No active project found" });
    }

    let matchingStop: Stop | undefined;
    const normalizedType = stopType === "pickup" ? "C" : stopType === "delivery" ? "D" : stopType;
    if (normalizedType === "C" || normalizedType === "D") {
      matchingStop = result.stops.find((s) => s.wbs.includes(waybill) && s.type === normalizedType);
    }
    if (!matchingStop) {
      matchingStop = result.stops.find((s) => s.wbs.includes(waybill));
    }
    if (!matchingStop) {
      return res.status(404).json({ message: "Waybill not found in your trip sheet" });
    }

    // GUARD: a delivery may not be completed before its requested delivery
    // window opens (dAfter). The driver can still hit "arrive" early (so the
    // recipient gets the en-route ping and ETA tracking works), but
    // "complete" / "fail" on a D stop is rejected until SAST clock reaches
    // dAfter. Respect any dispatcher override on the project. Dispatchers
    // can bypass by passing { force: true } in the body — exposed via the
    // driver app's "Early delivery (authorized)" confirmation flow.
    if ((action === "complete" || action === "fail") && matchingStop.type === "D" && !req.body?.force) {
      const projShipsForGuard = ((result.project.shipments || []) as Array<{ id: string; wb: string; dAfter?: string | null }>);
      const guardShip = projShipsForGuard.find((s) => s.wb === waybill);
      const overrides = (result.project as unknown as {
        deliveryOverrides?: Record<string, { dAfter?: string }>;
      }).deliveryOverrides || {};
      const effectiveDAfter = guardShip?.id
        ? (overrides[guardShip.id]?.dAfter ?? guardShip.dAfter ?? null)
        : (guardShip?.dAfter ?? null);
      if (effectiveDAfter && /^\d{2}:\d{2}$/.test(effectiveDAfter)) {
        // Compare against the current wall-clock time in SAST (UTC+2, no DST).
        const nowSastMin = (() => {
          const utcMs = Date.now();
          const sastDate = new Date(utcMs + 2 * 60 * 60 * 1000);
          return sastDate.getUTCHours() * 60 + sastDate.getUTCMinutes();
        })();
        const [hh, mm] = effectiveDAfter.split(":").map((n) => parseInt(n, 10));
        const dAfterMin = hh * 60 + mm;
        if (nowSastMin < dAfterMin) {
          const minsEarly = dAfterMin - nowSastMin;
          return res.status(409).json({
            code: "DELIVERY_BEFORE_WINDOW",
            message: `Delivery window opens at ${effectiveDAfter}. You are ${minsEarly} min early. Contact dispatch to authorize an early delivery.`,
            windowOpensAt: effectiveDAfter,
            minutesEarly: minsEarly,
          });
        }
      }
    }

    let statusValue: string;
    switch (action) {
      case "arrive": statusValue = "arrived"; break;
      case "complete": statusValue = "completed"; break;
      case "fail": statusValue = "failed"; break;
      case "skip": statusValue = "skipped"; break;
      default: statusValue = action;
    }

    const stopStatuses = { ...((result.project.stopStatuses || {}) as Record<string, string>) };
    stopStatuses[matchingStop.key] = statusValue;

    {
      type ProjShip = {
        id: string; wb: string; status?: string | null;
        rate?: string | number | null; cogs?: string | number | null;
        delDate?: string | Date | null; colDate?: string | Date | null; created?: string | Date | null;
        dContact?: string | null; dPhone?: string | null; dAddr?: string | null;
        webhookEvents?: any[] | null;
      };
      const projShips = ((result.project.shipments || []) as ProjShip[]);
      const projAsgn = (result.project.assignments || {}) as Record<string, string>;
      const ship = projShips.find((s) => s.wb === waybill);
      const fleetId = ship ? projAsgn[ship.id] : undefined;

      // Canonical shipment status the dashboard reads from. Picks the most
      // meaningful label per action+stop-type so CSV-imported and webhook-imported
      // records both reflect the latest driver progress.
      const canonicalStatus = mapDriverActionToShipmentStatus(action, matchingStop.type);

      const analyticsStatus =
        action === "complete" && matchingStop.type === "C" ? "collected" :
        action === "complete" ? "delivered" :
        action === "fail"     ? "failed" :
        action === "skip"     ? "skipped" :
        action;

      // Patch canonical status + driver event onto the shipment record so the
      // dashboard sees a single source of truth regardless of import origin.
      const updatedShipments = projShips.map((s) => {
        if (s.wb !== waybill) return s;
        const events = Array.isArray(s.webhookEvents) ? [...s.webhookEvents] : [];
        events.push({
          timestamp: new Date().toISOString(),
          status: canonicalStatus,
          source: "driver",
          message: `${action} (${matchingStop.type === "C" ? "pickup" : "delivery"})`,
        });
        return { ...s, status: canonicalStatus, webhookEvents: events };
      });

      await db.transaction(async (tx) => {
        if (action === "arrive") {
          const activeTrip = await storage.getActiveDriverTrip(req.driver!.driverAccountId);
          if (activeTrip) {
            const existing = await tx.select({ id: driverTripStops.id })
              .from(driverTripStops)
              .where(andOp(eq(driverTripStops.tripId, activeTrip.id), eq(driverTripStops.stopKey, matchingStop.key)))
              .limit(1);
            if (existing.length === 0) {
              const stopTypeStr = matchingStop.type === "C" ? "pickup" : "delivery";
              const mergedPhoto =
                typeof stopPhotoUrl === "string" && stopPhotoUrl.length > 0
                  ? stopPhotoUrl
                  : typeof signature === "string" && signature.length > 0
                    ? signature
                    : null;
              await tx.insert(driverTripStops).values({
                tripId: activeTrip.id,
                driverAccountId: activeTrip.driverAccountId,
                vehiclePlate: activeTrip.vehiclePlate || "",
                stopKey: matchingStop.key,
                waybill,
                stopType: stopTypeStr,
                lat: typeof lat === "number" ? lat : null,
                lng: typeof lng === "number" ? lng : null,
                photoUrl: mergedPhoto,
                notes: notes || "",
              });
            }
          }
        }
        await tx.update(projectsTable)
          .set({ stopStatuses, shipments: updatedShipments as any, updatedAt: new Date() })
          .where(eq(projectsTable.id, result.project.id));
        if (ship && fleetId && (action === "complete" || action === "fail" || action === "skip" || (action === "arrive" && matchingStop.type === "D"))) {
          await syncShipmentToAnalytics({
            driverFleetId: fleetId,
            shipment: { wb: ship.wb, rate: ship.rate, cogs: ship.cogs, status: analyticsStatus, delDate: ship.delDate, colDate: ship.colDate, created: ship.created },
            sourceProjectId: result.project.id,
            exec: tx,
          });
        }
      });

      // Fan the driver's stop progress out to the dispatcher dashboard, ops
      // portal and route planner in real time over the same SSE channel the
      // webhook pipeline uses. Without this a driver-completed stop only showed
      // up on the next manual project refetch. The stopStatusesPatch lets the
      // dispatcher patch its local stop-status map (and recompute the route)
      // immediately; buildSched normalises the casing on read.
      broadcastWebhookEvent({
        topic: "webhook_shipment_updated",
        waybill,
        projectId: result.project.id,
        shipmentId: ship?.id,
        updatedShipment: ship ? { id: ship.id, wb: ship.wb, status: canonicalStatus } : undefined,
        stopStatusesPatch: { [matchingStop.key]: statusValue },
        message: `${req.driver!.driverName}: ${action} ${waybill}`,
      });
    }

    const crmStatus = mapStopActionToCrmStatus(action, matchingStop.type);
    if (crmStatus) {
      type CrmShip = {
        id?: string; wb: string;
        dContact?: string | null; dPhone?: string | null; dAddr?: string | null;
        dLat?: number | null; dLng?: number | null;
        dAfter?: string | null; dBefore?: string | null;
      };
      const shipments = (result.project.shipments || []) as CrmShip[];
      const shipment = shipments.find((s) => s.wb === waybill);
      // Apply any dispatcher delivery-window override for this shipment so the
      // outbound CRM payload carries the effective (overridden) window, not
      // the original sender-requested one.
      const projectOverrides = (result.project as unknown as {
        deliveryOverrides?: Record<string, { dAfter?: string; dBefore?: string }>;
      }).deliveryOverrides || {};
      const ov = shipment?.id ? projectOverrides[shipment.id] : undefined;
      const reqDAfter = ov?.dAfter ?? shipment?.dAfter ?? null;
      const reqDBefore = ov?.dBefore ?? shipment?.dBefore ?? null;

      const crmPayload: CrmWebhookPayload = {
        waybill,
        recipientName: shipment?.dContact || matchingStop.contact || "",
        recipientPhone: shipment?.dPhone || matchingStop.phone || "",
        deliveryAddress: shipment?.dAddr || matchingStop.addr || `${matchingStop.sub}, ${matchingStop.city}`,
        driverAccountId: req.driver!.driverAccountId,
        driverName: req.driver!.driverName,
        shipmentStatus: crmStatus,
        driverLat: lat ?? null,
        driverLng: lng ?? null,
        deliveryLat: shipment?.dLat ?? null,
        deliveryLng: shipment?.dLng ?? null,
        requestedDeliveryAfter: reqDAfter,
        requestedDeliveryBefore: reqDBefore,
      };

      fireCrmWebhook(crmPayload).catch((err) => {
        console.error("[CRM Webhook] Fire-and-forget error:", err.message);
      });
    }

    res.json({
      ok: true,
      waybill,
      action,
      stopKey: matchingStop.key,
      status: statusValue,
      timestamp: new Date().toISOString(),
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    console.error("[Driver Stop Action]", msg);
    res.status(500).json({ message: msg });
  }
});

// DEPRECATED — read-only access to the legacy `driver_stop_events` table.
// New arrive/complete/fail/skip actions are no longer written here (Task #58).
// Live stop status lives in the project `stopStatuses` JSONB; arrival evidence
// lives in `driver_trip_stops`. This endpoint serves historical rows only.
router.get("/stop-events", requireDriverAuth, async (req: Request, res: Response) => {
  try {
    const projectId = req.query.projectId as string;
    if (!projectId) {
      const projects = await storage.getProjects();
      if (!projects.length) return res.json({ events: [] });
      const latest = projects.sort((a, b) =>
        new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
      )[0];
      const events = await storage.getStopEvents(req.driver!.driverAccountId, latest.id);
      return res.json({ events });
    }
    const events = await storage.getStopEvents(req.driver!.driverAccountId, projectId);
    res.json({ events });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    res.status(500).json({ message: msg });
  }
});

router.post("/reorder-request", requireDriverAuth, async (req: Request, res: Response) => {
  try {
    const { proposedOrder, reason } = req.body;
    if (!Array.isArray(proposedOrder) || proposedOrder.length === 0) {
      return res.status(400).json({ message: "proposedOrder must be a non-empty array of stop keys" });
    }

    const projects = await storage.getProjects();
    const result = getActiveProjectAndStops(projects, req.driver!.driverName);
    if (!result || !result.project) {
      return res.status(404).json({ message: "No active project found" });
    }

    const existing = await storage.getDriverPendingReorder(req.driver!.driverAccountId, result.project.id);
    if (existing) {
      return res.status(409).json({ message: "You already have a pending reorder request" });
    }

    const allPending = result.stops.filter((s) => s.status === "pending" || s.status === "arrived");
    const upcomingStops = allPending.slice(1);
    if (upcomingStops.length < 2) {
      return res.status(400).json({ message: "Need at least 2 upcoming stops to reorder" });
    }
    const currentOrder = upcomingStops.map((s) => s.key);

    const currentSet = new Set(currentOrder);
    if ((proposedOrder as string[]).length !== currentOrder.length) {
      return res.status(400).json({ message: "Proposed order must contain exactly the same stops" });
    }
    const proposedSet = new Set(proposedOrder as string[]);
    if (proposedSet.size !== currentOrder.length) {
      return res.status(400).json({ message: "Proposed order must not contain duplicate stops" });
    }
    for (const key of proposedOrder) {
      if (!currentSet.has(key)) {
        return res.status(400).json({ message: `Unknown stop key: ${key}` });
      }
    }

    const canonicalDriverId = result.driverId || req.driver!.driverName;

    const request = await storage.createReorderRequest({
      driverAccountId: req.driver!.driverAccountId,
      driverName: canonicalDriverId,
      projectId: result.project.id,
      currentOrder: currentOrder as unknown as InsertDriverReorderRequest["currentOrder"],
      proposedOrder: proposedOrder as unknown as InsertDriverReorderRequest["proposedOrder"],
      reason: (reason || "").slice(0, 500),
    });

    res.status(201).json(request);
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    console.error("[Driver Reorder Request]", msg);
    res.status(500).json({ message: msg });
  }
});

router.get("/reorder-request/status", requireDriverAuth, async (req: Request, res: Response) => {
  try {
    const projects = await storage.getProjects();
    const result = getActiveProjectAndStops(projects, req.driver!.driverName);
    if (!result || !result.project) {
      return res.json({ request: null });
    }

    const request = await storage.getDriverLatestReorder(req.driver!.driverAccountId, result.project.id);
    res.json({ request: request || null });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    res.status(500).json({ message: msg });
  }
});

router.get("/reorder-request/history", requireDriverAuth, async (req: Request, res: Response) => {
  try {
    const projects = await storage.getProjects();
    const result = getActiveProjectAndStops(projects, req.driver!.driverName);
    if (!result || !result.project) {
      return res.json({ requests: [] });
    }

    const all = await storage.getRecentReorderRequests(result.project.id, 20);
    const mine = all.filter((r) => r.driverAccountId === req.driver!.driverAccountId);
    res.json({ requests: mine });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    res.status(500).json({ message: msg });
  }
});

export async function ensureTestDriverAccount(): Promise<void> {
  try {
    const existing = await storage.getDriverAccountByUsername("driver1");
    if (!existing) {
      const hashed = await hashPassword("delicate2024");
      const newAccount: InsertDriverAccount = {
        username: "driver1",
        passwordHash: hashed,
        driverName: "Driver 1",
        phone: "+27123456789",
        isOnline: false,
        currentLat: null,
        currentLng: null,
        currentAccuracy: null,
        currentSpeed: null,
        currentHeading: null,
        locationUpdatedAt: null,
        lastLoginAt: null,
      };
      await storage.createDriverAccount(newAccount);
      console.log("[Driver App] Test account created: driver1 / delicate2024");
    }
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    console.error("[Driver App] Failed to create test account:", msg);
  }
}

export async function cleanupLocationHistory(): Promise<void> {
  try {
    const count = await storage.cleanupOldLocationHistory(30);
    if (count > 0) {
      console.log(`[Driver App] Cleaned up ${count} old location history records`);
    }
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    console.error("[Driver App] Cleanup error:", msg);
  }
}

function decodePolyline(encoded: string): [number, number][] {
  const points: [number, number][] = [];
  let index = 0, lat = 0, lng = 0;
  while (index < encoded.length) {
    let b, shift = 0, result = 0;
    do { b = encoded.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
    lat += (result & 1) ? ~(result >> 1) : (result >> 1);
    shift = 0; result = 0;
    do { b = encoded.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
    lng += (result & 1) ? ~(result >> 1) : (result >> 1);
    points.push([lat / 1e5, lng / 1e5]);
  }
  return points;
}

const routePolylineCache = new Map<string, { points: [number, number][]; ts: number }>();
const ROUTE_CACHE_TTL = 900_000;

router.post("/route-polyline", requireDriverAuth, async (req, res) => {
  try {
    const { waypoints } = req.body as { waypoints: { lat: number; lng: number }[] };
    if (!waypoints || waypoints.length < 2) {
      return res.status(400).json({ error: "Need at least 2 waypoints" });
    }

    const cacheKey = waypoints.map(w => `${w.lat.toFixed(4)},${w.lng.toFixed(4)}`).join("|");
    const cached = routePolylineCache.get(cacheKey);
    if (cached && Date.now() - cached.ts < ROUTE_CACHE_TTL) {
      return res.json({ points: cached.points });
    }

    if (waypoints.some(w => w.lat < -35 || w.lat > -22 || w.lng < 16 || w.lng > 33)) {
      return res.status(400).json({ error: "Waypoints outside South Africa bounds" });
    }

    let encoded: string | undefined;

    try {
      const coords = waypoints.map(w => `${w.lng},${w.lat}`).join(";");
      const osrmResp = await fetch(`https://router.project-osrm.org/route/v1/driving/${coords}?overview=full&geometries=polyline`);
      if (osrmResp.ok) {
        const osrmData = await osrmResp.json();
        if (osrmData.code === "Ok" && osrmData.routes?.[0]?.geometry) {
          encoded = osrmData.routes[0].geometry;
        }
      }
    } catch {
      console.warn("[Route Polyline] OSRM failed, trying Google Routes");
    }

    if (!encoded) {
      const apiKey = process.env.GOOGLE_ROUTES_API_KEY;
      if (apiKey && waypoints.length === 2) {
        try {
          const data = await centralCallRoutes(
            waypoints[0].lat, waypoints[0].lng,
            waypoints[1].lat, waypoints[1].lng,
            { fieldMask: "routes.polyline.encodedPolyline", routingPreference: "TRAFFIC_AWARE", apiType: API_TYPES.ROUTES_POLYLINE }
          );
          encoded = data.routes?.[0]?.polyline?.encodedPolyline;
        } catch {
          console.warn("[Route Polyline] Google API also failed");
        }
      } else if (apiKey) {
        try {
          const data = await callGoogleRoutesMultiWaypoint(waypoints, { apiType: API_TYPES.ROUTES_POLYLINE });
          encoded = data.routes?.[0]?.polyline?.encodedPolyline;
        } catch {
          console.warn("[Route Polyline] Google API also failed");
        }
      }
    }

    if (!encoded) {
      return res.status(502).json({ error: "No routing service available" });
    }

    const points = decodePolyline(encoded);
    routePolylineCache.set(cacheKey, { points, ts: Date.now() });

    for (const [key, val] of routePolylineCache) {
      if (Date.now() - val.ts > ROUTE_CACHE_TTL) routePolylineCache.delete(key);
    }

    res.json({ points });
  } catch (err) {
    console.error("[Route Polyline] Error:", err);
    res.status(500).json({ error: "Internal error" });
  }
});

// ── Native app install distribution ──────────────────────────────────────────
// Serves the latest signed Android APK and small JSON metadata that the
// in-app /driver/install page renders. APK lives at attached_assets/driver-app/latest.apk
// (drop a freshly built file there from `cd android && ./gradlew assembleRelease`).
const APK_DIR = installPath.resolve(process.cwd(), "attached_assets", "driver-app");
const APK_FILE = installPath.join(APK_DIR, "latest.apk");
const APK_META = installPath.join(APK_DIR, "latest.json");

interface ApkMeta {
  version?: string;
  releasedAt?: string;
}

function readApkMeta(): ApkMeta {
  try {
    if (installFs.existsSync(APK_META)) {
      return JSON.parse(installFs.readFileSync(APK_META, "utf-8"));
    }
  } catch {}
  return {};
}

router.get("/notifications", requireDriverAuth, async (req: Request, res: Response) => {
  try {
    const limitParam = Number(req.query.limit);
    const limit = Number.isFinite(limitParam) && limitParam > 0 && limitParam <= 200 ? Math.floor(limitParam) : 50;
    const driverId = req.driver!.driverAccountId;
    const [rows, unread] = await Promise.all([
      storage.listDriverNotifications(driverId, limit),
      storage.getDriverUnreadNotificationCount(driverId),
    ]);
    res.json({
      notifications: rows.map((n) => ({
        id: n.id,
        kind: n.kind,
        title: n.title,
        body: n.body,
        data: n.data ?? {},
        readAt: n.readAt ? n.readAt.toISOString() : null,
        createdAt: n.createdAt.toISOString(),
      })),
      unreadCount: unread,
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    console.error("[Driver Notifications]", msg);
    res.status(500).json({ message: msg });
  }
});

router.get("/notifications/unread-count", requireDriverAuth, async (req: Request, res: Response) => {
  try {
    const count = await storage.getDriverUnreadNotificationCount(req.driver!.driverAccountId);
    res.json({ unreadCount: count });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    res.status(500).json({ message: msg });
  }
});

router.patch("/notifications/:id/read", requireDriverAuth, async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({ message: "Invalid notification id" });
    }
    const updated = await storage.markDriverNotificationRead(id, req.driver!.driverAccountId);
    if (!updated) return res.status(404).json({ message: "Notification not found" });
    res.json({ ok: true, readAt: updated.readAt ? updated.readAt.toISOString() : null });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    res.status(500).json({ message: msg });
  }
});

router.post("/notifications/mark-all-read", requireDriverAuth, async (req: Request, res: Response) => {
  try {
    await storage.markAllDriverNotificationsRead(req.driver!.driverAccountId);
    res.json({ ok: true });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    res.status(500).json({ message: msg });
  }
});

export async function pruneDriverNotifications(): Promise<void> {
  try {
    const count = await storage.pruneOldDriverNotifications(14);
    if (count > 0) {
      console.log(`[Driver App] Pruned ${count} driver notifications older than 14 days`);
    }
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    console.error("[Driver App] Notification prune error:", msg);
  }
}

router.post("/push/register", requireDriverAuth, async (req: Request, res: Response) => {
  try {
    const { token, platform, appVersion } = req.body || {};
    if (!token || typeof token !== "string" || token.length < 16) {
      return res.status(400).json({ message: "Invalid push token" });
    }
    if (!platform || (platform !== "ios" && platform !== "android")) {
      return res.status(400).json({ message: "platform must be ios|android" });
    }
    // Single-owner enforcement: when a driver registers a token, drop any
    // previous association of the same token with a *different* driver. This
    // covers shared/reused devices where driver B logs in after driver A on
    // the same physical device — without this step, sendToDriver(A) would
    // continue notifying that device. We delete by token value across the
    // whole table, then re-insert for the current driver in the same request.
    await storage.removeDriverPushTokensByValue(token);
    const saved = await storage.upsertDriverPushToken({
      driverAccountId: req.driver!.driverAccountId,
      token,
      platform,
      appVersion: typeof appVersion === "string" ? appVersion.slice(0, 32) : "",
    });
    res.json({ ok: true, id: saved.id, configured: isPushConfigured() });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    res.status(500).json({ message: msg });
  }
});

router.post("/push/unregister", requireDriverAuth, async (req: Request, res: Response) => {
  try {
    const { token } = req.body || {};
    if (!token || typeof token !== "string") {
      return res.status(400).json({ message: "token required" });
    }
    await storage.removeDriverPushToken(req.driver!.driverAccountId, token);
    res.json({ ok: true });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    res.status(500).json({ message: msg });
  }
});

const ALLOWED_TEST_KINDS = new Set([
  "test", "assignment_new", "route_changed", "stop_cancelled", "reorder_approved", "reorder_rejected",
]);

router.get("/push/status", requireDispatcherAuth, (_req: Request, res: Response) => {
  res.json({ configured: isPushConfigured() });
});

router.post("/push/test", requireDispatcherAuth, async (req: Request, res: Response) => {
  try {
    const { driverName, driverAccountId, kind: rawKind, title: rawTitle, body: rawBody } = req.body || {};
    let accountId: number | null = null;
    if (typeof driverAccountId === "number") {
      accountId = driverAccountId;
    } else if (typeof driverName === "string" && driverName.trim()) {
      const acc = await storage.getDriverAccountByName(driverName.trim());
      if (!acc) return res.status(404).json({ message: "Driver not found" });
      accountId = acc.id;
    } else {
      return res.status(400).json({ message: "driverName or driverAccountId required" });
    }

    const kind = typeof rawKind === "string" && ALLOWED_TEST_KINDS.has(rawKind) ? rawKind : "test";
    if (rawKind && !ALLOWED_TEST_KINDS.has(rawKind)) {
      return res.status(400).json({ message: `kind must be one of: ${Array.from(ALLOWED_TEST_KINDS).join(", ")}` });
    }
    const title = typeof rawTitle === "string" && rawTitle.trim() ? rawTitle.slice(0, 100) : "Delicate Driver test";
    const body = typeof rawBody === "string" && rawBody.trim() ? rawBody.slice(0, 240) : "Push notifications are working.";

    const result = await sendToDriver(accountId!, {
      kind: kind as "test" | "assignment_new" | "route_changed" | "stop_cancelled" | "reorder_approved" | "reorder_rejected",
      title,
      body,
      data: { source: "dispatcher-test" },
    });
    res.json({ ok: true, kind, ...result, configured: isPushConfigured() });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    res.status(500).json({ message: msg });
  }
});

router.get("/install/info", (_req: Request, res: Response) => {
  let android: any = { available: false, downloadUrl: "/api/driver/install/android" };
  try {
    if (installFs.existsSync(APK_FILE)) {
      const stat = installFs.statSync(APK_FILE);
      const meta = readApkMeta();
      android = {
        available: true,
        downloadUrl: "/api/driver/install/android",
        sizeBytes: stat.size,
        version: meta.version,
        updatedAt: stat.mtime.toISOString(),
      };
    }
  } catch {}
  res.json({
    android,
    ios: {
      testflightUrl: process.env.DRIVER_TESTFLIGHT_URL || null,
      requestEmail: process.env.DRIVER_INSTALL_CONTACT_EMAIL || "dispatch@delicate.co.za",
    },
  });
});

router.get("/install/android", (_req: Request, res: Response) => {
  if (!installFs.existsSync(APK_FILE)) {
    res.status(404).json({ message: "No APK has been published yet." });
    return;
  }
  const meta = readApkMeta();
  const filename = meta.version ? `delicate-driver-${meta.version}.apk` : "delicate-driver.apk";
  res.setHeader("Content-Type", "application/vnd.android.package-archive");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.sendFile(APK_FILE);
});

const MAX_PHOTO_BYTES = 2_500_000;

class PhotoTooLargeError extends Error {
  constructor(public field: string) {
    super(`${field} exceeds ${MAX_PHOTO_BYTES} bytes`);
    this.name = "PhotoTooLargeError";
  }
}

function decodedByteLength(value: string): number {
  const commaIdx = value.indexOf(",");
  const isDataUrl = value.startsWith("data:") && commaIdx > 0;
  const payload = isDataUrl ? value.slice(commaIdx + 1) : value;
  if (isDataUrl && /;base64/i.test(value.slice(0, commaIdx))) {
    const len = payload.length;
    const padding = payload.endsWith("==") ? 2 : payload.endsWith("=") ? 1 : 0;
    return Math.floor((len * 3) / 4) - padding;
  }
  return Buffer.byteLength(payload, "utf8");
}

function validatePhoto(value: unknown, field: string, required: boolean): string | null {
  if (value == null || value === "") {
    if (required) throw new Error(`${field} is required`);
    return null;
  }
  if (typeof value !== "string") {
    throw new Error(`${field} must be a string`);
  }
  if (decodedByteLength(value) > MAX_PHOTO_BYTES) {
    throw new PhotoTooLargeError(field);
  }
  return value;
}

function serializeTrip(trip: DriverTrip) {
  return {
    ...trip,
    startOdometer: trip.startOdometer != null ? Number(trip.startOdometer) : 0,
    endOdometer: trip.endOdometer != null ? Number(trip.endOdometer) : null,
  };
}

function serializeExpense(exp: DriverTripExpense) {
  return {
    ...exp,
    amount: exp.amount != null ? Number(exp.amount) : 0,
    litres: exp.litres != null ? Number(exp.litres) : null,
  };
}

const FUEL_LEVEL_OPTIONS = ["F", "3/4", "1/2", "1/4", "E"] as const;
const STOP_TYPE_OPTIONS = ["pickup", "delivery"] as const;
const EXPENSE_TYPE_OPTIONS = ["fuel", "toll", "service"] as const;

// Vehicle Logs API contract (driver + dispatcher) is documented in
// docs/vehicle-logs.md. The Zod schemas below are the source of truth
// for accepted request shapes and field names.

// Pre-process accepts both prefixed (startOdometer) and the original
// short-form aliases (odometer/fuelLevel/clusterPhoto/lat/lng) from the
// task brief, mapping the latter onto the prefixed canonical fields.
const startTripBodySchema = z.preprocess((raw) => {
  if (!raw || typeof raw !== "object") return raw;
  const r = raw as Record<string, unknown>;
  return {
    startOdometer: r.startOdometer ?? r.odometer,
    startFuelLevel: r.startFuelLevel ?? r.fuelLevel,
    startClusterPhoto: r.startClusterPhoto ?? r.clusterPhoto ?? r.photo,
    startLat: r.startLat ?? r.lat,
    startLng: r.startLng ?? r.lng,
    projectId: r.projectId,
    notes: r.notes,
  };
}, z.object({
  startOdometer: z.union([z.string(), z.number()]).transform((v) => Number(v)).refine((n) => Number.isFinite(n) && n >= 0, "startOdometer must be >= 0"),
  startFuelLevel: z.enum(FUEL_LEVEL_OPTIONS),
  startClusterPhoto: z.string().min(1, "startClusterPhoto is required"),
  startLat: z.number().optional().nullable(),
  startLng: z.number().optional().nullable(),
  projectId: z.string().optional().nullable(),
  notes: z.string().optional(),
}));

const endTripBodySchema = z.preprocess((raw) => {
  if (!raw || typeof raw !== "object") return raw;
  const r = raw as Record<string, unknown>;
  return {
    endOdometer: r.endOdometer ?? r.odometer,
    endFuelLevel: r.endFuelLevel ?? r.fuelLevel,
    endClusterPhoto: r.endClusterPhoto ?? r.clusterPhoto ?? r.photo,
    endLat: r.endLat ?? r.lat,
    endLng: r.endLng ?? r.lng,
    notes: r.notes,
  };
}, z.object({
  endOdometer: z.union([z.string(), z.number()]).transform((v) => Number(v)).refine((n) => Number.isFinite(n) && n >= 0, "endOdometer must be >= 0"),
  endFuelLevel: z.enum(FUEL_LEVEL_OPTIONS),
  endClusterPhoto: z.string().min(1, "endClusterPhoto is required"),
  endLat: z.number().optional().nullable(),
  endLng: z.number().optional().nullable(),
  notes: z.string().optional(),
}));

const tripStopBodySchema = z.preprocess((raw) => {
  if (!raw || typeof raw !== "object") return raw;
  const r = raw as Record<string, unknown>;
  return {
    ...r,
    photoUrl: r.photoUrl ?? r.photo,
  };
}, z.object({
  stopKey: z.string().min(1, "stopKey is required"),
  waybill: z.string().optional().default(""),
  stopType: z.enum(STOP_TYPE_OPTIONS),
  lat: z.number().optional().nullable(),
  lng: z.number().optional().nullable(),
  photoUrl: z.string().nullable().optional(),
  notes: z.string().optional(),
}));

const tripExpenseBodySchema = z.preprocess((raw) => {
  if (!raw || typeof raw !== "object") return raw;
  const r = raw as Record<string, unknown>;
  return {
    ...r,
    receiptUrl: r.receiptUrl ?? r.receipt,
  };
}, z.object({
  expenseType: z.enum(EXPENSE_TYPE_OPTIONS),
  amount: z.union([z.string(), z.number()]).transform((v) => Number(v)).refine((n) => Number.isFinite(n) && n > 0, "amount must be > 0"),
  litres: z.union([z.string(), z.number(), z.null()]).optional().transform((v) => v == null || v === "" ? null : Number(v)),
  receiptUrl: z.string().nullable().optional(),
  lat: z.number().optional().nullable(),
  lng: z.number().optional().nullable(),
  notes: z.string().optional(),
}));

router.get("/trips/active", requireDriverAuth, async (req: Request, res: Response) => {
  try {
    const driverAccountId = req.driver!.driverAccountId;
    const trip = await storage.getActiveDriverTrip(driverAccountId);
    if (!trip) {
      return res.json({ trip: null, stops: [], expenses: [] });
    }
    const [stops, expenses] = await Promise.all([
      storage.listDriverTripStops(trip.id),
      storage.listDriverTripExpenses(trip.id),
    ]);
    res.json({
      trip: serializeTrip(trip),
      stops,
      expenses: expenses.map(serializeExpense),
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Failed to load active trip";
    console.error("[Driver Trips Active]", msg);
    res.status(500).json({ message: msg });
  }
});

router.post("/trips/start", requireDriverAuth, async (req: Request, res: Response) => {
  try {
    const driverAccountId = req.driver!.driverAccountId;
    // Previously this returned 409 "An active shift already exists", which
    // permanently blocked drivers whose prior shift was never properly ended
    // (e.g. the app was closed before tapping End Shift, leaving a stale
    // "active" row). Instead, auto-close ANY lingering active shifts so a driver
    // can always start a fresh one / go online at any time. We end each with
    // zero distance (end odometer = start odometer) since we have no real
    // reading, and never let a close failure block the new shift.
    try {
      const stale = await storage.listDriverTrips({ driverAccountId, status: "active", limit: 100 });
      if (stale.length > 0) {
        for (const trip of stale) {
          await storage.closeDriverTrip(trip.id, {
            endTime: new Date(),
            endOdometer: trip.startOdometer,
            endFuelLevel: trip.startFuelLevel,
            endClusterPhoto: null,
            endLat: trip.startLat ?? null,
            endLng: trip.startLng ?? null,
            notes: [trip.notes, "Auto-closed: superseded by a new shift start"]
              .filter(Boolean)
              .join(" | "),
          });
        }
        const { invalidateDriverAccountCache } = await import("../lib/analytics-cache");
        await invalidateDriverAccountCache(driverAccountId);
      }
    } catch (e) {
      console.error("[Driver Trips Start] auto-close stale shift(s) failed", e);
    }

    const parsed = startTripBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: parsed.error.issues[0]?.message || "Invalid request body" });
    }
    const body = parsed.data;
    let startClusterPhoto: string | null;
    try {
      startClusterPhoto = validatePhoto(body.startClusterPhoto, "startClusterPhoto", true);
    } catch (e) {
      if (e instanceof PhotoTooLargeError) return res.status(413).json({ message: e.message });
      return res.status(400).json({ message: e instanceof Error ? e.message : "Invalid photo" });
    }
    if (!startClusterPhoto) {
      return res.status(400).json({ message: "startClusterPhoto is required" });
    }

    const account = await storage.getDriverAccount(driverAccountId);
    let resolvedProjectId: string | null = body.projectId ?? null;
    if (!resolvedProjectId) {
      try {
        const projects = await storage.getProjects();
        const active = getActiveProjectAndStops(projects, req.driver!.driverName);
        if (active?.project?.id) resolvedProjectId = active.project.id;
      } catch (e) {
        console.error("[Driver Trips Start] resolve project", e);
      }
    }
    const insert: InsertDriverTrip = {
      driverAccountId,
      vehiclePlate: account?.vehiclePlate || "",
      vehicleType: account?.vehicleType || "",
      projectId: resolvedProjectId,
      startTime: new Date(),
      startOdometer: body.startOdometer.toFixed(2),
      startFuelLevel: body.startFuelLevel,
      startClusterPhoto,
      startLat: body.startLat ?? null,
      startLng: body.startLng ?? null,
      status: "active",
      notes: body.notes ?? "",
    };

    const validated = insertDriverTripSchema.safeParse(insert);
    if (!validated.success) {
      return res.status(400).json({ message: validated.error.issues[0]?.message || "Invalid trip data" });
    }

    const trip = await storage.createDriverTrip(insert);

    const { ocrAndPersistTripPhoto } = await import("../lib/ocr");
    void ocrAndPersistTripPhoto(trip.id, "start", startClusterPhoto)
      .catch((e) => console.error("[OCR cluster start]", e instanceof Error ? e.message : e));

    res.status(201).json({ trip: serializeTrip(trip) });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Failed to start shift";
    console.error("[Driver Trips Start]", msg);
    res.status(500).json({ message: msg });
  }
});

router.post("/trips/:id/end", requireDriverAuth, async (req: Request, res: Response) => {
  try {
    const driverAccountId = req.driver!.driverAccountId;
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ message: "Invalid trip id" });
    const trip = await storage.getDriverTrip(id);
    if (!trip || trip.driverAccountId !== driverAccountId) {
      return res.status(404).json({ message: "Trip not found" });
    }
    if (trip.status !== "active") {
      return res.status(409).json({ message: "Trip is already closed" });
    }

    const parsed = endTripBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: parsed.error.issues[0]?.message || "Invalid request body" });
    }
    const body = parsed.data;
    const startOdoNum = Number(trip.startOdometer);
    if (body.endOdometer < startOdoNum) {
      return res.status(400).json({ message: "End odometer must be greater than or equal to start odometer" });
    }
    let endClusterPhoto: string | null;
    try {
      endClusterPhoto = validatePhoto(body.endClusterPhoto, "endClusterPhoto", true);
    } catch (e) {
      if (e instanceof PhotoTooLargeError) return res.status(413).json({ message: e.message });
      return res.status(400).json({ message: e instanceof Error ? e.message : "Invalid photo" });
    }
    if (!endClusterPhoto) {
      return res.status(400).json({ message: "endClusterPhoto is required" });
    }

    const closed = await storage.closeDriverTrip(id, {
      endTime: new Date(),
      endOdometer: body.endOdometer.toFixed(2),
      endFuelLevel: body.endFuelLevel,
      endClusterPhoto,
      endLat: body.endLat ?? null,
      endLng: body.endLng ?? null,
      notes: body.notes ?? trip.notes ?? "",
    });

    const { ocrAndPersistTripPhoto } = await import("../lib/ocr");
    void ocrAndPersistTripPhoto(id, "end", endClusterPhoto)
      .catch((e) => console.error("[OCR cluster end]", e instanceof Error ? e.message : e));

    try {
      const { invalidateDriverAccountCache } = await import("../lib/analytics-cache");
      await invalidateDriverAccountCache(driverAccountId);
    } catch (e) {
      console.error("[Driver Trips End] cache invalidate failed", e);
    }

    const [stops, expenses] = await Promise.all([
      storage.listDriverTripStops(id),
      storage.listDriverTripExpenses(id),
    ]);
    const fuelTotal = expenses.filter((e) => e.expenseType === "fuel").reduce((s, e) => s + Number(e.amount || 0), 0);
    const litresTotal = expenses.filter((e) => e.expenseType === "fuel").reduce((s, e) => s + Number(e.litres || 0), 0);

    res.json({
      trip: closed ? serializeTrip(closed) : serializeTrip(trip),
      stops,
      expenses: expenses.map(serializeExpense),
      summary: {
        distanceKm: body.endOdometer - startOdoNum,
        stopCount: stops.length,
        fuelTotal,
        litresTotal,
      },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Failed to end shift";
    console.error("[Driver Trips End]", msg);
    res.status(500).json({ message: msg });
  }
});

router.post("/trips/:id/stops", requireDriverAuth, async (req: Request, res: Response) => {
  try {
    const driverAccountId = req.driver!.driverAccountId;
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ message: "Invalid trip id" });
    const trip = await storage.getDriverTrip(id);
    if (!trip || trip.driverAccountId !== driverAccountId) {
      return res.status(404).json({ message: "Trip not found" });
    }
    if (trip.status !== "active") {
      return res.status(409).json({ message: "Trip is closed; cannot log stops" });
    }
    const parsed = tripStopBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: parsed.error.issues[0]?.message || "Invalid request body" });
    }
    const body = parsed.data;
    let photoUrl: string | null;
    try {
      photoUrl = validatePhoto(body.photoUrl ?? null, "photoUrl", false);
    } catch (e) {
      if (e instanceof PhotoTooLargeError) return res.status(413).json({ message: e.message });
      return res.status(400).json({ message: e instanceof Error ? e.message : "Invalid photo" });
    }
    const insert: InsertDriverTripStop = {
      tripId: id,
      driverAccountId: trip.driverAccountId,
      vehiclePlate: trip.vehiclePlate || "",
      stopKey: body.stopKey,
      waybill: body.waybill,
      stopType: body.stopType,
      lat: body.lat ?? null,
      lng: body.lng ?? null,
      photoUrl,
      notes: body.notes ?? "",
    };
    const validated = insertDriverTripStopSchema.safeParse(insert);
    if (!validated.success) {
      return res.status(400).json({ message: validated.error.issues[0]?.message || "Invalid stop data" });
    }
    const stop = await storage.createDriverTripStop(insert);
    res.status(201).json({ stop });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Failed to log stop";
    console.error("[Driver Trips Stop]", msg);
    res.status(500).json({ message: msg });
  }
});

router.post("/trips/:id/expenses", requireDriverAuth, async (req: Request, res: Response) => {
  try {
    const driverAccountId = req.driver!.driverAccountId;
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ message: "Invalid trip id" });
    const trip = await storage.getDriverTrip(id);
    if (!trip || trip.driverAccountId !== driverAccountId) {
      return res.status(404).json({ message: "Trip not found" });
    }
    if (trip.status !== "active") {
      return res.status(409).json({ message: "Trip is closed; cannot log expenses" });
    }
    const parsed = tripExpenseBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: parsed.error.issues[0]?.message || "Invalid request body" });
    }
    const body = parsed.data;
    let receiptUrl: string | null;
    try {
      receiptUrl = validatePhoto(body.receiptUrl ?? null, "receiptUrl", false);
    } catch (e) {
      if (e instanceof PhotoTooLargeError) return res.status(413).json({ message: e.message });
      return res.status(400).json({ message: e instanceof Error ? e.message : "Invalid photo" });
    }
    if (body.expenseType === "fuel" && !receiptUrl) {
      return res.status(400).json({ message: "receiptUrl is required for fuel expenses" });
    }
    const litresStr = body.litres != null && Number.isFinite(body.litres) ? body.litres.toFixed(2) : null;

    const insert: InsertDriverTripExpense = {
      tripId: id,
      driverAccountId: trip.driverAccountId,
      vehiclePlate: trip.vehiclePlate || "",
      expenseType: body.expenseType,
      amount: body.amount.toFixed(2),
      litres: litresStr,
      receiptUrl,
      lat: body.lat ?? null,
      lng: body.lng ?? null,
      notes: body.notes ?? "",
    };
    const validated = insertDriverTripExpenseSchema.safeParse(insert);
    if (!validated.success) {
      return res.status(400).json({ message: validated.error.issues[0]?.message || "Invalid expense data" });
    }
    const expense = await storage.createDriverTripExpense(insert);

    if (receiptUrl) {
      const { ocrAndPersistExpensePhoto } = await import("../lib/ocr");
      void ocrAndPersistExpensePhoto(expense.id, receiptUrl)
        .catch((e) => console.error("[OCR receipt]", e instanceof Error ? e.message : e));
    }

    try {
      const { invalidateDriverAccountCache } = await import("../lib/analytics-cache");
      await invalidateDriverAccountCache(driverAccountId);
    } catch (e) {
      console.error("[Driver Trips Expense] cache invalidate failed", e);
    }

    res.status(201).json({ expense: serializeExpense(expense) });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Failed to log expense";
    console.error("[Driver Trips Expense]", msg);
    res.status(500).json({ message: msg });
  }
});

router.get("/trips/:id", requireDriverAuth, async (req: Request, res: Response) => {
  try {
    const driverAccountId = req.driver!.driverAccountId;
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ message: "Invalid trip id" });
    const trip = await storage.getDriverTrip(id);
    if (!trip || trip.driverAccountId !== driverAccountId) {
      return res.status(404).json({ message: "Trip not found" });
    }
    const [stops, expenses] = await Promise.all([
      storage.listDriverTripStops(id),
      storage.listDriverTripExpenses(id),
    ]);
    res.json({
      trip: serializeTrip(trip),
      stops,
      expenses: expenses.map(serializeExpense),
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Failed to load trip";
    console.error("[Driver Trips Get]", msg);
    res.status(500).json({ message: msg });
  }
});

export default router;
