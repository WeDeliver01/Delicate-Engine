import { createContext, useContext, type ReactNode, type RefObject } from "react";
import type { TripData, WarningItem, Insight } from "@/lib/routing";
import type { FleetSettings } from "@/lib/fleet";
import type { Driver, Shipment, HandoffEvent, HandoffPoint, DeliveryOverrides, CollectionOverrides } from "@shared/schema";
import type { ParseResult } from "@/lib/csv";
import type { TrafficStatus, DriverTrafficData } from "@/lib/traffic";
import type { TrafficReport } from "@/lib/persistence";

export type TabId =
  | "import"
  | "ops"
  | "trips"
  | "driver"
  | "metrics"
  | "settings"
  | "log"
  | "handoffs"
  | "traffic"
  | "datacentre"
  | "shipments"
  | "allshipments"
  | "analytics";

const ROUTE_TO_TAB: Array<[RegExp, TabId]> = [
  [/^\/intake/, "import"],
  [/^\/live\/trips/, "trips"],
  [/^\/live\/handoffs/, "handoffs"],
  [/^\/live/, "ops"],
  [/^\/fleet/, "driver"],
  [/^\/traffic/, "traffic"],
  [/^\/care/, "shipments"],
  [/^\/archive\/audit/, "log"],
  [/^\/archive/, "datacentre"],
  [/^\/insights\/drivers/, "analytics"],
  [/^\/insights/, "metrics"],
  [/^\/analytics/, "analytics"],
  [/^\/settings\/audit/, "log"],
  [/^\/settings/, "settings"],
];

const TAB_TO_ROUTE: Record<TabId, string> = {
  import: "/intake",
  ops: "/live",
  trips: "/live/trips",
  driver: "/fleet",
  handoffs: "/live/handoffs",
  traffic: "/traffic",
  datacentre: "/archive",
  allshipments: "/care",
  shipments: "/care",
  metrics: "/insights",
  analytics: "/insights/drivers",
  settings: "/settings",
  log: "/archive/audit",
};

export function tabForPath(path: string): TabId {
  for (const [re, tab] of ROUTE_TO_TAB) {
    if (re.test(path)) return tab;
  }
  return "ops";
}

export function pathForTab(tab: TabId): string {
  return TAB_TO_ROUTE[tab] ?? "/live";
}

export interface DispatchAuthUser {
  id: string;
  username: string;
  displayName: string | null;
  email: string | null;
  role: string;
  avatarColor: string;
}

export interface DispatchTotals {
  rev: number;
  cogs: number;
  km: number;
  fuelL: number;
  fuelR: number;
  deadKm: number;
  depotToFirstKm: number;
  returnToDepotKm: number;
  margin: number;
}

export interface DispatchExtras {
  insights: Insight[];
  fleetSettings: FleetSettings;
  setFleetSettings: (s: FleetSettings) => void;
  log: (msg: string, type?: string) => void;
  toggleDriverActive: (id: string) => void;
  onDriverRemoved?: (removedId: string, updated: FleetSettings) => void;
  authUser?: DispatchAuthUser;
  onUpdateProfile?: (data: Record<string, unknown>) => Promise<unknown>;
  // v7 live data fields used by /live and /fleet pages
  totals: DispatchTotals;
  fleet: Driver[];
  tl: Record<string, TripData>;
  dayShips: Shipment[];
  // Subset of dayShips with non-terminal status (not delivered/failed/cancelled).
  // Used for "open work" counts and route planning so completed parcels don't
  // bloat the live tile or add phantom stops to driver routes.
  openDayShips: Shipment[];
  allShipsCount: number;
  asgn: Record<string, string>;
  setAsgn: (updater: Record<string, string> | ((prev: Record<string, string>) => Record<string, string>)) => void;
  runOptimizer: (targetShips?: Shipment[] | null, usePre?: boolean, explore?: boolean, optDayOverride?: string | null) => void;
  optimizing: boolean;
  handoffs: HandoffEvent[];
  handoffPoints: HandoffPoint[];
  allWarn: WarningItem[];
  selectedDay: string;
  setSelectedDay: (d: string) => void;
  availableDays: string[];
  trafficCond: string;
  moveStop: (driverId: string, fromIdx: number, toIdx: number) => void;
  mergeStop: (driverId: string, idx: number) => void;
  splitStop: (driverId: string, idx: number) => void;
  tripSt: Record<string, string>;
  deliveryOverrides: DeliveryOverrides;
  collectionOverrides: CollectionOverrides;
  setDeliveryOverride: (shipmentId: string, dAfter: string, dBefore: string, pinnedTime?: string) => void;
  clearDeliveryOverride: (shipmentId: string) => void;
  setCollectionOverride: (shipmentId: string, cAfter: string, cBefore: string, pinnedTime?: string) => void;
  clearCollectionOverride: (shipmentId: string) => void;
}

export type DispatchLiveData = DispatchExtras;

export interface IntakeContextValue {
  fileRef: RefObject<HTMLInputElement>;
  importFileRef: RefObject<HTMLInputElement>;
  csvText: string;
  setCsvText: (v: string) => void;
  csvResult: ParseResult | null;
  csvFileName: string;
  optimizing: boolean;
  geocoding: boolean;
  geocodingProgress: { done: number; total: number } | null;
  totalShipmentsLoaded: number;
  estimatedDriveHours: number;
  handleFileDrop: (e: React.DragEvent) => void;
  readFile: (f: File) => void;
  parsePastedCsv: () => Promise<void>;
  confirmIntake: () => Promise<void>;
  handleExport: () => void;
  handleImportProject: (e: React.ChangeEvent<HTMLInputElement>) => void;
  goToWebhookSettings: () => void;
}

export interface IncidentItem {
  id: string;
  type: "closure" | "construction" | "incident";
  corridor: string;
  location: string;
  description: string;
  severity: "high" | "medium" | "low";
  timeRestriction?: string;
  detour?: string;
  affectsRoute: boolean;
  isActiveNow: boolean;
}

export interface DriverRouteLeg {
  fromLat: number;
  fromLng: number;
  toLat: number;
  toLng: number;
  fromLabel: string;
  toLabel: string;
  congestion: "NORMAL" | "SLOW" | "HEAVY" | "STANDSTILL";
  delayMin: number;
  corridorId?: string;
  corridorName?: string;
}

export interface DriverRouteForMap {
  driverId: string;
  driverName: string;
  driverColor: string;
  totalDelayMin: number;
  worstCongestion: "NORMAL" | "SLOW" | "HEAVY" | "STANDSTILL";
  legs: DriverRouteLeg[];
  stops: Array<{ lat: number; lng: number; label: string }>;
}

export interface TrafficContextValue {
  trafficStatus: TrafficStatus;
  driverTraffic: Map<string, DriverTrafficData>;
  driverRoutes: DriverRouteForMap[];
  refreshTraffic: () => void;
  totalDelayMin: number;
  worstCongestion: string;
  congestedLegs: number;
  totalLegs: number;
  affectedDriverCount: number;
  incidents: IncidentItem[];
  userReports: TrafficReport[];
  generateDetour: (incident: IncidentItem) => void;
  optimizing: boolean;
  /**
   * OSRM road polylines keyed by `legKey(fromLat,fromLng,toLat,toLng)`.
   * Includes both corridor probes and driver legs so consumers (the traffic
   * page map + corridor matcher) share one cache.
   */
  legGeometries: ReadonlyMap<string, ReadonlyArray<[number, number]>>;
}

export interface DispatchTabContextValue {
  tabBodies: Record<TabId, ReactNode>;
  extras: DispatchExtras;
  intake?: IntakeContextValue;
  traffic?: TrafficContextValue;
}

export const DispatchTabContext = createContext<DispatchTabContextValue | null>(null);

export function useDispatchTabBody(tab: TabId): ReactNode {
  const ctx = useContext(DispatchTabContext);
  if (!ctx) {
    throw new Error('useDispatchTabBody must be used inside <DispatchPage chrome="v7">');
  }
  return ctx.tabBodies[tab];
}

export function useDispatchExtras(): DispatchExtras {
  const ctx = useContext(DispatchTabContext);
  if (!ctx) {
    throw new Error('useDispatchExtras must be used inside <DispatchPage chrome="v7">');
  }
  return ctx.extras;
}

export function useIntakeContext(): IntakeContextValue {
  const ctx = useContext(DispatchTabContext);
  if (!ctx?.intake) {
    throw new Error('useIntakeContext must be used inside <DispatchPage chrome="v7">');
  }
  return ctx.intake;
}

export function useTrafficContext(): TrafficContextValue {
  const ctx = useContext(DispatchTabContext);
  if (!ctx?.traffic) {
    throw new Error('useTrafficContext must be used inside <DispatchPage chrome="v7">');
  }
  return ctx.traffic;
}

export function useDispatchData(): DispatchLiveData {
  const ctx = useContext(DispatchTabContext);
  if (!ctx) {
    throw new Error('useDispatchData must be used inside <DispatchPage chrome="v7">');
  }
  return ctx.extras;
}
