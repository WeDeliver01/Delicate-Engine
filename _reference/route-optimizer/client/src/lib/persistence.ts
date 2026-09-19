import type { Shipment, Stop, HandoffEvent, HandoffPoint, DeliveryOverrides, CollectionOverrides, StopGroupings } from "@shared/schema";

const STORAGE_KEY = "delicate-courier-v6";
const SCHEMA_VERSION = 1;

interface StoredState {
  version: number;
  shipments: Shipment[];
  assignments: Record<string, string>;
  tripStatuses: Record<string, string>;
  stopStatuses: Record<string, string>;
  stopNotes: Record<string, string>;
  handoffs?: HandoffEvent[];
  handoffPoints?: HandoffPoint[];
  stopOverrides?: Record<string, Stop[]>;
  deliveryOverrides?: DeliveryOverrides;
  collectionOverrides?: CollectionOverrides;
  stopGroupings?: StopGroupings;
  savedAt: string;
}

export function saveState(state: Omit<StoredState, "version" | "savedAt">) {
  try {
    const data: StoredState = {
      ...state,
      version: SCHEMA_VERSION,
      savedAt: new Date().toISOString(),
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch (e) {
    console.warn("Failed to save state to localStorage:", e);
  }
}

export function loadState(): Omit<StoredState, "version" | "savedAt"> | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const data: StoredState = JSON.parse(raw);
    if (data.version !== SCHEMA_VERSION) {
      return migrateState(data);
    }
    return {
      shipments: data.shipments || [],
      assignments: data.assignments || {},
      tripStatuses: data.tripStatuses || {},
      stopStatuses: data.stopStatuses || {},
      stopNotes: data.stopNotes || {},
      handoffs: data.handoffs || [],
      handoffPoints: data.handoffPoints || [],
      stopOverrides: data.stopOverrides || {},
      deliveryOverrides: data.deliveryOverrides || {},
      collectionOverrides: data.collectionOverrides || {},
      stopGroupings: data.stopGroupings || {},
    };
  } catch (e) {
    console.warn("Failed to load state from localStorage:", e);
    return null;
  }
}

function migrateState(data: any): Omit<StoredState, "version" | "savedAt"> | null {
  try {
    return {
      shipments: data.shipments || [],
      assignments: data.assignments || {},
      tripStatuses: data.tripStatuses || {},
      stopStatuses: data.stopStatuses || {},
      stopNotes: data.stopNotes || {},
      handoffs: data.handoffs || [],
      handoffPoints: data.handoffPoints || [],
      stopOverrides: data.stopOverrides || {},
      deliveryOverrides: data.deliveryOverrides || {},
      collectionOverrides: data.collectionOverrides || {},
      stopGroupings: data.stopGroupings || {},
    };
  } catch {
    return null;
  }
}

export function clearState() {
  localStorage.removeItem(STORAGE_KEY);
}

export interface ProjectExport {
  appVersion: string;
  exportedAt: string;
  shipments: Shipment[];
  assignments: Record<string, string>;
  tripStatuses: Record<string, string>;
  stopStatuses: Record<string, string>;
  stopNotes: Record<string, string>;
  handoffs?: HandoffEvent[];
  handoffPoints?: HandoffPoint[];
}

export function exportProject(state: {
  shipments: Shipment[];
  assignments: Record<string, string>;
  tripStatuses: Record<string, string>;
  stopStatuses: Record<string, string>;
  stopNotes: Record<string, string>;
  handoffs?: HandoffEvent[];
  handoffPoints?: HandoffPoint[];
}): string {
  const data: ProjectExport = {
    appVersion: "6.1",
    exportedAt: new Date().toISOString(),
    ...state,
  };
  return JSON.stringify(data, null, 2);
}

export function importProject(json: string): Omit<StoredState, "version" | "savedAt"> {
  const data: ProjectExport = JSON.parse(json);
  return {
    shipments: data.shipments || [],
    assignments: data.assignments || {},
    tripStatuses: data.tripStatuses || {},
    stopStatuses: data.stopStatuses || {},
    stopNotes: data.stopNotes || {},
    handoffs: data.handoffs || [],
    handoffPoints: data.handoffPoints || [],
    stopOverrides: {},
    deliveryOverrides: {},
    collectionOverrides: {},
    stopGroupings: {},
  };
}

export interface TrafficReport {
  id: string;
  roadId: string;
  roadName: string;
  category: "traffic" | "condition";
  type: string;
  severity: "high" | "medium" | "low";
  notes: string;
  reportedAt: string;
  expiresAt?: string;
  active: boolean;
}

const REPORTS_KEY = "delicate-courier-reports";

export function saveReports(reports: TrafficReport[]) {
  try {
    localStorage.setItem(REPORTS_KEY, JSON.stringify(reports));
  } catch { /* ignore */ }
}

export function loadReports(): TrafficReport[] {
  try {
    const raw = localStorage.getItem(REPORTS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

const LOG_KEY = "delicate-courier-log";
const MAX_LOGS = 200;

export interface LogEntry {
  t: string;
  msg: string;
  type: string;
}

export function saveLogs(logs: LogEntry[]) {
  try {
    localStorage.setItem(LOG_KEY, JSON.stringify(logs.slice(0, MAX_LOGS)));
  } catch { /* ignore */ }
}

export function loadLogs(): LogEntry[] {
  try {
    const raw = localStorage.getItem(LOG_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}
