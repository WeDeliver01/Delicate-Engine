/**
 * autosave.ts
 * Debounced server-sync of the working session state.
 *
 * Strategy:
 *  - On every meaningful state change, call `scheduleAutosave()`.
 *  - Actual save fires 8 s after the last schedule call (debounced).
 *  - A fallback interval fires every 30 s in case no change was detected.
 *  - Session project ID is stored in localStorage so the same record is
 *    updated (PATCH) rather than creating duplicates on refresh.
 */

import type { Shipment, HandoffEvent, HandoffPoint, DeliveryOverrides, CollectionOverrides, StopGroupings } from "@shared/schema";

export type SaveStatus = "idle" | "pending" | "saving" | "saved" | "error";

export interface SessionState {
  shipments: Shipment[];
  assignments: Record<string, string>;
  tripStatuses: Record<string, string>;
  stopStatuses: Record<string, string>;
  stopNotes: Record<string, string>;
  driverStopSequences?: Record<string, string[]>;
  deliveryOverrides?: DeliveryOverrides;
  collectionOverrides?: CollectionOverrides;
  stopGroupings?: StopGroupings;
  handoffs?: HandoffEvent[];
  handoffPoints?: HandoffPoint[];
}

const SESSION_ID_KEY = "delicate-courier-session-id";
const DEBOUNCE_MS = 8_000;
const INTERVAL_MS = 30_000;

type StatusListener = (status: SaveStatus) => void;

class AutosaveService {
  private projectId: string | null = null;
  private pendingState: SessionState | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private intervalTimer: ReturnType<typeof setInterval> | null = null;
  private listeners: Set<StatusListener> = new Set();
  private status: SaveStatus = "idle";
  private lastSavedHash = "";

  constructor() {
    this.projectId = localStorage.getItem(SESSION_ID_KEY);
  }

  /** Register a listener to receive save status updates. */
  onStatusChange(fn: StatusListener): () => void {
    this.listeners.add(fn);
    fn(this.status);
    return () => this.listeners.delete(fn);
  }

  private emit(s: SaveStatus) {
    this.status = s;
    this.listeners.forEach((fn) => fn(s));
  }

  /** Call this from React when state changes. */
  scheduleAutosave(state: SessionState) {
    this.pendingState = state;
    this.emit("pending");
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => this.flush(), DEBOUNCE_MS);
  }

  /** Immediately save without waiting for the debounce. */
  async flushNow(state?: SessionState) {
    if (state) this.pendingState = state;
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    await this.flush();
  }

  private stateHash(s: SessionState): string {
    return JSON.stringify({
      wbs: s.shipments.map((sh) => sh.wb).sort(),
      asgn: s.assignments,
      trip: s.tripStatuses,
      seq: s.driverStopSequences || {},
      dov: s.deliveryOverrides || {},
      cov: s.collectionOverrides || {},
      grp: s.stopGroupings || {},
    });
  }

  private async flush() {
    if (!this.pendingState) return;
    const hash = this.stateHash(this.pendingState);
    if (hash === this.lastSavedHash) {
      this.emit("saved");
      return;
    }
    this.emit("saving");
    try {
      const body = {
        projectId: this.projectId,
        name: "session",
        shipments: this.pendingState.shipments,
        assignments: this.pendingState.assignments,
        tripStatuses: this.pendingState.tripStatuses,
        stopStatuses: this.pendingState.stopStatuses,
        stopNotes: this.pendingState.stopNotes,
        driverStopSequences: this.pendingState.driverStopSequences || {},
        deliveryOverrides: this.pendingState.deliveryOverrides || {},
        collectionOverrides: this.pendingState.collectionOverrides || {},
        stopGroupings: this.pendingState.stopGroupings || {},
      };
      const res = await fetch("/api/session/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data.id && data.id !== this.projectId) {
        this.projectId = data.id;
        localStorage.setItem(SESSION_ID_KEY, data.id);
      }
      this.lastSavedHash = hash;
      this.emit("saved");
    } catch (e) {
      console.warn("[autosave] Save failed:", e);
      this.emit("error");
      // Retry after 15 s
      setTimeout(() => this.flush(), 15_000);
    }
  }

  /** Start the background interval fallback. */
  start() {
    if (this.intervalTimer) return;
    this.intervalTimer = setInterval(() => {
      if (this.pendingState && this.status !== "saving") {
        this.flush();
      }
    }, INTERVAL_MS);
  }

  stop() {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    if (this.intervalTimer) clearInterval(this.intervalTimer);
    this.intervalTimer = null;
  }

  /**
   * Load the last saved session from the server.
   * Returns null if no session exists or the request fails.
   */
  async loadSession(): Promise<{
    shipments: any[];
    assignments: Record<string, string>;
    tripStatuses: Record<string, string>;
    stopStatuses: Record<string, string>;
    stopNotes: Record<string, string>;
    driverStopSequences: Record<string, string[]>;
    deliveryOverrides: DeliveryOverrides;
    collectionOverrides: CollectionOverrides;
    stopGroupings: StopGroupings;
  } | null> {
    if (!this.projectId) return null;
    try {
      const res = await fetch(`/api/session/${this.projectId}`);
      if (!res.ok) {
        if (res.status === 404) {
          localStorage.removeItem(SESSION_ID_KEY);
          this.projectId = null;
        }
        return null;
      }
      const proj = await res.json();
      return {
        shipments: (proj.shipments as any[]) || [],
        assignments: (proj.assignments as Record<string, string>) || {},
        tripStatuses: (proj.tripStatuses as Record<string, string>) || {},
        stopStatuses: (proj.stopStatuses as Record<string, string>) || {},
        stopNotes: (proj.stopNotes as Record<string, string>) || {},
        driverStopSequences: (proj.driverStopSequences as Record<string, string[]>) || {},
        deliveryOverrides: (proj.deliveryOverrides as DeliveryOverrides) || {},
        collectionOverrides: (proj.collectionOverrides as CollectionOverrides) || {},
        stopGroupings: (proj.stopGroupings as StopGroupings) || {},
      };
    } catch {
      return null;
    }
  }

  getStatus(): SaveStatus { return this.status; }
  getProjectId(): string | null { return this.projectId; }
}

// Singleton — one instance for the whole app
export const autosave = new AutosaveService();

/**
 * Post an audit log entry (fire-and-forget, no UI blocking).
 */
export async function postAuditLog(entry: {
  eventType: string;
  entityType: string;
  entityId: string;
  actorType?: string;
  previousValue?: unknown;
  newValue?: unknown;
  details?: string;
}) {
  try {
    await fetch("/api/audit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ actorType: "user", ...entry }),
    });
  } catch {
    // Non-critical; silently ignore network errors
  }
}

/**
 * Post a CSV import record (fire-and-forget).
 */
export async function postImportRecord(record: {
  fileName: string;
  rowCount: number;
  newCount: number;
  updatedCount: number;
  matchedCount: number;
  failedCount: number;
  warnings: string[];
  changeLog: Array<{ wb: string; field: string; from: unknown; to: unknown }>;
  shipmentSnapshot: unknown[];
}) {
  try {
    const res = await fetch("/api/imports", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(record),
    });
    if (res.ok) return res.json();
  } catch {
    // Non-critical
  }
  return null;
}
