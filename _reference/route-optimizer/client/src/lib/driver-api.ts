const TOKEN_KEY = "delicate-driver-token";
const DRIVER_KEY = "delicate-driver-info";

export interface DriverInfo {
  id: number;
  username: string;
  driverName: string;
  phone: string;
  vehiclePlate?: string;
  vehicleType?: string;
}

export interface DriverStop {
  seq: number;
  type: "C" | "D";
  key: string;
  wbs: string[];
  ids: string[];
  sub: string;
  city: string;
  addr: string;
  acc: string;
  pcs: number;
  kg: number;
  win: string;
  eta: string;
  etaM: number;
  legKm: number;
  legMin: number;
  svcMin: number;
  fromLoc: string;
  contact: string;
  phone: string;
  instr: string;
  spx: boolean;
  late: boolean;
  lat: number;
  lng: number;
  status: string;
}

export interface TripSheetResponse {
  projectId: string | null;
  driverId: string;
  driverName: string;
  vehiclePlate: string;
  stops: DriverStop[];
  stopCount: number;
  completedCount: number;
  pendingCount: number;
  fleetColor?: string;
}

export interface EtaEntry {
  key: string;
  legKm: number;
  legMin: number;
  etaMin: number;
  eta: string;
}

export interface OnlineDriver {
  id: number;
  driverName: string;
  lat: number | null;
  lng: number | null;
  accuracy: number | null;
  speed: number | null;
  heading: number | null;
  updatedAt: string | null;
  fleetColor: string;
  vehiclePlate: string;
}

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY) || sessionStorage.getItem(TOKEN_KEY);
}

export function getDriverInfo(): DriverInfo | null {
  const raw = localStorage.getItem(DRIVER_KEY) || sessionStorage.getItem(DRIVER_KEY);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

export function setAuth(token: string, driver: DriverInfo, remember = true) {
  const store = remember ? localStorage : sessionStorage;
  store.setItem(TOKEN_KEY, token);
  store.setItem(DRIVER_KEY, JSON.stringify(driver));
  localStorage.setItem("delicate-driver-session-start", new Date().toISOString());
}

type AuthListener = () => void;
const authListeners: AuthListener[] = [];

export function onAuthChange(listener: AuthListener): () => void {
  authListeners.push(listener);
  return () => {
    const idx = authListeners.indexOf(listener);
    if (idx >= 0) authListeners.splice(idx, 1);
  };
}

function notifyAuthChange() {
  authListeners.forEach((fn) => fn());
}

export function clearAuth() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(DRIVER_KEY);
  sessionStorage.removeItem(TOKEN_KEY);
  sessionStorage.removeItem(DRIVER_KEY);
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
  notifyAuthChange();
}

async function driverFetch(url: string, options: RequestInit = {}): Promise<Response> {
  const token = getToken();
  const headers: Record<string, string> = {
    ...(options.headers as Record<string, string> || {}),
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  if (options.body && typeof options.body === "string") {
    headers["Content-Type"] = "application/json";
  }
  const res = await fetch(url, { ...options, headers });
  if (res.status === 401) {
    clearAuth();
  }
  return res;
}

export async function fetchOnlineDrivers(): Promise<OnlineDriver[]> {
  const res = await driverFetch("/api/driver/locations/all");
  if (!res.ok) return [];
  return res.json();
}

export async function login(username: string, password: string, remember = true): Promise<{ token: string; driver: DriverInfo }> {
  const res = await fetch("/api/driver/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({ message: "Login failed" }));
    throw new Error(data.message || "Login failed");
  }
  const data = await res.json();
  setAuth(data.token, data.driver, remember);
  return data;
}

export async function fetchProfile(): Promise<DriverInfo> {
  const res = await driverFetch("/api/driver/profile");
  if (!res.ok) throw new Error("Failed to fetch profile");
  return res.json();
}

export async function fetchTripSheet(): Promise<TripSheetResponse> {
  const res = await driverFetch("/api/driver/trip-sheet");
  if (!res.ok) throw new Error("Failed to fetch trip sheet");
  return res.json();
}

export async function fetchEtas(): Promise<{ etas: EtaEntry[] }> {
  const res = await driverFetch("/api/driver/trip-sheet/remaining-etas");
  if (!res.ok) throw new Error("Failed to fetch ETAs");
  return res.json();
}

export async function fetchRouteOverview(): Promise<{ waypoints: Array<{ lat: number; lng: number; key: string; type: string; status: string }> }> {
  const res = await driverFetch("/api/driver/trip-sheet/route-overview");
  if (!res.ok) throw new Error("Failed to fetch route overview");
  return res.json();
}

export async function sendLocation(lat: number, lng: number, accuracy: number, speed?: number | null, heading?: number | null): Promise<void> {
  const body: Record<string, number | null | undefined> = { lat, lng, accuracy };
  if (speed != null) body.speed = speed;
  if (heading != null) body.heading = heading;
  const res = await driverFetch("/api/driver/location", {
    method: "POST",
    body: JSON.stringify(body),
  });
  if (!res.ok && res.status !== 429) {
    throw new Error("Failed to send location");
  }
}

export function sendLocationBeacon(lat: number, lng: number, accuracy: number | null, speed?: number | null, heading?: number | null): boolean {
  const token = getToken();
  if (!token) return false;
  if (typeof navigator === "undefined" || !navigator.sendBeacon) return false;
  const payload: Record<string, number | string | null | undefined> = { token, lat, lng };
  if (accuracy != null) payload.accuracy = accuracy;
  if (speed != null) payload.speed = speed;
  if (heading != null) payload.heading = heading;
  try {
    const blob = new Blob([JSON.stringify(payload)], { type: "application/json" });
    return navigator.sendBeacon("/api/driver/location-beacon", blob);
  } catch {
    return false;
  }
}

export async function goOffline(): Promise<void> {
  const res = await driverFetch("/api/driver/go-offline", { method: "POST", body: JSON.stringify({}) });
  if (!res.ok) throw new Error(`Failed to go offline (${res.status})`);
}

export async function goOnline(): Promise<void> {
  const res = await driverFetch("/api/driver/go-online", { method: "POST", body: JSON.stringify({}) });
  if (!res.ok) throw new Error(`Failed to go online (${res.status})`);
}

// Going online is the critical recovery path (especially when the location flow
// is broken), so retry with bounded exponential backoff before giving up. A 401
// is not retried — the token is gone, retrying cannot help.
export async function goOnlineWithRetry(attempts = 3): Promise<boolean> {
  for (let i = 0; i < attempts; i++) {
    try {
      await goOnline();
      return true;
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      if (msg.includes("401")) return false;
      if (i < attempts - 1) {
        await new Promise((r) => setTimeout(r, 1000 * Math.pow(2, i)));
      }
    }
  }
  return false;
}

export async function declineOnline(): Promise<void> {
  const res = await driverFetch("/api/driver/decline-online", { method: "POST", body: JSON.stringify({}) });
  if (!res.ok) throw new Error(`Failed to decline online request (${res.status})`);
}

export interface ReorderRequest {
  id: number;
  driverAccountId: number;
  driverName: string;
  projectId: string;
  currentOrder: string[];
  proposedOrder: string[];
  reason: string;
  status: string;
  reviewedBy: string | null;
  reviewNote: string | null;
  createdAt: string;
  reviewedAt: string | null;
}

export async function submitReorderRequest(proposedOrder: string[], reason: string): Promise<ReorderRequest> {
  const res = await driverFetch("/api/driver/reorder-request", {
    method: "POST",
    body: JSON.stringify({ proposedOrder, reason }),
  });
  if (!res.ok) {
    const d = await res.json().catch(() => ({ message: "Failed to submit reorder request" }));
    throw new Error(d.message || "Failed to submit reorder request");
  }
  return res.json();
}

export async function fetchReorderStatus(): Promise<ReorderRequest | null> {
  const res = await driverFetch("/api/driver/reorder-request/status");
  if (!res.ok) return null;
  const data = await res.json();
  return data.request || null;
}

export async function fetchReorderHistory(): Promise<ReorderRequest[]> {
  const res = await driverFetch("/api/driver/reorder-request/history");
  if (!res.ok) return [];
  const data = await res.json();
  return data.requests || [];
}

export interface DriverInboxNotification {
  id: number;
  kind: string;
  title: string;
  body: string;
  data: Record<string, string>;
  readAt: string | null;
  createdAt: string;
}

export async function fetchDriverNotifications(limit = 50): Promise<{ notifications: DriverInboxNotification[]; unreadCount: number }> {
  const res = await driverFetch(`/api/driver/notifications?limit=${limit}`);
  if (!res.ok) return { notifications: [], unreadCount: 0 };
  return res.json();
}

export async function fetchDriverUnreadCount(): Promise<number> {
  const res = await driverFetch("/api/driver/notifications/unread-count");
  if (!res.ok) return 0;
  const data = await res.json();
  return Number(data?.unreadCount) || 0;
}

export async function markDriverNotificationRead(id: number): Promise<void> {
  await driverFetch(`/api/driver/notifications/${id}/read`, { method: "PATCH", body: JSON.stringify({}) });
}

export async function markAllDriverNotificationsRead(): Promise<void> {
  await driverFetch("/api/driver/notifications/mark-all-read", { method: "POST", body: JSON.stringify({}) });
}

export async function fetchRoutePolyline(
  waypoints: { lat: number; lng: number }[]
): Promise<[number, number][]> {
  const res = await driverFetch("/api/driver/route-polyline", {
    method: "POST",
    body: JSON.stringify({ waypoints }),
  });
  if (!res.ok) return [];
  const data = await res.json();
  return data.points || [];
}

export interface DriverTripDto {
  id: number;
  driverAccountId: number;
  vehiclePlate: string;
  vehicleType: string;
  projectId: string | null;
  startTime: string;
  endTime: string | null;
  startOdometer: number;
  endOdometer: number | null;
  startFuelLevel: string;
  endFuelLevel: string | null;
  startClusterPhoto: string | null;
  endClusterPhoto: string | null;
  startLat: number | null;
  startLng: number | null;
  endLat: number | null;
  endLng: number | null;
  status: string;
  notes: string;
}

export interface DriverTripStopDto {
  id: number;
  tripId: number;
  stopKey: string;
  waybill: string;
  stopType: string;
  arrivedAt: string;
  lat: number | null;
  lng: number | null;
  photoUrl: string | null;
  notes: string;
}

export interface DriverTripExpenseDto {
  id: number;
  tripId: number;
  expenseType: string;
  amount: number;
  litres: number | null;
  receiptUrl: string | null;
  incurredAt: string;
  lat: number | null;
  lng: number | null;
  notes: string;
}

export interface ActiveTripResponse {
  trip: DriverTripDto | null;
  stops: DriverTripStopDto[];
  expenses: DriverTripExpenseDto[];
}

export interface EndTripResponse {
  trip: DriverTripDto;
  stops: DriverTripStopDto[];
  expenses: DriverTripExpenseDto[];
  summary: { distanceKm: number; stopCount: number; fuelTotal: number; litresTotal: number };
}

export async function fetchActiveTrip(): Promise<ActiveTripResponse> {
  const res = await driverFetch("/api/driver/trips/active");
  if (!res.ok) throw new Error("Failed to fetch active trip");
  return res.json();
}

export async function startTrip(payload: {
  startOdometer: number;
  startFuelLevel: string;
  startClusterPhoto?: string | null;
  startLat?: number | null;
  startLng?: number | null;
  projectId?: string | null;
  notes?: string;
}): Promise<DriverTripDto> {
  const res = await driverFetch("/api/driver/trips/start", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const d = await res.json().catch(() => ({ message: "Failed to start shift" }));
    throw new Error(d.message || "Failed to start shift");
  }
  const data = await res.json();
  return data.trip;
}

export async function endTrip(id: number, payload: {
  endOdometer: number;
  endFuelLevel: string;
  endClusterPhoto?: string | null;
  endLat?: number | null;
  endLng?: number | null;
  notes?: string;
}): Promise<EndTripResponse> {
  const res = await driverFetch(`/api/driver/trips/${id}/end`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const d = await res.json().catch(() => ({ message: "Failed to end shift" }));
    throw new Error(d.message || "Failed to end shift");
  }
  return res.json();
}

export async function logTripStop(tripId: number, payload: {
  stopKey: string;
  waybill?: string;
  stopType?: string;
  lat?: number | null;
  lng?: number | null;
  photoUrl?: string | null;
  notes?: string;
}): Promise<DriverTripStopDto> {
  const res = await driverFetch(`/api/driver/trips/${tripId}/stops`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const d = await res.json().catch(() => ({ message: "Failed to log stop" }));
    throw new Error(d.message || "Failed to log stop");
  }
  const data = await res.json();
  return data.stop;
}

export async function logTripExpense(tripId: number, payload: {
  expenseType?: string;
  amount: number;
  litres?: number | null;
  receiptUrl?: string | null;
  lat?: number | null;
  lng?: number | null;
  notes?: string;
}): Promise<DriverTripExpenseDto> {
  const res = await driverFetch(`/api/driver/trips/${tripId}/expenses`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const d = await res.json().catch(() => ({ message: "Failed to log expense" }));
    throw new Error(d.message || "Failed to log expense");
  }
  const data = await res.json();
  return data.expense;
}

// Error thrown when the backend rejects an early delivery completion. The
// driver UI can catch this and prompt the user for an authorized override.
export class EarlyDeliveryError extends Error {
  code = "DELIVERY_BEFORE_WINDOW" as const;
  windowOpensAt: string;
  minutesEarly: number;
  constructor(message: string, windowOpensAt: string, minutesEarly: number) {
    super(message);
    this.windowOpensAt = windowOpensAt;
    this.minutesEarly = minutesEarly;
  }
}

export async function performStopAction(
  waybill: string,
  action: "arrive" | "complete" | "fail" | "skip",
  data?: { lat?: number; lng?: number; notes?: string; recipientName?: string; signature?: string; stopType?: "pickup" | "delivery"; force?: boolean }
): Promise<void> {
  const res = await driverFetch(`/api/driver/stop/${waybill}/${action}`, {
    method: "POST",
    body: JSON.stringify(data || {}),
  });
  if (!res.ok) {
    const d = await res.json().catch(() => ({ message: "Action failed" }));
    if (res.status === 409 && d?.code === "DELIVERY_BEFORE_WINDOW") {
      throw new EarlyDeliveryError(d.message || "Too early", d.windowOpensAt, d.minutesEarly);
    }
    throw new Error(d.message || "Action failed");
  }
}
