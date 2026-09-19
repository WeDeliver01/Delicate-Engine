import { useState, useMemo, useEffect, useRef, useCallback, Fragment, type ReactNode } from "react";
import { useQuery as useTanQuery, useMutation } from "@tanstack/react-query";
import type { Shipment, Stop, HandoffPoint, HandoffEvent, TripArchive, StopGroupings, StopGrouping } from "@shared/schema";
import { getFleetSettings, updateFleetSettings, settingsToFleet, settingsToActiveFleet, fuelCostPerKm, createBlankDriver, DRIVER_COLORS, type FleetSettings, type DriverProfile } from "@/lib/fleet";
import { ts, fmM, gMap, setTrafficCondition, getTrafficCondition, calcDrive, haversine, svcTime, toM, type TrafficCondition } from "@/lib/geo";
import { parseShipLogicCSV, type ParseResult } from "@/lib/csv";
import { isStopFinished } from "@shared/status";
import { optimizeRoutes, buildSched, generateInsights, autoGenerateHandoffs, stopsCanMerge, applyStopGroupings, mergeWarnings, type TripData, type WarningItem, type Insight, type InsightCategory } from "@/lib/routing";
import { saveState, loadState, exportProject, importProject, saveLogs, loadLogs, saveReports, loadReports, type LogEntry, type TrafficReport } from "@/lib/persistence";
import { DeliveryWindowDialog } from "@/components/delivery-window-dialog";
import { applyDeliveryOverrides, applyCollectionOverrides } from "@/lib/routing";
import type { DeliveryOverrides, CollectionOverrides } from "@shared/schema";
import { autosave, postAuditLog, postImportRecord, type SaveStatus } from "@/lib/autosave";
import { GAUTENG_ROADS, searchRoads, type GautengRoad } from "@/lib/roads";
import { DEFAULT_HANDOFF_POINTS } from "@/lib/handoff-points";
import { checkTrafficEnabled, refreshTrafficForSchedule, startAutoRefresh, stopAutoRefresh, getTrafficStatus, onTrafficStatusChange, getDriverTrafficData, setRefreshCallback, type ScheduleStop, type DriverTrafficData, type TrafficStatus, type LegSpeedReading } from "@/lib/traffic";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Sidebar, SidebarContent, SidebarGroup, SidebarGroupLabel,
  SidebarGroupContent, SidebarMenu, SidebarMenuItem, SidebarMenuButton,
  SidebarTrigger, SidebarMenuBadge,
} from "@/components/ui/sidebar";
import { useToast } from "@/hooks/use-toast";
import {
  Upload, Truck, BarChart3, ClipboardList, Smartphone, ScrollText,
  FileDown, FileUp, ChevronDown, ChevronRight, Package, MapPin,
  Clock, AlertTriangle, CheckCircle2, Circle, Play, Lock, Unlock,
  ArrowRight, ExternalLink, Fuel, Route, TrendingUp, Zap, RefreshCw,
  Loader2, X, Search, Filter, Moon, Sun, ArrowUpRight, Activity,
  CircleDot, Navigation, Timer, Weight, Hash, DollarSign, Gauge,
  Lightbulb, Shield, TriangleAlert, Info, Waypoints, ArrowRightLeft,
  Settings, Save, Pencil, Power, ArrowUp, ArrowDown, Repeat2, UserCheck, Users,
  Construction, Ban, History, Siren, Milestone, Database, Trash2, Plus, UserPlus, Merge, Split,
  Eye, EyeOff, Key, Smartphone as SmartphoneIcon, Copy, ArrowUpDown, Phone
} from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { publicUrl } from "@/lib/public-url";
import { useTheme } from "@/components/theme-provider";
import { useLiveClock } from "@/hooks/use-live-clock";
import DataCentreTab from "@/components/data-centre-tab";
import { Inspector } from "@/components/layout/inspector";
import ShipmentsPage from "@/pages/shipments";
import DriverAnalyticsTab from "@/pages/driver-analytics";
import { DriverMapButton } from "@/components/dispatcher-driver-map";
import { CallDriverButton } from "@/components/call-driver-button";
import ShipmentsListTab from "@/components/shipments-list-tab";
import AddressAutocomplete, { type PlaceResult } from "@/components/address-autocomplete";
import sidebarBgImage from "@/assets/images/sidebar-bg.jpg";
import bgDashboard from "@/assets/images/bg-dashboard-new.png";
import bgTrips from "@/assets/images/bg-trips-new.png";
import bgDriver from "@/assets/images/bg-driver-new.png";
import bgMetrics from "@/assets/images/bg-metrics-new.png";
import bgSettings from "@/assets/images/bg-settings-new.png";
import bgImport from "@/assets/images/bg-import-new.png";

import { DispatchTabContext, type TabId, type IntakeContextValue, type TrafficContextValue, type IncidentItem, type DriverRouteForMap, type DriverRouteLeg } from "@/hooks/use-dispatch-data";
import { CORRIDOR_PROBES, PRETORIA_KNOWN_INCIDENTS, nearestCorridor, type CorridorTrafficResult } from "@/lib/traffic-corridors";
import { useLegPolylines, legKey, type PolylineRequestLeg } from "@/hooks/use-leg-polylines";
export type { TabId };

function subCity(sub: string, city?: string): string {
  return city ? `${sub}, ${city}` : sub;
}

function formatDayLabel(dateStr: string): string {
  try {
    const d = new Date(dateStr + "T00:00:00");
    const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    return `${days[d.getDay()]} ${d.getDate()} ${months[d.getMonth()]}`;
  } catch {
    return dateStr;
  }
}

interface AuthUser {
  id: string;
  username: string;
  displayName: string | null;
  email: string | null;
  role: string;
  avatarColor: string;
}

interface DispatchPageProps {
  authUser?: AuthUser;
  onLogout?: () => void;
  onUpdateProfile?: (data: { displayName?: string; email?: string; avatarColor?: string; currentPassword?: string; newPassword?: string }) => Promise<unknown>;
  chrome?: "v6" | "v7";
  currentTab?: TabId;
  children?: ReactNode;
}

export default function DispatchPage({ authUser, onLogout, onUpdateProfile, chrome = "v6", currentTab, children }: DispatchPageProps = {}) {
  const { toast } = useToast();
  const { theme, toggle: toggleTheme } = useTheme();
  const { time, date } = useLiveClock();

  const [ships, setShips] = useState<Shipment[]>([]);
  const [asgn, setAsgn] = useState<Record<string, string>>({});
  const [tripSt, setTripSt] = useState<Record<string, string>>(() => {
    const fs = getFleetSettings();
    return Object.fromEntries(fs.drivers.map((d) => [d.id, "DRAFT"]));
  });
  const [stopSt, setStopSt] = useState<Record<string, string>>({});
  const [stopNotes, setStopNotes] = useState<Record<string, string>>({});
  const [tabState, setTabState] = useState<TabId>(currentTab || "import");
  const tab = currentTab ?? tabState;
  const setTab = setTabState;
  const tabRef = useRef<TabId>(tab);
  tabRef.current = tab;
  useEffect(() => {
    if (currentTab) setTabState(currentTab);
  }, [currentTab]);
  const [editDriverId, setEditDriverId] = useState<string | null>(null);
  const [selectedDay, setSelectedDay] = useState<string>("all");
  const [sel, setSel] = useState<Record<string, boolean>>({});
  const [drvView, setDrvView] = useState(() => getFleetSettings().drivers[0]?.id || "vinny");
  const [filter, setFilter] = useState("");
  const [fZone, setFZone] = useState("");
  const [events, setEvents] = useState<LogEntry[]>([{ t: ts(), msg: "System ready — live ShipLogic webhook is the source of truth. CSV import is available as a backfill.", type: "SYS" }]);
  const [optInfo, setOptInfo] = useState<{ cost: number; passes: number } | null>(null);
  const [csvText, setCsvText] = useState("");
  const [csvResult, setCsvResult] = useState<ParseResult | null>(null);
  const [optimizing, setOptimizing] = useState(false);
  const [geocoding, setGeocoding] = useState(false);
  const [geocodingProgress, setGeocodingProgress] = useState<{ done: number; total: number } | null>(null);
  const [trafficCond, setTrafficCond] = useState<TrafficCondition>(getTrafficCondition());
  const [expandedTrips, setExpandedTrips] = useState<Record<string, boolean>>(() => {
    const fs = getFleetSettings();
    return Object.fromEntries(fs.drivers.map((d) => [d.id, true]));
  });
  const [fleetSettings, setFleetSettings] = useState<FleetSettings>(getFleetSettings);
  const fleetServerTs = useRef<number>(0);

  async function saveFleetToServer(settings: FleetSettings) {
    try {
      const res = await fetch("/api/settings/fleet", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value: settings }),
      });
      if (res.ok) {
        const data = await res.json();
        fleetServerTs.current = new Date(data.updatedAt).getTime();
      }
    } catch {}
  }

  async function loadFleetFromServer(force = false) {
    try {
      const res = await fetch("/api/settings/fleet");
      if (res.status === 404) {
        await saveFleetToServer(fleetSettings);
        return;
      }
      if (!res.ok) return;
      const data = await res.json();
      const serverTs = new Date(data.updatedAt).getTime();
      if (!force && serverTs <= fleetServerTs.current) return;

      const remoteSettings = data.value as FleetSettings;

      if (force) {
        const localSettings = getFleetSettings();
        const remoteIds = new Set(remoteSettings.drivers.map((d: any) => d.id));
        const localOnlyDrivers = localSettings.drivers.filter((d) => !remoteIds.has(d.id));
        if (localOnlyDrivers.length > 0) {
          const merged: FleetSettings = {
            ...remoteSettings,
            drivers: [...remoteSettings.drivers, ...localOnlyDrivers],
          };
          await saveFleetToServer(merged);
          setFleetSettings(merged);
          updateFleetSettings(merged);
          fleetServerTs.current = Date.now();
          return;
        }
      }

      fleetServerTs.current = serverTs;
      setFleetSettings(remoteSettings);
      updateFleetSettings(remoteSettings);
    } catch {}
  }

  const fleet = useMemo(() => settingsToFleet(fleetSettings), [fleetSettings]);
  const activeFleet = useMemo(() => settingsToActiveFleet(fleetSettings), [fleetSettings]);

  async function loadClientAccounts() {
    try {
      const res = await fetch("/api/client-accounts");
      if (res.ok) {
        const accounts = await res.json();
        const map: Record<string, string> = {};
        accounts.forEach((a: any) => { map[a.accountCode] = a.clientName; });
        setClientAccountMap(map);
        return map;
      }
    } catch {}
    return clientAccountMap;
  }

  async function autoInsertNewAccounts(accountCodes: { code: string; name: string }[]) {
    for (const { code, name } of accountCodes) {
      if (!clientAccountMap[code]) {
        try {
          await fetch("/api/client-accounts", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ accountCode: code, clientName: name, address: "" }),
          });
        } catch (e) {
          console.warn("[AutoInsert] Failed to create client:", code, e);
        }
      }
    }
    loadClientAccounts();
  }

  useEffect(() => {
    loadFleetFromServer(true);
    loadClientAccounts();
    const interval = setInterval(() => loadFleetFromServer(false), 30_000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    let es: EventSource | null = null;
    try {
      es = new EventSource("/api/webhooks/stream");
      es.onmessage = (ev) => {
        try {
          const data = JSON.parse(ev.data);
          if (data.type === "connected") return;

          if (data.topic === "driver_presence_changed") {
            // A driver went online/offline, or an ops force-online request was
            // raised/confirmed. Refresh the live map presence immediately.
            queryClient.invalidateQueries({ queryKey: ["/api/dispatch/driver-locations"] });
            return;
          }

          if (data.topic === "collection_override_changed") {
            if (data.projectId && data.shipmentId) {
              setCollectionOverrides((prev) => {
                const nextOv = { ...prev };
                if (data.collectionOverride) {
                  nextOv[data.shipmentId] = data.collectionOverride;
                } else {
                  delete nextOv[data.shipmentId];
                }
                setShips((curShips) => {
                  const affected = curShips.some((s) => s.id === data.shipmentId);
                  if (affected) {
                    const patched = applyDeliveryOverrides(applyCollectionOverrides(curShips, nextOv), deliveryOverridesRef.current);
                    setTimeout(() => { try { runOptimizer(patched); } catch { /* noop */ } }, 50);
                  }
                  return curShips;
                });
                return nextOv;
              });
              toast({
                title: data.collectionOverride ? "Collection window updated" : "Collection override cleared",
                description: data.message || "Re-optimizing…",
              });
            }
            return;
          }

          if (data.topic === "delivery_override_changed") {
            // A dispatcher in another tab/window (typically the Shipments tab)
            // changed a delivery-window override for this project. Sync the
            // in-memory overrides so the optimizer reflects the new window.
            if (data.projectId && data.shipmentId) {
              setDeliveryOverrides((prev) => {
                const nextOv = { ...prev };
                if (data.deliveryOverride) {
                  nextOv[data.shipmentId] = data.deliveryOverride;
                } else {
                  delete nextOv[data.shipmentId];
                }
                // Re-run the optimizer asynchronously against the freshly
                // patched ships so the change takes effect without manual
                // intervention. Only re-optimize if this project is currently
                // loaded — guard by the existence of the affected shipment.
                setShips((curShips) => {
                  const affected = curShips.some((s) => s.id === data.shipmentId);
                  if (affected) {
                    const patched = applyDeliveryOverrides(applyCollectionOverrides(curShips, collectionOverridesRef.current), nextOv);
                    setTimeout(() => { try { runOptimizer(patched); } catch { /* noop */ } }, 50);
                  }
                  return curShips;
                });
                return nextOv;
              });
              toast({
                title: data.deliveryOverride ? "Delivery window updated" : "Delivery override cleared",
                description: data.message || "Re-optimizing…",
              });
            }
            return;
          }

          if (data.topic === "webhook_shipment_updated") {
            log(`[Webhook] ${data.message || "Shipment updated"}`, "SYS");
            queryClient.invalidateQueries({ queryKey: ["/api/projects"] });
            queryClient.invalidateQueries({ queryKey: ["/api/webhooks/events"] });
            queryClient.invalidateQueries({ queryKey: ["/api/dispatch/all-shipments"] });
            queryClient.invalidateQueries({ queryKey: ["/api/dispatch/shipment-totals"] });
            queryClient.invalidateQueries({ queryKey: ["/api/crm/alerts"] });
            // FIX: previously this matched only on `s.wb === data.waybill`,
            // which silently no-ops when the stored shipment is keyed by
            // trackingRef/customRef or by id. Match on the same broad set
            // of references the backend uses so the status field reliably
            // updates locally regardless of which reference field
            // ShipLogic chose to put in this payload.
            if (data.updatedShipment && (data.waybill || (data.updatedShipment as any).id)) {
              const incoming = data.updatedShipment as any;
              const refs = new Set<string>(
                [data.waybill, incoming.wb, incoming.id, incoming.trackingRef, incoming.customRef]
                  .filter(Boolean) as string[]
              );
              setShips((prev) =>
                prev.map((s: any) => {
                  if (
                    (s.wb && refs.has(s.wb)) ||
                    (s.id && refs.has(s.id)) ||
                    (s.trackingRef && refs.has(s.trackingRef)) ||
                    (s.customRef && refs.has(s.customRef))
                  ) {
                    return { ...s, ...incoming };
                  }
                  return s;
                })
              );
            }
            // FIX: previously this required `currentProjectId === data.projectId`
            // before applying the stop-status patch. That guard was almost
            // always false in practice — the dispatcher's session project
            // is named "session" while webhook auto-import creates date-bucket
            // projects like "2026-05-22 Deliveries". The patch was therefore
            // silently dropped on every delivered/failed/collected event,
            // which is the main reason completed shipments kept appearing as
            // pending in the live ops view.
            //
            // Apply the patch whenever any of its stop keys reference a
            // shipment the dispatcher actually has loaded. Stop keys are
            // either `C_<id>` / `D_<id>` (single) or `C_<idA>_<idB>_...`
            // (grouped). We check id membership against local `ships`.
            if (
              data.stopStatusesPatch &&
              typeof data.stopStatusesPatch === "object"
            ) {
              setShips((prevShips) => {
                const loadedIds = new Set(prevShips.map((s: any) => s.id).filter(Boolean));
                const patch = data.stopStatusesPatch as Record<string, string>;
                const applicable: Record<string, string> = {};
                for (const [k, v] of Object.entries(patch)) {
                  if (typeof k !== "string") continue;
                  if (!k.startsWith("C_") && !k.startsWith("D_")) continue;
                  const ids = k.slice(2).split("_");
                  if (ids.some((id) => loadedIds.has(id))) applicable[k] = v;
                }
                if (Object.keys(applicable).length > 0) {
                  setStopSt((prev) => ({ ...prev, ...applicable }));
                }
                return prevShips; // no change to ships from this branch
              });
            }
            return;
          }

          if (data.topic === "webhook_shipment_created") {
            toast({
              title: "New Webhook Shipment",
              description: data.message || `Waybill ${data.waybill} auto-imported`,
            });
            log(`[Webhook] ${data.message || "New shipment auto-imported"}`, "SYS");
            queryClient.invalidateQueries({ queryKey: ["/api/projects"] });
            queryClient.invalidateQueries({ queryKey: ["/api/webhooks/events"] });

            if (data.updatedShipment) {
              setShips((prev) => {
                // FIX: also dedupe by id/trackingRef/customRef so an
                // incoming create whose waybill format differs from the
                // already-stored row doesn't add a phantom duplicate. The
                // backend's auto-import is now also broadened, but defense
                // in depth here keeps client state consistent if any
                // ref-mismatched event slips through.
                const incoming = data.updatedShipment as any;
                const refs = new Set<string>(
                  [data.waybill, incoming.wb, incoming.id, incoming.trackingRef, incoming.customRef]
                    .filter(Boolean) as string[]
                );
                const idx = prev.findIndex((s: any) =>
                  (s.wb && refs.has(s.wb)) ||
                  (s.id && refs.has(s.id)) ||
                  (s.trackingRef && refs.has(s.trackingRef)) ||
                  (s.customRef && refs.has(s.customRef))
                );
                if (idx >= 0) {
                  const next = prev.slice();
                  next[idx] = { ...next[idx], ...incoming };
                  return next;
                }
                return [...prev, incoming];
              });
            }
            return;
          }

          if (data.topic === "assignments_changed") {
            // A reassignment happened elsewhere (another dispatcher tab, a
            // webhook auto-assign, or an applied auto-suggestion). Merge the
            // changed shipment->driver map into local state so KPIs, totals and
            // trip sheets re-derive without a reload, and refresh the live map +
            // CRM alerts that depend on driver assignments.
            if (data.assignments && typeof data.assignments === "object") {
              const changed = data.assignments as Record<string, string>;
              setAsgn((prev) => {
                let dirty = false;
                const next = { ...prev };
                for (const [sid, drv] of Object.entries(changed)) {
                  if (next[sid] !== drv) { next[sid] = drv; dirty = true; }
                }
                return dirty ? next : prev;
              });
            }
            queryClient.invalidateQueries({ queryKey: ["/api/dispatch/driver-locations"] });
            queryClient.invalidateQueries({ queryKey: ["/api/crm/alerts"] });
            return;
          }

          const isErr = !data.processed || data.error;
          toast({
            title: isErr ? "Webhook Error" : "ShipLogic Update",
            description: data.message || `${data.topic}: ${data.waybill}`,
            variant: isErr ? "destructive" : "default",
          });
          log(`[Webhook] ${data.message || data.topic}`, isErr ? "ERR" : "SYS");
          queryClient.invalidateQueries({ queryKey: ["/api/webhooks/events"] });
          if (data.processed && data.updatedShipment) {
            const incoming = data.updatedShipment as any;
            const refs = new Set<string>(
              [data.waybill, incoming.wb, incoming.id, incoming.trackingRef, incoming.customRef]
                .filter(Boolean) as string[]
            );
            setShips((prev) =>
              prev.map((s: any) => {
                if (
                  (s.wb && refs.has(s.wb)) ||
                  (s.id && refs.has(s.id)) ||
                  (s.trackingRef && refs.has(s.trackingRef)) ||
                  (s.customRef && refs.has(s.customRef))
                ) {
                  return { ...s, ...incoming };
                }
                return s;
              })
            );
          }
        } catch (e) {
          console.warn("[Webhook SSE] Error processing event:", e);
        }
      };
      es.onerror = () => {};
    } catch (e) {
      console.warn("[Webhook SSE] Failed to connect:", e);
    }
    return () => { es?.close(); };
  }, []);

  useEffect(() => {
    const driverIds = new Set(fleet.map((d) => d.id));
    setTripSt((prev) => {
      const updated: Record<string, string> = {};
      Object.keys(prev).forEach((id) => { if (driverIds.has(id)) updated[id] = prev[id]; });
      fleet.forEach((d) => { if (!(d.id in updated)) updated[d.id] = "DRAFT"; });
      return updated;
    });
    setExpandedTrips((prev) => {
      const updated: Record<string, boolean> = {};
      Object.keys(prev).forEach((id) => { if (driverIds.has(id)) updated[id] = prev[id]; });
      fleet.forEach((d) => { if (!(d.id in updated)) updated[d.id] = true; });
      return updated;
    });
    setDrvView((prev) => (driverIds.has(prev) ? prev : fleet[0]?.id || prev));
  }, [fleet]);

  const [handoffs, setHandoffs] = useState<HandoffEvent[]>([]);
  const [handoffPoints, setHandoffPoints] = useState<HandoffPoint[]>(DEFAULT_HANDOFF_POINTS);
  const [trafficStatus, setTrafficStatus] = useState<TrafficStatus>({ enabled: false, lastRefresh: null, isRefreshing: false });
  const [driverTraffic, setDriverTraffic] = useState<Map<string, DriverTrafficData>>(new Map());
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 3000);
    return () => clearInterval(t);
  }, []);
  const [userReports, setUserReports] = useState<TrafficReport[]>(loadReports);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [csvFileName, setCsvFileName] = useState<string>("");
  const [stopOverrides, setStopOverrides] = useState<Record<string, Stop[]>>({});
  const [deliveryOverrides, setDeliveryOverrides] = useState<DeliveryOverrides>({});
  const [collectionOverrides, setCollectionOverrides] = useState<CollectionOverrides>({});
  // Refs keep the SSE handler (whose useEffect has empty deps) reading the
  // *latest* override maps when it re-runs the optimizer after a remote
  // collection_override_changed / delivery_override_changed message, so the
  // other side's overrides aren't dropped from the re-optimization input.
  const deliveryOverridesRef = useRef<DeliveryOverrides>({});
  const collectionOverridesRef = useRef<CollectionOverrides>({});
  useEffect(() => { deliveryOverridesRef.current = deliveryOverrides; }, [deliveryOverrides]);
  useEffect(() => { collectionOverridesRef.current = collectionOverrides; }, [collectionOverrides]);
  // Durable dispatcher grouping decisions. Persisted to project +
  // localStorage so they survive re-optimize, page refresh, webhook
  // auto-imports, and propagate to the driver app + CRM via the backend.
  const [stopGroupings, setStopGroupings] = useState<StopGroupings>({});
  const [clientAccountMap, setClientAccountMap] = useState<Record<string, string>>({});
  const fileRef = useRef<HTMLInputElement>(null);
  const importFileRef = useRef<HTMLInputElement>(null);

  // PWA install prompt
  interface BeforeInstallPromptEvent extends Event {
    prompt(): Promise<void>;
    userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
  }
  const [installPromptEvent, setInstallPromptEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [isAppInstalled, setIsAppInstalled] = useState(false);
  useEffect(() => {
    const handler = (e: Event) => { e.preventDefault(); setInstallPromptEvent(e as BeforeInstallPromptEvent); };
    window.addEventListener("beforeinstallprompt", handler);
    const installedHandler = () => setIsAppInstalled(true);
    window.addEventListener("appinstalled", installedHandler);
    if (window.matchMedia("(display-mode: standalone)").matches) setIsAppInstalled(true);
    return () => {
      window.removeEventListener("beforeinstallprompt", handler);
      window.removeEventListener("appinstalled", installedHandler);
    };
  }, []);

  useEffect(() => {
    const saved = loadState();
    if (saved && saved.shipments.length > 0) {
      setShips(saved.shipments);
      setAsgn(saved.assignments);
      setTripSt(saved.tripStatuses);
      setStopSt(saved.stopStatuses);
      setStopNotes(saved.stopNotes);
      if (saved.handoffs && saved.handoffs.length > 0) {
        setHandoffs(saved.handoffs);
      }
      if (saved.handoffPoints && saved.handoffPoints.length > 0) {
        setHandoffPoints(saved.handoffPoints);
      }
      if (saved.stopOverrides && Object.keys(saved.stopOverrides).length > 0) {
        setStopOverrides(saved.stopOverrides);
      }
      if (saved.deliveryOverrides && Object.keys(saved.deliveryOverrides).length > 0) {
        setDeliveryOverrides(saved.deliveryOverrides);
      }
      if (saved.collectionOverrides && Object.keys(saved.collectionOverrides).length > 0) {
        setCollectionOverrides(saved.collectionOverrides);
      }
      if (saved.stopGroupings && Object.keys(saved.stopGroupings).length > 0) {
        setStopGroupings(saved.stopGroupings);
      }
      setTab("ops");
    }
    const savedLogs = loadLogs();
    if (savedLogs.length > 0) {
      setEvents(savedLogs);
    }
  }, []);

  // Start autosave service once on mount
  useEffect(() => {
    autosave.start();
    const unsub = autosave.onStatusChange(setSaveStatus);
    return () => { autosave.stop(); unsub(); };
  }, []);

  // v7 chrome: surface save events as toasts (the old chrome "Saved" badge is gone)
  const lastSaveStatus = useRef<SaveStatus>("idle");
  useEffect(() => {
    if (chrome !== "v7") { lastSaveStatus.current = saveStatus; return; }
    if (saveStatus === "error" && lastSaveStatus.current !== "error") {
      toast({ title: "Save failed", description: "We'll retry automatically.", variant: "destructive" });
    } else if (saveStatus === "saved" && lastSaveStatus.current === "saving") {
      // Quiet success — no toast spam on every autosave tick.
    }
    lastSaveStatus.current = saveStatus;
  }, [saveStatus, chrome, toast]);

  useEffect(() => {
    if (ships.length > 0) {
      saveState({ shipments: ships, assignments: asgn, tripStatuses: tripSt, stopStatuses: stopSt, stopNotes, handoffs, handoffPoints, stopOverrides, deliveryOverrides, collectionOverrides, stopGroupings });
      autosave.scheduleAutosave({ shipments: ships, assignments: asgn, tripStatuses: tripSt, stopStatuses: stopSt, stopNotes, handoffs, handoffPoints, deliveryOverrides, collectionOverrides, stopGroupings });
    }
  }, [ships, asgn, tripSt, stopSt, stopNotes, handoffs, handoffPoints, stopOverrides, deliveryOverrides, collectionOverrides, stopGroupings]);

  useEffect(() => {
    if (events.length > 0) saveLogs(events);
  }, [events]);

  useEffect(() => {
    saveReports(userReports);
  }, [userReports]);

  const availableDays = useMemo(() => {
    const days = new Set<string>();
    ships.forEach((s) => {
      const d = s.delDate || s.colDate;
      if (d) days.add(d);
    });
    return Array.from(days).sort();
  }, [ships]);

  // Apply dispatcher delivery-window overrides at the top of the data flow so
  // the optimizer, schedule builder, shipment tables, and CRM webhooks all
  // see the patched dAfter/dBefore. Original sender-requested windows live
  // on `origDAfter` / `origDBefore` for UI badges.
  const overriddenShips = useMemo(
    () => applyDeliveryOverrides(
      applyCollectionOverrides(ships, collectionOverrides),
      deliveryOverrides,
    ),
    [ships, deliveryOverrides, collectionOverrides],
  );

  const dayShips = useMemo(() => {
    // FIX: previously this short-circuited when `availableDays.length <= 1`,
    // which let stray shipments whose delDate/colDate didn't match the
    // single available day still count toward "today". When the user has
    // selected a specific day (not "all"), always filter by it.
    if (selectedDay === "all") return overriddenShips;
    return overriddenShips.filter((s) => (s.delDate || s.colDate) === selectedDay);
  }, [overriddenShips, selectedDay]);

  // Shipments that are still actionable (not yet delivered/failed/cancelled).
  // The route planner and the live "Total Shipments" tile should only count
  // and route these — once a shipment is closed out, it shouldn't appear as
  // an unscheduled stop on a driver's route.
  const TERMINAL_STATUSES = useMemo(
    () => new Set(["delivered", "failed", "cancelled", "canceled", "returned", "exception"]),
    [],
  );
  const isShipmentOpen = (s: Shipment): boolean => {
    const raw = String((s as any).status || "").toLowerCase().trim();
    if (!raw) return true;
    const normalized = raw.replace(/[-_]/g, " ");
    if (normalized.includes("delivered")) return false;
    if (normalized.includes("fail")) return false;
    if (normalized.includes("cancel")) return false;
    if (normalized.includes("return")) return false;
    if (normalized.includes("exception")) return false;
    return !TERMINAL_STATUSES.has(raw);
  };
  const openDayShips = useMemo(
    () => dayShips.filter(isShipmentOpen),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [dayShips],
  );

  const effectiveDay = selectedDay !== "all" ? selectedDay : (availableDays.length === 1 ? availableDays[0] : undefined);
  const activeHandoffs = useMemo(() => handoffs.filter(h => h.status === "planned" || h.status === "confirmed"), [handoffs]);
  const tl = useMemo(() => {
    const base = buildSched(dayShips, asgn, stopSt, effectiveDay, fleet, activeHandoffs.length > 0 ? activeHandoffs : undefined, activeHandoffs.length > 0 ? handoffPoints : undefined);
    // Apply durable dispatcher groupings post-buildSched so manual grouping
    // decisions survive re-optimize and webhook-triggered auto-imports.
    if (!stopGroupings || Object.keys(stopGroupings).length === 0) return base;
    const out: Record<string, TripData> = {};
    for (const [driverId, trip] of Object.entries(base)) {
      const pinned = stopGroupings[driverId];
      if (!pinned || pinned.length === 0) { out[driverId] = trip; continue; }
      const driver = fleet.find((d: any) => d.id === driverId);
      const groupedStops = applyStopGroupings(trip.stops, pinned);
      const stops = driver ? recalcStops(groupedStops, driver) : groupedStops;
      // Recompute trip-level km/cost stats after grouping changes leg distances.
      const stopsKm = stops.reduce((s, st) => s + (st.legKm || 0), 0);
      const lastStop = stops[stops.length - 1];
      const returnDrv = driver && lastStop ? calcDrive({ lat: lastStop.lat, lng: lastStop.lng }, { lat: driver.depotLat, lng: driver.depotLng }) : { km: 0, min: 0 };
      const totalKm = Math.round(stopsKm + returnDrv.km);
      const settings = getFleetSettings();
      const fuelPer100City = (driver?.fuelPer100 ?? 0) * settings.cityFactor;
      const fuelLitres = Math.round((totalKm * fuelPer100City / 100) * 10) / 10;
      const fuelCost = Math.round(fuelLitres * settings.fuelPrice);
      out[driverId] = {
        ...trip,
        stops,
        stats: { ...trip.stats, totalKm, fuelLitres, fuelCost, cogs: fuelCost, margin: Math.round(trip.stats.revenue) - fuelCost },
      };
    }
    return out;
  }, [dayShips, asgn, stopSt, effectiveDay, fleet, activeHandoffs, handoffPoints, stopGroupings]);

  const effectiveTl = useMemo(() => {
    if (Object.keys(stopOverrides).length === 0) return tl;
    const result = { ...tl };
    for (const [driverId, overrideStops] of Object.entries(stopOverrides)) {
      const orig = tl[driverId];
      if (!orig || overrideStops.length === 0) continue;
      const isStale = overrideStops.some((stop) =>
        (stop.ids || []).some((sid: string) => asgn[sid] && asgn[sid] !== driverId)
      );
      if (isStale) continue;
      const driver = orig.driver;
      const stopsKm = overrideStops.reduce((s, stop) => s + (stop.legKm || 0), 0);
      const lastStop = overrideStops[overrideStops.length - 1];
      const returnDrv = calcDrive({ lat: lastStop.lat, lng: lastStop.lng }, { lat: driver.depotLat, lng: driver.depotLng });
      const returnKm = returnDrv.km;
      const totalKm = Math.round(stopsKm + returnKm);
      const firstStop = overrideStops[0];
      const depotToFirstKm = firstStop?.legKm || 0;
      const deadKm = Math.round(depotToFirstKm + returnKm);
      const settings = getFleetSettings();
      const fuelPer100City = driver.fuelPer100 * settings.cityFactor;
      const fuelLitres = Math.round((totalKm * fuelPer100City / 100) * 10) / 10;
      const fuelCost = Math.round(fuelLitres * settings.fuelPrice);
      const cogs = fuelCost;
      const mileage = totalKm > 0 && fuelLitres > 0 ? Math.round((totalKm / fuelLitres) * 10) / 10 : 0;
      const warnings: WarningItem[] = overrideStops
        .filter((s) => s.late)
        .map((s) => ({ sev: "MED" as const, msg: `${(s.wbs || []).join(", ") || subCity(s.sub, s.city)}: arriving late after reorder` }));
      result[driverId] = {
        ...orig,
        stops: overrideStops,
        warnings,
        stats: { ...orig.stats, totalKm, deadKm, depotToFirstKm: Math.round(depotToFirstKm), returnToDepotKm: Math.round(returnKm), fuelLitres, fuelCost, cogs, mileage, margin: Math.round(orig.stats.revenue) - cogs },
      };
    }
    return result;
  }, [tl, stopOverrides, asgn]);

  // Live driver positions (server-computed, traffic-aware first leg). Polled on
  // a 15s cadence so the route plan re-grounds to where drivers actually are.
  const { data: liveDriverLocations } = useTanQuery<any[]>({
    queryKey: ["/api/dispatch/driver-locations"],
    refetchInterval: 15000,
  });

  // Live-grounded route plan. For every driver who is online with a fresh GPS
  // fix we re-simulate their EXISTING stop ORDER (no re-routing) starting from
  // the live position at "now" — so collection AND delivery ETAs and trip KPIs
  // reflect reality and refresh on the 15s driver-locations cadence. The active
  // first leg reuses the server's traffic-aware Google ETA (one call/driver/45s
  // via firstLegCache); downstream legs use offline calcDrive, matching
  // buildSched. Offline/stale drivers fall back to the static depot-start
  // estimate (effectiveTl) unchanged.
  const liveTl = useMemo(() => {
    if (!liveDriverLocations || liveDriverLocations.length === 0) return effectiveTl;
    const byName = new Map<string, any>();
    liveDriverLocations.forEach((dl) => {
      if (dl && dl.driverName) byName.set(String(dl.driverName).toLowerCase().trim(), dl);
    });
    const nowDate = new Date();
    const nowMin = nowDate.getHours() * 60 + nowDate.getMinutes();
    const settings = getFleetSettings();
    const result: Record<string, TripData> = {};
    for (const [driverId, trip] of Object.entries(effectiveTl)) {
      const driver = trip.driver;
      const live = driver ? byName.get(String(driver.name).toLowerCase().trim()) : null;
      const hasLive = !!live && live.isOnline && live.lat != null && live.lng != null;
      if (!hasLive || !trip.stops || trip.stops.length === 0) { result[driverId] = trip; continue; }

      const serverFirst = Array.isArray(live.allStops) && live.allStops.length > 0 ? live.allStops[0] : null;
      let prevLat = live.lat as number;
      let prevLng = live.lng as number;
      let t = nowMin;
      // Only re-time stops the driver still has to make (pending/arrived).
      // Finished stops (completed/failed/skipped) are kept exactly as planned
      // and do NOT advance the live-position cursor — otherwise downstream
      // ETAs would be computed as if the driver had to revisit done stops.
      // The first ACTIVE stop is the one grounded at the live position, which
      // matches the server's pending-stop list (isStopActive) so serverFirst
      // (its traffic-aware leg) lines up with it.
      let firstActiveSeen = false;
      const newStops: Stop[] = trip.stops.map((stop) => {
        if (isStopFinished(stop.status)) return stop;
        const isFirstActive = !firstActiveSeen;
        firstActiveSeen = true;
        let legKm: number;
        let legMin: number;
        const useServerFirst = isFirstActive && serverFirst && Array.isArray(serverFirst.waybills) &&
          (stop.wbs || []).some((w: string) => serverFirst.waybills.includes(w));
        if (useServerFirst) {
          legKm = serverFirst.legDistanceKm ?? serverFirst.distanceFromDriverKm ?? 0;
          legMin = serverFirst.legDriveMin ?? serverFirst.etaMin ?? 0;
        } else {
          const drv = calcDrive({ lat: prevLat, lng: prevLng }, { lat: stop.lat, lng: stop.lng }, t);
          legKm = drv.km;
          legMin = drv.min;
        }
        const arriveM = t + legMin;
        const winOpen = toM(stop.win?.split("-")[0] || "") || 0;
        const actual = winOpen ? Math.max(arriveM, winOpen) : arriveM;
        prevLat = stop.lat;
        prevLng = stop.lng;
        t = actual + (stop.svcMin || 0);
        return {
          ...stop,
          legKm: Math.round(legKm * 10) / 10,
          legMin,
          arriveM,
          etaM: actual,
          eta: fmM(actual),
          waitMin: Math.max(0, actual - arriveM),
          fromLoc: isFirstActive ? "Live position" : stop.fromLoc,
        };
      });

      const stopsKm = newStops.reduce((s, st) => s + (st.legKm || 0), 0);
      const hasRtn = newStops.some((st) => st.type === "RTN");
      let totalKmRaw = stopsKm;
      if (!hasRtn) {
        const lastStop = newStops[newStops.length - 1];
        const ret = calcDrive({ lat: lastStop.lat, lng: lastStop.lng }, { lat: driver.depotLat, lng: driver.depotLng });
        totalKmRaw += ret.km;
      }
      const totalKm = Math.round(totalKmRaw);
      const fuelPer100City = driver.fuelPer100 * settings.cityFactor;
      const fuelLitres = Math.round((totalKm * fuelPer100City / 100) * 10) / 10;
      const fuelCost = Math.round(fuelLitres * settings.fuelPrice);
      const mileage = totalKm > 0 && fuelLitres > 0 ? Math.round((totalKm / fuelLitres) * 10) / 10 : 0;
      result[driverId] = {
        ...trip,
        stops: newStops,
        stats: { ...trip.stats, totalKm, fuelLitres, fuelCost, cogs: fuelCost, mileage, margin: Math.round(trip.stats.revenue) - fuelCost },
      };
    }
    return result;
  }, [effectiveTl, liveDriverLocations]);

  const driverStopSequences = useMemo(() => {
    const seqs: Record<string, string[]> = {};
    for (const [driverId, td] of Object.entries(effectiveTl)) {
      if (td.stops && td.stops.length > 0) {
        seqs[driverId] = td.stops.map((s: Stop) => s.key);
      }
    }
    return seqs;
  }, [effectiveTl]);

  useEffect(() => {
    if (ships.length > 0) {
      autosave.scheduleAutosave({ shipments: ships, assignments: asgn, tripStatuses: tripSt, stopStatuses: stopSt, stopNotes, driverStopSequences, handoffs, handoffPoints, deliveryOverrides, collectionOverrides });
      autosave.flushNow();
    }
  }, [driverStopSequences, asgn]);

  useEffect(() => {
    if (Object.keys(stopOverrides).length === 0) return;
    const staleDriverIds = Object.entries(stopOverrides)
      .filter(([driverId, stops]) =>
        stops.some((stop) => (stop.ids || []).some((sid: string) => asgn[sid] && asgn[sid] !== driverId))
      )
      .map(([driverId]) => driverId);
    if (staleDriverIds.length > 0) {
      setStopOverrides((prev: Record<string, Stop[]>) => {
        const next = { ...prev };
        staleDriverIds.forEach((id) => { delete next[id]; });
        return next;
      });
    }
  }, [asgn]);

  const log = useCallback((msg: string, type: string = "OPS") => {
    setEvents((p) => [{ t: ts(), msg, type }, ...p].slice(0, 200));
  }, []);

  useEffect(() => {
    checkTrafficEnabled();
    const unsub = onTrafficStatusChange(() => {
      setTrafficStatus(getTrafficStatus());
    });
    setRefreshCallback((data) => setDriverTraffic(data));
    return () => { unsub(); stopAutoRefresh(); };
  }, []);

  const refreshTraffic = useCallback(() => {
    const schedStops: ScheduleStop[] = [];
    Object.entries(tl).forEach(([driverId, td]) => {
      let prevLat = td.driver.depotLat;
      let prevLng = td.driver.depotLng;
      let prevLabel = td.driver.depot + " (Depot)";
      // Honor the depot-linger shift from buildSched: first leg departs when
      // first stop's arrival minus its drive time, not raw shift start.
      const shiftStartM = toM(td.driver.shift[0]) || 420;
      const firstReal = td.stops.find((s) => s.lat && s.lng);
      const firstArrive = firstReal ? ((firstReal as any).arriveM ?? firstReal.etaM) : shiftStartM;
      const firstLegMin = firstReal ? firstReal.legMin : 0;
      let cumTime = Math.max(shiftStartM, firstArrive - firstLegMin);
      td.stops.forEach((stop) => {
        if (stop.lat && stop.lng) {
          schedStops.push({
            driverId,
            fromLat: prevLat,
            fromLng: prevLng,
            toLat: stop.lat,
            toLng: stop.lng,
            fromLabel: prevLabel,
            toLabel: subCity(stop.sub, stop.city) || stop.addr,
            departMin: cumTime,
          });
          cumTime = stop.etaM + stop.svcMin + (((stop as any).lingerMin || 0)) + (stop.waitMin || 0);
          prevLat = stop.lat;
          prevLng = stop.lng;
          prevLabel = subCity(stop.sub, stop.city) || stop.addr;
        }
      });
    });
    if (schedStops.length > 0) {
      refreshTrafficForSchedule(schedStops);
    }
  }, [tl]);

  useEffect(() => {
    if (ships.length > 0 && Object.keys(tl).length > 0 && trafficStatus.enabled) {
      const getStops = (): ScheduleStop[] => {
        const schedStops: ScheduleStop[] = [];
        Object.entries(tl).forEach(([driverId, td]) => {
          let prevLat = td.driver.depotLat;
          let prevLng = td.driver.depotLng;
          let prevLabel = td.driver.depot + " (Depot)";
          const shiftStartM = toM(td.driver.shift[0]) || 420;
          const firstReal = td.stops.find((s) => s.lat && s.lng);
          const firstArrive = firstReal ? ((firstReal as any).arriveM ?? firstReal.etaM) : shiftStartM;
          const firstLegMin = firstReal ? firstReal.legMin : 0;
          let cumTime = Math.max(shiftStartM, firstArrive - firstLegMin);
          td.stops.forEach((stop) => {
            if (stop.lat && stop.lng) {
              schedStops.push({ driverId, fromLat: prevLat, fromLng: prevLng, toLat: stop.lat, toLng: stop.lng, fromLabel: prevLabel, toLabel: subCity(stop.sub, stop.city) || stop.addr, departMin: cumTime });
              cumTime = stop.etaM + stop.svcMin + (((stop as any).lingerMin || 0)) + (stop.waitMin || 0);
              prevLat = stop.lat; prevLng = stop.lng; prevLabel = subCity(stop.sub, stop.city) || stop.addr;
            }
          });
        });
        return schedStops;
      };
      const trafficTabs: TabId[] = ["ops", "trips", "traffic", "metrics"];
      startAutoRefresh(getStops, 60 * 1000, () => trafficTabs.includes(tabRef.current));
    }
    return () => stopAutoRefresh();
  }, [ships.length, Object.keys(tl).length, trafficStatus.enabled]);

  function toggleDriverActive(driverId: string) {
    const updated = {
      ...fleetSettings,
      drivers: fleetSettings.drivers.map((d) =>
        d.id === driverId ? { ...d, active: !d.active } : d
      ),
    };
    setFleetSettings(updated);
    updateFleetSettings(updated);
    saveFleetToServer(updated);
    const driver = updated.drivers.find((d) => d.id === driverId);
    if (driver) {
      log(`${driver.name} marked ${driver.active ? "ONLINE" : "OFFLINE"}`, "OPS");
      toast({ title: `${driver.name} is now ${driver.active ? "online" : "offline"}`, description: driver.active ? "Will be included in route planning" : "Excluded from route planning" });
    }
  }

  function handleDriverRemoved(removedId: string, updatedSettings: FleetSettings) {
    const activeFids = updatedSettings.drivers
      .filter((d) => d.active !== false && d.id !== removedId)
      .map((d) => d.id);
    if (!activeFids.length) { setAsgn({}); return; }
    const loads: Record<string, number> = {};
    activeFids.forEach((id) => { loads[id] = 0; });
    setAsgn((prev) => {
      const out: Record<string, string> = {};
      Object.keys(prev).forEach((sid) => {
        const did = prev[sid];
        if (did && activeFids.includes(did)) { out[sid] = did; loads[did]++; }
      });
      Object.keys(prev).forEach((sid) => {
        if (!out[sid]) {
          const minD = activeFids.reduce((b, id) => (loads[id] < loads[b] ? id : b), activeFids[0]);
          out[sid] = minD; loads[minD]++;
        }
      });
      return out;
    });
    log(`Driver removed, assignments redistributed`, "OPS");
  }

  function runOptimizer(targetShips?: Shipment[] | null, usePre?: boolean, explore?: boolean, optDayOverride?: string | null, liveAssignOverride?: Record<string, string> | null) {
    if (activeFleet.length === 0) {
      toast({ title: "No active drivers", description: "At least one driver must be online to optimize routes", variant: "destructive" });
      return;
    }
    setOptimizing(true);
    setTimeout(() => {
      try {
        const prevAsgn = { ...asgn };
        const s = targetShips || dayShips;
        const optDay = optDayOverride !== undefined && optDayOverride !== null
          ? optDayOverride
          : (selectedDay !== "all" ? selectedDay : (availableDays.length === 1 ? availableDays[0] : undefined));
        const hptsForOpt = handoffPoints;
        const res = optimizeRoutes(s, activeFleet, !!usePre, explore ? asgn : null, optDay, hptsForOpt);
        // Live-position auto-assignment: any NEW shipment from this intake is
        // pinned to the nearest ONLINE driver's current GPS position, overriding
        // the optimizer's depot-based placement. Only active-fleet driver ids are
        // honoured so the post-merge balancing below stays valid.
        if (liveAssignOverride) {
          const activeFidSet = new Set(activeFleet.map((d: any) => d.id));
          for (const [sid, did] of Object.entries(liveAssignOverride)) {
            if (activeFidSet.has(did)) res.asgn[sid] = did;
          }
        }
        setAsgn(prev => {
          const merged = { ...prev, ...res.asgn };
          const activeFids = activeFleet.map((d: any) => d.id);
          const activeFidSet = new Set(activeFids);
          if (!activeFids.length) return merged;
          const loads: Record<string, number> = {};
          activeFids.forEach((id: string) => { loads[id] = 0; });
          const out: Record<string, string> = {};
          Object.keys(merged).forEach((sid) => {
            const did = merged[sid];
            if (did && activeFidSet.has(did)) { out[sid] = did; loads[did]++; }
          });
          Object.keys(merged).forEach((sid) => {
            if (!out[sid]) {
              const minD = activeFids.reduce((b: string, id: string) => loads[id] < loads[b] ? id : b, activeFids[0]);
              out[sid] = minD; loads[minD]++;
            }
          });
          return out;
        });
        const newTripSt: Record<string, string> = {};
        fleet.forEach((d) => { newTripSt[d.id] = activeFleet.some((a) => a.id === d.id) ? "GENERATED" : tripSt[d.id] || "DRAFT"; });
        setTripSt(newTripSt);
        setStopSt({});
        setStopOverrides({});

        if (s.length > 0 && activeFleet.length >= 2) {
          const autoHandoffs = autoGenerateHandoffs(s, activeFleet, res.asgn, handoffPoints, optDay);
          setHandoffs((prev) => {
            const completed = prev.filter(h => h.status === "completed");
            const merged = [...completed, ...autoHandoffs];
            return merged;
          });
          if (autoHandoffs.length > 0) {
            const totalShipsInHandoffs = autoHandoffs.reduce((sum, h) => sum + h.shipmentIds.length, 0);
            log("Auto-generated " + autoHandoffs.length + " handoff" + (autoHandoffs.length > 1 ? "s" : "") + " for " + totalShipsInHandoffs + " shipment" + (totalShipsInHandoffs > 1 ? "s" : ""), "HANDOFF");
          }
        }

        const counts: Record<string, number> = {};
        activeFleet.forEach((d) => { counts[d.id] = 0; });
        Object.values(res.asgn).forEach((did) => { counts[did] = (counts[did] || 0) + 1; });
        const prevCost = optInfo ? optInfo.cost : null;
        const delta = prevCost != null ? (res.cost - prevCost) : 0;
        const deltaStr = prevCost != null ? (delta < 0 ? " ↓" + Math.abs(Math.round(delta)) : (delta > 0 ? " ↑" + Math.round(delta) : " =")) : "";
        let changed = 0, total = 0;
        if (prevAsgn) {
          s.forEach((sh) => { total++; if (prevAsgn[sh.id] && prevAsgn[sh.id] !== res.asgn[sh.id]) changed++; });
        }
        const chgStr = total > 0 ? " · " + changed + "/" + total + " changed" : "";
        log("Optimized (" + res.passes + " passes, cost " + Math.round(res.cost) + deltaStr + chgStr + "): " + activeFleet.map((d) => d.name + ":" + counts[d.id]).join(" "), "AI");
        setOptInfo({ cost: Math.round(res.cost), passes: res.passes });
        toast({ title: "Routes optimized", description: `Cost: R${Math.round(res.cost)} · ${activeFleet.map((d) => d.name + ": " + counts[d.id]).join(", ")}` });
      } catch (e: any) {
        log("Optimizer error: " + e.message, "ERR");
        toast({ title: "Optimizer error", description: e.message, variant: "destructive" });
      }
      setOptimizing(false);
      setTab("ops");
    }, 100);
  }

  const allWarn = useMemo(() => {
    const w: WarningItem[] = [];
    Object.values(effectiveTl).forEach((t) => { if (t.warnings) w.push(...t.warnings); });
    return w;
  }, [effectiveTl]);

  const zones = useMemo(() => {
    const z: string[] = [];
    dayShips.forEach((s) => { if (s.zone && !z.includes(s.zone)) z.push(s.zone); });
    return z.sort();
  }, [dayShips]);

  const filtered = useMemo(() => {
    return dayShips.filter((s) => {
      if (filter) {
        const f = filter.toLowerCase();
        if (!s.wb.toLowerCase().includes(f) && !s.client.toLowerCase().includes(f) && !s.dSub.toLowerCase().includes(f)) return false;
      }
      if (fZone && s.zone !== fZone) return false;
      return true;
    });
  }, [dayShips, filter, fZone]);

  const totals = useMemo(() => {
    let rev = 0, cogs = 0, km = 0, fuelL = 0, fuelR = 0, deadKm = 0, depotToFirstKm = 0, returnToDepotKm = 0;
    Object.values(liveTl).forEach((t) => {
      rev += t.stats.revenue; cogs += t.stats.cogs; km += t.stats.totalKm;
      fuelL += (t.stats.fuelLitres || 0); fuelR += (t.stats.fuelCost || 0);
      deadKm += (t.stats.deadKm || 0);
      depotToFirstKm += (t.stats.depotToFirstKm || 0);
      returnToDepotKm += (t.stats.returnToDepotKm || 0);
    });
    return { rev, cogs, km, fuelL, fuelR, deadKm, depotToFirstKm, returnToDepotKm, margin: rev - cogs };
  }, [liveTl]);

  // Persist a dispatcher-set delivery-window override and immediately re-run
  // the optimizer so the trip plan reflects the new (often earlier) window.
  // Collections are never touched — only the delivery side.
  const setDeliveryOverride = useCallback((shipmentId: string, dAfter: string, dBefore: string, pinnedTime?: string) => {
    const ship = ships.find((s) => s.id === shipmentId);
    if (!ship) return;
    const ovEntry = pinnedTime
      ? { pinnedTime, setAt: new Date().toISOString() }
      : { dAfter, dBefore, setAt: new Date().toISOString() };
    const next: DeliveryOverrides = { ...deliveryOverrides, [shipmentId]: ovEntry };
    setDeliveryOverrides(next);
    // Mirror to backend PATCH so other dispatcher sessions get an SSE broadcast
    // and the change survives a hard reload before autosave's debounce flushes.
    const pid = autosave.getProjectId();
    if (pid) {
      const body: Record<string, unknown> = { shipmentId };
      if (pinnedTime) body.pinnedTime = pinnedTime; else { body.dAfter = dAfter; body.dBefore = dBefore; }
      fetch(`/api/dispatch/projects/${pid}/delivery-overrides`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, credentials: "include",
        body: JSON.stringify(body),
      }).catch(() => { /* autosave will reconcile */ });
    }
    const desc = pinnedTime
      ? `Delivery for ${ship.wb} pinned → ${pinnedTime} (was ${ship.dAfter || "?"}–${ship.dBefore || "?"})`
      : `Delivery window for ${ship.wb} overridden → ${dAfter}–${dBefore} (was ${ship.dAfter || "?"}–${ship.dBefore || "?"})`;
    log(desc, "OPS");
    postAuditLog({
      eventType: "DELIVERY_WINDOW_OVERRIDDEN",
      entityType: "shipment",
      entityId: shipmentId,
      previousValue: { dAfter: ship.dAfter, dBefore: ship.dBefore },
      newValue: pinnedTime ? { pinnedTime } : { dAfter, dBefore },
      details: pinnedTime
        ? `${ship.wb}: pinned to ${pinnedTime}`
        : `${ship.wb}: ${ship.dAfter}-${ship.dBefore} → ${dAfter}-${dBefore}`,
    });
    toast({
      title: pinnedTime ? "Delivery pinned" : "Override saved",
      description: pinnedTime ? `${ship.wb}: ${pinnedTime}. Re-optimizing…` : `${ship.wb}: ${dAfter}–${dBefore}. Re-optimizing…`,
    });
    const patched = applyDeliveryOverrides(applyCollectionOverrides(ships, collectionOverrides), next);
    setTimeout(() => runOptimizer(patched), 50);
  }, [ships, deliveryOverrides, collectionOverrides, log, toast, runOptimizer]);

  const clearDeliveryOverride = useCallback((shipmentId: string) => {
    if (!deliveryOverrides[shipmentId]) return;
    const ship = ships.find((s) => s.id === shipmentId);
    const pid = autosave.getProjectId();
    if (pid) {
      fetch(`/api/dispatch/projects/${pid}/delivery-overrides`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, credentials: "include",
        body: JSON.stringify({ shipmentId, clear: true }),
      }).catch(() => { /* autosave will reconcile */ });
    }
    const next = { ...deliveryOverrides };
    delete next[shipmentId];
    setDeliveryOverrides(next);
    log(`Delivery window override cleared for ${ship?.wb || shipmentId}`, "OPS");
    postAuditLog({
      eventType: "DELIVERY_WINDOW_OVERRIDE_CLEARED",
      entityType: "shipment",
      entityId: shipmentId,
      previousValue: deliveryOverrides[shipmentId],
      newValue: null,
      details: `${ship?.wb || shipmentId}: override removed`,
    });
    toast({ title: "Override cleared", description: "Reverting to sender window. Re-optimizing…" });
    const patched = applyDeliveryOverrides(applyCollectionOverrides(ships, collectionOverrides), next);
    setTimeout(() => runOptimizer(patched), 50);
  }, [ships, deliveryOverrides, collectionOverrides, log, toast, runOptimizer]);

  const setCollectionOverride = useCallback((shipmentId: string, cAfter: string, cBefore: string, pinnedTime?: string) => {
    const ship = ships.find((s) => s.id === shipmentId);
    if (!ship) return;
    const ovEntry = pinnedTime
      ? { pinnedTime, setAt: new Date().toISOString() }
      : { cAfter, cBefore, setAt: new Date().toISOString() };
    const next: CollectionOverrides = { ...collectionOverrides, [shipmentId]: ovEntry };
    setCollectionOverrides(next);
    const pid = autosave.getProjectId();
    if (pid) {
      const body: Record<string, unknown> = { shipmentId };
      if (pinnedTime) body.pinnedTime = pinnedTime; else { body.cAfter = cAfter; body.cBefore = cBefore; }
      fetch(`/api/dispatch/projects/${pid}/collection-overrides`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, credentials: "include",
        body: JSON.stringify(body),
      }).catch(() => { /* autosave will reconcile */ });
    }
    const desc = pinnedTime
      ? `Collection for ${ship.wb} pinned → ${pinnedTime} (was ${ship.cAfter || "?"}–${ship.cBefore || "?"})`
      : `Collection window for ${ship.wb} overridden → ${cAfter}–${cBefore} (was ${ship.cAfter || "?"}–${ship.cBefore || "?"})`;
    log(desc, "OPS");
    postAuditLog({
      eventType: "COLLECTION_WINDOW_OVERRIDDEN",
      entityType: "shipment",
      entityId: shipmentId,
      previousValue: { cAfter: ship.cAfter, cBefore: ship.cBefore },
      newValue: pinnedTime ? { pinnedTime } : { cAfter, cBefore },
      details: pinnedTime
        ? `${ship.wb}: pinned to ${pinnedTime}`
        : `${ship.wb}: ${ship.cAfter}-${ship.cBefore} → ${cAfter}-${cBefore}`,
    });
    toast({
      title: pinnedTime ? "Collection pinned" : "Override saved",
      description: pinnedTime ? `${ship.wb}: ${pinnedTime}. Re-optimizing…` : `${ship.wb}: ${cAfter}–${cBefore}. Re-optimizing…`,
    });
    const patched = applyDeliveryOverrides(applyCollectionOverrides(ships, next), deliveryOverrides);
    setTimeout(() => runOptimizer(patched), 50);
  }, [ships, collectionOverrides, deliveryOverrides, log, toast, runOptimizer]);

  const clearCollectionOverride = useCallback((shipmentId: string) => {
    if (!collectionOverrides[shipmentId]) return;
    const ship = ships.find((s) => s.id === shipmentId);
    const next = { ...collectionOverrides };
    delete next[shipmentId];
    setCollectionOverrides(next);
    const pid = autosave.getProjectId();
    if (pid) {
      fetch(`/api/dispatch/projects/${pid}/collection-overrides`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, credentials: "include",
        body: JSON.stringify({ shipmentId, clear: true }),
      }).catch(() => { /* autosave will reconcile */ });
    }
    log(`Collection window override cleared for ${ship?.wb || shipmentId}`, "OPS");
    postAuditLog({
      eventType: "COLLECTION_WINDOW_OVERRIDE_CLEARED",
      entityType: "shipment",
      entityId: shipmentId,
      previousValue: collectionOverrides[shipmentId],
      newValue: null,
      details: `${ship?.wb || shipmentId}: collection override removed`,
    });
    toast({ title: "Override cleared", description: "Reverting to sender collection window. Re-optimizing…" });
    const patched = applyDeliveryOverrides(applyCollectionOverrides(ships, next), deliveryOverrides);
    setTimeout(() => runOptimizer(patched), 50);
  }, [ships, collectionOverrides, deliveryOverrides, log, toast, runOptimizer]);

  // Confirm with the dispatcher when applying a grouping change to a LOCKED
  // trip. Returns true when the operation should proceed.
  function confirmLockedTripChange(driverId: string, verb: "group" | "ungroup"): boolean {
    if (tripSt[driverId] !== "LOCKED") return true;
    // window.confirm is intentional here — the operation is destructive enough
    // (and rare enough) that an explicit blocking dialog is the safest UX.
    return window.confirm(
      `This trip is LOCKED. ${verb === "group" ? "Group" : "Ungroup"} stops anyway?\n\n` +
      `The change will be saved and pushed to the driver app.`
    );
  }

  // Group N stops into one. Pins the decision in `stopGroupings` so it
  // survives re-optimize and webhook auto-imports, and so the driver app
  // and CRM webhooks see the same combined stop the dispatcher sees.
  function groupStopsGlobal(driverId: string, stopIndices: number[]) {
    const trip = effectiveTl[driverId];
    if (!trip) return;
    const targets = stopIndices.map((i) => trip.stops[i]).filter(Boolean);
    if (targets.length < 2) return;
    const type = targets[0].type;
    if (!(type === "C" || type === "D") || targets.some((s) => s.type !== type)) {
      toast({ title: "Cannot group", description: "All grouped stops must be the same type (collection or delivery).", variant: "destructive" });
      return;
    }
    if (!confirmLockedTripChange(driverId, "group")) return;
    // Expand any prior groupings down to atomic shipment ids so the pinned
    // group entry is always the canonical set.
    const allIds: string[] = [];
    for (const s of targets) {
      if (s.unmergedIds && s.unmergedIds.length) {
        for (const arr of s.unmergedIds) allIds.push(...arr);
      } else {
        allIds.push(...s.ids);
      }
    }
    const warnings = mergeWarnings(targets);
    setStopGroupings((prev) => {
      const next = { ...prev };
      const existing = next[driverId] || [];
      const idsSet = new Set(allIds);
      const cleaned = existing.filter((g) => !g.ids.some((id) => idsSet.has(id)));
      next[driverId] = [...cleaned, { ids: [...allIds].sort(), type }];
      return next;
    });
    setStopOverrides((prev) => { const n = { ...prev }; delete n[driverId]; return n; });
    const driverName = fleet.find((d: any) => d.id === driverId)?.name || driverId;
    const wbList = targets.flatMap((s) => s.wbs).join(", ");
    log(`Grouped ${targets.length} stops (${wbList}) for ${driverName}`, "MANUAL");
    toast({
      title: "Stops grouped",
      description: warnings.length > 0
        ? `${targets.length} stops grouped. Note: ${warnings.join(" · ")}`
        : `${targets.length} stops grouped into one (${allIds.length} shipments)`,
    });
    postAuditLog({ eventType: "STOPS_MERGED", entityType: "trip", entityId: driverId, previousValue: { stops: targets.map((s) => s.key) }, newValue: { ids: allIds, type }, details: `${targets.length} stops grouped for ${driverName}` });
  }

  // Back-compat: mergeStopGlobal still groups stop[i] with stop[i+1].
  function mergeStopGlobal(driverId: string, idxA: number) {
    groupStopsGlobal(driverId, [idxA, idxA + 1]);
  }

  // Ungroup a previously-grouped stop. Always available: works on pinned
  // dispatcher groupings (removes the entry from `stopGroupings`) and also
  // on optimizer-auto-batched stops (falls back to splitGroupedStop +
  // stopOverrides for the current optimization run).
  function splitStopGlobal(driverId: string, idx: number) {
    const trip = effectiveTl[driverId];
    if (!trip) return;
    const stop = trip.stops[idx];
    if (!stop) return;
    const isGrouped = (stop.ids?.length ?? 0) >= 2 || stop.grouped === true || (stop.unmergedIds?.length ?? 0) >= 2;
    if (!isGrouped) {
      toast({ title: "Cannot ungroup", description: "This stop has only one shipment.", variant: "destructive" });
      return;
    }
    if (!confirmLockedTripChange(driverId, "ungroup")) return;
    const ids = stop.ids || [];
    const idsSet = new Set(ids);
    // Try removing a matching pinned grouping first.
    let removedPinned = false;
    setStopGroupings((prev) => {
      const existing = prev[driverId] || [];
      const remaining = existing.filter((g) => !(g.ids.length === ids.length && g.ids.every((id) => idsSet.has(id))));
      if (remaining.length === existing.length) return prev;
      removedPinned = true;
      const next = { ...prev };
      if (remaining.length === 0) delete next[driverId];
      else next[driverId] = remaining;
      return next;
    });
    // If no pinned grouping matched, this was an auto-batched stop — fall
    // back to splitGroupedStop into stopOverrides so the dispatcher sees the
    // ungroup take effect immediately. (Re-optimize will re-batch unless
    // the dispatcher pins individual orderings.)
    if (!removedPinned) {
      const driver = fleet.find((d: any) => d.id === driverId);
      if (!driver) return;
      let pieces: Stop[] = [];
      try {
        pieces = splitGroupedStop(stop, ships);
      } catch (err: any) {
        toast({ title: "Cannot ungroup", description: err?.message || "Failed to ungroup stop", variant: "destructive" });
        return;
      }
      if (pieces.length < 2) {
        toast({ title: "Cannot ungroup", description: "This stop has only one shipment.", variant: "destructive" });
        return;
      }
      const newStops = [...trip.stops.slice(0, idx), ...pieces, ...trip.stops.slice(idx + 1)];
      const recalculated = recalcStops(newStops, driver);
      setStopOverrides((prev: Record<string, Stop[]>) => ({ ...prev, [driverId]: recalculated }));
    } else {
      // Pinned group removed — clear any stopOverride so tl rebuild produces clean stops.
      setStopOverrides((prev) => { const n = { ...prev }; delete n[driverId]; return n; });
    }
    const driverName = fleet.find((d: any) => d.id === driverId)?.name || driverId;
    log(`Ungrouped ${stop.wbs.join(", ")} for ${driverName}`, "MANUAL");
    toast({ title: "Stop ungrouped", description: `Separated into ${ids.length} individual ${stop.type === "C" ? "collections" : "deliveries"}` });
    postAuditLog({ eventType: "STOP_SPLIT", entityType: "trip", entityId: driverId, previousValue: { key: stop.key }, newValue: { ids }, details: `${stop.wbs.join(", ")} ungrouped for ${driverName}` });
  }

  // Manual stop reorder shared between TripsTab cards and the DriverDetailModal.
  // Updates stopOverrides → effectiveTl → cascades to dashboard cards, archives,
  // analytics, live map ETAs, etc. (same path the inline trip card uses).
  function moveStopGlobal(driverId: string, fromIdx: number, toIdx: number) {
    if (tripSt[driverId] === "LOCKED") {
      toast({ title: "Trip is locked", description: "Unlock the trip before reordering stops", variant: "destructive" });
      return;
    }
    const trip = effectiveTl[driverId];
    if (!trip) return;
    const driver = fleet.find((d: any) => d.id === driverId);
    if (!driver) return;
    if (fromIdx < 0 || toIdx < 0 || fromIdx >= trip.stops.length || toIdx >= trip.stops.length) return;
    const newStops = [...trip.stops];
    const [moved] = newStops.splice(fromIdx, 1);
    newStops.splice(toIdx, 0, moved);
    const recalculated = recalcStops(newStops, driver);
    setStopOverrides((prev: Record<string, Stop[]>) => ({ ...prev, [driverId]: recalculated }));
    log(`Reordered ${subCity(moved.sub, moved.city)} (${moved.type === "C" ? "Col" : "Del"}) in ${driver.name}'s trip`, "MANUAL");
    postAuditLog({ eventType: "TRIP_SEQUENCE_UPDATED", entityType: "trip", entityId: driverId, previousValue: { position: fromIdx }, newValue: { position: toIdx }, details: `${subCity(moved.sub, moved.city)} moved ${fromIdx < toIdx ? "down" : "up"} in ${driver.name}'s trip` });
  }

  function handleFileDrop(e: React.DragEvent) {
    e.preventDefault();
    const f = e.dataTransfer.files[0];
    if (f) readFile(f);
  }

  function readFile(f: File) {
    setCsvFileName(f.name);
    const r = new FileReader();
    r.onload = async (ev) => {
      const txt = ev.target?.result as string;
      setCsvText(txt);
      const latestMap = await loadClientAccounts();
      const result = parseShipLogicCSV(txt, latestMap);
      setCsvResult(result);
      if (result.accountCodes.length > 0) {
        autoInsertNewAccounts(result.accountCodes);
      }
    };
    r.readAsText(f);
  }

  function handleExport() {
    const json = exportProject({ shipments: ships, assignments: asgn, tripStatuses: tripSt, stopStatuses: stopSt, stopNotes, handoffs, handoffPoints });
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `delicate-courier-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    log("Project exported", "SYS");
    toast({ title: "Project exported", description: "Backup file downloaded" });
  }

  function handleImportProject(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = (ev) => {
      try {
        const data = importProject(ev.target?.result as string);
        setShips(data.shipments);
        setAsgn(data.assignments);
        setTripSt(data.tripStatuses);
        setStopSt(data.stopStatuses);
        setStopNotes(data.stopNotes);
        if (data.handoffs) setHandoffs(data.handoffs);
        if (data.handoffPoints) setHandoffPoints(data.handoffPoints);
        setTab("ops");
        log("Project imported: " + data.shipments.length + " shipments", "SYS");
        toast({ title: "Project restored", description: `${data.shipments.length} shipments loaded` });
      } catch (e: any) {
        toast({ title: "Import failed", description: e.message, variant: "destructive" });
      }
    };
    r.readAsText(f);
  }

  useEffect(() => {
    function onRestoreEvent(e: Event) {
      const detail = (e as CustomEvent).detail;
      if (detail) handleRestoreArchive(detail as TripArchive);
    }
    window.addEventListener("v7:restore-archive", onRestoreEvent as EventListener);
    return () => window.removeEventListener("v7:restore-archive", onRestoreEvent as EventListener);
  }, []);

  async function loadShipmentsWithGeocode(shipsToLoad: Shipment[]): Promise<Shipment[]> {
    const missing = shipsToLoad.filter((s) => s.cLat === 0 || s.cLng === 0 || s.dLat === 0 || s.dLng === 0);
    if (missing.length === 0) return shipsToLoad;
    setGeocoding(true);
    setGeocodingProgress({ done: 0, total: missing.length * 2 });
    try {
      const result = await geocodeShipments(shipsToLoad, (done, total) => {
        setGeocodingProgress({ done, total });
      });
      if (result.failed.length > 0) {
        log(`⚠ ${result.failed.length} address(es) could not be resolved — routing may be affected`, "WARN");
      }
      return result.ships;
    } finally {
      setGeocoding(false);
      setGeocodingProgress(null);
    }
  }

  async function confirmIntake() {
    if (!csvResult || csvResult.ships.length === 0) {
      toast({ title: "Nothing to confirm", description: "Parse or upload a CSV first.", variant: "destructive" });
      return;
    }
    const { merged, enrichedCount } = mergeCSVWithExisting(csvResult.ships, ships);
    const finalShips = await loadShipmentsWithGeocode(merged);
    const hasPreAssign = finalShips.some((s) => s.preColDriver || s.preDelDriver);
    const dates = Array.from(new Set(csvResult.ships.map((s: any) => s.delDate || s.colDate || "unknown")));
    setShips(finalShips);
    setSelectedDay("all");
    setAsgn({});
    setStopSt({});
    setTripSt(Object.fromEntries(fleet.map((d) => [d.id, "DRAFT"])));
    const mergeMsg = enrichedCount > 0 ? ` (${enrichedCount} merged with webhook data)` : "";
    log("Imported " + finalShips.length + " shipments" + mergeMsg + (dates.length > 1 ? ` across ${dates.length} days` : ""), "SYS");
    const existingWbs = new Set(ships.map((s) => s.wb));
    const newCount = finalShips.filter((s) => !existingWbs.has(s.wb)).length;
    const updatedCount = finalShips.filter((s) => existingWbs.has(s.wb)).length;
    postImportRecord({
      fileName: csvFileName || "pasted",
      rowCount: csvResult.ships.length,
      newCount,
      updatedCount,
      matchedCount: updatedCount,
      failedCount: csvResult.warnings.length,
      warnings: csvResult.warnings,
      changeLog: finalShips.filter((s) => existingWbs.has(s.wb)).map((s) => ({ wb: s.wb, field: "reimport", from: "existing", to: "updated" })),
      shipmentSnapshot: finalShips,
    });
    // Auto-assign NEW shipments to the nearest ONLINE driver's live GPS position
    // (falls back to the optimizer when no driver is online). Pre-assigned CSVs
    // keep their explicit driver pins, so skip the live override in that case.
    let liveAssignOverride: Record<string, string> | null = null;
    if (!hasPreAssign && liveDriverLocations && liveDriverLocations.length > 0) {
      const liveDrivers = liveDriverLocations
        .filter((dl) => dl && dl.isOnline && dl.lat != null && dl.lng != null)
        .map((dl) => {
          const af = activeFleet.find((a: any) => a.name.toLowerCase().trim() === String(dl.driverName).toLowerCase().trim());
          return af ? { id: af.id, lat: dl.lat as number, lng: dl.lng as number } : null;
        })
        .filter((d): d is { id: string; lat: number; lng: number } => !!d);
      if (liveDrivers.length > 0) {
        liveAssignOverride = {};
        for (const s of finalShips) {
          if (existingWbs.has(s.wb)) continue;
          const lat = (s.cLat && s.cLng) ? s.cLat : s.dLat;
          const lng = (s.cLat && s.cLng) ? s.cLng : s.dLng;
          if (!lat || !lng) continue;
          let bestId: string | null = null;
          let bestKm = Infinity;
          for (const d of liveDrivers) {
            const km = haversine({ lat, lng }, { lat: d.lat, lng: d.lng });
            if (km < bestKm) { bestKm = km; bestId = d.id; }
          }
          if (bestId) liveAssignOverride[s.id] = bestId;
        }
      }
    }
    runOptimizer(finalShips, hasPreAssign, false, null, liveAssignOverride);
  }

  async function parsePastedCsv() {
    if (!csvText.trim()) {
      toast({ title: "Nothing to parse", description: "Paste CSV data first.", variant: "destructive" });
      return;
    }
    const latestMap = await loadClientAccounts();
    const result = parseShipLogicCSV(csvText, latestMap);
    setCsvResult(result);
    if (result.accountCodes.length > 0) autoInsertNewAccounts(result.accountCodes);
  }

  function handleRestoreArchive(archive: TripArchive) {
    const restoredShips = (archive.shipments || []) as Shipment[];
    const restoredAsgn = (archive.assignments || {}) as Record<string, string>;
    const restoredHandoffs = (archive.handoffs || []) as HandoffEvent[];
    setShips(restoredShips);
    setAsgn(restoredAsgn);
    setStopOverrides({});
    if (restoredHandoffs.length > 0) setHandoffs(restoredHandoffs);
    setTab("ops");
    log(`Restored archive "${archive.name}" — ${restoredShips.length} shipments, ${Object.keys(restoredAsgn).length} assignments`, "SYS");
    toast({ title: "Archive restored", description: `${restoredShips.length} shipments and assignments loaded from "${archive.name}"` });
  }

  function toggleStopStatus(key: string) {
    setStopSt((prev) => {
      const cur = prev[key] || "PENDING";
      const next = cur === "PENDING" ? "ARRIVED" : cur === "ARRIVED" ? "DONE" : "PENDING";
      return { ...prev, [key]: next };
    });
  }

  const tabItems: { id: TabId; label: string; icon: any; badge?: number }[] = [
    { id: "import", label: "Import", icon: Upload },
    { id: "ops", label: "Dashboard", icon: BarChart3 },
    { id: "trips", label: "Trips", icon: ClipboardList },
    { id: "driver", label: "Driver", icon: Smartphone },
    { id: "handoffs", label: "Handoffs", icon: Repeat2, badge: activeHandoffs.length || undefined },
    { id: "traffic", label: "Traffic", icon: Activity },
    { id: "datacentre", label: "Data Centre", icon: Database },
    { id: "allshipments", label: "Shipments", icon: Package },
    { id: "shipments", label: "Client Care", icon: Phone },
    { id: "metrics", label: "Metrics", icon: TrendingUp },
    ...(authUser && ["admin","manager","ops","dispatcher"].includes(authUser.role)
      ? [{ id: "analytics", label: "Driver Analytics", icon: BarChart3 }]
      : []),
    { id: "settings", label: "Settings", icon: Settings },
    { id: "log", label: "Log", icon: ScrollText },
  ];

  const totalShipmentsLoaded = ships.length;
  const estimatedDriveHours = useMemo(() => {
    let totalMin = 0;
    Object.values(liveTl).forEach((t) => {
      t.stops.forEach((s: any) => { totalMin += (s.legMin || 0); });
    });
    return Math.round((totalMin / 60) * 10) / 10;
  }, [liveTl]);

  const intakeContext: IntakeContextValue = {
    fileRef,
    importFileRef,
    csvText,
    setCsvText,
    csvResult,
    csvFileName,
    optimizing,
    geocoding,
    geocodingProgress,
    totalShipmentsLoaded,
    estimatedDriveHours,
    handleFileDrop,
    readFile,
    parsePastedCsv,
    confirmIntake,
    handleExport,
    handleImportProject,
    goToWebhookSettings: () => setTab("settings"),
  };

  const trafficSuburbsUsed = useMemo(() => {
    const s = new Set<string>();
    Object.values(effectiveTl).forEach((td) => {
      td.stops.forEach((stop) => { if (stop.sub) s.add(stop.sub.toLowerCase().trim()); });
    });
    return s;
  }, [effectiveTl]);

  const trafficIncidents: IncidentItem[] = useMemo(() => {
    const now = new Date();
    const dow = now.getDay();
    const isWeekend = dow === 0 || dow === 6;
    const nowMin = now.getHours() * 60 + now.getMinutes();
    return PRETORIA_KNOWN_INCIDENTS.map((inc) => {
      const affectsRoute = inc.affectedSuburbs.some((s) => trafficSuburbsUsed.has(s));
      let isActiveNow = true;
      if (inc.timeRestriction) {
        const r = inc.timeRestriction.toLowerCase();
        if (r.includes("weekday") && isWeekend) {
          isActiveNow = false;
        } else {
          const ranges = inc.timeRestriction.match(/(\d{2}:\d{2})-(\d{2}:\d{2})/g);
          if (ranges && ranges.length > 0) {
            isActiveNow = ranges.some((rg) => {
              const [s, e] = rg.split("-");
              const [sh, sm] = s.split(":").map(Number);
              const [eh, em] = e.split(":").map(Number);
              return nowMin >= sh * 60 + sm && nowMin <= eh * 60 + em;
            });
          }
        }
      }
      return { id: inc.id, type: inc.type, corridor: inc.corridor, location: inc.location, description: inc.description, severity: inc.severity, timeRestriction: inc.timeRestriction, detour: inc.detour, affectsRoute, isActiveNow };
    }).sort((a, b) => {
      if (a.affectsRoute !== b.affectsRoute) return a.affectsRoute ? -1 : 1;
      const order = { high: 0, medium: 1, low: 2 } as const;
      return order[a.severity] - order[b.severity];
    });
  }, [trafficSuburbsUsed]);

  const trafficTotalDelay = useMemo(() => Array.from(driverTraffic.values()).reduce((s, d) => s + d.totalDelayMin, 0), [driverTraffic]);
  const trafficWorst = useMemo(() => Array.from(driverTraffic.values()).reduce((w, d) => {
    const levels = ["NORMAL", "SLOW", "HEAVY", "STANDSTILL"];
    return levels.indexOf(d.worstCongestion) > levels.indexOf(w) ? d.worstCongestion : w;
  }, "NORMAL"), [driverTraffic]);
  const trafficTotalLegs = useMemo(() => Array.from(driverTraffic.values()).reduce((s, d) => s + d.legDetails.length, 0), [driverTraffic]);
  const trafficCongestedLegs = useMemo(() => Array.from(driverTraffic.values()).reduce((s, d) => s + d.legDetails.filter((l) => l.congestion !== "NORMAL").length, 0), [driverTraffic]);
  const trafficAffectedDrivers = useMemo(() => Array.from(driverTraffic.values()).filter((d) => d.totalDelayMin > 0 || d.worstCongestion !== "NORMAL").length, [driverTraffic]);

  const generateDetour = (incident: IncidentItem) => {
    const probe = CORRIDOR_PROBES.find((p) => p.name === incident.corridor || incident.corridor.includes(p.name));
    const newReport = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
      roadId: probe?.id || incident.corridor.toLowerCase().replace(/\s+/g, "_"),
      roadName: incident.corridor,
      category: "traffic" as const,
      type: incident.type === "closure" ? "Road Closure" : incident.type === "construction" ? "Heavy Traffic" : "Accident",
      severity: incident.severity,
      notes: `Detour requested from incident feed: ${incident.location} — ${incident.description}`,
      reportedAt: new Date().toISOString(),
      active: true,
    };
    setUserReports([newReport, ...userReports]);
    log(`Detour requested for ${incident.corridor} (${incident.location})`, "AI");
    toast({ title: "Detour generating", description: `Re-optimizing routes to avoid ${incident.corridor}…` });
    runOptimizer(null, false, false, null);
  };

  // Collect every leg that needs an OSRM polyline (corridor probes + each
  // driver leg between depot and stops). Shared cache feeds both the
  // corridor matcher below and the traffic-page map.
  const polylineRequestLegs = useMemo<PolylineRequestLeg[]>(() => {
    const out: PolylineRequestLeg[] = CORRIDOR_PROBES.map((c) => ({
      originLat: c.originLat, originLng: c.originLng,
      destLat: c.destLat, destLng: c.destLng,
    }));
    Object.values(effectiveTl).forEach((td) => {
      const stopsWithCoords = td.stops.filter((s) => Number.isFinite(s.lat) && Number.isFinite(s.lng));
      let prevLat = td.driver.depotLat;
      let prevLng = td.driver.depotLng;
      stopsWithCoords.forEach((stop) => {
        out.push({ originLat: prevLat, originLng: prevLng, destLat: stop.lat, destLng: stop.lng });
        prevLat = stop.lat;
        prevLng = stop.lng;
      });
    });
    return out;
  }, [effectiveTl]);

  const legGeometries = useLegPolylines(polylineRequestLegs);

  const corridorPolylines = useMemo(() => {
    const map = new Map<string, ReadonlyArray<[number, number]>>();
    for (const c of CORRIDOR_PROBES) {
      const geo = legGeometries.get(legKey(c.originLat, c.originLng, c.destLat, c.destLng));
      if (geo && geo.length >= 2) map.set(c.id, geo);
    }
    return map;
  }, [legGeometries]);

  const driverRoutesForMap = useMemo<DriverRouteForMap[]>(() => {
    const fleetById = new Map(fleet.map((d) => [d.id, d]));
    const levels = ["NORMAL", "SLOW", "HEAVY", "STANDSTILL"] as const;
    const routes: DriverRouteForMap[] = [];
    Object.entries(effectiveTl).forEach(([driverId, td]) => {
      const stopsWithCoords = td.stops.filter((s) => Number.isFinite(s.lat) && Number.isFinite(s.lng));
      if (stopsWithCoords.length === 0) return;
      const driverProfile = fleetById.get(driverId);
      const driverColor = driverProfile?.color || td.driver.color || "#64748b";
      const driverName = driverProfile?.name || td.driver.name || driverId;
      const tdata = driverTraffic.get(driverId);
      const legDetails = tdata?.legDetails ?? [];

      const legs: DriverRouteLeg[] = [];
      let prevLat = td.driver.depotLat;
      let prevLng = td.driver.depotLng;
      let prevLabel = (td.driver.depot || "Depot") + " (Depot)";
      stopsWithCoords.forEach((stop, i) => {
        const toLabel = subCity(stop.sub, stop.city) || stop.addr || `Stop ${i + 1}`;
        const det = legDetails[i];
        const congestionRaw = det?.congestion || "NORMAL";
        const congestion = (levels as readonly string[]).includes(congestionRaw)
          ? (congestionRaw as DriverRouteLeg["congestion"])
          : "NORMAL";
        const legPolyline = legGeometries.get(legKey(prevLat, prevLng, stop.lat, stop.lng));
        const matched = nearestCorridor(prevLat, prevLng, stop.lat, stop.lng, {
          legPolyline,
          corridorPolylines,
        });
        legs.push({
          fromLat: prevLat,
          fromLng: prevLng,
          toLat: stop.lat,
          toLng: stop.lng,
          fromLabel: prevLabel,
          toLabel,
          congestion,
          delayMin: det?.delayMin ?? 0,
          corridorId: matched?.id,
          corridorName: matched?.name,
        });
        prevLat = stop.lat;
        prevLng = stop.lng;
        prevLabel = toLabel;
      });

      const worst = legs.reduce<DriverRouteLeg["congestion"]>((w, l) => {
        return levels.indexOf(l.congestion) > levels.indexOf(w) ? l.congestion : w;
      }, "NORMAL");
      const totalDelayMin = legs.reduce((s, l) => s + (l.delayMin || 0), 0);

      routes.push({
        driverId,
        driverName,
        driverColor,
        totalDelayMin: tdata?.totalDelayMin ?? totalDelayMin,
        worstCongestion: tdata?.worstCongestion ?? worst,
        legs,
        stops: stopsWithCoords.map((s, i) => ({
          lat: s.lat,
          lng: s.lng,
          label: subCity(s.sub, s.city) || s.addr || `Stop ${i + 1}`,
        })),
      });
    });
    return routes;
  }, [effectiveTl, fleet, driverTraffic, legGeometries, corridorPolylines]);

  const trafficContext: TrafficContextValue = {
    trafficStatus,
    driverTraffic,
    driverRoutes: driverRoutesForMap,
    refreshTraffic,
    totalDelayMin: trafficTotalDelay,
    worstCongestion: trafficWorst,
    congestedLegs: trafficCongestedLegs,
    totalLegs: trafficTotalLegs,
    affectedDriverCount: trafficAffectedDrivers,
    incidents: trafficIncidents,
    userReports,
    generateDetour,
    optimizing,
    legGeometries,
  };

  const tabBodies: Record<TabId, ReactNode> = {
    import: <ImportTab csvText={csvText} setCsvText={setCsvText} csvResult={csvResult} setCsvResult={setCsvResult} fileRef={fileRef} ships={dayShips} allShips={ships} setShips={setShips} asgn={asgn} setAsgn={setAsgn} setTripSt={setTripSt} setStopSt={setStopSt} runOptimizer={runOptimizer} optimizing={optimizing} log={log} handleFileDrop={handleFileDrop} readFile={readFile} handleExport={handleExport} importFileRef={importFileRef} handleImportProject={handleImportProject} selectedDay={selectedDay} setSelectedDay={setSelectedDay} availableDays={availableDays} csvFileName={csvFileName} fleet={fleet} loadClientAccounts={loadClientAccounts} autoInsertNewAccounts={autoInsertNewAccounts} onLoadShipments={(newShips: Shipment[]) => {
      const existingWbs = new Set(ships.map((s) => s.wb));
      const newCount = newShips.filter((s) => !existingWbs.has(s.wb)).length;
      const updatedCount = newShips.filter((s) => existingWbs.has(s.wb)).length;
      const changeLog = newShips
        .filter((s) => existingWbs.has(s.wb))
        .map((s) => ({ wb: s.wb, field: "reimport", from: "existing", to: "updated" }));
      postImportRecord({
        fileName: csvFileName || "pasted",
        rowCount: csvResult?.ships.length ?? newShips.length,
        newCount,
        updatedCount,
        matchedCount: updatedCount,
        failedCount: csvResult?.warnings.length ?? 0,
        warnings: csvResult?.warnings ?? [],
        changeLog,
        shipmentSnapshot: newShips,
      });
    }} />,
    ops: <OpsTab tl={liveTl} ships={dayShips} asgn={asgn} setAsgn={setAsgn} allWarn={allWarn} totals={totals} runOptimizer={runOptimizer} optimizing={optimizing} optInfo={optInfo} tripSt={tripSt} selectedDay={selectedDay} trafficCond={trafficCond} setTrafficCond={(c: TrafficCondition) => { setTrafficCondition(c); setTrafficCond(c); }} fleet={fleet} fleetSettings={fleetSettings} toggleDriverActive={toggleDriverActive} log={log} driverTraffic={driverTraffic} trafficStatus={trafficStatus} refreshTraffic={refreshTraffic} userReports={userReports} handoffs={handoffs} setTab={setTab} now={now} moveStop={moveStopGlobal} mergeStop={mergeStopGlobal} splitStop={splitStopGlobal} deliveryOverrides={deliveryOverrides} setDeliveryOverride={setDeliveryOverride} clearDeliveryOverride={clearDeliveryOverride} collectionOverrides={collectionOverrides} setCollectionOverride={setCollectionOverride} clearCollectionOverride={clearCollectionOverride} />,
    trips: <TripsTab tl={liveTl} tripSt={tripSt} setTripSt={setTripSt} stopSt={stopSt} toggleStopStatus={toggleStopStatus} expandedTrips={expandedTrips} setExpandedTrips={setExpandedTrips} asgn={asgn} setAsgn={setAsgn} ships={dayShips} log={log} trafficCond={trafficCond} selectedDay={selectedDay} fleet={fleet} runOptimizer={runOptimizer} optimizing={optimizing} userReports={userReports} stopOverrides={stopOverrides} setStopOverrides={setStopOverrides} setStopGroupings={setStopGroupings} mergeStopGlobal={mergeStopGlobal} splitStopGlobal={splitStopGlobal} groupStopsGlobal={groupStopsGlobal} />,
    driver: <DriverTab tl={effectiveTl} drvView={drvView} setDrvView={setDrvView} stopSt={stopSt} toggleStopStatus={toggleStopStatus} fleet={fleet} ships={dayShips} asgn={asgn} setAsgn={setAsgn} log={log} />,
    handoffs: <HandoffsTab handoffs={handoffs} setHandoffs={setHandoffs} handoffPoints={handoffPoints} fleet={fleet} ships={dayShips} asgn={asgn} log={log} tl={effectiveTl} />,
    traffic: <TrafficTab tl={effectiveTl} ships={dayShips} fleet={fleet} driverTraffic={driverTraffic} trafficStatus={trafficStatus} refreshTraffic={refreshTraffic} selectedDay={selectedDay} userReports={userReports} setUserReports={setUserReports} />,
    datacentre: <DataCentreTab onRestore={handleRestoreArchive} />,
    allshipments: <ShipmentsListTab />,
    shipments: <ShipmentsPage />,
    metrics: <MetricsTab tl={effectiveTl} totals={totals} ships={dayShips} fleet={fleet} fleetSettings={fleetSettings} />,
    analytics: <DriverAnalyticsTab />,
    settings: <SettingsTab fleetSettings={fleetSettings} setFleetSettings={(s: FleetSettings) => { setFleetSettings(s); updateFleetSettings(s); saveFleetToServer(s); }} log={log} editDriverId={editDriverId} clearEditDriverId={() => setEditDriverId(null)} toggleDriverActive={toggleDriverActive} onDriverRemoved={handleDriverRemoved} authUser={authUser} onUpdateProfile={onUpdateProfile} />,
    log: <LogTab events={events} />,
  };

  const v7IsSaturday = selectedDay && selectedDay !== "all" ? new Date(selectedDay + "T00:00:00").getDay() === 6 : false;
  const v7Insights = useMemo(
    () => generateInsights(effectiveTl, dayShips, trafficCond || "normal", v7IsSaturday, userReports),
    [effectiveTl, dayShips, trafficCond, v7IsSaturday, userReports],
  );
  const v7Extras = {
    insights: v7Insights,
    fleetSettings,
    setFleetSettings: (s: FleetSettings) => { setFleetSettings(s); updateFleetSettings(s); saveFleetToServer(s); },
    log,
    toggleDriverActive,
    onDriverRemoved: handleDriverRemoved,
    authUser,
    onUpdateProfile: onUpdateProfile as ((data: Record<string, unknown>) => Promise<unknown>) | undefined,
  };

  const mainContent = (
    <main className="flex-1 overflow-hidden flex flex-col bg-slate-50 dark:bg-slate-950">
      {tabBodies[tab]}
    </main>
  );

  if (chrome === "v7") {
    return (
      <DispatchTabContext.Provider value={{
        tabBodies,
        extras: {
          ...v7Extras,
          totals,
          fleet,
          tl: effectiveTl,
          dayShips,
          openDayShips,
          allShipsCount: ships.length,
          asgn,
          setAsgn,
          runOptimizer,
          optimizing,
          handoffs,
          handoffPoints,
          allWarn,
          selectedDay: selectedDay ?? "",
          setSelectedDay,
          availableDays,
          trafficCond: trafficCond ?? "normal",
          moveStop: moveStopGlobal,
          mergeStop: mergeStopGlobal,
          splitStop: splitStopGlobal,
          tripSt,
          deliveryOverrides,
          collectionOverrides,
          setDeliveryOverride,
          clearDeliveryOverride,
          setCollectionOverride,
          clearCollectionOverride,
        },
        intake: intakeContext,
        traffic: trafficContext,
      }}>
        <main className="flex-1 overflow-hidden flex flex-col bg-slate-50 dark:bg-slate-950 min-w-0">
          {children ?? (currentTab ? tabBodies[currentTab] : tabBodies[tab])}
        </main>
        {/* The Inspector must live INSIDE this provider: it renders custom
            nodes (e.g. <TripSheet/>) that call useDispatchData(). Rendered as a
            sibling of <DispatchPage/> in AppShell it had no context and threw
            "useDispatchData must be used inside <DispatchPage chrome=\"v7\">". */}
        <Inspector />
      </DispatchTabContext.Provider>
    );
  }

  return (
    <div className="flex h-screen w-full bg-background" data-testid="dispatch-page">
      <Sidebar className="[&_[data-slot=sidebar-inner]]:bg-transparent [&_[data-slot=sidebar-inner]]:border-none [&_[data-slot=sidebar-container]]:border-none">
        <div className="absolute inset-0 z-0">
          <img src={sidebarBgImage} alt="" className="h-full w-full object-cover" />
          <div className="absolute inset-0 bg-gradient-to-b from-slate-900/93 via-slate-900/90 to-slate-950/96" />
        </div>

        <div className="relative z-10 flex flex-col h-full">
          <div className="px-4 pt-4 pb-4">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-md bg-white/15 backdrop-blur-sm border border-white/20 flex items-center justify-center">
                <Truck className="w-4 h-4 text-white" />
              </div>
              <div>
                <h1 className="text-[13px] font-bold tracking-tight text-white">Delicate Courier</h1>
                <p className="text-[11px] text-white/50 leading-none mt-0.5">Dispatch v6.1</p>
              </div>
            </div>
            <div className="mt-3 px-1 flex items-center justify-between" data-testid="sidebar-live-clock">
              <span className="text-[10px] text-white/50">{date}</span>
              <span className="text-[11px] font-mono font-semibold text-white/80 tabular-nums">{time}</span>
            </div>
          </div>

          <SidebarContent>
            <SidebarGroup>
              <SidebarGroupContent>
                <div className="space-y-1 px-2">
                  {tabItems.map((item) => {
                    const active = tab === item.id;
                    const Icon = item.icon;
                    return (
                      <button
                        key={item.id}
                        onClick={() => setTab(item.id)}
                        className={`flex items-center gap-3 w-full rounded-md px-3 py-2.5 text-[14px] font-semibold transition-all cursor-pointer ${
                          active
                            ? "bg-white/25 text-white border border-white/30 backdrop-blur-sm shadow-lg shadow-black/25"
                            : "text-white/80 border border-transparent hover:bg-white/15 hover:text-white hover:border-white/20"
                        }`}
                        data-testid={`nav-${item.id}`}
                      >
                        <Icon className={`w-4.5 h-4.5 ${active ? "text-white" : "text-white/70"}`} />
                        <span className="flex-1 text-left">{item.label}</span>
                        {item.badge != null && item.badge > 0 && (
                          <span className="text-[10px] font-bold bg-white/20 rounded-full px-1.5 py-0.5 tabular-nums">{item.badge}</span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </SidebarGroupContent>
            </SidebarGroup>

            {availableDays.length > 1 && (
              <SidebarGroup>
                <div className="px-4 pt-2 pb-1.5">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-white/50">Schedule</p>
                </div>
                <SidebarGroupContent>
                  <div className="space-y-0.5 px-2">
                    <button
                      onClick={() => setSelectedDay("all")}
                      className={`flex items-center gap-2.5 w-full rounded-md px-3 py-2 text-[13px] font-semibold transition-all cursor-pointer ${
                        selectedDay === "all"
                          ? "bg-white/25 text-white border border-white/30 backdrop-blur-sm"
                          : "text-white/70 border border-transparent hover:bg-white/15 hover:text-white hover:border-white/20"
                      }`}
                      data-testid="button-day-all"
                    >
                      <Package className="w-4 h-4" />
                      <span className="flex-1 text-left">All Days</span>
                      <span className="text-[11px] font-bold tabular-nums text-white/60">{ships.length}</span>
                    </button>
                    {availableDays.map((d) => {
                      const count = ships.filter((s) => (s.delDate || s.colDate) === d).length;
                      return (
                        <button
                          key={d}
                          onClick={() => setSelectedDay(d)}
                          className={`flex items-center gap-2.5 w-full rounded-md px-3 py-2 text-[13px] font-semibold transition-all cursor-pointer ${
                            selectedDay === d
                              ? "bg-white/25 text-white border border-white/30 backdrop-blur-sm"
                              : "text-white/70 border border-transparent hover:bg-white/15 hover:text-white hover:border-white/20"
                          }`}
                          data-testid={`button-day-${d}`}
                        >
                          <Clock className="w-4 h-4" />
                          <span className="flex-1 text-left">{formatDayLabel(d)}</span>
                          <span className="text-[11px] font-bold tabular-nums text-white/60">{count}</span>
                        </button>
                      );
                    })}
                  </div>
                </SidebarGroupContent>
              </SidebarGroup>
            )}

            <SidebarGroup className="mt-auto">
              <SidebarGroupContent>
                <div className="px-4 pb-1.5">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-white/50">Fleet</p>
                </div>
                <div className="space-y-1 px-2">
                  {fleet.map((d) => {
                    const trip = tl[d.id];
                    const driverProfile = fleetSettings.drivers.find((p: DriverProfile) => p.id === d.id);
                    const isActive = driverProfile?.active !== false;
                    return (
                      <button
                        key={d.id}
                        className={`flex items-center gap-3 w-full rounded-md px-3 py-2 cursor-pointer text-left border border-transparent hover:bg-white/15 hover:border-white/20 transition-all ${!isActive ? "opacity-70" : ""}`}
                        onClick={() => { setEditDriverId(d.id); setTab("settings"); }}
                        data-testid={`sidebar-driver-${d.id}`}
                      >
                        <div className="relative">
                          <div className="h-7 w-7 rounded-full flex items-center justify-center text-[11px] font-bold text-white shrink-0 border-2 border-white/30 shadow-lg" style={{ backgroundColor: isActive ? d.color : "#6b7280" }}>
                            {d.icon}
                          </div>
                          <div className={`absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-slate-900 ${isActive ? "bg-green-500" : "bg-red-500"}`} />
                        </div>
                        <span className="text-[13px] font-semibold text-white/90 flex-1">{d.name}</span>
                        <span className="text-[12px] text-white/50 tabular-nums font-bold">
                          {!isActive ? "OFF" : (trip?.stats.shipments ? trip.stats.shipments + "j" : "--")}
                        </span>
                      </button>
                    );
                  })}
                </div>
                <div className="mx-3 my-2 border-t border-white/10" />
                <div className="flex items-center justify-between gap-2 px-3 pb-2">
                  <span className="text-[12px] font-medium text-white/50">
                    {dayShips.length ? `${dayShips.length} shipments` : "No data"}
                    {allWarn.length > 0 && <span className="text-amber-400 font-bold ml-1">{allWarn.length} warn</span>}
                  </span>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={toggleTheme}
                    className="text-white/50 hover:text-white hover:bg-white/10"
                    data-testid="button-theme-toggle"
                  >
                    {theme === "dark" ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
                  </Button>
                </div>
                {authUser && (
                  <>
                    <div className="mx-3 my-1 border-t border-white/10" />
                    <div className="flex items-center gap-2.5 px-3 pb-3 pt-1">
                      <div
                        className="w-8 h-8 rounded-full flex items-center justify-center text-[13px] font-bold text-white shrink-0 border-2 border-white/25"
                        style={{ backgroundColor: authUser.avatarColor }}
                        data-testid="sidebar-user-avatar"
                      >
                        {(authUser.displayName || authUser.username).charAt(0).toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-[12px] font-semibold text-white/90 truncate" data-testid="sidebar-user-name">
                          {authUser.displayName || authUser.username}
                        </p>
                        <p className="text-[10px] text-white/50 truncate">{authUser.role}</p>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={onLogout}
                        className="text-white/40 hover:text-red-400 hover:bg-red-500/10 h-7 w-7"
                        data-testid="button-logout"
                        title="Sign out"
                      >
                        <Power className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </>
                )}
              </SidebarGroupContent>
            </SidebarGroup>
          </SidebarContent>
        </div>
      </Sidebar>

      <div className="flex-1 overflow-hidden flex flex-col">
        <header className="flex items-center gap-2 px-2 py-1.5 border-b border-border/50 bg-slate-900/95 sticky top-0 z-30">
          <SidebarTrigger className="text-white/70 hover:text-white" data-testid="button-sidebar-toggle" />
          <div className="flex-1" />
          {saveStatus === "saving" && (
            <span className="flex items-center gap-1 text-[11px] text-white/60" data-testid="save-status">
              <Loader2 className="w-3 h-3 animate-spin" />Saving…
            </span>
          )}
          {saveStatus === "saved" && (
            <span className="flex items-center gap-1 text-[11px] text-green-400" data-testid="save-status">
              <CheckCircle2 className="w-3 h-3" />Saved
            </span>
          )}
          {saveStatus === "pending" && (
            <span className="text-[11px] text-white/40" data-testid="save-status">Unsaved changes</span>
          )}
          {saveStatus === "error" && (
            <span className="flex items-center gap-1 text-[11px] text-red-400" data-testid="save-status">
              <AlertTriangle className="w-3 h-3" />Save failed — retrying
            </span>
          )}
          {installPromptEvent && !isAppInstalled && (
            <Button
              variant="ghost"
              size="sm"
              onClick={async () => {
                installPromptEvent.prompt();
                const { outcome } = await installPromptEvent.userChoice;
                if (outcome === "accepted") { setIsAppInstalled(true); setInstallPromptEvent(null); }
              }}
              className="h-6 px-2 text-[11px] text-orange-400 hover:text-orange-300 hover:bg-orange-400/10 border border-orange-400/30 rounded gap-1"
              data-testid="button-install-pwa"
            >
              <Smartphone className="w-3 h-3" />
              Install App
            </Button>
          )}
        </header>
        {mainContent}
      </div>
    </div>
  );
}

function PageHeader({ title, subtitle, children, bgImage }: { title: string; subtitle?: string; children?: React.ReactNode; bgImage?: string }) {
  return (
    <div className="relative overflow-hidden border-b border-white/10">
      {bgImage && (
        <>
          <img
            src={bgImage}
            alt=""
            className="absolute inset-0 w-full h-full"
            style={{ objectFit: "cover", objectPosition: "center 40%", imageRendering: "auto" }}
            loading="eager"
            decoding="sync"
          />
          <div className="absolute inset-0 bg-gradient-to-r from-slate-900/90 via-slate-900/85 to-slate-800/80" />
        </>
      )}
      <div className={`relative z-10 px-6 py-5 flex items-center justify-between gap-4 flex-wrap ${bgImage ? "" : "bg-background"}`}>
        <div>
          <h2 className={`text-[18px] font-bold tracking-tight ${bgImage ? "text-white" : "text-foreground"}`}>{title}</h2>
          {subtitle && <p className={`text-[13px] mt-0.5 ${bgImage ? "text-white/70" : "text-muted-foreground"}`}>{subtitle}</p>}
        </div>
        {children && <div className="flex items-center gap-2">{children}</div>}
      </div>
    </div>
  );
}

function PageBody({ bgImage, bgImages, children, className }: { bgImage?: string; bgImages?: string[]; children: React.ReactNode; className?: string }) {
  const images = bgImages || (bgImage ? [bgImage, bgImage, bgImage] : []);
  return (
    <div className={`relative min-h-full overflow-hidden ${className || ""}`}>
      {images.length > 0 && (
        <>
          <div className="absolute inset-0" aria-hidden="true">
            <div className="flex flex-col w-full">
              {images.map((src, i) => (
                <img
                  key={i}
                  src={src}
                  alt=""
                  className="w-full h-auto block"
                  style={{ imageRendering: "auto" }}
                  loading="eager"
                  decoding="sync"
                />
              ))}
            </div>
          </div>
          <div className="absolute inset-0 bg-white/[0.30] dark:bg-slate-950/[0.30]" />
        </>
      )}
      <div className="relative z-10">{children}</div>
    </div>
  );
}

async function resolveOneAddress(address: string): Promise<{ lat: number; lng: number } | null> {
  if (!address.trim()) return null;
  try {
    const res = await fetch("/api/places/geocode", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address }),
    });
    const data = await res.json();
    if (data.found && data.lat !== null && data.lng !== null) {
      return { lat: data.lat, lng: data.lng };
    }
    return null;
  } catch {
    return null;
  }
}

async function geocodeShipments(
  ships: Shipment[],
  onProgress: (done: number, total: number) => void
): Promise<{ ships: Shipment[]; failed: string[] }> {
  type GeoTask = { key: string; address: string };
  const tasks: GeoTask[] = [];

  for (const s of ships) {
    if (s.cLat === 0 || s.cLng === 0) {
      const addr = [s.cAddr, s.cSub, s.cCity, s.cPostal, "South Africa"].filter(Boolean).join(", ");
      tasks.push({ key: `c:${s.id}`, address: addr });
    }
    if (s.dLat === 0 || s.dLng === 0) {
      const addr = [s.dAddr, s.dSub, s.dCity, s.dPostal, "South Africa"].filter(Boolean).join(", ");
      tasks.push({ key: `d:${s.id}`, address: addr });
    }
  }

  if (tasks.length === 0) return { ships, failed: [] };

  const BATCH = 5;
  const resolved = new Map<string, { lat: number; lng: number }>();
  const failed: string[] = [];
  let done = 0;

  for (let i = 0; i < tasks.length; i += BATCH) {
    const batch = tasks.slice(i, i + BATCH);
    await Promise.all(
      batch.map(async (task) => {
        const result = await resolveOneAddress(task.address);
        if (result) {
          resolved.set(task.key, result);
        } else {
          failed.push(task.address);
        }
        done++;
        onProgress(done, tasks.length);
      })
    );
  }

  const updatedShips = ships.map((s) => {
    const cFix = resolved.get(`c:${s.id}`);
    const dFix = resolved.get(`d:${s.id}`);
    return {
      ...s,
      cLat: cFix ? cFix.lat : s.cLat,
      cLng: cFix ? cFix.lng : s.cLng,
      dLat: dFix ? dFix.lat : s.dLat,
      dLng: dFix ? dFix.lng : s.dLng,
    };
  });

  return { ships: updatedShips, failed };
}

function mergeCSVWithExisting(csvShips: Shipment[], existingShips: Shipment[]): { merged: Shipment[]; enrichedCount: number; newCount: number } {
  const existingByWb = new Map<string, Shipment>();
  for (const s of existingShips) {
    if (s.wb) existingByWb.set(s.wb, s);
  }

  const merged: Shipment[] = [];
  let enrichedCount = 0;
  let newCount = 0;

  for (const csvShip of csvShips) {
    const existing = csvShip.wb ? existingByWb.get(csvShip.wb) : null;
    const existingSource = existing?.source || "";
    const hasWebhookOrigin = existingSource === "webhook" || existingSource === "csv+webhook" || (existing?.webhookEvents && existing.webhookEvents.length > 0);
    if (existing && hasWebhookOrigin) {
      const enriched: Shipment = {
        ...existing,
        acc: csvShip.acc || existing.acc,
        client: csvShip.client || existing.client,
        clientName: csvShip.clientName || existing.clientName,
        pcs: csvShip.pcs || existing.pcs,
        kg: csvShip.kg || existing.kg,
        svc: csvShip.svc || existing.svc,
        rate: csvShip.rate || existing.rate,
        cAddr: csvShip.cAddr || existing.cAddr,
        cSub: csvShip.cSub || existing.cSub,
        cCity: csvShip.cCity || existing.cCity,
        cPostal: csvShip.cPostal || existing.cPostal,
        cContact: csvShip.cContact || existing.cContact,
        cPhone: csvShip.cPhone || existing.cPhone,
        cEmail: csvShip.cEmail || existing.cEmail,
        cLat: csvShip.cLat || existing.cLat,
        cLng: csvShip.cLng || existing.cLng,
        cAfter: csvShip.cAfter || existing.cAfter,
        cBefore: csvShip.cBefore || existing.cBefore,
        dAddr: csvShip.dAddr || existing.dAddr,
        dSub: csvShip.dSub || existing.dSub,
        dCity: csvShip.dCity || existing.dCity,
        dPostal: csvShip.dPostal || existing.dPostal,
        dContact: csvShip.dContact || existing.dContact,
        dPhone: csvShip.dPhone || existing.dPhone,
        dEmail: csvShip.dEmail || existing.dEmail,
        dLat: csvShip.dLat || existing.dLat,
        dLng: csvShip.dLng || existing.dLng,
        dAfter: csvShip.dAfter || existing.dAfter,
        dBefore: csvShip.dBefore || existing.dBefore,
        zone: csvShip.zone || existing.zone,
        tags: csvShip.tags || existing.tags,
        preColDriver: csvShip.preColDriver || existing.preColDriver,
        preDelDriver: csvShip.preDelDriver || existing.preDelDriver,
        parcelType: csvShip.parcelType || existing.parcelType,
        parcelCategory: csvShip.parcelCategory || existing.parcelCategory,
        colDate: csvShip.colDate || existing.colDate,
        delDate: csvShip.delDate || existing.delDate,
        lDelDate: csvShip.lDelDate || existing.lDelDate,
        // CSV is a fresh ShipLogic snapshot, so it wins for the status
        // field when it disagrees with a stale terminal status in
        // `existing` (e.g. a dispatcher manually marked the row delivered
        // and the user is now re-importing the CSV to undo it). Keep the
        // existing status only when CSV has no status to share.
        status: (csvShip as any).status || (existing as any).status,
        source: "csv+webhook",
        webhookEvents: existing.webhookEvents || [],
      };
      merged.push(enriched);
      enrichedCount++;
    } else {
      merged.push({ ...csvShip, source: "csv" });
      newCount++;
    }
  }

  return { merged, enrichedCount, newCount };
}

function ImportTab({ csvText, setCsvText, csvResult, setCsvResult, fileRef, ships, allShips, setShips, asgn, setAsgn, setTripSt, setStopSt, runOptimizer, optimizing, log, handleFileDrop, readFile, handleExport, importFileRef, handleImportProject, selectedDay, setSelectedDay, availableDays, csvFileName, fleet, loadClientAccounts, autoInsertNewAccounts, onLoadShipments }: any) {
  const [geocoding, setGeocoding] = useState(false);
  const [geocodingProgress, setGeocodingProgress] = useState<{ done: number; total: number } | null>(null);

  async function loadShipments(shipsToLoad: Shipment[]) {
    const missing = shipsToLoad.filter((s) => s.cLat === 0 || s.cLng === 0 || s.dLat === 0 || s.dLng === 0);
    let finalShips = shipsToLoad;
    if (missing.length > 0) {
      setGeocoding(true);
      setGeocodingProgress({ done: 0, total: missing.length * 2 });
      try {
        const result = await geocodeShipments(shipsToLoad, (done, total) => {
          setGeocodingProgress({ done, total });
        });
        finalShips = result.ships;
        if (result.failed.length > 0) {
          log(`⚠ ${result.failed.length} address(es) could not be resolved — routing may be affected`, "WARN");
        }
      } finally {
        setGeocoding(false);
        setGeocodingProgress(null);
      }
    }
    return finalShips;
  }

  return (
    <ScrollArea className="flex-1">
      <PageHeader title="Import" subtitle="Shipments arrive live from the ShipLogic webhook. Use CSV here only to backfill or top up a project." bgImage={bgImport} />
      <PageBody bgImages={[bgImport, bgDashboard]}>
      <div className="p-6 space-y-5">
        <div
          className="border border-dashed border-white/30 rounded-lg cursor-pointer hover-elevate transition-colors bg-slate-800/60 backdrop-blur-md"
          onClick={() => fileRef.current?.click()}
          onDragOver={(e: React.DragEvent) => e.preventDefault()}
          onDrop={handleFileDrop}
          data-testid="drop-zone"
        >
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <div className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center mb-3">
              <Upload className="w-5 h-5 text-white" />
            </div>
            <p className="text-[13px] font-medium text-white">Drop CSV here or click to browse</p>
            <p className="text-[12px] text-white/60 mt-1">
              ShipLogic format with auto-detection
            </p>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,.txt"
              className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) readFile(f); }}
              data-testid="input-csv-file"
            />
          </div>
        </div>

        <div className="space-y-3">
          <p className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider">Or paste CSV data</p>
          <Textarea
            value={csvText}
            onChange={(e) => setCsvText(e.target.value)}
            placeholder="Paste ShipLogic CSV data here..."
            className="font-mono text-[12px] min-h-[80px] bg-background"
            data-testid="input-csv-paste"
          />
          <div className="flex gap-2 flex-wrap">
            <Button
              onClick={async () => {
                if (csvText.trim()) {
                  const latestMap = await loadClientAccounts();
                  const result = parseShipLogicCSV(csvText, latestMap);
                  setCsvResult(result);
                  if (result.accountCodes.length > 0) autoInsertNewAccounts(result.accountCodes);
                }
              }}
              className="font-bold"
              data-testid="button-parse"
            >
              Parse CSV
            </Button>
            <Button variant="outline" onClick={handleExport} disabled={ships.length === 0} className="font-bold" data-testid="button-export">
              <FileDown className="w-4 h-4 mr-1.5" />
              Export
            </Button>
            <Button variant="outline" onClick={() => importFileRef.current?.click()} className="font-bold" data-testid="button-import-project">
              <FileUp className="w-4 h-4 mr-1.5" />
              Import
            </Button>
            <input
              ref={importFileRef}
              type="file"
              accept=".json"
              className="hidden"
              onChange={handleImportProject}
            />
            <Button
              variant="destructive"
              className="font-bold ml-auto"
              data-testid="button-wipe-all-shipments"
              onClick={async () => {
                const csvCount = (allShips || []).filter((s: any) => {
                  const src = String(s.source || "").toLowerCase();
                  return !src.includes("webhook");
                }).length;
                if (csvCount === 0) {
                  log("No CSV-only shipments to wipe — all active shipments are webhook-sourced.", "SYS");
                  return;
                }
                if (!window.confirm(`Wipe ${csvCount} CSV-imported shipment${csvCount === 1 ? "" : "s"} from every project? Webhook (ShipLogic) shipments are preserved. Cannot be undone.`)) return;
                try {
                  const resp = await fetch("/api/dispatch/wipe-shipments", { method: "POST", credentials: "include" });
                  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
                  const data = await resp.json();
                  setCsvResult(null);
                  setCsvText("");
                  log(`Wiped ${data.shipmentsRemoved} CSV shipments, kept ${data.shipmentsKept} webhook shipments across ${data.projectsTouched} projects`, "SYS");
                  setTimeout(() => window.location.reload(), 400);
                } catch (e: any) {
                  log(`Wipe failed: ${e.message}`, "ERR");
                }
              }}
            >
              <AlertTriangle className="w-4 h-4 mr-1.5" />
              Wipe CSV
            </Button>
          </div>
        </div>

        {csvResult && (() => {
          const gpsErrors = csvResult.warnings.filter((w: string) => w.includes("outside South Africa"));
          const needsGeocode = csvResult.ships.filter((s: any) => s.cLat === 0 || s.cLng === 0 || s.dLat === 0 || s.dLng === 0).length;
          return (
            <>
              {gpsErrors.length > 0 && (
                <div className="rounded-lg border border-red-200 dark:border-red-800/50 bg-red-50/50 dark:bg-red-950/20 p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <AlertTriangle className="w-4 h-4 text-red-500" />
                    <span className="text-[13px] font-medium text-red-700 dark:text-red-400">
                      {gpsErrors.length} invalid GPS coordinate{gpsErrors.length !== 1 ? "s" : ""} — ignored
                    </span>
                  </div>
                  <div className="space-y-1">
                    {gpsErrors.slice(0, 3).map((w: string, i: number) => (
                      <p key={i} className="text-[12px] text-red-600 dark:text-red-400">{w}</p>
                    ))}
                    {gpsErrors.length > 3 && (
                      <p className="text-[12px] text-red-500">+{gpsErrors.length - 3} more</p>
                    )}
                  </div>
                </div>
              )}
              {needsGeocode > 0 && (
                <div className="rounded-lg border border-blue-200 dark:border-blue-800/50 bg-blue-50/50 dark:bg-blue-950/20 p-3">
                  <div className="flex items-center gap-2">
                    <MapPin className="w-4 h-4 text-blue-500 shrink-0" />
                    <span className="text-[12px] text-blue-700 dark:text-blue-300">
                      <strong>{needsGeocode}</strong> address{needsGeocode !== 1 ? "es" : ""} will be geocoded via Google Places when you click Load — coordinates are resolved automatically for all South African locations.
                    </span>
                  </div>
                </div>
              )}
            </>
          );
        })()}

        {csvResult && csvResult.ships.length > 0 && (() => {
          const byDate: Record<string, any[]> = {};
          csvResult.ships.forEach((s: any) => { const d = s.delDate || s.colDate || "unknown"; if (!byDate[d]) byDate[d] = []; byDate[d].push(s); });
          const dates = Object.keys(byDate).sort();
          const multiDay = dates.length > 1;

          return (
            <Card>
              <CardHeader className="flex flex-row items-center justify-between gap-2 pb-3 flex-wrap">
                <div>
                  <span className="text-[15px] font-semibold">{csvResult.ships.length} shipments</span>
                  {multiDay && <span className="text-[12px] text-muted-foreground ml-2">across {dates.length} days</span>}
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  {geocoding && geocodingProgress && (
                    <span className="text-[11px] text-amber-600 dark:text-amber-400 flex items-center gap-1">
                      <Loader2 className="w-3 h-3 animate-spin" />
                      Geocoding {geocodingProgress.done}/{geocodingProgress.total}…
                    </span>
                  )}
                  {optimizing && (
                    <span className="text-[11px] text-blue-600 dark:text-blue-400 flex items-center gap-1">
                      <Loader2 className="w-3 h-3 animate-spin" />
                      Optimizing…
                    </span>
                  )}
                  <Button
                    disabled={geocoding || optimizing}
                    onClick={async () => {
                      const { merged, enrichedCount } = mergeCSVWithExisting(csvResult.ships, allShips);
                      const finalShips = await loadShipments(merged);
                      const hasPreAssign = finalShips.some((s: Shipment) => s.preColDriver || s.preDelDriver);
                      setShips(finalShips);
                      setSelectedDay("all");
                      setAsgn({});
                      setStopSt({});
                      setTripSt(Object.fromEntries(fleet.map((d: any) => [d.id, "DRAFT"])));
                      const mergeMsg = enrichedCount > 0 ? ` (${enrichedCount} merged with webhook data)` : "";
                      log("Imported " + finalShips.length + " shipments" + mergeMsg + (multiDay ? ` across ${dates.length} days` : ""), "SYS");
                      onLoadShipments?.(finalShips);
                      runOptimizer(finalShips, hasPreAssign, false, null);
                    }}
                    className="font-bold"
                    data-testid="button-load-all"
                  >
                    {geocoding ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : <Zap className="w-3.5 h-3.5 mr-1.5" />}
                    Load & Optimise All ({csvResult.ships.length})
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                <ScrollArea className="max-h-[65vh]">
                  <div className="overflow-x-auto">
                    <table className="w-full text-[12px]" data-testid="table-csv-preview">
                      <thead>
                        <tr className="border-b border-border bg-muted/30 sticky top-0 z-10">
                          {["WB", "Client", "Col Suburb", "Del Suburb", "Col Time", "Del Time", "Pcs", "kg", "Svc", "Rate", "Geo"].map((h) => (
                            <th key={h} className="px-3 py-2 text-left font-medium text-muted-foreground whitespace-nowrap">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {dates.map((date) => {
                          const dayShips = byDate[date];
                          return [
                            multiDay && (
                              <tr key={`header-${date}`} className="bg-muted/20 border-b border-border">
                                <td colSpan={11} className="px-3 py-2">
                                  <div className="flex items-center justify-between gap-2">
                                    <div className="flex items-center gap-2">
                                      <Clock className="w-3.5 h-3.5 text-muted-foreground" />
                                      <span className="text-[12px] font-medium">{formatDayLabel(date)}</span>
                                      <span className="text-[11px] text-muted-foreground">{dayShips.length} shipments</span>
                                    </div>
                                    <Button
                                      size="sm"
                                      disabled={geocoding || optimizing}
                                      onClick={async () => {
                                        const { merged, enrichedCount } = mergeCSVWithExisting(dayShips, allShips);
                                        const finalShips = await loadShipments(merged);
                                        const hasPreAssign = finalShips.some((s: Shipment) => s.preColDriver || s.preDelDriver);
                                        setShips(finalShips);
                                        setSelectedDay(date);
                                        setAsgn({});
                                        setStopSt({});
                                        setTripSt(Object.fromEntries(fleet.map((d: any) => [d.id, "DRAFT"])));
                                        const mergeMsg = enrichedCount > 0 ? ` (${enrichedCount} merged)` : "";
                                        log(`Imported ${finalShips.length} shipments for ${formatDayLabel(date)}${mergeMsg}`, "SYS");
                                        onLoadShipments?.(finalShips);
                                        runOptimizer(finalShips, hasPreAssign, false, date);
                                      }}
                                      className="font-bold"
                                      data-testid={`button-load-day-${date}`}
                                    >
                                      <Zap className="w-3 h-3 mr-1" />
                                      Load & Optimise {dayShips.length}
                                    </Button>
                                  </div>
                                </td>
                              </tr>
                            ),
                            ...dayShips.map((s: any) => {
                              const cOk = s.cLat !== 0 && s.cLng !== 0;
                              const dOk = s.dLat !== 0 && s.dLng !== 0;
                              const bothOk = cOk && dOk;
                              const neitherOk = !cOk && !dOk;
                              return (
                                <tr key={s.id} className="border-b border-border/50" data-testid={`row-csv-${s.id}`}>
                                  <td className="px-3 py-2 font-mono text-[11px] font-medium">{s.wb}</td>
                                  <td className="px-3 py-2 font-medium">{s.client}</td>
                                  <td className="px-3 py-2 text-muted-foreground">{subCity(s.cSub, s.cCity)}</td>
                                  <td className="px-3 py-2 text-muted-foreground">{subCity(s.dSub, s.dCity)}</td>
                                  <td className="px-3 py-2 font-medium tabular-nums whitespace-nowrap">{s.cAfter}{s.cBefore && s.cBefore !== s.cAfter ? "-" + s.cBefore : ""}</td>
                                  <td className="px-3 py-2 font-medium tabular-nums whitespace-nowrap">{s.dAfter || "?"}-{s.dBefore || "?"}</td>
                                  <td className="px-3 py-2 text-center tabular-nums">{s.pcs}</td>
                                  <td className="px-3 py-2 tabular-nums">{s.kg}</td>
                                  <td className="px-3 py-2">
                                    <Badge variant={s.svc === "SPX" ? "destructive" : "secondary"} className="text-[10px]">{s.svc}</Badge>
                                  </td>
                                  <td className="px-3 py-2 tabular-nums">R{s.rate}</td>
                                  <td className="px-3 py-2">
                                    {bothOk ? (
                                      <span className="flex items-center gap-1 text-green-600 dark:text-green-400" title={`Col: ${s.cLat.toFixed(4)}, ${s.cLng.toFixed(4)} | Del: ${s.dLat.toFixed(4)}, ${s.dLng.toFixed(4)}`}>
                                        <CheckCircle2 className="w-3.5 h-3.5" />
                                        <span className="text-[10px] font-medium">GPS</span>
                                      </span>
                                    ) : neitherOk ? (
                                      <span className="flex items-center gap-1 text-amber-500" title="No GPS — will geocode on load">
                                        <MapPin className="w-3.5 h-3.5" />
                                        <span className="text-[10px] font-medium">Geocode</span>
                                      </span>
                                    ) : (
                                      <span className="flex items-center gap-1 text-amber-500" title={`Partial GPS — ${cOk ? "col OK" : "col missing"}, ${dOk ? "del OK" : "del missing"}`}>
                                        <MapPin className="w-3.5 h-3.5" />
                                        <span className="text-[10px] font-medium">{cOk ? "C✓" : "C?"}/{dOk ? "D✓" : "D?"}</span>
                                      </span>
                                    )}
                                  </td>
                                </tr>
                              );
                            }),
                          ];
                        })}
                      </tbody>
                    </table>
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>
          );
        })()}

        {optimizing && (
          <div className="flex flex-col items-center gap-3 py-10">
            <Loader2 className="w-6 h-6 text-foreground animate-spin" />
            <p className="text-[13px] font-medium">Optimizing routes — taking you to Dashboard…</p>
          </div>
        )}
      </div>
      </PageBody>
    </ScrollArea>
  );
}

function InsightIcon({ cat }: { cat: InsightCategory }) {
  switch (cat) {
    case "road": return <Navigation className="w-3.5 h-3.5" />;
    case "fuel": return <Fuel className="w-3.5 h-3.5" />;
    case "punctuality": return <Clock className="w-3.5 h-3.5" />;
    case "capacity": return <Gauge className="w-3.5 h-3.5" />;
    case "alternative": return <ArrowRightLeft className="w-3.5 h-3.5" />;
    default: return <Lightbulb className="w-3.5 h-3.5" />;
  }
}

function insightSevColor(sev: string): string {
  switch (sev) {
    case "warning": return "text-red-500 dark:text-red-400";
    case "tip": return "text-amber-500 dark:text-amber-400";
    case "success": return "text-green-600 dark:text-green-400";
    default: return "text-blue-500 dark:text-blue-400";
  }
}

function insightSevBg(sev: string): string {
  switch (sev) {
    case "warning": return "bg-red-50 dark:bg-red-900/15";
    case "tip": return "bg-amber-50 dark:bg-amber-900/15";
    case "success": return "bg-green-50 dark:bg-green-900/15";
    default: return "bg-blue-50 dark:bg-blue-900/15";
  }
}

function insightCatLabel(cat: InsightCategory): string {
  switch (cat) {
    case "road": return "Route";
    case "fuel": return "Fuel";
    case "punctuality": return "Time";
    case "capacity": return "Capacity";
    case "alternative": return "Alt";
    default: return "Info";
  }
}

function InsightsPanel({ insights, filterDriver }: { insights: Insight[]; filterDriver?: string }) {
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);
  const [catFilter, setCatFilter] = useState<InsightCategory | "all">("all");

  const filtered = useMemo(() => {
    let list = insights;
    if (filterDriver) list = list.filter((i) => i.driver === filterDriver);
    if (catFilter !== "all") list = list.filter((i) => i.cat === catFilter);
    return list;
  }, [insights, filterDriver, catFilter]);

  const cats = useMemo(() => {
    const base = filterDriver ? insights.filter((i) => i.driver === filterDriver) : insights;
    const s = new Set<InsightCategory>();
    base.forEach((i) => s.add(i.cat));
    return Array.from(s);
  }, [insights, filterDriver]);

  if (!insights.length) return null;

  return (
    <div className="space-y-2" data-testid="insights-panel">
      <div className="flex items-center gap-2 flex-wrap">
        <Button
          variant={catFilter === "all" ? "secondary" : "ghost"}
          size="sm"
          onClick={() => setCatFilter("all")}
          data-testid="button-filter-all"
          className="text-[11px] toggle-elevate"
        >
          All ({(filterDriver ? insights.filter((i) => i.driver === filterDriver) : insights).length})
        </Button>
        {cats.map((cat) => {
          const count = (filterDriver ? insights.filter((i) => i.driver === filterDriver) : insights).filter((i) => i.cat === cat).length;
          return (
            <Button
              key={cat}
              variant={catFilter === cat ? "secondary" : "ghost"}
              size="sm"
              onClick={() => setCatFilter(cat)}
              data-testid={`button-filter-${cat}`}
              className="text-[11px] toggle-elevate gap-1"
            >
              <InsightIcon cat={cat} />
              {insightCatLabel(cat)} ({count})
            </Button>
          );
        })}
      </div>
      <div className="space-y-1.5">
        {filtered.map((insight, idx) => {
          const isExpanded = expandedIdx === idx;
          return (
            <div
              key={idx}
              role="button"
              tabIndex={0}
              className={`rounded-md p-2.5 cursor-pointer ${insightSevBg(insight.sev)}`}
              onClick={() => setExpandedIdx(isExpanded ? null : idx)}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") setExpandedIdx(isExpanded ? null : idx); }}
              data-testid={`insight-${idx}`}
            >
              <div className="flex items-start gap-2">
                <div className={`mt-0.5 flex-shrink-0 ${insightSevColor(insight.sev)}`}>
                  <InsightIcon cat={insight.cat} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-[12px] font-medium">{insight.title}</span>
                    <Badge variant="secondary" className="text-[9px] no-default-active-elevate no-default-hover-elevate">
                      {insightCatLabel(insight.cat)}
                    </Badge>
                  </div>
                  {isExpanded && (
                    <p className="text-[11px] text-muted-foreground mt-1.5 leading-relaxed">{insight.detail}</p>
                  )}
                </div>
                <ChevronDown className={`w-3.5 h-3.5 text-muted-foreground flex-shrink-0 mt-0.5 transition-transform ${isExpanded ? "rotate-180" : ""}`} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function TrafficPanel({ driverTraffic, trafficStatus, onRefresh, now }: { driverTraffic: Map<string, DriverTrafficData>; trafficStatus: TrafficStatus; onRefresh: () => void; now?: number }) {
  const [expanded, setExpanded] = useState(false);

  const congestionColor = (level: string) => {
    switch (level) {
      case "STANDSTILL": return "text-red-500";
      case "HEAVY": return "text-orange-500";
      case "SLOW": return "text-yellow-500";
      default: return "text-green-500";
    }
  };

  const congestionBg = (level: string) => {
    switch (level) {
      case "STANDSTILL": return "bg-red-500/10 border-red-500/30 text-red-700 dark:text-red-400";
      case "HEAVY": return "bg-orange-500/10 border-orange-500/30 text-orange-700 dark:text-orange-400";
      case "SLOW": return "bg-yellow-500/10 border-yellow-500/30 text-yellow-700 dark:text-yellow-400";
      default: return "bg-green-500/10 border-green-500/30 text-green-700 dark:text-green-400";
    }
  };

  if (!trafficStatus.enabled) return null;

  const entries = Array.from(driverTraffic.entries());
  const totalDelay = entries.reduce((sum, [, d]) => sum + d.totalDelayMin, 0);
  const worstOverall = entries.reduce((w, [, d]) => {
    const levels = ["NORMAL", "SLOW", "HEAVY", "STANDSTILL"];
    return levels.indexOf(d.worstCongestion) > levels.indexOf(w) ? d.worstCongestion : w;
  }, "NORMAL" as string);

  return (
    <Card className="mb-4">
      <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2 cursor-pointer" onClick={() => setExpanded(!expanded)}>
        <div className="flex items-center gap-2">
          <Activity className={`w-4 h-4 ${congestionColor(worstOverall)}`} />
          <span className="font-bold text-sm">Live Traffic</span>
          {totalDelay > 0 && (
            <Badge variant="outline" className={congestionBg(worstOverall)} data-testid="badge-traffic-delay">
              +{Math.round(totalDelay)}min delay
            </Badge>
          )}
          {totalDelay === 0 && entries.length > 0 && (
            <Badge variant="outline" className={congestionBg("NORMAL")} data-testid="badge-traffic-clear">
              Clear roads
            </Badge>
          )}
          {trafficStatus.isRefreshing && (
            <RefreshCw className="w-3 h-3 animate-spin text-muted-foreground" />
          )}
        </div>
        <div className="flex items-center gap-2">
          {trafficStatus.lastRefresh && (() => {
            const elapsed = (now ?? Date.now()) - trafficStatus.lastRefresh;
            const secsAgo = Math.round(elapsed / 1000);
            const nextIn = Math.max(0, 60 - secsAgo);
            return (
              <span className="text-xs text-muted-foreground tabular-nums">
                {secsAgo < 60 ? `${secsAgo}s ago` : `${Math.round(secsAgo / 60)}m ago`} · next in {nextIn}s
              </span>
            );
          })()}
          <Button size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); onRefresh(); }} disabled={trafficStatus.isRefreshing} data-testid="button-refresh-traffic">
            <RefreshCw className="w-3 h-3 mr-1" />
            Refresh
          </Button>
          {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        </div>
      </CardHeader>
      {expanded && (
        <CardContent className="pt-0">
          {entries.length === 0 ? (
            <p className="text-sm text-muted-foreground">No traffic data yet. Click Refresh or wait for auto-update.</p>
          ) : (
            <div className="space-y-3">
              {entries.map(([driverId, dd]) => (
                <div key={driverId} className="space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-sm">{driverId}</span>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className={congestionBg(dd.worstCongestion)} data-testid={`badge-congestion-${driverId}`}>
                        {dd.worstCongestion}
                      </Badge>
                      {dd.totalDelayMin > 0 && (
                        <span className="text-xs text-muted-foreground">+{Math.round(dd.totalDelayMin)}min</span>
                      )}
                    </div>
                  </div>
                  <div className="space-y-0.5">
                    {dd.legDetails.map((leg, i) => (
                      <div key={i} className="flex items-center gap-2 text-xs text-muted-foreground">
                        <span className={`w-2 h-2 rounded-full flex-shrink-0 ${
                          leg.congestion === "STANDSTILL" ? "bg-red-500" :
                          leg.congestion === "HEAVY" ? "bg-orange-500" :
                          leg.congestion === "SLOW" ? "bg-yellow-500" : "bg-green-500"
                        }`} />
                        <span className="truncate flex-1">{leg.fromLabel} &rarr; {leg.toLabel}</span>
                        <span className="flex-shrink-0">{leg.trafficMin}min</span>
                        {leg.delayMin > 0 && (
                          <span className="text-orange-500 flex-shrink-0">(+{leg.delayMin})</span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      )}
    </Card>
  );
}

const HISTORICAL_PATTERNS: { corridorId: string; morningPeak: string; eveningPeak: string; bestWindow: string; avgDelayPeakMin: number; avgDelayOffPeakMin: number; saturdayNote: string }[] = [
  { corridorId: "n1_south", morningPeak: "06:30-08:30", eveningPeak: "16:00-18:30", bestWindow: "09:00-15:00", avgDelayPeakMin: 15, avgDelayOffPeakMin: 3, saturdayNote: "Generally clear, light traffic after 10:00" },
  { corridorId: "n4_west", morningPeak: "07:00-09:00", eveningPeak: "16:00-17:30", bestWindow: "10:00-15:00", avgDelayPeakMin: 10, avgDelayOffPeakMin: 2, saturdayNote: "Minimal delays, truck traffic reduced" },
  { corridorId: "garsfontein", morningPeak: "07:00-08:30", eveningPeak: "16:00-17:30", bestWindow: "09:00-15:00", avgDelayPeakMin: 8, avgDelayOffPeakMin: 2, saturdayNote: "School traffic absent, mostly clear" },
  { corridorId: "r21", morningPeak: "06:00-09:00", eveningPeak: "16:00-18:00", bestWindow: "10:00-15:30", avgDelayPeakMin: 12, avgDelayOffPeakMin: 3, saturdayNote: "Airport traffic lighter, moderate flow" },
  { corridorId: "church_st", morningPeak: "07:30-09:00", eveningPeak: "16:00-17:00", bestWindow: "10:00-15:00", avgDelayPeakMin: 8, avgDelayOffPeakMin: 2, saturdayNote: "CBD quiet, street parking easier" },
  { corridorId: "n14", morningPeak: "06:30-08:30", eveningPeak: "16:00-18:00", bestWindow: "09:30-15:00", avgDelayPeakMin: 12, avgDelayOffPeakMin: 4, saturdayNote: "Construction still affects flow, plan +5min" },
  { corridorId: "zambezi", morningPeak: "07:00-08:00", eveningPeak: "14:00-15:00", bestWindow: "09:00-13:00", avgDelayPeakMin: 5, avgDelayOffPeakMin: 1, saturdayNote: "Very quiet, no school traffic" },
];

function SpeedFlowBar({ readings }: { readings?: LegSpeedReading[] }) {
  if (!readings || readings.length === 0) return null;
  const totalFraction = readings.reduce((s, r) => s + r.fraction, 0) || 1;
  return (
    <div className="flex h-1.5 rounded-full overflow-hidden w-full" data-testid="speed-flow-bar">
      {readings.map((r, i) => {
        const pct = Math.max((r.fraction / totalFraction) * 100, 2);
        const bg = r.speed === "TRAFFIC_JAM" ? "bg-red-500" : r.speed === "SLOW" ? "bg-yellow-500" : "bg-green-500";
        return <div key={i} className={`${bg}`} style={{ width: `${pct}%` }} />;
      })}
    </div>
  );
}

function TrafficTab({ tl, ships, fleet, driverTraffic, trafficStatus, refreshTraffic, selectedDay, userReports, setUserReports }: { tl: Record<string, TripData>; ships: Shipment[]; fleet: any[]; driverTraffic: Map<string, DriverTrafficData>; trafficStatus: TrafficStatus; refreshTraffic: () => void; selectedDay: string; userReports: TrafficReport[]; setUserReports: (reports: TrafficReport[]) => void }) {
  const { toast } = useToast();
  const [corridorData, setCorridorData] = useState<CorridorTrafficResult[]>([]);
  const [loadingCorridors, setLoadingCorridors] = useState(false);
  const [lastCorridorRefresh, setLastCorridorRefresh] = useState<number | null>(null);
  const [filterDriver, setFilterDriver] = useState<string>("all");
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({ flow: true, incidents: true, corridors: true, history: false, roads: false, report: false, userReports: true });
  const [roadSearch, setRoadSearch] = useState("");
  const [reportRoadSearch, setReportRoadSearch] = useState("");
  const [reportSelectedRoad, setReportSelectedRoad] = useState<GautengRoad | null>(null);
  const [reportCategory, setReportCategory] = useState<"traffic" | "condition">("traffic");
  const [reportType, setReportType] = useState("");
  const [reportSeverity, setReportSeverity] = useState<"high" | "medium" | "low">("medium");
  const [reportNotes, setReportNotes] = useState("");
  const [showRoadDropdown, setShowRoadDropdown] = useState(false);

  const filteredRoads = useMemo(() => searchRoads(roadSearch), [roadSearch]);
  const reportRoadResults = useMemo(() => {
    if (!reportRoadSearch || reportRoadSearch.trim().length < 2) return [];
    return searchRoads(reportRoadSearch).slice(0, 8);
  }, [reportRoadSearch]);

  const roadTypeBadge = (type: string) => {
    switch (type) {
      case "national": return "bg-blue-500/10 border-blue-500/30 text-blue-700 dark:text-blue-400";
      case "regional": return "bg-purple-500/10 border-purple-500/30 text-purple-700 dark:text-purple-400";
      case "city": return "bg-emerald-500/10 border-emerald-500/30 text-emerald-700 dark:text-emerald-400";
      case "rural": return "bg-amber-500/10 border-amber-500/30 text-amber-700 dark:text-amber-400";
      default: return "";
    }
  };

  const severityBadge = (sev: string) => {
    switch (sev) {
      case "high": return "bg-red-500/10 border-red-500/30 text-red-700 dark:text-red-400";
      case "medium": return "bg-orange-500/10 border-orange-500/30 text-orange-700 dark:text-orange-400";
      case "low": return "bg-yellow-500/10 border-yellow-500/30 text-yellow-700 dark:text-yellow-400";
      default: return "";
    }
  };

  const trafficTypeOptions = ["Heavy Traffic", "Standstill", "Accident", "Road Closure", "Flooding"];
  const conditionTypeOptions = ["Potholes", "Gravel Road", "Muddy Road", "Construction Debris", "Poor Visibility"];

  const handleSubmitReport = () => {
    if (!reportSelectedRoad || !reportType) {
      toast({ title: "Missing fields", description: "Please select a road and report type", variant: "destructive" });
      return;
    }
    const newReport: TrafficReport = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
      roadId: reportSelectedRoad.id,
      roadName: reportSelectedRoad.name,
      category: reportCategory,
      type: reportType,
      severity: reportSeverity,
      notes: reportNotes,
      reportedAt: new Date().toISOString(),
      active: true,
    };
    setUserReports([newReport, ...userReports]);
    setReportSelectedRoad(null);
    setReportRoadSearch("");
    setReportType("");
    setReportSeverity("medium");
    setReportNotes("");
    setReportCategory("traffic");
    toast({ title: "Report submitted", description: `${newReport.type} on ${newReport.roadName}` });
  };

  const toggleSection = (key: string) => setExpandedSections((prev) => ({ ...prev, [key]: !prev[key] }));

  const suburbsUsed = useMemo(() => {
    const s = new Set<string>();
    Object.values(tl).forEach((td) => {
      td.stops.forEach((stop) => {
        if (stop.sub) s.add(stop.sub.toLowerCase().trim());
      });
    });
    return s;
  }, [tl]);

  const isSaturday = useMemo(() => {
    if (selectedDay && selectedDay !== "all") return new Date(selectedDay + "T00:00:00").getDay() === 6;
    return new Date().getDay() === 6;
  }, [selectedDay]);

  const relevantCorridors = useMemo(() => {
    const corridorSuburbs: Record<string, string[]> = {
      n1_south: ["centurion", "lyttelton", "wierdapark", "wierda park", "eldoraigne", "clubview", "zwartkop", "pierre van ryneveld"],
      n4_west: ["rosslyn", "akasia", "orchards", "the orchards", "karenpark", "annlin"],
      n14: ["midrand", "halfway house", "carlswald", "vorna valley", "noordwyk"],
      garsfontein: ["garsfontein", "moreleta park", "faerie glen", "woodhill", "waterkloof ridge"],
      church_st: ["pretoria central", "sunnyside", "arcadia", "hatfield"],
      r21: ["irene", "rooihuiskraal", "erasmuskloof", "constantia park"],
      zambezi: ["montana", "montana park", "sinoville", "zambezi", "dorandia"],
    };
    return CORRIDOR_PROBES.filter((cp) => {
      const suburbs = corridorSuburbs[cp.id] || [];
      return suburbs.some((sub) => suburbsUsed.has(sub));
    });
  }, [suburbsUsed]);

  const allCorridorsToProbe = useMemo(() => {
    if (relevantCorridors.length === CORRIDOR_PROBES.length) return CORRIDOR_PROBES;
    const relevantIds = new Set(relevantCorridors.map((c) => c.id));
    const others = CORRIDOR_PROBES.filter((c) => !relevantIds.has(c.id));
    return [...relevantCorridors, ...others];
  }, [relevantCorridors]);

  const fetchCorridorTraffic = useCallback(async () => {
    setLoadingCorridors(true);
    try {
      const legs = allCorridorsToProbe.flatMap((c) => [
        { originLat: c.originLat, originLng: c.originLng, destLat: c.destLat, destLng: c.destLng },
        { originLat: c.altOriginLat, originLng: c.altOriginLng, destLat: c.altDestLat, destLng: c.altDestLng },
      ]);
      const res = await fetch("/api/routes/traffic/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ legs }),
      });
      if (!res.ok) throw new Error("Failed");
      const data = await res.json();
      const results: CorridorTrafficResult[] = allCorridorsToProbe.map((c, i) => {
        const mainLeg = data.legs[i * 2];
        const altLeg = data.legs[i * 2 + 1];
        return {
          corridorId: c.id,
          mainRoute: mainLeg && !mainLeg.error ? { durationMin: Math.round(mainLeg.durationMin * 10) / 10, distanceKm: Math.round(mainLeg.distanceKm * 10) / 10, congestion: mainLeg.congestionLevel || "NORMAL", delayMin: Math.round((mainLeg.trafficDelayMin || 0) * 10) / 10 } : null,
          altRoute: altLeg && !altLeg.error ? { durationMin: Math.round(altLeg.durationMin * 10) / 10, distanceKm: Math.round(altLeg.distanceKm * 10) / 10, congestion: altLeg.congestionLevel || "NORMAL", delayMin: Math.round((altLeg.trafficDelayMin || 0) * 10) / 10 } : null,
          error: (mainLeg?.error || altLeg?.error) ? "Partial data" : undefined,
        };
      });
      setCorridorData(results);
      setLastCorridorRefresh(Date.now());
    } catch {
      setCorridorData([]);
    } finally {
      setLoadingCorridors(false);
    }
  }, [allCorridorsToProbe]);

  useEffect(() => {
    if (trafficStatus.enabled) {
      fetchCorridorTraffic();
      const interval = setInterval(fetchCorridorTraffic, 5 * 60 * 1000);
      return () => clearInterval(interval);
    }
  }, [trafficStatus.enabled, fetchCorridorTraffic]);

  const congestionColor = (level: string) => {
    switch (level) {
      case "STANDSTILL": return "text-red-500";
      case "HEAVY": return "text-orange-500";
      case "SLOW": return "text-yellow-500";
      default: return "text-green-500";
    }
  };
  const congestionBg = (level: string) => {
    switch (level) {
      case "STANDSTILL": return "bg-red-500/10 border-red-500/30 text-red-700 dark:text-red-400";
      case "HEAVY": return "bg-orange-500/10 border-orange-500/30 text-orange-700 dark:text-orange-400";
      case "SLOW": return "bg-yellow-500/10 border-yellow-500/30 text-yellow-700 dark:text-yellow-400";
      default: return "bg-green-500/10 border-green-500/30 text-green-700 dark:text-green-400";
    }
  };
  const congestionDot = (level: string) => {
    switch (level) {
      case "STANDSTILL": return "bg-red-500";
      case "HEAVY": return "bg-orange-500";
      case "SLOW": return "bg-yellow-500";
      default: return "bg-green-500";
    }
  };

  const driverEntries = useMemo(() => {
    const entries = Array.from(driverTraffic.entries());
    if (filterDriver === "all") return entries;
    return entries.filter(([id]) => id === filterDriver);
  }, [driverTraffic, filterDriver]);

  const totalDelay = Array.from(driverTraffic.values()).reduce((s, d) => s + d.totalDelayMin, 0);
  const worstOverall = Array.from(driverTraffic.values()).reduce((w, d) => {
    const levels = ["NORMAL", "SLOW", "HEAVY", "STANDSTILL"];
    return levels.indexOf(d.worstCongestion) > levels.indexOf(w) ? d.worstCongestion : w;
  }, "NORMAL" as string);
  const totalLegs = Array.from(driverTraffic.values()).reduce((s, d) => s + d.legDetails.length, 0);
  const congestedLegs = Array.from(driverTraffic.values()).reduce((s, d) => s + d.legDetails.filter((l) => l.congestion !== "NORMAL").length, 0);

  const relevantIds = new Set(relevantCorridors.map((c) => c.id));

  const activeIncidents = useMemo(() => {
    const now = new Date();
    const h = now.getHours();
    const m = now.getMinutes();
    const nowMin = h * 60 + m;

    const dayOfWeek = now.getDay();
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

    return PRETORIA_KNOWN_INCIDENTS.map((inc) => {
      const affectsRoute = inc.affectedSuburbs.some((s) => suburbsUsed.has(s));
      let isActiveNow = true;
      if (inc.timeRestriction) {
        const restriction = inc.timeRestriction.toLowerCase();
        if (restriction.includes("weekday") && isWeekend) {
          isActiveNow = false;
        } else {
          const ranges = inc.timeRestriction.match(/(\d{2}:\d{2})-(\d{2}:\d{2})/g);
          if (ranges && ranges.length > 0) {
            isActiveNow = ranges.some((r) => {
              const [s, e] = r.split("-");
              const [sh, sm] = s.split(":").map(Number);
              const [eh, em] = e.split(":").map(Number);
              return nowMin >= sh * 60 + sm && nowMin <= eh * 60 + em;
            });
          }
        }
      }
      const liveCorridorResult = corridorData.find((cd) => {
        const probe = CORRIDOR_PROBES.find((p) => p.name === inc.corridor || inc.corridor.includes(p.name));
        return probe && cd.corridorId === probe.id;
      });
      const liveDelay = liveCorridorResult?.mainRoute?.delayMin || 0;
      const elevatedSeverity = liveDelay > 5 && inc.severity === "low" ? "medium" as const : liveDelay > 10 && inc.severity === "medium" ? "high" as const : inc.severity;

      return { ...inc, affectsRoute, isActiveNow, liveDelay, elevatedSeverity };
    }).sort((a, b) => {
      if (a.affectsRoute !== b.affectsRoute) return a.affectsRoute ? -1 : 1;
      const sevOrder = { high: 0, medium: 1, low: 2 };
      return sevOrder[a.elevatedSeverity] - sevOrder[b.elevatedSeverity];
    });
  }, [suburbsUsed, corridorData]);

  const [timeWindowTick, setTimeWindowTick] = useState(0);
  useEffect(() => {
    const interval = setInterval(() => setTimeWindowTick((t) => t + 1), 15 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  const currentTimeWindow = useMemo(() => {
    const h = new Date().getHours();
    if (h >= 6 && h < 9) return "morning_peak";
    if (h >= 9 && h < 15) return "off_peak";
    if (h >= 15 && h < 18) return "evening_peak";
    return "off_peak";
  }, [timeWindowTick]);

  return (
    <ScrollArea className="flex-1" data-testid="traffic-tab">
      <PageHeader title="Traffic Updates" subtitle="Live traffic flow, incidents, congestion & historical patterns for your routes" bgImage={bgDashboard}>
        <div className="flex items-center gap-2 flex-wrap">
          {trafficStatus.isRefreshing || loadingCorridors ? (
            <Badge variant="outline" className="bg-white/10 border-white/20 text-white">
              <Loader2 className="w-3 h-3 animate-spin mr-1" />
              Refreshing...
            </Badge>
          ) : trafficStatus.lastRefresh ? (
            <Badge variant="outline" className="bg-white/10 border-white/20 text-white" data-testid="badge-traffic-last-update">
              Updated {Math.round((Date.now() - (lastCorridorRefresh || trafficStatus.lastRefresh)) / 60000)}m ago
            </Badge>
          ) : null}
          <Button size="sm" variant="outline" className="bg-white/10 border-white/20 text-white font-bold" onClick={() => { refreshTraffic(); fetchCorridorTraffic(); }} disabled={trafficStatus.isRefreshing || loadingCorridors} data-testid="button-refresh-all-traffic">
            <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
            Refresh All
          </Button>
        </div>
      </PageHeader>

      <PageBody bgImage={bgDashboard}>
        <div className="p-6 space-y-6">

          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2 pb-3 cursor-pointer" onClick={() => toggleSection("roads")} data-testid="toggle-road-search">
              <div className="flex items-center gap-2 flex-wrap">
                <Search className="w-4 h-4 text-muted-foreground" />
                <span className="font-bold text-sm">Road Search</span>
                <Badge variant="outline">{GAUTENG_ROADS.length} roads</Badge>
              </div>
              {expandedSections.roads ? <ChevronDown className="w-4 h-4 text-muted-foreground" /> : <ChevronRight className="w-4 h-4 text-muted-foreground" />}
            </CardHeader>
            {expandedSections.roads && (
              <CardContent className="pt-0">
                <div className="space-y-3">
                  <Input
                    placeholder="Search roads by name, type, or suburb..."
                    value={roadSearch}
                    onChange={(e) => setRoadSearch(e.target.value)}
                    data-testid="input-road-search"
                  />
                  <div className="rounded-md border overflow-hidden">
                    <table className="w-full text-xs" data-testid="table-road-search">
                      <thead>
                        <tr className="bg-muted/50">
                          <th className="px-3 py-1.5 text-left font-semibold">Road</th>
                          <th className="px-3 py-1.5 text-left font-semibold">Type</th>
                          <th className="px-3 py-1.5 text-left font-semibold">Affected Suburbs</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredRoads.slice(0, 20).map((road) => (
                          <tr key={road.id} className="border-t border-border/50" data-testid={`row-road-${road.id}`}>
                            <td className="px-3 py-1.5 font-medium">{road.name}</td>
                            <td className="px-3 py-1.5">
                              <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${roadTypeBadge(road.type)}`}>{road.type}</Badge>
                            </td>
                            <td className="px-3 py-1.5 text-muted-foreground truncate max-w-[250px]">
                              {road.suburbs ? road.suburbs.join(", ") : "-"}
                            </td>
                          </tr>
                        ))}
                        {filteredRoads.length === 0 && (
                          <tr>
                            <td colSpan={3} className="px-3 py-4 text-center text-muted-foreground">No roads found matching your search</td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                  {filteredRoads.length > 20 && (
                    <p className="text-xs text-muted-foreground text-center">Showing 20 of {filteredRoads.length} results. Refine your search to see more.</p>
                  )}
                </div>
              </CardContent>
            )}
          </Card>

          {!trafficStatus.enabled && (
            <Card>
              <CardContent className="py-8 text-center">
                <Activity className="w-10 h-10 mx-auto text-muted-foreground mb-3" />
                <p className="font-semibold mb-1">Live Traffic Unavailable</p>
                <p className="text-sm text-muted-foreground">Google Routes API key is not configured. Add GOOGLE_ROUTES_API_KEY in your secrets to enable live traffic updates.</p>
              </CardContent>
            </Card>
          )}

          {trafficStatus.enabled && (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                <Card>
                  <CardContent className="py-4 text-center">
                    <Activity className={`w-5 h-5 mx-auto mb-1 ${congestionColor(worstOverall)}`} />
                    <p className="text-lg font-bold">{worstOverall}</p>
                    <p className="text-xs text-muted-foreground">Congestion Level</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="py-4 text-center">
                    <Timer className="w-5 h-5 mx-auto mb-1 text-muted-foreground" />
                    <p className="text-lg font-bold">{totalDelay > 0 ? `+${Math.round(totalDelay)}min` : "0min"}</p>
                    <p className="text-xs text-muted-foreground">Total Delay</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="py-4 text-center">
                    <Route className="w-5 h-5 mx-auto mb-1 text-muted-foreground" />
                    <p className="text-lg font-bold">{totalLegs}</p>
                    <p className="text-xs text-muted-foreground">Route Legs</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="py-4 text-center">
                    <AlertTriangle className={`w-5 h-5 mx-auto mb-1 ${congestedLegs > 0 ? "text-orange-500" : "text-green-500"}`} />
                    <p className="text-lg font-bold">{congestedLegs}</p>
                    <p className="text-xs text-muted-foreground">Slow Legs</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="py-4 text-center">
                    <Siren className={`w-5 h-5 mx-auto mb-1 ${activeIncidents.filter((i) => i.affectsRoute && i.isActiveNow).length > 0 ? "text-red-500" : "text-muted-foreground"}`} />
                    <p className="text-lg font-bold">{activeIncidents.filter((i) => i.affectsRoute && i.isActiveNow).length}</p>
                    <p className="text-xs text-muted-foreground">Active Alerts</p>
                  </CardContent>
                </Card>
              </div>

              <Card>
                <CardHeader className="flex flex-row items-center justify-between gap-2 pb-3 cursor-pointer" onClick={() => toggleSection("flow")}>
                  <div className="flex items-center gap-2">
                    <Gauge className="w-4 h-4 text-muted-foreground" />
                    <span className="font-bold text-sm">Real-Time Traffic Flow</span>
                    {driverEntries.length > 0 && (
                      <Badge variant="outline" className={congestionBg(worstOverall)} data-testid="badge-route-status">
                        {totalDelay > 0 ? `+${Math.round(totalDelay)}min delay` : "Clear roads"}
                      </Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                    <Select value={filterDriver} onValueChange={setFilterDriver} data-testid="select-traffic-driver-filter">
                      <SelectTrigger className="w-[140px]" data-testid="trigger-traffic-driver-filter">
                        <SelectValue placeholder="All Drivers" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Drivers</SelectItem>
                        {fleet.map((d: any) => (
                          <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {expandedSections.flow ? <ChevronDown className="w-4 h-4 text-muted-foreground" /> : <ChevronRight className="w-4 h-4 text-muted-foreground" />}
                  </div>
                </CardHeader>
                {expandedSections.flow && (
                  <CardContent className="pt-0">
                    {driverEntries.length === 0 ? (
                      <div className="text-center py-6">
                        <Route className="w-8 h-8 mx-auto text-muted-foreground mb-2" />
                        <p className="text-sm text-muted-foreground">{ships.length === 0 ? "Import shipments and run the optimizer to see route traffic." : "No traffic data yet. Click Refresh All to load live traffic."}</p>
                      </div>
                    ) : (
                      <div className="space-y-4">
                        {driverEntries.map(([driverId, dd]) => {
                          const driverObj = fleet.find((f: any) => f.id === driverId);
                          const driverName = driverObj?.name || driverId;
                          const avgSpeed = dd.legDetails.length > 0 ? Math.round(dd.legDetails.reduce((s, l) => s + (l.avgSpeedKmh || 0), 0) / dd.legDetails.length) : 0;
                          return (
                            <div key={driverId} className="space-y-2">
                              <div className="flex items-center justify-between gap-2 flex-wrap">
                                <div className="flex items-center gap-2">
                                  <Truck className="w-4 h-4 text-muted-foreground" />
                                  <span className="font-semibold text-sm">{driverName}</span>
                                  <Badge variant="outline" className={congestionBg(dd.worstCongestion)} data-testid={`badge-driver-traffic-${driverId}`}>
                                    {dd.worstCongestion}
                                  </Badge>
                                </div>
                                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                                  <span>{dd.legDetails.length} legs</span>
                                  {avgSpeed > 0 && <span>avg {avgSpeed}km/h</span>}
                                  {dd.totalDelayMin > 0 && (
                                    <span className="text-orange-500 font-semibold">+{Math.round(dd.totalDelayMin)}min</span>
                                  )}
                                </div>
                              </div>
                              <div className="rounded-md border overflow-hidden">
                                <table className="w-full text-xs" data-testid={`table-traffic-${driverId}`}>
                                  <thead>
                                    <tr className="bg-muted/50">
                                      <th className="px-3 py-1.5 text-left font-semibold">Leg</th>
                                      <th className="px-3 py-1.5 text-left font-semibold w-[80px]">Flow</th>
                                      <th className="px-3 py-1.5 text-right font-semibold">Dist</th>
                                      <th className="px-3 py-1.5 text-right font-semibold">Speed</th>
                                      <th className="px-3 py-1.5 text-right font-semibold">ETA</th>
                                      <th className="px-3 py-1.5 text-right font-semibold">Delay</th>
                                      <th className="px-3 py-1.5 text-center font-semibold">Status</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {dd.legDetails.map((leg, i) => (
                                      <tr key={i} className="border-t border-border/50">
                                        <td className="px-3 py-1.5">
                                          <div className="flex items-center gap-1.5">
                                            <span className={`w-2 h-2 rounded-full flex-shrink-0 ${congestionDot(leg.congestion)}`} />
                                            <span className="truncate max-w-[180px]">{leg.fromLabel} &rarr; {leg.toLabel}</span>
                                          </div>
                                        </td>
                                        <td className="px-3 py-1.5">
                                          <SpeedFlowBar readings={leg.speedReadings} />
                                        </td>
                                        <td className="px-3 py-1.5 text-right tabular-nums">{leg.km.toFixed(1)}km</td>
                                        <td className="px-3 py-1.5 text-right tabular-nums">{leg.avgSpeedKmh || "-"}km/h</td>
                                        <td className="px-3 py-1.5 text-right tabular-nums">{Math.round(leg.trafficMin)}min</td>
                                        <td className="px-3 py-1.5 text-right tabular-nums">
                                          {leg.delayMin > 0 ? (
                                            <span className="text-orange-500 font-semibold">+{Math.round(leg.delayMin)}min</span>
                                          ) : (
                                            <span className="text-muted-foreground">-</span>
                                          )}
                                        </td>
                                        <td className="px-3 py-1.5 text-center">
                                          <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${congestionBg(leg.congestion)}`}>{leg.congestion}</Badge>
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </CardContent>
                )}
              </Card>

              <Card>
                <CardHeader className="flex flex-row items-center justify-between gap-2 pb-3 cursor-pointer" onClick={() => toggleSection("incidents")}>
                  <div className="flex items-center gap-2">
                    <Construction className="w-4 h-4 text-muted-foreground" />
                    <span className="font-bold text-sm">Incidents & Road Closures</span>
                    {activeIncidents.filter((i) => i.affectsRoute).length > 0 && (
                      <Badge variant="outline" className="bg-red-500/10 border-red-500/30 text-red-700 dark:text-red-400">
                        {activeIncidents.filter((i) => i.affectsRoute).length} affecting routes
                      </Badge>
                    )}
                  </div>
                  {expandedSections.incidents ? <ChevronDown className="w-4 h-4 text-muted-foreground" /> : <ChevronRight className="w-4 h-4 text-muted-foreground" />}
                </CardHeader>
                {expandedSections.incidents && (
                  <CardContent className="pt-0">
                    <div className="space-y-2">
                      {activeIncidents.map((inc) => {
                        const typeIcon = inc.type === "closure" ? Ban : inc.type === "construction" ? Construction : Siren;
                        const TypeIcon = typeIcon;
                        const sevColor = inc.elevatedSeverity === "high" ? "text-red-500" : inc.elevatedSeverity === "medium" ? "text-orange-500" : "text-yellow-600 dark:text-yellow-400";
                        const sevBg = inc.elevatedSeverity === "high" ? "bg-red-500/10 border-red-500/30" : inc.elevatedSeverity === "medium" ? "bg-orange-500/10 border-orange-500/30" : "bg-yellow-500/10 border-yellow-500/30";
                        return (
                          <div key={inc.id} className={`rounded-md border p-3 ${inc.affectsRoute ? sevBg : ""}`} data-testid={`incident-${inc.id}`}>
                            <div className="flex items-start gap-3">
                              <TypeIcon className={`w-4 h-4 mt-0.5 flex-shrink-0 ${sevColor}`} />
                              <div className="flex-1 space-y-1">
                                <div className="flex items-center justify-between gap-2 flex-wrap">
                                  <div className="flex items-center gap-2">
                                    <span className="font-semibold text-sm">{inc.corridor}</span>
                                    <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${sevBg} ${sevColor}`}>{inc.elevatedSeverity.toUpperCase()}</Badge>
                                    {inc.affectsRoute && <Badge variant="outline" className="text-[10px] px-1.5 py-0 bg-primary/10 border-primary/30 text-primary">On Route</Badge>}
                                    {inc.isActiveNow && <Badge variant="outline" className="text-[10px] px-1.5 py-0 bg-red-500/10 border-red-500/30 text-red-700 dark:text-red-400">Active Now</Badge>}
                                  </div>
                                  {inc.liveDelay > 0 && (
                                    <span className="text-xs text-orange-500 font-semibold">+{inc.liveDelay}min live delay</span>
                                  )}
                                </div>
                                <p className="text-xs text-muted-foreground">{inc.location} &mdash; {inc.description}</p>
                                <div className="flex items-center gap-4 text-xs text-muted-foreground flex-wrap">
                                  {inc.timeRestriction && (
                                    <span className="flex items-center gap-1"><Clock className="w-3 h-3" /> {inc.timeRestriction}</span>
                                  )}
                                  {inc.detour && (
                                    <span className="flex items-center gap-1"><ArrowRightLeft className="w-3 h-3" /> Detour: {inc.detour}</span>
                                  )}
                                </div>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </CardContent>
                )}
              </Card>

              <Card>
                <CardHeader className="flex flex-row items-center justify-between gap-2 pb-3 cursor-pointer" onClick={() => toggleSection("report")} data-testid="toggle-report-form">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Milestone className="w-4 h-4 text-muted-foreground" />
                    <span className="font-bold text-sm">Report Traffic Update</span>
                  </div>
                  {expandedSections.report ? <ChevronDown className="w-4 h-4 text-muted-foreground" /> : <ChevronRight className="w-4 h-4 text-muted-foreground" />}
                </CardHeader>
                {expandedSections.report && (
                  <CardContent className="pt-0">
                    <div className="space-y-4">
                      <div className="space-y-2">
                        <label className="text-xs font-semibold text-muted-foreground">Road</label>
                        <div className="relative">
                          <Input
                            placeholder="Search for a road..."
                            value={reportSelectedRoad ? reportSelectedRoad.name : reportRoadSearch}
                            onChange={(e) => {
                              setReportRoadSearch(e.target.value);
                              setReportSelectedRoad(null);
                              setShowRoadDropdown(true);
                            }}
                            onFocus={() => setShowRoadDropdown(true)}
                            onBlur={() => setTimeout(() => setShowRoadDropdown(false), 200)}
                            data-testid="input-report-road"
                          />
                          {showRoadDropdown && reportRoadResults.length > 0 && !reportSelectedRoad && (
                            <div className="absolute z-20 top-full left-0 right-0 mt-1 rounded-md border bg-popover shadow-md max-h-48 overflow-auto">
                              {reportRoadResults.map((road) => (
                                <button
                                  key={road.id}
                                  className="flex items-center gap-2 w-full px-3 py-2 text-xs text-left hover-elevate cursor-pointer"
                                  onMouseDown={(e) => {
                                    e.preventDefault();
                                    setReportSelectedRoad(road);
                                    setReportRoadSearch(road.name);
                                    setShowRoadDropdown(false);
                                  }}
                                  data-testid={`option-road-${road.id}`}
                                >
                                  <span className="font-medium flex-1">{road.name}</span>
                                  <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${roadTypeBadge(road.type)}`}>{road.type}</Badge>
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        <div className="space-y-2">
                          <label className="text-xs font-semibold text-muted-foreground">Category</label>
                          <Select value={reportCategory} onValueChange={(v) => { setReportCategory(v as "traffic" | "condition"); setReportType(""); }} data-testid="select-report-category">
                            <SelectTrigger data-testid="trigger-report-category">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="traffic">Traffic Condition</SelectItem>
                              <SelectItem value="condition">Road Condition</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>

                        <div className="space-y-2">
                          <label className="text-xs font-semibold text-muted-foreground">Type</label>
                          <Select value={reportType} onValueChange={setReportType} data-testid="select-report-type">
                            <SelectTrigger data-testid="trigger-report-type">
                              <SelectValue placeholder="Select type..." />
                            </SelectTrigger>
                            <SelectContent>
                              {(reportCategory === "traffic" ? trafficTypeOptions : conditionTypeOptions).map((opt) => (
                                <SelectItem key={opt} value={opt}>{opt}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>

                        <div className="space-y-2">
                          <label className="text-xs font-semibold text-muted-foreground">Severity</label>
                          <Select value={reportSeverity} onValueChange={(v) => setReportSeverity(v as "high" | "medium" | "low")} data-testid="select-report-severity">
                            <SelectTrigger data-testid="trigger-report-severity">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="high">High</SelectItem>
                              <SelectItem value="medium">Medium</SelectItem>
                              <SelectItem value="low">Low</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </div>

                      <div className="space-y-2">
                        <label className="text-xs font-semibold text-muted-foreground">Notes (optional)</label>
                        <Textarea
                          placeholder="Additional details about the report..."
                          value={reportNotes}
                          onChange={(e) => setReportNotes(e.target.value)}
                          className="resize-none text-sm"
                          rows={2}
                          data-testid="textarea-report-notes"
                        />
                      </div>

                      <Button onClick={handleSubmitReport} data-testid="button-submit-report">
                        <CheckCircle2 className="w-4 h-4 mr-1.5" />
                        Submit Report
                      </Button>
                    </div>
                  </CardContent>
                )}
              </Card>

              <Card>
                <CardHeader className="flex flex-row items-center justify-between gap-2 pb-3 cursor-pointer" onClick={() => toggleSection("userReports")} data-testid="toggle-user-reports">
                  <div className="flex items-center gap-2 flex-wrap">
                    <AlertTriangle className="w-4 h-4 text-muted-foreground" />
                    <span className="font-bold text-sm">User Reports & Road Conditions</span>
                    {userReports.filter((r) => r.active).length > 0 && (
                      <Badge variant="outline" className="bg-orange-500/10 border-orange-500/30 text-orange-700 dark:text-orange-400">
                        {userReports.filter((r) => r.active).length} active
                      </Badge>
                    )}
                  </div>
                  {expandedSections.userReports ? <ChevronDown className="w-4 h-4 text-muted-foreground" /> : <ChevronRight className="w-4 h-4 text-muted-foreground" />}
                </CardHeader>
                {expandedSections.userReports && (
                  <CardContent className="pt-0">
                    {userReports.length === 0 ? (
                      <div className="text-center py-6">
                        <Milestone className="w-8 h-8 mx-auto text-muted-foreground mb-2" />
                        <p className="text-sm text-muted-foreground">No user reports yet. Use the Report Traffic Update form above to add one.</p>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {userReports.map((report) => {
                          const catColor = report.category === "traffic"
                            ? "bg-orange-500/10 border-orange-500/30"
                            : "bg-yellow-600/10 border-yellow-600/30";
                          const catText = report.category === "traffic"
                            ? "text-orange-700 dark:text-orange-400"
                            : "text-yellow-700 dark:text-yellow-400";
                          return (
                            <div key={report.id} className={`rounded-md border p-3 ${report.active ? catColor : "opacity-50"}`} data-testid={`report-${report.id}`}>
                              <div className="flex items-start gap-3">
                                <div className="flex-1 space-y-1">
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <span className="font-semibold text-sm">{report.roadName}</span>
                                    <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${catColor} ${catText}`}>
                                      {report.type}
                                    </Badge>
                                    <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${severityBadge(report.severity)}`}>
                                      {report.severity.toUpperCase()}
                                    </Badge>
                                    {report.active ? (
                                      <Badge variant="outline" className="text-[10px] px-1.5 py-0 bg-green-500/10 border-green-500/30 text-green-700 dark:text-green-400">Active</Badge>
                                    ) : (
                                      <Badge variant="outline" className="text-[10px] px-1.5 py-0">Inactive</Badge>
                                    )}
                                  </div>
                                  {report.notes && (
                                    <p className="text-xs text-muted-foreground">{report.notes}</p>
                                  )}
                                  <p className="text-[10px] text-muted-foreground">
                                    Reported {new Date(report.reportedAt).toLocaleString()}
                                  </p>
                                </div>
                                <div className="flex items-center gap-1">
                                  <Button
                                    size="icon"
                                    variant="ghost"
                                    onClick={() => {
                                      setUserReports(userReports.map((r) => r.id === report.id ? { ...r, active: !r.active } : r));
                                    }}
                                    data-testid={`button-toggle-report-${report.id}`}
                                  >
                                    {report.active ? <Power className="w-4 h-4 text-green-500" /> : <Power className="w-4 h-4 text-muted-foreground" />}
                                  </Button>
                                  <Button
                                    size="icon"
                                    variant="ghost"
                                    onClick={() => {
                                      setUserReports(userReports.filter((r) => r.id !== report.id));
                                    }}
                                    data-testid={`button-delete-report-${report.id}`}
                                  >
                                    <X className="w-4 h-4 text-muted-foreground" />
                                  </Button>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </CardContent>
                )}
              </Card>

              <Card>
                <CardHeader className="flex flex-row items-center justify-between gap-2 pb-3 cursor-pointer" onClick={() => toggleSection("corridors")}>
                  <div className="flex items-center gap-2">
                    <Waypoints className="w-4 h-4 text-muted-foreground" />
                    <span className="font-bold text-sm">Corridor & Detour Comparison</span>
                  </div>
                  <div className="flex items-center gap-2">
                    {relevantCorridors.length > 0 && (
                      <Badge variant="outline" className="text-xs">{relevantCorridors.length} on your routes</Badge>
                    )}
                    {expandedSections.corridors ? <ChevronDown className="w-4 h-4 text-muted-foreground" /> : <ChevronRight className="w-4 h-4 text-muted-foreground" />}
                  </div>
                </CardHeader>
                {expandedSections.corridors && (
                  <CardContent className="pt-0">
                    {loadingCorridors && corridorData.length === 0 ? (
                      <div className="text-center py-6">
                        <Loader2 className="w-6 h-6 mx-auto animate-spin text-muted-foreground mb-2" />
                        <p className="text-sm text-muted-foreground">Loading corridor traffic...</p>
                      </div>
                    ) : corridorData.length === 0 ? (
                      <p className="text-sm text-muted-foreground text-center py-4">Click Refresh All to load corridor traffic data.</p>
                    ) : (
                      <div className="space-y-3">
                        {allCorridorsToProbe.map((corridor) => {
                          const result = corridorData.find((r) => r.corridorId === corridor.id);
                          const isRelevant = relevantIds.has(corridor.id);
                          if (!result) return null;
                          const mainBetter = result.mainRoute && result.altRoute && result.mainRoute.durationMin <= result.altRoute.durationMin;
                          const savings = result.mainRoute && result.altRoute ? Math.round(Math.abs(result.mainRoute.durationMin - result.altRoute.durationMin)) : 0;
                          return (
                            <div key={corridor.id} className={`rounded-md border p-3 space-y-2 ${isRelevant ? "border-primary/30 bg-primary/5" : ""}`} data-testid={`corridor-${corridor.id}`}>
                              <div className="flex items-center justify-between gap-2 flex-wrap">
                                <div className="flex items-center gap-2">
                                  <span className="font-semibold text-sm">{corridor.name}</span>
                                  {isRelevant && (
                                    <Badge variant="outline" className="text-[10px] px-1.5 py-0 bg-primary/10 border-primary/30 text-primary">On Route</Badge>
                                  )}
                                  {result.mainRoute && (
                                    <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${congestionBg(result.mainRoute.congestion)}`}>{result.mainRoute.congestion}</Badge>
                                  )}
                                </div>
                                <span className="text-xs text-muted-foreground">{corridor.description}</span>
                              </div>
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                {result.mainRoute && (
                                  <div className={`rounded border p-2 text-xs ${mainBetter ? "border-green-500/30 bg-green-500/5" : result.altRoute ? "border-orange-500/30 bg-orange-500/5" : ""}`}>
                                    <div className="flex items-center justify-between gap-2 mb-1">
                                      <span className="font-semibold flex items-center gap-1">
                                        <span className={`w-2 h-2 rounded-full ${congestionDot(result.mainRoute.congestion)}`} />
                                        Main Route
                                      </span>
                                      {mainBetter && savings > 0 && <Badge variant="outline" className="text-[9px] px-1 py-0 bg-green-500/10 border-green-500/30 text-green-700 dark:text-green-400">Faster</Badge>}
                                    </div>
                                    <div className="flex items-center gap-3 text-muted-foreground">
                                      <span className="tabular-nums">{result.mainRoute.distanceKm}km</span>
                                      <span className="tabular-nums">{result.mainRoute.durationMin}min</span>
                                      {result.mainRoute.delayMin > 0 && <span className="text-orange-500 tabular-nums">+{result.mainRoute.delayMin}min</span>}
                                    </div>
                                  </div>
                                )}
                                {result.altRoute && (
                                  <div className={`rounded border p-2 text-xs ${!mainBetter ? "border-green-500/30 bg-green-500/5" : "border-border/50"}`}>
                                    <div className="flex items-center justify-between gap-2 mb-1">
                                      <span className="font-semibold flex items-center gap-1">
                                        <span className={`w-2 h-2 rounded-full ${congestionDot(result.altRoute.congestion)}`} />
                                        {corridor.altRoute}
                                      </span>
                                      {!mainBetter && savings > 0 && <Badge variant="outline" className="text-[9px] px-1 py-0 bg-green-500/10 border-green-500/30 text-green-700 dark:text-green-400">Faster ({savings}min)</Badge>}
                                    </div>
                                    <div className="flex items-center gap-3 text-muted-foreground">
                                      <span className="tabular-nums">{result.altRoute.distanceKm}km</span>
                                      <span className="tabular-nums">{result.altRoute.durationMin}min</span>
                                      {result.altRoute.delayMin > 0 && <span className="text-orange-500 tabular-nums">+{result.altRoute.delayMin}min</span>}
                                    </div>
                                  </div>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </CardContent>
                )}
              </Card>

              <Card>
                <CardHeader className="flex flex-row items-center justify-between gap-2 pb-3 cursor-pointer" onClick={() => toggleSection("history")}>
                  <div className="flex items-center gap-2">
                    <History className="w-4 h-4 text-muted-foreground" />
                    <span className="font-bold text-sm">Historical Traffic Patterns</span>
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                      {currentTimeWindow === "morning_peak" ? "Morning Peak" : currentTimeWindow === "evening_peak" ? "Evening Peak" : "Off-Peak"} now
                    </Badge>
                  </div>
                  {expandedSections.history ? <ChevronDown className="w-4 h-4 text-muted-foreground" /> : <ChevronRight className="w-4 h-4 text-muted-foreground" />}
                </CardHeader>
                {expandedSections.history && (
                  <CardContent className="pt-0">
                    <div className="rounded-md border overflow-hidden">
                      <table className="w-full text-xs" data-testid="table-historical-patterns">
                        <thead>
                          <tr className="bg-muted/50">
                            <th className="px-3 py-2 text-left font-semibold">Corridor</th>
                            <th className="px-3 py-2 text-center font-semibold">AM Peak</th>
                            <th className="px-3 py-2 text-center font-semibold">PM Peak</th>
                            <th className="px-3 py-2 text-center font-semibold">Best Window</th>
                            <th className="px-3 py-2 text-right font-semibold">Peak Delay</th>
                            <th className="px-3 py-2 text-right font-semibold">Off-Peak</th>
                            <th className="px-3 py-2 text-left font-semibold">{isSaturday ? "Saturday" : "Sat Note"}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {HISTORICAL_PATTERNS.map((hp) => {
                            const probe = CORRIDOR_PROBES.find((p) => p.id === hp.corridorId);
                            const isRelevant2 = relevantIds.has(hp.corridorId);
                            const liveResult = corridorData.find((r) => r.corridorId === hp.corridorId);
                            const liveDelay = liveResult?.mainRoute?.delayMin || 0;
                            const aboveHistorical = currentTimeWindow.includes("peak") ? liveDelay > hp.avgDelayPeakMin : liveDelay > hp.avgDelayOffPeakMin;
                            return (
                              <tr key={hp.corridorId} className={`border-t border-border/50 ${isRelevant2 ? "bg-primary/5" : ""}`}>
                                <td className="px-3 py-2">
                                  <div className="flex items-center gap-1.5">
                                    <span className="font-semibold">{probe?.name || hp.corridorId}</span>
                                    {isRelevant2 && <Badge variant="outline" className="text-[9px] px-1 py-0 bg-primary/10 border-primary/30 text-primary">On Route</Badge>}
                                  </div>
                                </td>
                                <td className={`px-3 py-2 text-center ${currentTimeWindow === "morning_peak" ? "font-bold" : ""}`}>
                                  {hp.morningPeak}
                                </td>
                                <td className={`px-3 py-2 text-center ${currentTimeWindow === "evening_peak" ? "font-bold" : ""}`}>
                                  {hp.eveningPeak}
                                </td>
                                <td className={`px-3 py-2 text-center ${currentTimeWindow === "off_peak" ? "font-bold text-green-600 dark:text-green-400" : ""}`}>
                                  {hp.bestWindow}
                                </td>
                                <td className="px-3 py-2 text-right tabular-nums">
                                  <span className="text-orange-500">+{hp.avgDelayPeakMin}min</span>
                                  {aboveHistorical && liveDelay > 0 && (
                                    <span className="ml-1 text-red-500 text-[10px]">(live +{Math.round(liveDelay)})</span>
                                  )}
                                </td>
                                <td className="px-3 py-2 text-right tabular-nums text-green-600 dark:text-green-400">
                                  +{hp.avgDelayOffPeakMin}min
                                </td>
                                <td className="px-3 py-2 text-muted-foreground max-w-[180px] truncate">{hp.saturdayNote}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                    <div className="mt-3 flex items-center gap-4 text-xs text-muted-foreground flex-wrap">
                      <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-green-500" /> Normal flow</span>
                      <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-yellow-500" /> Slow</span>
                      <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-orange-500" /> Heavy</span>
                      <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-500" /> Standstill</span>
                      <span className="ml-auto">Data based on typical Pretoria traffic patterns</span>
                    </div>
                  </CardContent>
                )}
              </Card>
            </>
          )}
        </div>
      </PageBody>
    </ScrollArea>
  );
}

export function DriverDetailModal({ open, onClose, trip, ships, asgn, setAsgn, fleet, fleetSettings, log, driverPhoneMap, onMoveStop, onMergeStop, onSplitStop, isLocked, deliveryOverrides, onSetDeliveryOverride, onClearDeliveryOverride, collectionOverrides, onSetCollectionOverride, onClearCollectionOverride }: { open: boolean; onClose: () => void; trip: TripData | null; ships: Shipment[]; asgn: Record<string, string>; setAsgn: (fn: (prev: Record<string, string>) => Record<string, string>) => void; fleet: any[]; fleetSettings: FleetSettings; log: (msg: string, type?: string) => void; driverPhoneMap?: Record<string, string>; onMoveStop?: (driverId: string, fromIdx: number, toIdx: number) => void; onMergeStop?: (driverId: string, idx: number) => void; onSplitStop?: (driverId: string, idx: number) => void; isLocked?: boolean; deliveryOverrides?: DeliveryOverrides; onSetDeliveryOverride?: (shipmentId: string, dAfter: string, dBefore: string, pinnedTime?: string) => void; onClearDeliveryOverride?: (shipmentId: string) => void; collectionOverrides?: CollectionOverrides; onSetCollectionOverride?: (shipmentId: string, cAfter: string, cBefore: string, pinnedTime?: string) => void; onClearCollectionOverride?: (shipmentId: string) => void }) {
  const [overrideShipment, setOverrideShipment] = useState<{ ship: Shipment; kind: "C" | "D" } | null>(null);
  if (!trip) return null;
  const d = trip.driver;
  const st = trip.stats;
  const driverPhone = driverPhoneMap?.[d.name.toLowerCase().trim()];
  const driverShips = ships.filter((s) => asgn[s.id] === d.id);
  const profile = fleetSettings.drivers.find((p) => p.id === d.id);
  const tankRange = profile ? Math.round((45 / (profile.fuelPer100 * fleetSettings.cityFactor / 100)) * 0.75) : 300;

  const fuelStops: { afterStop: number; cumKm: number; location: string }[] = [];
  let cumKm = 0;
  let lastFuelKm = 0;
  trip.stops.forEach((stop, i) => {
    cumKm += stop.legKm;
    if (cumKm - lastFuelKm >= tankRange && stop.type !== "RTN" && i < trip.stops.length - 1) {
      fuelStops.push({ afterStop: stop.seq, cumKm: Math.round(cumKm), location: subCity(stop.sub, stop.city) });
      lastFuelKm = cumKm;
    }
  });

  const timeBreakdown = trip.stops.map((stop, i) => {
    const driveMin = Math.round(stop.legMin);
    const waitMin = Math.round(stop.waitMin || 0);
    const lingerMin = Math.round((stop as any).lingerMin || 0);
    const svcMin = Math.round(stop.svcMin);
    // stop.etaM = service-start (post-wait clamp). arriveM = raw pulls-up time.
    // Arrive = arriveM (or etaM - wait fallback). Depart = etaM + service + linger.
    const arrivalMin = (stop as any).arriveM != null ? (stop as any).arriveM : stop.etaM - waitMin;
    return {
      seq: stop.seq,
      type: stop.type,
      location: subCity(stop.sub, stop.city),
      wbs: stop.wbs,
      driveMin,
      arrival: fmM(Math.max(0, arrivalMin)),
      waitMin,
      lingerMin,
      serviceStart: fmM(stop.etaM),
      svcMin,
      departure: fmM(stop.etaM + svcMin + lingerMin),
      eta: stop.eta,
      window: stop.win,
      legKm: stop.legKm,
      late: stop.late,
      slack: stop.slack,
      fromLoc: stop.fromLoc,
      addr: stop.addr,
      lat: stop.lat,
      lng: stop.lng,
      acc: stop.acc,
      contact: stop.contact,
      phone: stop.phone,
      instr: stop.instr,
      pcs: stop.pcs,
      kg: stop.kg,
      clientName: stop.clientName,
    };
  });

  return (
    <>
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto" data-testid="modal-driver-detail">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className="h-12 w-12 rounded-full flex items-center justify-center text-[16px] font-bold text-white shrink-0" style={{ backgroundColor: d.color }} data-testid="modal-driver-avatar">
              {d.icon}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <DialogTitle className="text-[18px] font-bold" data-testid="modal-driver-name">{d.name} — Full Trip Overview</DialogTitle>
                {driverPhone && (
                  <CallDriverButton phone={driverPhone} driverName={d.name} variant="chip" testId="button-call-driver-modal" />
                )}
              </div>
              <p className="text-[12px] text-muted-foreground">{d.vehicle} · {d.plate} · Depot: {d.depot}</p>
              <p className="text-[12px] text-muted-foreground">Shift: {d.shift[0]} – {d.shift[1]} · Fuel: {d.fuelPer100} L/100km</p>
            </div>
          </div>
        </DialogHeader>

        <div>
          <div className="space-y-5 pb-4">

            <div>
              <h3 className="text-[13px] font-bold mb-2 flex items-center gap-1.5">
                <BarChart3 className="w-4 h-4" />
                Summary
              </h3>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {[
                  { label: "Shipments", value: String(st.shipments) },
                  { label: "Stops", value: String(trip.stops.length) },
                  { label: "Total Distance", value: `${st.totalKm} km`, sub: `Dead km: ${st.deadKm}km (Depot\u2192 1st: ${st.depotToFirstKm || 0}km | Last \u2192depot: ${st.returnToDepotKm || 0}km)` },
                  { label: "Revenue", value: `R${st.revenue}` },
                  { label: "COGS (Fuel)", value: `R${st.cogs}`, color: "text-red-500 dark:text-red-400" },
                  { label: "Margin", value: `R${st.margin}`, color: st.margin >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-500 dark:text-red-400" },
                  { label: "Mileage", value: `${st.mileage || 0} km/L` },
                  { label: "Fuel Used", value: `${st.fuelLitres} L` },
                  { label: "Fuel Cost", value: `R${st.fuelCost}` },
                  { label: "Start", value: st.startTime || "--" },
                  { label: "End", value: st.endTime || "--" },
                ].map((item) => (
                  <div key={item.label} className="p-2.5 rounded-md bg-muted/50" data-testid={`modal-stat-${item.label.toLowerCase().replace(/[^a-z0-9]/g, "-")}`}>
                    <p className="text-[10px] text-muted-foreground font-medium">{item.label}</p>
                    <p className={`text-[15px] font-semibold tabular-nums ${(item as any).color || ""}`}>{item.value}</p>
                    {(item as any).sub && <p className="text-[9px] text-muted-foreground mt-0.5 leading-snug">{subCity((item as any).sub, (item as any).city)}</p>}
                  </div>
                ))}
              </div>
            </div>

            {fuelStops.length > 0 && (
              <div>
                <h3 className="text-[13px] font-bold mb-2 flex items-center gap-1.5">
                  <Fuel className="w-4 h-4 text-amber-500" />
                  Suggested Fuel Stops
                </h3>
                <div className="space-y-1.5">
                  {fuelStops.map((fs, i) => (
                    <div key={i} className="flex items-center gap-2 p-2 rounded-md bg-amber-50 dark:bg-amber-950/30 text-[12px]" data-testid={`modal-fuel-stop-${i}`}>
                      <Fuel className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                      <span>Refuel near <span className="font-semibold">{fs.location}</span> (after stop #{fs.afterStop}, ~{fs.cumKm} km cumulative)</span>
                    </div>
                  ))}
                  <p className="text-[10px] text-muted-foreground">Based on estimated {tankRange} km urban range ({d.fuelPer100} L/100km × {fleetSettings.cityFactor}x city factor, 45L tank at 75% fill)</p>
                </div>
              </div>
            )}

            <div>
              <h3 className="text-[13px] font-bold mb-2 flex items-center gap-1.5">
                <Package className="w-4 h-4" />
                Shipments ({driverShips.length})
              </h3>
              <div className="overflow-x-auto" data-testid="modal-shipments-table">
                <table className="w-full text-[11px]">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="text-left py-1.5 px-2 font-semibold text-muted-foreground">Waybill</th>
                      <th className="text-left py-1.5 px-2 font-semibold text-muted-foreground">Client</th>
                      <th className="text-left py-1.5 px-2 font-semibold text-muted-foreground">Service</th>
                      <th className="text-right py-1.5 px-2 font-semibold text-muted-foreground">Pcs</th>
                      <th className="text-right py-1.5 px-2 font-semibold text-muted-foreground">Kg</th>
                      <th className="text-left py-1.5 px-2 font-semibold text-muted-foreground">Collection</th>
                      <th className="text-left py-1.5 px-2 font-semibold text-muted-foreground">Delivery</th>
                      <th className="text-right py-1.5 px-2 font-semibold text-muted-foreground">Rate</th>
                      <th className="text-left py-1.5 px-2 font-semibold text-muted-foreground">Assign</th>
                    </tr>
                  </thead>
                  <tbody>
                    {driverShips.map((sh) => {
                      return (
                        <Fragment key={sh.id}>
                          <tr className="border-b border-border/50" data-testid={`row-shipment-${sh.id}`}>
                            <td className="py-1.5 px-2 font-mono font-medium">{sh.wb}</td>
                            <td className="py-1.5 px-2">{sh.clientName || sh.client || sh.acc}</td>
                            <td className="py-1.5 px-2">
                              <Badge variant={sh.svc === "SPX" ? "destructive" : "secondary"} className="text-[9px]">{sh.svc}</Badge>
                            </td>
                            <td className="py-1.5 px-2 text-right tabular-nums">{sh.pcs}</td>
                            <td className="py-1.5 px-2 text-right tabular-nums">{sh.kg}</td>
                            <td className="py-1.5 px-2">
                              <span className="font-medium">{subCity(sh.cSub, sh.cCity)}</span>
                              <br />
                              <span className="text-muted-foreground inline-flex items-center gap-1">
                                {sh.cAfter || "?"}{sh.cBefore && sh.cBefore !== sh.cAfter ? `–${sh.cBefore}` : ""}
                                {collectionOverrides?.[sh.id] && (
                                  <Badge variant="secondary" className="text-[8px] px-1 py-0" data-testid={`badge-collection-overridden-${sh.id}`}>
                                    {(collectionOverrides[sh.id] as any).pinnedTime ? `pin ${(collectionOverrides[sh.id] as any).pinnedTime}` : `was ${sh.origCAfter || "?"}–${sh.origCBefore || "?"}`}
                                  </Badge>
                                )}
                                {onSetCollectionOverride && (
                                  <button
                                    type="button"
                                    className="text-muted-foreground hover:text-foreground"
                                    onClick={() => setOverrideShipment({ ship: sh, kind: "C" })}
                                    title="Override collection window"
                                    data-testid={`button-edit-collection-window-${sh.id}`}
                                  >
                                    <Pencil className="w-3 h-3" />
                                  </button>
                                )}
                              </span>
                            </td>
                            <td className="py-1.5 px-2">
                              {sh.dLat && sh.dLng && sh.dLat !== 0 && sh.dLng !== 0 ? (
                                <a href={gMap(sh.dLat, sh.dLng)} target="_blank" rel="noopener noreferrer" className="font-medium text-blue-600 dark:text-blue-400 hover:underline inline-flex items-center gap-0.5" data-testid={`shipment-del-map-${sh.id}`}>
                                  <MapPin className="w-3 h-3" />{subCity(sh.dSub, sh.dCity)}
                                </a>
                              ) : (
                                <span className="font-medium">{subCity(sh.dSub, sh.dCity)}</span>
                              )}
                              <br />
                              <span className="text-muted-foreground inline-flex items-center gap-1">
                                {sh.dAfter || "?"}–{sh.dBefore || "?"}
                                {deliveryOverrides?.[sh.id] && (
                                  <Badge variant="secondary" className="text-[8px] px-1 py-0" data-testid={`badge-delivery-overridden-${sh.id}`}>
                                    {(deliveryOverrides[sh.id] as any).pinnedTime ? `pin ${(deliveryOverrides[sh.id] as any).pinnedTime}` : `was ${sh.origDAfter || "?"}–${sh.origDBefore || "?"}`}
                                  </Badge>
                                )}
                                {onSetDeliveryOverride && (
                                  <button
                                    type="button"
                                    className="text-muted-foreground hover:text-foreground"
                                    onClick={() => setOverrideShipment({ ship: sh, kind: "D" })}
                                    title="Override delivery window"
                                    data-testid={`button-edit-delivery-window-${sh.id}`}
                                  >
                                    <Pencil className="w-3 h-3" />
                                  </button>
                                )}
                              </span>
                            </td>
                            <td className="py-1.5 px-2 text-right tabular-nums font-medium">R{sh.rate}</td>
                            <td className="py-1.5 px-2">
                              <Select
                                value={asgn[sh.id] || d.id}
                                onValueChange={(newDriverId) => {
                                  if (newDriverId === d.id) return;
                                  const targetDriver = fleet.find((dd: any) => dd.id === newDriverId);
                                  setAsgn((prev) => ({ ...prev, [sh.id]: newDriverId }));
                                  log(`Reassigned ${sh.wb} from ${d.name} to ${targetDriver?.name || newDriverId}`, "OPS");
                                }}
                              >
                                <SelectTrigger className="h-7 text-[11px] w-[110px]" data-testid={`select-assign-${sh.id}`}>
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  {fleet.map((dd: any) => (
                                    <SelectItem key={dd.id} value={dd.id} data-testid={`option-assign-${sh.id}-${dd.id}`}>
                                      <div className="flex items-center gap-1.5">
                                        <div className="w-2 h-2 rounded-full" style={{ backgroundColor: dd.color || "#999" }} />
                                        <span>{dd.name}</span>
                                      </div>
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </td>
                          </tr>
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            <div>
              <h3 className="text-[13px] font-bold mb-2 flex items-center gap-1.5">
                <Clock className="w-4 h-4" />
                Trip Timeline — Stop-by-Stop Breakdown
              </h3>
              <div className="space-y-0">
                <div className="grid grid-cols-[auto_1fr] gap-x-3">
                  {timeBreakdown.map((tb, i) => {
                    const isLast = i === timeBreakdown.length - 1;
                    const typeLabel = tb.type === "C" ? "Collection" : tb.type === "D" ? "Delivery" : "Return to Depot";
                    const typeColor = tb.type === "C" ? "bg-blue-500" : tb.type === "D" ? "bg-emerald-500" : "bg-gray-400";
                    return (
                      <div key={tb.seq} className="contents" data-testid={`timeline-stop-${tb.seq}`}>
                        <div className="flex flex-col items-center">
                          <div className={`w-3 h-3 rounded-full ${typeColor} shrink-0 mt-1.5`} />
                          {!isLast && <div className="w-0.5 flex-1 bg-border min-h-[40px]" />}
                        </div>
                        <div className={`pb-3 ${isLast ? "" : "border-b border-border/40 mb-1"}`}>
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-[12px] font-bold">#{tb.seq} {typeLabel}</span>
                            {tb.late && <Badge variant="destructive" className="text-[9px]">LATE</Badge>}
                            {tb.type === "D" && tb.slack != null && tb.slack >= 0 && tb.slack < 15 && (
                              <Badge variant="secondary" className="text-[9px]">AT RISK ({tb.slack}m)</Badge>
                            )}
                            {tb.type !== "RTN" && (
                              <span className="ml-auto inline-flex items-center gap-0.5">
                                {(() => {
                                  const stopRef = trip.stops[i];
                                  const nextRef = trip.stops[i + 1];
                                  // Group is always available between two adjacent C/D stops of the
                                  // same type — `stopsCanMerge` is now a no-op true, kept for legacy
                                  // call sites. Soft warnings (distance, window) are surfaced via toast.
                                  const canGroup = !!onMergeStop && stopRef && nextRef && nextRef.type === stopRef.type && (stopRef.type === "C" || stopRef.type === "D");
                                  const canUngroup = !!onSplitStop && stopRef && (stopRef.type === "C" || stopRef.type === "D") && (((stopRef as any).grouped === true) || ((stopRef as any).unmergedIds?.length ?? 0) >= 2 || (stopRef.ids?.length ?? 0) >= 2);
                                  return (
                                    <>
                                      {canGroup && (
                                        <button
                                          type="button"
                                          className="h-5 px-1.5 inline-flex items-center gap-1 rounded-sm text-[10px] font-semibold text-blue-600 dark:text-blue-300 hover:text-blue-700 dark:hover:text-blue-200 hover-elevate"
                                          onClick={() => onMergeStop!(d.id, i)}
                                          data-testid={`modal-group-${tb.seq}`}
                                          title={isLocked ? "Trip is LOCKED — you'll be asked to confirm" : "Group with next stop"}
                                        >
                                          <Merge className="w-3 h-3" /> Group
                                        </button>
                                      )}
                                      {canUngroup && (
                                        <button
                                          type="button"
                                          className="h-5 px-1.5 inline-flex items-center gap-1 rounded-sm text-[10px] font-semibold text-amber-600 dark:text-amber-300 hover:text-amber-700 dark:hover:text-amber-200 hover-elevate"
                                          onClick={() => onSplitStop!(d.id, i)}
                                          data-testid={`modal-ungroup-${tb.seq}`}
                                          title={isLocked ? "Trip is LOCKED — you'll be asked to confirm" : "Ungroup back into individual stops"}
                                        >
                                          <Split className="w-3 h-3" /> Ungroup
                                        </button>
                                      )}
                                    </>
                                  );
                                })()}
                                {onMoveStop && (
                                  <>
                                    <button
                                      type="button"
                                      className={`w-6 h-5 flex items-center justify-center rounded-sm ${i <= 0 ? "opacity-25 cursor-not-allowed" : "text-muted-foreground hover:text-foreground hover-elevate cursor-pointer"}`}
                                      disabled={i <= 0}
                                      onClick={() => i > 0 && onMoveStop(d.id, i, i - 1)}
                                      data-testid={`modal-move-up-${tb.seq}`}
                                      title="Move up"
                                    >
                                      <ArrowUp className="w-3 h-3" />
                                    </button>
                                    <button
                                      type="button"
                                      className={`w-6 h-5 flex items-center justify-center rounded-sm ${i >= timeBreakdown.length - 1 || timeBreakdown[i + 1]?.type === "RTN" ? "opacity-25 cursor-not-allowed" : "text-muted-foreground hover:text-foreground hover-elevate cursor-pointer"}`}
                                      disabled={i >= timeBreakdown.length - 1 || timeBreakdown[i + 1]?.type === "RTN"}
                                      onClick={() => i < timeBreakdown.length - 1 && timeBreakdown[i + 1]?.type !== "RTN" && onMoveStop(d.id, i, i + 1)}
                                      data-testid={`modal-move-down-${tb.seq}`}
                                      title="Move down"
                                    >
                                      <ArrowDown className="w-3 h-3" />
                                    </button>
                                  </>
                                )}
                              </span>
                            )}
                          </div>
                          {tb.lat && tb.lng && tb.lat !== 0 && tb.lng !== 0 ? (
                            <a
                              href={gMap(tb.lat, tb.lng)}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-[12px] font-semibold mt-0.5 text-blue-600 dark:text-blue-400 hover:underline inline-flex items-center gap-1"
                              data-testid={`timeline-map-link-${tb.seq}`}
                            >
                              <MapPin className="w-3 h-3" />
                              {tb.addr || tb.location}
                            </a>
                          ) : (
                            <p className="text-[12px] font-semibold mt-0.5">{tb.addr || tb.location}</p>
                          )}
                          {tb.wbs.length > 0 && (
                            <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
                              {tb.wbs.map((wb, wbIdx) => {
                                const wbShip = tb.type === "D" ? ships.find((sh) => sh.wb === wb) : null;
                                const wbOv = wbShip && deliveryOverrides ? deliveryOverrides[wbShip.id] : undefined;
                                return (
                                  <span key={`${wb}-${wbIdx}`} className="inline-flex items-center gap-0.5 text-[10px] text-muted-foreground font-mono">
                                    {wb}{wbIdx < tb.wbs.length - 1 ? "," : ""}
                                    {wbShip && !isLocked && (
                                      <>
                                        {wbOv && (
                                          <Badge variant="secondary" className="text-[8px] px-1 py-0 ml-0.5" data-testid={`badge-timeline-override-${wb}`}>OVR</Badge>
                                        )}
                                        <Button
                                          variant="ghost"
                                          size="icon"
                                          className="h-4 w-4 ml-0.5"
                                          onClick={(e) => { e.stopPropagation(); setOverrideShipment({ ship: wbShip, kind: "D" }); }}
                                          data-testid={`button-timeline-edit-window-${wb}`}
                                          aria-label="Override delivery window"
                                        >
                                          <Pencil className="w-2.5 h-2.5" />
                                        </Button>
                                      </>
                                    )}
                                  </span>
                                );
                              })}
                            </div>
                          )}
                          {(tb.clientName || tb.acc) && (
                            <div className="text-[11px] flex items-center gap-1.5 flex-wrap">
                              {tb.clientName && <span className="font-medium text-foreground/80">{tb.clientName}</span>}
                              {tb.acc && <span className="text-muted-foreground font-mono text-[10px]">({tb.acc})</span>}
                            </div>
                          )}
                          {tb.pcs > 0 && (
                            <div className="text-[11px] text-muted-foreground">
                              <span className="font-medium">{tb.pcs} pcs</span> · <span className="font-medium">{tb.kg} kg</span>
                            </div>
                          )}
                          {tb.contact && (
                            <div className="text-[11px] text-muted-foreground">
                              {tb.contact}{tb.phone ? ` · ${tb.phone}` : ""}
                            </div>
                          )}
                          {tb.instr && (
                            <div className="text-[11px] text-muted-foreground italic">{tb.instr}</div>
                          )}
                          <div className="mt-2 rounded-md border border-border/40 bg-muted/30 p-2 text-[11px]">
                            <div className="grid grid-cols-[auto_1fr_auto_auto] items-center gap-x-3 gap-y-1">
                              <span className="text-muted-foreground">Leg</span>
                              <span className="truncate">
                                <span className="text-muted-foreground">from </span>
                                <span className="font-medium">{tb.fromLoc}</span>
                              </span>
                              <span className="tabular-nums text-muted-foreground">{tb.driveMin}m · {tb.legKm}km</span>
                              <span className="tabular-nums font-semibold" data-testid={`timeline-arrive-${tb.seq}`}>arr {tb.arrival}</span>
                            </div>
                            {tb.type !== "RTN" && (
                              <div className="mt-1 grid grid-cols-[auto_1fr_auto_auto] items-center gap-x-3 gap-y-1 border-t border-border/40 pt-1">
                                <span className="text-muted-foreground">On-site</span>
                                <span className="truncate">
                                  {tb.waitMin > 0 ? (
                                    <span className="text-amber-600 dark:text-amber-400">wait {tb.waitMin}m → service {tb.serviceStart}</span>
                                  ) : (
                                    <span className="text-muted-foreground">service starts {tb.serviceStart}</span>
                                  )}
                                  {tb.window && (
                                    <span className="ml-2 text-muted-foreground">· window {tb.window}</span>
                                  )}
                                </span>
                                <span className="tabular-nums text-muted-foreground">svc {tb.svcMin}m</span>
                                <span className="tabular-nums font-semibold" data-testid={`timeline-depart-${tb.seq}`}>dep {tb.departure}</span>
                              </div>
                            )}
                            {tb.lingerMin > 0 && tb.type !== "RTN" && (
                              <div className="mt-1 text-[10px] text-amber-600 dark:text-amber-400 border-t border-border/40 pt-1" data-testid={`timeline-linger-${tb.seq}`}>
                                Linger here +{tb.lingerMin}m so next stop arrives at its window open
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            {trip.warnings.length > 0 && (
              <div>
                <h3 className="text-[13px] font-bold mb-2 flex items-center gap-1.5">
                  <AlertTriangle className="w-4 h-4 text-amber-500" />
                  Warnings ({trip.warnings.length})
                </h3>
                <div className="space-y-1.5">
                  {trip.warnings.map((w: WarningItem, i: number) => (
                    <div key={i} className="flex items-start gap-2 text-[11px] p-2 rounded-md bg-muted/40">
                      <Badge variant={w.sev === "HIGH" ? "destructive" : "secondary"} className="text-[9px] shrink-0">{w.sev}</Badge>
                      <span className="text-muted-foreground">{w.msg}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

          </div>
        </div>
      </DialogContent>
    </Dialog>
    <DeliveryWindowDialog
      open={!!overrideShipment}
      onOpenChange={(o) => { if (!o) setOverrideShipment(null); }}
      shipment={overrideShipment?.ship ?? null}
      kind={overrideShipment?.kind ?? "D"}
      currentOverride={overrideShipment
        ? (overrideShipment.kind === "D" ? deliveryOverrides?.[overrideShipment.ship.id] : collectionOverrides?.[overrideShipment.ship.id])
        : undefined}
      onSave={(id, after, before, pinnedTime) => {
        if (overrideShipment?.kind === "C") onSetCollectionOverride?.(id, after, before, pinnedTime);
        else onSetDeliveryOverride?.(id, after, before, pinnedTime);
      }}
      onClear={(id) => {
        if (overrideShipment?.kind === "C") onClearCollectionOverride?.(id);
        else onClearDeliveryOverride?.(id);
      }}
    />
    </>
  );
}

function ReorderRequestsPanel({ log }: { log: (msg: string, type?: string) => void }) {
  const { toast } = useToast();
  const { data: pendingRequests = [], refetch: refetchPending, isLoading } = useTanQuery<any[]>({
    queryKey: ["/api/dispatch/reorder-requests"],
    refetchInterval: 15000,
  });
  const { data: allRequests = [], refetch: refetchAll } = useTanQuery<any[]>({
    queryKey: ["/api/dispatch/reorder-requests", "history"],
    queryFn: async () => {
      const res = await fetch("/api/dispatch/reorder-requests?history=true", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch reorder history");
      return res.json();
    },
  });
  const [showHistory, setShowHistory] = useState(false);
  const [reviewingId, setReviewingId] = useState<number | null>(null);
  const [reviewNotes, setReviewNotes] = useState<Record<number, string>>({});

  async function handleAction(id: number, action: "approve" | "reject") {
    setReviewingId(id);
    try {
      const note = reviewNotes[id]?.trim() || undefined;
      await apiRequest("PATCH", `/api/dispatch/reorder-requests/${id}`, { action, reviewNote: note });
      toast({ title: action === "approve" ? "Reorder approved" : "Reorder rejected", description: action === "approve" ? "Driver's stop order has been updated" : "Request has been rejected" });
      log(`${action === "approve" ? "Approved" : "Rejected"} driver reorder request #${id}`, "OPS");
      refetchPending();
      refetchAll();
      if (action === "approve") {
        queryClient.invalidateQueries({ queryKey: ["/api/projects"] });
      }
    } catch (err: any) {
      toast({ title: "Action failed", description: err.message, variant: "destructive" });
    } finally {
      setReviewingId(null);
    }
  }

  const reviewedRequests = allRequests.filter((r: any) => r.status !== "pending");

  if (isLoading || (pendingRequests.length === 0 && reviewedRequests.length === 0)) return null;

  return (
    <Card className="border-amber-500/30 bg-amber-500/5" data-testid="panel-reorder-requests">
      <CardHeader className="pb-2 pt-3 px-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ArrowUpDown className="w-4 h-4 text-amber-400" />
            <span className="text-sm font-semibold">Driver Reorder Requests</span>
            {pendingRequests.length > 0 && <Badge variant="outline" className="text-[10px] bg-amber-500/20 text-amber-300 border-amber-500/30">{pendingRequests.length}</Badge>}
          </div>
          {reviewedRequests.length > 0 && (
            <button onClick={() => setShowHistory(!showHistory)} className="text-[10px] text-muted-foreground hover:text-white" data-testid="button-toggle-reorder-history">
              {showHistory ? "Hide History" : `History (${reviewedRequests.length})`}
            </button>
          )}
        </div>
      </CardHeader>
      <CardContent className="px-4 pb-3 space-y-3">
        {pendingRequests.map((req: any) => {
          const currentOrder = (req.currentOrder || []) as string[];
          const proposedOrder = (req.proposedOrder || []) as string[];
          const isReviewing = reviewingId === req.id;
          return (
            <div key={req.id} className="rounded-lg p-3 space-y-2" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }} data-testid={`reorder-request-${req.id}`}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{req.driverName}</span>
                  <span className="text-[10px] text-muted-foreground">{new Date(req.createdAt).toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit" })}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Button size="sm" variant="outline" className="h-7 text-xs border-green-500/40 text-green-400 hover:bg-green-500/20" disabled={isReviewing} onClick={() => handleAction(req.id, "approve")} data-testid={`button-approve-${req.id}`}>
                    {isReviewing ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <CheckCircle2 className="w-3 h-3 mr-1" />}
                    Approve
                  </Button>
                  <Button size="sm" variant="outline" className="h-7 text-xs border-red-500/40 text-red-400 hover:bg-red-500/20" disabled={isReviewing} onClick={() => handleAction(req.id, "reject")} data-testid={`button-reject-${req.id}`}>
                    <X className="w-3 h-3 mr-1" />
                    Reject
                  </Button>
                </div>
              </div>
              {req.reason && <p className="text-xs text-muted-foreground italic">"{req.reason}"</p>}
              <input
                type="text"
                placeholder="Optional note to driver..."
                value={reviewNotes[req.id] || ""}
                onChange={(e) => setReviewNotes((prev) => ({ ...prev, [req.id]: e.target.value }))}
                className="w-full text-xs px-2 py-1.5 rounded bg-white/5 border border-white/10 text-white placeholder:text-gray-500 focus:outline-none focus:border-white/20"
                data-testid={`input-review-note-${req.id}`}
              />
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">Current Order</p>
                  <div className="space-y-0.5">
                    {currentOrder.map((key: string, i: number) => (
                      <div key={key} className="text-[11px] text-muted-foreground flex items-center gap-1">
                        <span className="w-4 h-4 rounded flex items-center justify-center text-[9px] font-bold bg-white/10">{i + 1}</span>
                        <span className="truncate">{key}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">Proposed Order</p>
                  <div className="space-y-0.5">
                    {proposedOrder.map((key: string, i: number) => {
                      const moved = key !== currentOrder[i];
                      return (
                        <div key={key} className={`text-[11px] flex items-center gap-1 ${moved ? "text-amber-300" : "text-muted-foreground"}`}>
                          <span className={`w-4 h-4 rounded flex items-center justify-center text-[9px] font-bold ${moved ? "bg-amber-500/20" : "bg-white/10"}`}>{i + 1}</span>
                          <span className="truncate">{key}</span>
                          {moved && <ArrowUpDown className="w-2.5 h-2.5 flex-shrink-0" />}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
        {showHistory && reviewedRequests.length > 0 && (
          <div className="pt-2 border-t border-white/10 space-y-2">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Recent History</p>
            {reviewedRequests.map((req: any) => (
              <div key={req.id} className="rounded-lg p-2 flex items-center justify-between gap-2 opacity-70" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.04)" }} data-testid={`reorder-history-${req.id}`}>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium">{req.driverName}</span>
                  <Badge variant="outline" className={`text-[9px] ${req.status === "approved" ? "bg-green-500/10 text-green-400 border-green-500/20" : req.status === "rejected" ? "bg-red-500/10 text-red-400 border-red-500/20" : "bg-gray-500/10 text-gray-400 border-gray-500/20"}`}>
                    {req.status}
                  </Badge>
                </div>
                <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                  {req.reviewedBy && <span>by {req.reviewedBy}</span>}
                  {req.reviewedAt && <span>{new Date(req.reviewedAt).toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit" })}</span>}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function WaybillSearch({ ships, asgn, setAsgn, fleet, log }: { ships: Shipment[]; asgn: Record<string, string>; setAsgn: (a: Record<string, string>) => void; fleet: any[]; log: (msg: string, type?: string) => void }) {
  const { toast } = useToast();
  const [query, setQuery] = useState("");

  const results = useMemo(() => {
    if (query.length < 3) return [];
    const q = query.toLowerCase();
    return ships.filter((s) => s.wb.toLowerCase().includes(q)).slice(0, 10);
  }, [query, ships]);

  return (
    <div className="space-y-2">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/60 pointer-events-none" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search waybill number..."
          className="pl-9 pr-9 bg-slate-800/60 backdrop-blur-md border-white/30 text-white placeholder:text-white/50"
          data-testid="input-waybill-search"
        />
        {query && (
          <button
            onClick={() => setQuery("")}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            data-testid="button-clear-waybill-search"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>
      {query.length >= 3 && results.length === 0 && (
        <p className="text-[12px] text-muted-foreground px-1">No results for "{query}"</p>
      )}
      {results.length > 0 && (
        <Card>
          <CardContent className="p-3 space-y-2">
            {results.map((ship) => {
              const currentDriverId = asgn[ship.id];
              const currentDriver = fleet.find((d: any) => d.id === currentDriverId);
              return (
                <div key={ship.id} className="flex items-center gap-3 p-2 rounded-md bg-muted/30 text-[12px] flex-wrap" data-testid={`card-waybill-result-${ship.id}`}>
                  <div className="flex-1 min-w-0 space-y-0.5">
                    <p className="font-mono font-semibold text-[13px]">{ship.wb}</p>
                    <p className="text-muted-foreground">{subCity(ship.cSub, ship.cCity)} <ArrowRight className="inline w-3 h-3" /> {subCity(ship.dSub, ship.dCity)}</p>
                    <p className="text-muted-foreground">{ship.client}</p>
                    {currentDriver && (
                      <p className="text-[11px]">Assigned: <span className="font-medium">{currentDriver.name}</span></p>
                    )}
                  </div>
                  <Select
                    value={currentDriverId || ""}
                    onValueChange={(newDriverId) => {
                      const prevDriverId = currentDriverId;
                      const prevDriver = fleet.find((d: any) => d.id === prevDriverId);
                      setAsgn({ ...asgn, [ship.id]: newDriverId });
                      const newDriver = fleet.find((d: any) => d.id === newDriverId);
                      log(`Reassigned ${ship.wb} to ${newDriver?.name || newDriverId}`, "MANUAL");
                      toast({ title: "Waybill reassigned", description: `${ship.wb} → ${newDriver?.name || newDriverId}` });
                      postAuditLog({ eventType: "DRIVER_REASSIGNED", entityType: "shipment", entityId: ship.id, previousValue: { driverId: prevDriverId, driverName: prevDriver?.name }, newValue: { driverId: newDriverId, driverName: newDriver?.name }, details: `${ship.wb} reassigned via Waybill Search` });
                    }}
                    data-testid={`select-reassign-${ship.id}`}
                  >
                    <SelectTrigger className="w-[130px] text-[11px]" data-testid={`select-reassign-${ship.id}`}>
                      <SelectValue placeholder="Assign driver" />
                    </SelectTrigger>
                    <SelectContent>
                      {fleet.map((d: any) => (
                        <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function OpsTab({ tl, ships, asgn, setAsgn, allWarn, totals, runOptimizer, optimizing, optInfo, tripSt, selectedDay, trafficCond, setTrafficCond, fleet, fleetSettings, toggleDriverActive, log, driverTraffic, trafficStatus, refreshTraffic, userReports, handoffs, setTab, now, moveStop, mergeStop, splitStop, deliveryOverrides, setDeliveryOverride, clearDeliveryOverride, collectionOverrides, setCollectionOverride, clearCollectionOverride }: any) {
  const { toast } = useToast();
  const [selectedDriverId, setSelectedDriverId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const selectedTrip = selectedDriverId ? tl[selectedDriverId] || null : null;
  const isSaturday = selectedDay && selectedDay !== "all" ? new Date(selectedDay + "T00:00:00").getDay() === 6 : false;
  const insights = useMemo(() => generateInsights(tl, ships, trafficCond, isSaturday, userReports), [tl, ships, trafficCond, isSaturday, userReports]);

  const { data: driverAccounts = [] } = useTanQuery({
    queryKey: ["/api/auth/driver-accounts"],
  });
  const driverPhoneMap = useMemo(() => {
    const map: Record<string, string> = {};
    (driverAccounts as any[]).forEach((acc: any) => {
      if (acc.phone && acc.driverName) {
        map[acc.driverName.toLowerCase().trim()] = acc.phone;
      }
    });
    return map;
  }, [driverAccounts]);

  const handleSaveToDataCentre = useCallback(async () => {
    if (saving || !ships.length || !Object.keys(asgn).length) return;
    setSaving(true);
    try {
      const runDate = selectedDay && selectedDay !== "all" ? selectedDay : new Date().toISOString().slice(0, 10);
      const driverSummaries = fleet
        .filter((d: any) => tl[d.id])
        .map((d: any) => {
          const td = tl[d.id];
          return {
            driverId: d.id,
            driverName: d.name,
            driverColor: d.color,
            shipmentCount: td.stats?.shipments || 0,
            stopCount: td.stops?.length || 0,
            totalKm: td.stats?.totalKm || 0,
            deadKm: td.stats?.deadKm || 0,
            revenue: td.stats?.revenue || 0,
            cogs: td.stats?.cogs || 0,
            fuelCost: td.stats?.fuelCost || 0,
            margin: td.stats?.margin || 0,
            fuelLitres: td.stats?.fuelLitres || 0,
            lateCount: td.stats?.lateCount || 0,
            startTime: td.stats?.startTime || "",
            endTime: td.stats?.endTime || "",
          };
        });

      const archive = {
        name: `Trip Sheet — ${runDate}`,
        runDate,
        shipmentCount: ships.length,
        driverCount: driverSummaries.length,
        totalKm: totals.km || 0,
        totalRevenue: totals.rev || 0,
        totalFuelCost: totals.fuelR || 0,
        totalMargin: totals.margin || 0,
        totalDeadKm: totals.deadKm || 0,
        warningCount: allWarn?.length || 0,
        trafficCondition: trafficCond || "normal",
        shipments: ships,
        assignments: asgn,
        tripSheets: tl,
        driverSummaries,
        handoffs: handoffs || [],
        notes: "",
      };

      await apiRequest("POST", "/api/archives", archive);
      queryClient.invalidateQueries({ queryKey: ["/api/archives"] });
      toast({ title: "Saved to Data Centre", description: `${ships.length} shipments archived for ${runDate}` });
      log(`Saved ${ships.length} shipments to Data Centre for ${runDate}`, "SYS");
    } catch (err: any) {
      toast({ title: "Save failed", description: err.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }, [saving, ships, asgn, tl, fleet, totals, allWarn, trafficCond, selectedDay, handoffs, log, toast]);

  if (!ships.length) {
    return (
      <div className="flex-1 flex flex-col">
        <div className="flex justify-end p-4">
          <DriverMapButton />
        </div>
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center space-y-3">
            <div className="w-14 h-14 rounded-full bg-muted flex items-center justify-center mx-auto">
              <Package className="w-6 h-6 text-muted-foreground" />
            </div>
            <h3 className="text-[15px] font-semibold">No shipments loaded</h3>
            <p className="text-[13px] text-muted-foreground">Import a CSV to get started</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
    <ScrollArea className="flex-1">
      <PageHeader
        title="Dashboard"
        subtitle={`${ships.length} shipments · ${ships.filter((s: any) => asgn[s.id]).length} routed${selectedDay && selectedDay !== "all" ? " · " + formatDayLabel(selectedDay) : ""}`}
        bgImage={bgDashboard}
      >
        <div className="flex items-center gap-3 flex-wrap">
          <Select value={trafficCond} onValueChange={(v: string) => setTrafficCond(v)} data-testid="select-traffic">
            <SelectTrigger className="w-[140px] bg-white/15 border-white/25 text-white font-semibold backdrop-blur-sm" data-testid="select-traffic-trigger">
              <SelectValue placeholder="Traffic" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="normal" data-testid="select-traffic-normal">Normal</SelectItem>
              <SelectItem value="moderate" data-testid="select-traffic-moderate">Moderate</SelectItem>
              <SelectItem value="heavy" data-testid="select-traffic-heavy">Heavy</SelectItem>
            </SelectContent>
          </Select>
          <DriverMapButton />
          {Object.keys(asgn).length > 0 && (
            <>
              <Button onClick={() => runOptimizer(null, false, true)} disabled={optimizing} className="bg-white/20 border border-white/30 text-white font-bold backdrop-blur-sm" data-testid="button-reoptimize-dashboard">
                <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
                Re-Optimize
              </Button>
              <Button onClick={handleSaveToDataCentre} disabled={saving} className="bg-white/20 border border-white/30 text-white font-bold backdrop-blur-sm" data-testid="button-save-to-datacentre">
                <Database className="w-3.5 h-3.5 mr-1.5" />
                {saving ? "Saving..." : "Save to Data Centre"}
              </Button>
            </>
          )}
        </div>
      </PageHeader>
      <PageBody bgImages={[bgDashboard, bgTrips, bgMetrics]}>
      <div className="p-6 space-y-6">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4" data-testid="stats-grid">
          <MetricCard label="Total Revenue" value={`R${totals.rev}`} trend={totals.rev > 0 ? "up" : undefined} color="green" />
          <MetricCard label="Fuel Cost" value={`R${totals.fuelR}`} sub={`${totals.fuelL.toFixed(0)}L`} color="amber" />
          <MetricCard label="Total km" value={`${totals.km}`} sub={`${totals.deadKm}km dead`} color="blue" breakdown={totals.deadKm > 0 ? `Depot to 1st stop: ${totals.depotToFirstKm}km | Last stop to depot: ${totals.returnToDepotKm}km` : undefined} />
          <MetricCard label="Margin" value={`R${totals.margin}`} trend={totals.margin >= 0 ? "up" : "down"} color={totals.margin >= 0 ? "green" : "red"} />
        </div>

        <ReorderRequestsPanel log={log} />

        <WaybillSearch ships={ships} asgn={asgn} setAsgn={setAsgn} fleet={fleet} log={log} />

        {optInfo && (
          <div className="flex items-center gap-3 text-[12px] text-white/70 flex-wrap">
            <span>Optimizer cost: <span className="font-medium text-white">R{optInfo.cost}</span></span>
            <span className="text-white/30">|</span>
            <span>{optInfo.passes} refinement passes</span>
            <span className="text-white/30">|</span>
            <span>Fuel: R{fleetSettings.fuelPrice}/L</span>
            <span className="text-white/30">|</span>
            <span>Traffic: <span className="font-medium text-white">{trafficCond === "normal" ? "Normal" : trafficCond === "moderate" ? "Moderate" : "Heavy"}</span></span>
            {selectedDay && selectedDay !== "all" && new Date(selectedDay + "T00:00:00").getDay() === 6 && (
              <>
                <span className="text-white/30">|</span>
                <span className="font-medium text-amber-300" data-testid="text-saturday-mode">Saturday caps: 12 AM / 8 PM per driver</span>
              </>
            )}
          </div>
        )}

        {trafficStatus.enabled && (() => {
          const entries = Array.from(driverTraffic.entries());
          const totalDelay = entries.reduce((s: number, [, d]: any) => s + d.totalDelayMin, 0);
          const worstLevel = entries.reduce((w: string, [, d]: any) => {
            const lvls = ["NORMAL", "SLOW", "HEAVY", "STANDSTILL"];
            return lvls.indexOf(d.worstCongestion) > lvls.indexOf(w) ? d.worstCongestion : w;
          }, "NORMAL");
          const affectedLegs = entries.reduce((s: number, [, d]: any) => s + d.legDetails.filter((l: any) => l.congestion !== "NORMAL").length, 0);
          const totalLegs = entries.reduce((s: number, [, d]: any) => s + d.legDetails.length, 0);
          const dotColor = worstLevel === "STANDSTILL" ? "bg-red-400" : worstLevel === "HEAVY" ? "bg-orange-400" : worstLevel === "SLOW" ? "bg-yellow-300" : "bg-green-400";
          const badgeColor = worstLevel === "STANDSTILL" ? "bg-red-500/30 border-red-300/50 text-red-100" : worstLevel === "HEAVY" ? "bg-orange-500/30 border-orange-300/50 text-orange-100" : worstLevel === "SLOW" ? "bg-yellow-500/30 border-yellow-300/50 text-yellow-100" : "bg-green-500/30 border-green-300/50 text-green-100";
          const delayColor = worstLevel === "STANDSTILL" ? "text-red-300" : worstLevel === "HEAVY" ? "text-orange-300" : worstLevel === "SLOW" ? "text-yellow-300" : "text-green-300";
          const elapsed = trafficStatus.lastRefresh ? Math.round(((now ?? Date.now()) - trafficStatus.lastRefresh) / 1000) : null;
          const nextIn = elapsed !== null ? Math.max(0, 60 - elapsed) : null;
          return (
            <div className="rounded-xl border border-white/20 bg-black/30 backdrop-blur-sm px-4 py-3 flex items-center justify-between gap-4 flex-wrap" data-testid="bar-live-traffic">
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-1.5">
                  <span className={`w-2 h-2 rounded-full ${dotColor} animate-pulse`} />
                  <span className="text-[11px] font-bold uppercase tracking-wider text-white/80">Live Traffic</span>
                </div>
                <Badge variant="outline" className={`text-[11px] font-bold border ${badgeColor}`} data-testid="badge-live-congestion">
                  {worstLevel}
                </Badge>
                {totalDelay > 0 && (
                  <span className={`text-[12px] font-semibold tabular-nums ${delayColor}`}>+{Math.round(totalDelay)} min fleet delay</span>
                )}
                {totalLegs > 0 && (
                  <span className="text-[11px] text-white/60">{affectedLegs}/{totalLegs} legs affected</span>
                )}
                {entries.length === 0 && !trafficStatus.isRefreshing && (
                  <span className="text-[11px] text-white/60">Awaiting live data…</span>
                )}
                {trafficStatus.isRefreshing && (
                  <span className="text-[11px] text-white/60 flex items-center gap-1"><RefreshCw className="w-3 h-3 animate-spin" />Fetching…</span>
                )}
              </div>
              <div className="flex items-center gap-3">
                {elapsed !== null && (
                  <span className="text-[11px] text-white/60 tabular-nums">
                    {elapsed < 60 ? `${elapsed}s ago` : `${Math.round(elapsed / 60)}m ago`}
                    {nextIn !== null && nextIn > 0 && ` · next in ${nextIn}s`}
                  </span>
                )}
                <button
                  className="text-[11px] font-semibold text-white/80 hover:text-white flex items-center gap-1 hover-elevate"
                  onClick={refreshTraffic}
                  disabled={trafficStatus.isRefreshing}
                  data-testid="button-refresh-traffic-bar"
                >
                  <RefreshCw className={`w-3 h-3 ${trafficStatus.isRefreshing ? "animate-spin" : ""}`} />
                  Refresh now
                </button>
              </div>
            </div>
          );
        })()}

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {fleet.map((d: any) => {
            const trip = tl[d.id];
            if (!trip) return null;
            const st = trip.stats;
            const driverProfile = fleetSettings.drivers.find((p: DriverProfile) => p.id === d.id);
            const isActive = driverProfile?.active !== false;
            const capacityColor = (st.capacityScore || 0) >= 75 ? "text-green-600 dark:text-green-400" : (st.capacityScore || 0) >= 40 ? "text-amber-600 dark:text-amber-400" : "text-red-500 dark:text-red-400";
            return (
              <Card key={d.id} data-testid={`card-driver-${d.id}`} className={`cursor-pointer hover-elevate transition-shadow relative ${!isActive ? "opacity-80 border-red-400/40" : ""}`} role="button" tabIndex={0} onClick={() => setSelectedDriverId(d.id)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setSelectedDriverId(d.id); } }}>
                <button
                  className={`absolute top-2 right-2 z-10 h-6 w-6 rounded-full flex items-center justify-center transition-colors ${isActive ? "bg-green-600/20 text-green-600 hover:bg-green-600/30" : "bg-red-500/20 text-red-500 hover:bg-red-500/30"}`}
                  onClick={(e) => { e.stopPropagation(); toggleDriverActive(d.id); }}
                  data-testid={`button-toggle-driver-${d.id}`}
                >
                  <Power className="w-3 h-3" />
                </button>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-3">
                      <div className="h-10 w-10 rounded-full flex items-center justify-center text-[14px] font-bold text-white shrink-0" style={{ backgroundColor: isActive ? d.color : "#9ca3af" }} data-testid={`avatar-driver-${d.id}`}>
                        {d.icon}
                      </div>
                      <div>
                        <div className="flex items-center gap-1.5">
                          <p className="text-[14px] font-bold leading-tight" data-testid={`text-driver-name-${d.id}`}>{d.name}</p>
                          {driverPhoneMap[d.name.toLowerCase().trim()] && (
                            <CallDriverButton phone={driverPhoneMap[d.name.toLowerCase().trim()]} driverName={d.name} variant="icon" testId={`button-call-driver-card-${d.id}`} />
                          )}
                        </div>
                        <p className="text-[11px] text-muted-foreground leading-snug" data-testid={`text-driver-vehicle-${d.id}`}>{d.vehicle.split(" ").slice(1).join(" ")}</p>
                        <p className="text-[11px] text-muted-foreground font-mono leading-snug" data-testid={`text-driver-plate-${d.id}`}>{d.plate}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 mr-6">
                      <Badge
                        variant={tripSt[d.id] === "LOCKED" ? "default" : "secondary"}
                        className={`text-[10px] ${!isActive ? "bg-red-500/15 text-red-500 border-red-500/30" : ""}`}
                        data-testid={`badge-trip-status-${d.id}`}
                      >
                        {!isActive ? "OFFLINE" : tripSt[d.id]}
                      </Badge>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="grid grid-cols-2 gap-x-4 gap-y-2.5">
                    <div>
                      <p className="text-[11px] text-muted-foreground">Shipments</p>
                      <p className="text-[20px] font-semibold tabular-nums leading-tight" data-testid={`text-shipments-${d.id}`}>{st.shipments}</p>
                    </div>
                    <div>
                      <p className="text-[11px] text-muted-foreground">Stops</p>
                      <p className="text-[20px] font-semibold tabular-nums leading-tight" data-testid={`text-stops-${d.id}`}>{trip.stops.length}</p>
                    </div>
                    <div>
                      <p className="text-[11px] text-muted-foreground">Distance</p>
                      <p className="text-[14px] font-medium tabular-nums" data-testid={`text-distance-${d.id}`}>{st.totalKm} km</p>
                    </div>
                    <div>
                      <p className="text-[11px] text-muted-foreground">COGS</p>
                      <p className="text-[14px] font-medium tabular-nums text-red-500 dark:text-red-400" data-testid={`text-cogs-${d.id}`}>R{st.cogs}</p>
                    </div>
                    <div>
                      <p className="text-[11px] text-muted-foreground">Time</p>
                      <p className="text-[13px] font-medium tabular-nums" data-testid={`text-time-${d.id}`}>{st.startTime} - {st.endTime}</p>
                    </div>
                    <div>
                      <p className="text-[11px] text-muted-foreground">Mileage</p>
                      <p className="text-[13px] font-medium tabular-nums" data-testid={`text-mileage-${d.id}`}>{st.mileage || 0} km/L</p>
                    </div>
                  </div>
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <p className="text-[11px] text-muted-foreground">Capacity</p>
                      <span className={`text-[11px] font-semibold tabular-nums ${capacityColor}`} data-testid={`text-capacity-${d.id}`}>{st.capacityScore || 0}%</span>
                    </div>
                    <Progress value={st.capacityScore || 0} className="h-1.5" />
                    <p className="text-[10px] text-muted-foreground mt-1">{st.shipments}/20 trips · {st.shipments >= 15 ? "near capacity" : st.shipments >= 8 ? "good load" : "light load"}</p>
                  </div>
                  {trafficStatus.enabled && (() => {
                    const td = driverTraffic.get(d.id);
                    const level = td?.worstCongestion || "NORMAL";
                    const delay = td ? Math.round(td.totalDelayMin) : 0;
                    const congLegs = td ? td.legDetails.filter((l: any) => l.congestion !== "NORMAL").length : 0;
                    const badgeCls = level === "STANDSTILL" ? "bg-red-500/10 border-red-500/30 text-red-700 dark:text-red-400"
                      : level === "HEAVY" ? "bg-orange-500/10 border-orange-500/30 text-orange-700 dark:text-orange-400"
                      : level === "SLOW" ? "bg-yellow-500/10 border-yellow-500/30 text-yellow-700 dark:text-yellow-400"
                      : "bg-green-500/10 border-green-500/30 text-green-700 dark:text-green-400";
                    const dotCls = level === "STANDSTILL" ? "bg-red-500" : level === "HEAVY" ? "bg-orange-500" : level === "SLOW" ? "bg-yellow-400" : "bg-green-500";
                    return (
                      <div className="pt-2 border-t border-border flex items-center justify-between gap-2 flex-wrap">
                        <Badge variant="outline" className={`text-[11px] font-semibold ${badgeCls}`} data-testid={`badge-traffic-status-${d.id}`}>
                          <span className={`w-1.5 h-1.5 rounded-full mr-1.5 ${dotCls} ${level !== "NORMAL" ? "animate-pulse" : ""}`} />
                          {td ? level : "NO SIGNAL"}
                          {delay > 0 && ` · +${delay}min`}
                        </Badge>
                        {td && congLegs > 0 && (
                          <span className="text-[10px] text-muted-foreground">{congLegs} slow leg{congLegs !== 1 ? "s" : ""}</span>
                        )}
                        {td && congLegs === 0 && (
                          <span className="text-[10px] text-muted-foreground">All clear</span>
                        )}
                        {!td && (
                          <span className="text-[10px] text-muted-foreground">Awaiting data</span>
                        )}
                      </div>
                    );
                  })()}
                  {trip.warnings.length > 0 && (
                    <div className="pt-2 border-t border-border space-y-1">
                      {trip.warnings.slice(0, 3).map((w: WarningItem, i: number) => (
                        <div key={i} className="flex items-start gap-1.5 text-[11px]">
                          <AlertTriangle className={`w-3 h-3 flex-shrink-0 mt-0.5 ${w.sev === "HIGH" ? "text-red-500" : w.sev === "MED" ? "text-amber-500" : "text-muted-foreground"}`} />
                          <span className="text-muted-foreground">{w.msg}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>

        {allWarn.length > 0 && (
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-500" />
                <span className="text-[13px] font-semibold">Warnings ({allWarn.length})</span>
              </div>
            </CardHeader>
            <CardContent>
              <ScrollArea className="max-h-[200px]">
                <div className="space-y-1.5">
                  {allWarn.map((w: WarningItem, i: number) => (
                    <div key={i} className="flex items-start gap-2 text-[12px]">
                      <Badge variant={w.sev === "HIGH" ? "destructive" : "secondary"} className="text-[9px] flex-shrink-0">{w.sev}</Badge>
                      <span className="text-muted-foreground">{w.msg}</span>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>
        )}

        {insights.length > 0 && (
          <Card data-testid="card-insights">
            <CardHeader className="pb-2">
              <div className="flex items-center gap-2">
                <Lightbulb className="w-4 h-4 text-amber-500" />
                <span className="text-[13px] font-semibold">Alerts & Insights ({insights.length})</span>
              </div>
              <p className="text-[11px] text-muted-foreground mt-0.5">Route tips, fuel advice, punctuality checks, and capacity guidance</p>
            </CardHeader>
            <CardContent>
              <InsightsPanel insights={insights} />
            </CardContent>
          </Card>
        )}
      </div>
      </PageBody>
    </ScrollArea>

      <DriverDetailModal
        open={!!selectedDriverId}
        onClose={() => setSelectedDriverId(null)}
        trip={selectedTrip}
        ships={ships}
        asgn={asgn}
        setAsgn={setAsgn}
        fleet={fleet}
        fleetSettings={fleetSettings}
        log={log}
        driverPhoneMap={driverPhoneMap}
        onMoveStop={moveStop}
        onMergeStop={mergeStop}
        onSplitStop={splitStop}
        isLocked={selectedDriverId ? tripSt[selectedDriverId] === "LOCKED" : false}
        deliveryOverrides={deliveryOverrides}
        onSetDeliveryOverride={setDeliveryOverride}
        onClearDeliveryOverride={clearDeliveryOverride}
        collectionOverrides={collectionOverrides}
        onSetCollectionOverride={setCollectionOverride}
        onClearCollectionOverride={clearCollectionOverride}
      />
    </>
  );
}

function MetricCard({ label, value, sub, trend, color, breakdown }: { label: string; value: string; sub?: string; trend?: "up" | "down"; color?: "green" | "red" | "amber" | "blue"; breakdown?: string }) {
  const colorClass = color === "green" ? "text-emerald-600 dark:text-emerald-400"
    : color === "red" ? "text-red-500 dark:text-red-400"
    : color === "amber" ? "text-amber-600 dark:text-amber-400"
    : color === "blue" ? "text-blue-600 dark:text-blue-400"
    : "";
  return (
    <Card>
      <CardContent className="pt-4 pb-4">
        <p className="text-[11px] text-muted-foreground font-medium">{label}</p>
        <div className="flex items-end gap-2 mt-1">
          <p className={`text-[22px] font-semibold tabular-nums leading-none tracking-tight ${colorClass}`}>{value}</p>
          {sub && <span className="text-[11px] text-muted-foreground mb-0.5">{sub}</span>}
        </div>
        {trend && (
          <div className={`mt-2 flex items-center gap-0.5 text-[11px] ${trend === "up" ? "text-emerald-600 dark:text-emerald-400" : "text-red-500 dark:text-red-400"}`}>
            <ArrowUpRight className={`w-3 h-3 ${trend === "down" ? "rotate-90" : ""}`} />
          </div>
        )}
        {breakdown && (
          <p className="text-[10px] text-muted-foreground mt-1.5 leading-snug" data-testid={`breakdown-${label.toLowerCase().replace(/[^a-z0-9]/g, "-")}`}>{breakdown}</p>
        )}
      </CardContent>
    </Card>
  );
}

// Reconstructs individual single-shipment stops from an auto-grouped or
// merged collection/delivery stop. Used by splitStop when no `_unmerged`
// metadata is present (the optimizer batched the shipments together).
// Throws if any id in `parent.ids` cannot be found in `ships` so the caller
// can fail loudly instead of silently dropping shipments off the route.
function splitGroupedStop(parent: Stop, ships: Shipment[]): Stop[] {
  const shipsById = new Map(ships.map(s => [s.id, s]));
  const matched: Shipment[] = [];
  const missing: string[] = [];
  for (const id of parent.ids) {
    const sh = shipsById.get(id);
    if (sh) matched.push(sh); else missing.push(id);
  }
  if (missing.length > 0) {
    throw new Error(`Cannot split: ${missing.length} shipment id(s) missing from current data (${missing.join(", ")})`);
  }
  return matched.map((sh) => {
    const isCol = parent.type === "C";
    const win = isCol
      ? sh.cAfter + (sh.cBefore && sh.cBefore !== sh.cAfter ? "-" + sh.cBefore : "")
      : sh.dAfter + (sh.dBefore && sh.dBefore !== sh.dAfter ? "-" + sh.dBefore : "");
    const piece: Stop = {
      ...parent,
      key: (isCol ? "C_" : "D_") + sh.id,
      wbs: [sh.wb],
      ids: [sh.id],
      sub: isCol ? sh.cSub : sh.dSub,
      city: isCol ? sh.cCity : sh.dCity,
      addr: isCol ? sh.cAddr : sh.dAddr,
      acc: sh.acc,
      pcs: sh.pcs,
      kg: sh.kg,
      win,
      svcMin: svcTime(parent.type, sh.pcs),
      lat: isCol ? sh.cLat : sh.dLat,
      lng: isCol ? sh.cLng : sh.dLng,
      contact: isCol ? sh.cContact : sh.dContact,
      phone: isCol ? sh.cPhone : sh.dPhone,
      instr: isCol ? sh.iCol : sh.iDel,
      spx: sh.svc === "SPX",
      parcelType: sh.parcelType || undefined,
      parcelCategory: sh.parcelCategory || undefined,
      clientName: sh.clientName || undefined,
      waitMin: 0,
    };
    if (!isCol) {
      piece.deadline = sh.dBefore;
      piece.sid = sh.id;
    } else {
      delete (piece as any).deadline;
      delete (piece as any).sid;
    }
    delete (piece as any)._unmerged;
    return piece;
  });
}

function recalcStops(stops: Stop[], driver: any): Stop[] {
  let curTime = toM(driver.shift[0])!;
  let prevLat = driver.depotLat;
  let prevLng = driver.depotLng;
  let prevLabel = driver.depot + " (Home)";
  let seq = 0;
  const out = stops.map((stop) => {
    const drv = calcDrive({ lat: prevLat, lng: prevLng }, { lat: stop.lat, lng: stop.lng }, curTime);
    const arriveTime = curTime + drv.min;
    const winStart = toM(stop.win?.split("-")[0] || "") || 0;
    // Clamp BOTH collections and deliveries to window start (consistent with buildSched).
    const actualStart = (stop.type === "C" || stop.type === "D") ? Math.max(arriveTime, winStart) : arriveTime;
    const svc = stop.svcMin;
    seq++;
    const winEnd = toM(stop.win?.split("-")[1] || stop.win?.split("-")[0] || "") || 1080;
    const late = stop.type === "C" ? arriveTime > winEnd + 10 : false;
    const slack = stop.type === "D" ? winEnd - actualStart : undefined;
    const updated: Stop = {
      ...stop,
      seq,
      legKm: Math.round(drv.km * 10) / 10,
      legMin: Math.round(drv.min),
      eta: fmM(actualStart),
      etaM: actualStart,
      arriveM: arriveTime,
      waitMin: Math.max(0, actualStart - arriveTime),
      lingerMin: 0,
      fromLoc: prevLabel,
      late: late || (slack != null && slack < -5),
      slack: stop.type === "D" ? Math.round(slack || 0) : undefined,
    };
    curTime = actualStart + svc;
    prevLat = stop.lat;
    prevLng = stop.lng;
    prevLabel = subCity(stop.sub, stop.city) + (stop.type === "C" ? " (Col)" : stop.type === "D" ? " (Del)" : "");
    return updated;
  });
  // Mirror buildSched linger post-pass: push wait at stop i into linger at i-1.
  // First stop's wait stays in place (effectively a "depot linger" — driver
  // delays departure rather than idling on-site early).
  for (let i = 1; i < out.length; i++) {
    const st = out[i];
    const w = Math.round(st.waitMin || 0);
    if (w <= 0) continue;
    out[i - 1].lingerMin = (out[i - 1].lingerMin || 0) + w;
    st.arriveM = st.etaM;
    st.waitMin = 0;
  }
  return out;
}

function TripsTab({ tl, tripSt, setTripSt, stopSt, toggleStopStatus, expandedTrips, setExpandedTrips, asgn, setAsgn, ships, log, trafficCond, selectedDay, fleet, runOptimizer, optimizing, userReports, stopOverrides, setStopOverrides, setStopGroupings, mergeStopGlobal, splitStopGlobal, groupStopsGlobal }: any) {
  const { toast } = useToast();
  const isSaturday = selectedDay && selectedDay !== "all" ? new Date(selectedDay + "T00:00:00").getDay() === 6 : false;
  const insights = useMemo(() => generateInsights(tl, ships, trafficCond || "normal", isSaturday, userReports), [tl, ships, trafficCond, isSaturday, userReports]);
  const [manualEdits, setManualEdits] = useState(0);

  // Push manual edits (reassign / reorder / merge / split) to the server right
  // away so the live-ETA + reassignment cascade fires off the new assignments
  // without waiting for the autosave debounce. The flush is deferred to a
  // macrotask so the parent's autosave-schedule effect (which runs AFTER this
  // child effect) has queued the fresh payload first.
  const lastFlushedEdits = useRef(0);
  useEffect(() => {
    if (manualEdits > lastFlushedEdits.current) {
      lastFlushedEdits.current = manualEdits;
      const t = setTimeout(() => { autosave.flushNow(); }, 0);
      return () => clearTimeout(t);
    }
  }, [manualEdits]);

  const { data: driverAccounts = [] } = useTanQuery({
    queryKey: ["/api/auth/driver-accounts"],
  });
  const driverPhoneMap = useMemo(() => {
    const map: Record<string, string> = {};
    (driverAccounts as any[]).forEach((acc: any) => {
      if (acc.phone && acc.driverName) {
        map[acc.driverName.toLowerCase().trim()] = acc.phone;
      }
    });
    return map;
  }, [driverAccounts]);

  function reassignStop(stop: Stop, fromDriverId: string, toDriverId: string) {
    if (tripSt[fromDriverId] === "LOCKED") {
      toast({ title: "Trip is locked", description: "Unlock the trip before reassigning stops", variant: "destructive" });
      return;
    }
    const shipIds = stop.ids && stop.ids.length > 0 ? stop.ids : [];
    if (!shipIds.length) return;

    const toDriver = fleet.find((d: any) => d.id === toDriverId);
    const fromDriver = fleet.find((d: any) => d.id === fromDriverId);
    const newAsgn = { ...asgn };
    shipIds.forEach((sid: string) => { newAsgn[sid] = toDriverId; });
    setAsgn(newAsgn);
    setStopOverrides((prev: Record<string, Stop[]>) => {
      const next = { ...prev };
      delete next[fromDriverId];
      delete next[toDriverId];
      return next;
    });
    setManualEdits((p: number) => p + 1);

    const label = stop.wbs.length > 0 ? stop.wbs.join(", ") : subCity(stop.sub, stop.city);
    log(`Reassigned ${label} from ${fromDriver?.name || fromDriverId} to ${toDriver?.name || toDriverId}`, "MANUAL");
    toast({ title: "Shipment reassigned", description: `${label} moved to ${toDriver?.name || toDriverId}` });
    // Audit log each shipment reassignment
    shipIds.forEach((sid: string) => {
      postAuditLog({ eventType: "DRIVER_REASSIGNED", entityType: "shipment", entityId: sid, previousValue: { driverId: fromDriverId, driverName: fromDriver?.name }, newValue: { driverId: toDriverId, driverName: toDriver?.name }, details: `${label} moved via Trip Sheet` });
    });
  }

  function moveStop(driverId: string, fromIdx: number, toIdx: number) {
    if (tripSt[driverId] === "LOCKED") {
      toast({ title: "Trip is locked", description: "Unlock the trip before reordering stops", variant: "destructive" });
      return;
    }
    const trip = tl[driverId];
    if (!trip) return;
    const driver = fleet.find((d: any) => d.id === driverId);
    if (!driver) return;
    const currentStops = [...trip.stops];
    const newStops = [...currentStops];
    const [moved] = newStops.splice(fromIdx, 1);
    newStops.splice(toIdx, 0, moved);
    const recalculated = recalcStops(newStops, driver);
    setStopOverrides((prev: Record<string, Stop[]>) => ({ ...prev, [driverId]: recalculated }));
    setManualEdits((p) => p + 1);
    log(`Reordered ${subCity(moved.sub, moved.city)} (${moved.type === "C" ? "Col" : "Del"}) in ${driver.name}'s trip`, "MANUAL");
    postAuditLog({ eventType: "TRIP_SEQUENCE_UPDATED", entityType: "trip", entityId: driverId, previousValue: { position: fromIdx }, newValue: { position: toIdx }, details: `${subCity(moved.sub, moved.city)} moved ${fromIdx < toIdx ? "down" : "up"} in ${driver.name}'s trip` });
  }

  // Grouping handlers delegate to the global versions in the parent so the
  // durable `stopGroupings` state lives in one place. Manual-edit counter
  // still bumps so the "Re-optimize" badge appears.
  function mergeStop(driverId: string, idxA: number) {
    if (typeof mergeStopGlobal === "function") {
      mergeStopGlobal(driverId, idxA);
      setManualEdits((p) => p + 1);
    }
  }
  function splitStop(driverId: string, idx: number) {
    if (typeof splitStopGlobal === "function") {
      splitStopGlobal(driverId, idx);
      setManualEdits((p) => p + 1);
    }
  }
  function groupStops(driverId: string, stopIndices: number[]) {
    if (typeof groupStopsGlobal === "function") {
      groupStopsGlobal(driverId, stopIndices);
      setManualEdits((p) => p + 1);
    }
  }

  return (
    <ScrollArea className="flex-1">
      <PageHeader title="Trip Sheets" subtitle="Manage routes, lock trips, and track stop progress" bgImage={bgTrips}>
        <div className="flex items-center gap-2">
          {manualEdits > 0 && (
            <Badge variant="secondary" className="text-[10px] bg-white/20 border-white/30 text-white">
              {manualEdits} manual edit{manualEdits > 1 ? "s" : ""}
            </Badge>
          )}
          {manualEdits > 0 && (
            <Button
              variant="outline"
              size="sm"
              className="font-bold bg-white/20 border-white/30 text-white backdrop-blur-sm"
              disabled={optimizing}
              onClick={() => { runOptimizer(null, false, true); setManualEdits(0); setStopOverrides({}); }}
              data-testid="button-reoptimize-manual"
            >
              {optimizing ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <RefreshCw className="w-3 h-3 mr-1" />}
              Re-optimize around changes
            </Button>
          )}
        </div>
      </PageHeader>
      <PageBody bgImages={[bgTrips, bgDriver, bgImport]}>
      <div className="p-6 space-y-4">
        <WaybillSearch ships={ships} asgn={asgn} setAsgn={setAsgn} fleet={fleet} log={log} />
        {fleet.map((d: any) => {
          const trip = tl[d.id];
          if (!trip) return null;
          const isExpanded = expandedTrips[d.id];
          const st = trip.stats;
          const driverInsights = insights.filter((i: Insight) => i.driver === d.id);

          return (
            <Card key={d.id} data-testid={`trip-card-${d.id}`}>
              <CardHeader
                className="cursor-pointer flex flex-row items-center justify-between gap-2 pb-3"
                onClick={() => setExpandedTrips((p: any) => ({ ...p, [d.id]: !p[d.id] }))}
              >
                <div className="flex items-center gap-3">
                  <div className="h-9 w-9 rounded-full flex items-center justify-center text-[12px] font-bold text-white shrink-0" style={{ backgroundColor: d.color }}>
                    {d.icon}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-[14px] font-bold">{d.name}</span>
                      {driverPhoneMap[d.name.toLowerCase().trim()] && (
                        <CallDriverButton phone={driverPhoneMap[d.name.toLowerCase().trim()]} driverName={d.name} variant="icon" testId={`button-call-trip-${d.id}`} />
                      )}
                      <Badge variant="secondary" className="text-[10px]">{tripSt[d.id]}</Badge>
                      {driverInsights.some((i: Insight) => i.sev === "warning") && (
                        <Badge variant="destructive" className="text-[9px]">{driverInsights.filter((i: Insight) => i.sev === "warning").length} alert{driverInsights.filter((i: Insight) => i.sev === "warning").length > 1 ? "s" : ""}</Badge>
                      )}
                      {driverInsights.some((i: Insight) => i.sev === "tip") && !driverInsights.some((i: Insight) => i.sev === "warning") && (
                        <Badge variant="secondary" className="text-[9px]">{driverInsights.filter((i: Insight) => i.sev === "tip").length} tip{driverInsights.filter((i: Insight) => i.sev === "tip").length > 1 ? "s" : ""}</Badge>
                      )}
                    </div>
                    <p className="text-[12px] text-muted-foreground mt-0.5">
                      {st.shipments} shipments · {st.totalKm}km · {st.startTime}-{st.endTime}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {tripSt[d.id] !== "LOCKED" && st.shipments > 0 && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="font-bold"
                      onClick={(e) => {
                        e.stopPropagation();
                        setTripSt((p: any) => ({ ...p, [d.id]: "LOCKED" }));
                        log(`${d.name} trip LOCKED`, "OPS");
                      }}
                      data-testid={`button-lock-${d.id}`}
                    >
                      <Lock className="w-3 h-3 mr-1" />
                      Lock
                    </Button>
                  )}
                  {tripSt[d.id] === "LOCKED" && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="font-bold"
                      onClick={(e) => {
                        e.stopPropagation();
                        setTripSt((p: any) => ({ ...p, [d.id]: "GENERATED" }));
                        log(`${d.name} trip UNLOCKED`, "OPS");
                      }}
                      data-testid={`button-unlock-${d.id}`}
                    >
                      <Unlock className="w-3 h-3 mr-1" />
                      Unlock
                    </Button>
                  )}
                  {isExpanded ? <ChevronDown className="w-4 h-4 text-muted-foreground" /> : <ChevronRight className="w-4 h-4 text-muted-foreground" />}
                </div>
              </CardHeader>
              {isExpanded && (
                <CardContent className="pt-0">
                  {trip.fallbacks.length > 0 && (
                    <div className="mb-3 space-y-1">
                      {trip.fallbacks.map((f: any, i: number) => (
                        <div key={i} className="flex items-start gap-2 text-[12px] bg-amber-50 dark:bg-amber-900/20 rounded-md p-2.5">
                          <AlertTriangle className="w-3.5 h-3.5 text-amber-500 flex-shrink-0 mt-0.5" />
                          <span className="text-amber-700 dark:text-amber-400">{f.msg}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  {driverInsights.length > 0 && (
                    <div className="mb-3 border-b border-border pb-3" data-testid={`insights-driver-${d.id}`}>
                      <div className="flex items-center gap-1.5 mb-2">
                        <Lightbulb className="w-3.5 h-3.5 text-amber-500" />
                        <span className="text-[12px] font-semibold">Route Insights</span>
                      </div>
                      <InsightsPanel insights={insights} filterDriver={d.id} />
                    </div>
                  )}
                  {(() => {
                    const displayStops = trip.stops;
                    return displayStops.length === 0 ? (
                      <p className="text-[12px] text-muted-foreground text-center py-6">No stops assigned</p>
                    ) : (
                      <div className="space-y-0">
                        {displayStops.map((stop: Stop, i: number) => (
                          <StopRow key={stop.key} stop={stop} driver={d} toggleStopStatus={toggleStopStatus} i={i} totalStops={displayStops.length} fleet={fleet} onReassign={reassignStop} isLocked={tripSt[d.id] === "LOCKED"} onMoveStop={moveStop} nextStop={displayStops[i + 1] || null} onMergeStop={mergeStop} onSplitStop={splitStop} />
                        ))}
                      </div>
                    );
                  })()}
                </CardContent>
              )}
            </Card>
          );
        })}
      </div>
      </PageBody>
    </ScrollArea>
  );
}

function StopRow({ stop, driver, toggleStopStatus, i, totalStops, fleet, onReassign, isLocked, onMoveStop, nextStop, onMergeStop, onSplitStop }: { stop: Stop; driver: any; toggleStopStatus: (key: string) => void; i: number; totalStops: number; fleet?: any[]; onReassign?: (stop: Stop, fromDriverId: string, toDriverId: string) => void; isLocked?: boolean; onMoveStop?: (driverId: string, fromIdx: number, toIdx: number) => void; nextStop?: Stop | null; onMergeStop?: (driverId: string, idx: number) => void; onSplitStop?: (driverId: string, idx: number) => void }) {
  const isHome = stop.type === "H" || stop.type === "RTN";
  const isCol = stop.type === "C";
  const isExchange = stop.type === "X";
  const canReassign = !isHome && !isExchange && fleet && onReassign && !isLocked && stop.ids && stop.ids.length > 0;
  // Group with next-stop is offered for any non-home/non-exchange stop whose
  // neighbour shares its type. LOCKED trips show the button — clicking it
  // triggers a confirm() dialog rather than hiding the affordance.
  const canGroup = !isHome && !isExchange && (stop.type === "C" || stop.type === "D") && nextStop != null && nextStop.type === stop.type && onMergeStop != null;
  // Ungroup is always available for any grouped stop (>=2 ids, or carries
  // `grouped` flag, or has unmergedIds metadata). Works on LOCKED trips with
  // confirm(). The `stopsCanMerge` strict gate is no longer used.
  const canUngroup = !isHome && !isExchange && (stop.type === "C" || stop.type === "D") && (((stop as any).grouped === true) || ((stop as any).unmergedIds?.length ?? 0) >= 2 || (stop.ids?.length ?? 0) >= 2) && onSplitStop != null;
  const otherDrivers = fleet?.filter((d: any) => d.id !== driver.id) || [];

  const statusIcon = stop.status === "DONE" ? (
    <CheckCircle2 className="w-4 h-4 text-green-500" />
  ) : stop.status === "ARRIVED" ? (
    <Play className="w-4 h-4 text-blue-500" />
  ) : (
    <Circle className="w-4 h-4 text-muted-foreground/40" />
  );

  return (
    <div
      className={`flex items-start gap-3 px-3 py-2.5 text-[12px] ${stop.late ? "bg-red-50/50 dark:bg-red-900/10" : ""} ${isHome ? "bg-muted/30" : ""} ${isExchange ? "bg-purple-50/50 dark:bg-purple-900/10 border-l-2 border-l-purple-400" : ""} ${i < totalStops - 1 ? "border-b border-border/50" : ""}`}
      data-testid={`stop-${stop.key}`}
    >
      <div className="flex flex-col items-center gap-0.5 pt-0.5">
        <button onClick={() => !isHome && toggleStopStatus(stop.key)} className="cursor-pointer" data-testid={`button-stop-status-${stop.key}`}>
          {statusIcon}
        </button>
        {i < totalStops - 1 && <div className="w-px h-3 bg-border" />}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className={`text-[10px] font-semibold uppercase tracking-wider ${isExchange ? "text-purple-600 dark:text-purple-400" : isCol ? "text-amber-600 dark:text-amber-400" : isHome ? "text-muted-foreground" : "text-blue-600 dark:text-blue-400"}`}>
            {isExchange ? "XCHG" : isCol ? "COL" : isHome ? "HOME" : "DEL"}
          </span>
          <span className="font-medium text-[12px]">{subCity(stop.sub, stop.city)}</span>
          {isExchange && <Badge variant="secondary" className="text-[9px] bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300">HANDOFF</Badge>}
          {stop.spx && <Badge variant="destructive" className="text-[9px]">SPX</Badge>}
          {stop.late && <Badge variant="destructive" className="text-[9px]">LATE</Badge>}
          {stop.wbs.length > 0 && (
            <span className="text-muted-foreground font-mono text-[10px]">{stop.wbs.join(", ")}</span>
          )}
        </div>
        <div className="flex items-center gap-3 mt-0.5 text-[11px] text-muted-foreground flex-wrap">
          <span className="tabular-nums">ETA {stop.eta}</span>
          {stop.win && <span>{stop.win}</span>}
          <span className="tabular-nums">{stop.legKm}km · {stop.legMin}min</span>
          {stop.pcs > 0 && <span>{stop.pcs}pcs · {stop.kg}kg</span>}
          {stop.slack != null && stop.type === "D" && (
            <span className={`tabular-nums ${stop.slack < 0 ? "text-red-500" : stop.slack < 15 ? "text-amber-500" : ""}`}>
              {stop.slack > 0 ? "+" : ""}{stop.slack}m
            </span>
          )}
        </div>
        {(stop.clientName || stop.acc) && (
          <div className="text-[11px] mt-0.5 flex items-center gap-1.5 flex-wrap" data-testid={`stop-client-${stop.key}`}>
            {stop.clientName && <span className="font-medium text-foreground/80">{stop.clientName}</span>}
            {stop.acc && <span className="text-muted-foreground font-mono text-[10px]">({stop.acc})</span>}
          </div>
        )}
        {stop.contact && (
          <div className="text-[11px] text-muted-foreground mt-0.5">
            {stop.contact} {stop.phone && <span>· {stop.phone}</span>}
          </div>
        )}
        {stop.instr && (
          <div className="text-[11px] text-muted-foreground italic mt-0.5">{stop.instr}</div>
        )}
      </div>
      <div className="flex items-center gap-1 flex-shrink-0">
        {!isHome && !isLocked && onMoveStop && (
          <div className="flex flex-col gap-0">
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  className={`w-6 h-5 flex items-center justify-center rounded-sm ${i <= 0 ? "opacity-20 cursor-not-allowed" : "text-muted-foreground hover:text-foreground hover-elevate cursor-pointer"}`}
                  disabled={i <= 0}
                  onClick={() => i > 0 && onMoveStop(driver.id, i, i - 1)}
                  data-testid={`button-move-up-${stop.key}`}
                >
                  <ArrowUp className="w-3 h-3" />
                </button>
              </TooltipTrigger>
              <TooltipContent>Move up</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  className={`w-6 h-5 flex items-center justify-center rounded-sm ${i >= totalStops - 1 ? "opacity-20 cursor-not-allowed" : "text-muted-foreground hover:text-foreground hover-elevate cursor-pointer"}`}
                  disabled={i >= totalStops - 1}
                  onClick={() => i < totalStops - 1 && onMoveStop(driver.id, i, i + 1)}
                  data-testid={`button-move-down-${stop.key}`}
                >
                  <ArrowDown className="w-3 h-3" />
                </button>
              </TooltipTrigger>
              <TooltipContent>Move down</TooltipContent>
            </Tooltip>
          </div>
        )}
        {canGroup && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                className="w-7 h-7 rounded-md flex items-center justify-center text-amber-500 hover:text-amber-700 dark:hover:text-amber-300 hover-elevate cursor-pointer"
                onClick={() => onMergeStop!(driver.id, i)}
                data-testid={`button-group-stop-${stop.key}`}
              >
                <Merge className="w-3.5 h-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent>{isLocked ? "Group with next stop (will ask to confirm — trip is LOCKED)" : "Group with next stop"}</TooltipContent>
          </Tooltip>
        )}
        {canUngroup && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                className="w-7 h-7 rounded-md flex items-center justify-center text-blue-500 hover:text-blue-700 dark:hover:text-blue-300 hover-elevate cursor-pointer"
                onClick={() => onSplitStop!(driver.id, i)}
                data-testid={`button-ungroup-stop-${stop.key}`}
              >
                <Split className="w-3.5 h-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent>{isLocked ? "Ungroup back into individual stops (will ask to confirm — trip is LOCKED)" : "Ungroup back into individual stops"}</TooltipContent>
          </Tooltip>
        )}
        {canReassign && otherDrivers.length > 0 && (
          <Select onValueChange={(toId) => onReassign!(stop, driver.id, toId)}>
            <Tooltip>
              <TooltipTrigger asChild>
                <SelectTrigger className="h-7 w-7 p-0 border-0 bg-transparent [&>svg:last-child]:hidden" data-testid={`button-reassign-${stop.key}`}>
                  <ArrowRightLeft className="w-3.5 h-3.5 text-muted-foreground" />
                </SelectTrigger>
              </TooltipTrigger>
              <TooltipContent>Move to another driver</TooltipContent>
            </Tooltip>
            <SelectContent>
              {otherDrivers.map((od: any) => (
                <SelectItem key={od.id} value={od.id} data-testid={`reassign-option-${od.id}`}>
                  <div className="flex items-center gap-2">
                    <div className="w-4 h-4 rounded-full flex items-center justify-center text-[8px] font-bold text-white" style={{ backgroundColor: od.color }}>{od.icon}</div>
                    <span className="text-[12px]">{od.name}</span>
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        {stop.lat !== 0 && (
          <Tooltip>
            <TooltipTrigger asChild>
              <a
                href={gMap(stop.lat, stop.lng)}
                target="_blank"
                rel="noopener noreferrer"
                className="w-7 h-7 rounded-md flex items-center justify-center text-muted-foreground hover-elevate"
                data-testid={`link-map-${stop.key}`}
              >
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            </TooltipTrigger>
            <TooltipContent>Open in Google Maps</TooltipContent>
          </Tooltip>
        )}
      </div>
    </div>
  );
}

function HandoffsTab({ handoffs, setHandoffs, handoffPoints, fleet, ships, asgn, log, tl }: any) {
  const { toast } = useToast();

  function removeHandoff(id: string) {
    setHandoffs((p: HandoffEvent[]) => p.filter(h => h.id !== id));
    log(`Handoff removed: ${id}`, "HANDOFF");
    toast({ title: "Handoff removed" });
  }

  function confirmHandoff(id: string, role: "from" | "to") {
    setHandoffs((p: HandoffEvent[]) => p.map(h => {
      if (h.id !== id) return h;
      const updated = { ...h };
      if (role === "from") updated.fromConfirmed = true;
      if (role === "to") updated.toConfirmed = true;
      if (updated.fromConfirmed && updated.toConfirmed) {
        updated.status = "confirmed";
      }
      return updated;
    }));
    toast({ title: "Handoff confirmed" });
  }

  function completeHandoff(id: string) {
    setHandoffs((p: HandoffEvent[]) => p.map(h => {
      if (h.id !== id) return h;
      return { ...h, status: "completed", completedAt: new Date().toISOString() };
    }));
    log(`Handoff completed: ${id}`, "HANDOFF");
    toast({ title: "Handoff completed" });
  }

  const activeHandoffs = handoffs.filter((h: HandoffEvent) => h.status === "planned" || h.status === "confirmed");
  const completedHandoffs = handoffs.filter((h: HandoffEvent) => h.status === "completed");
  const cancelledHandoffs = handoffs.filter((h: HandoffEvent) => h.status === "cancelled");

  return (
    <ScrollArea className="flex-1">
      <PageHeader title="Driver Handoffs" subtitle="Automatic mid-journey parcel exchanges between drivers at petrol stations" bgImage={bgTrips}>
        <Badge variant="secondary" className="font-bold backdrop-blur-sm bg-purple-500/30 border-purple-300/50 text-white text-[11px]" data-testid="badge-handoffs-active">
          <Repeat2 className="w-3 h-3 mr-1" />
          Always Active
        </Badge>
      </PageHeader>
      <PageBody bgImages={[bgTrips, bgDriver]}>
        <div className="p-6 space-y-6">
          {activeHandoffs.length === 0 && (
            <Card>
              <CardContent className="py-6 text-center">
                <Users className="w-8 h-8 mx-auto mb-2 text-muted-foreground/40" />
                <p className="text-[13px] font-semibold mb-1">No handoff opportunities detected</p>
                <p className="text-[12px] text-muted-foreground max-w-md mx-auto">
                  Handoffs are automatically planned when you optimise routes. If a shipment's collection and delivery are far apart and another driver is closer to the delivery, the optimiser splits the route via a petrol station meeting point.
                </p>
              </CardContent>
            </Card>
          )}

          {activeHandoffs.length > 0 && (
            <Card data-testid="active-handoffs">
              <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
                <div className="flex items-center gap-2">
                  <Repeat2 className="w-4 h-4 text-purple-500" />
                  <span className="text-[14px] font-bold">Active Handoffs</span>
                  <Badge variant="secondary" className="text-[10px] bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300">{activeHandoffs.length}</Badge>
                  <Badge variant="secondary" className="text-[9px]">Auto-planned</Badge>
                </div>
              </CardHeader>
              <CardContent className="pt-0 space-y-2">
                {activeHandoffs.map((h: HandoffEvent) => {
                  const fromDriver = fleet.find((d: any) => d.id === h.fromDriverId);
                  const toDriver = fleet.find((d: any) => d.id === h.toDriverId);
                  const point = handoffPoints.find((p: HandoffPoint) => p.id === h.pointId);
                  const handoffShips = h.shipmentIds.map((sid: string) => ships.find((s: Shipment) => s.id === sid)).filter(Boolean);
                  const wbs = handoffShips.map((s: Shipment) => s.wb).join(", ");

                  return (
                    <div key={h.id} className="p-3 rounded-md border border-purple-200 dark:border-purple-800/50 bg-purple-50/50 dark:bg-purple-900/10" data-testid={`handoff-${h.id}`}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-[12px] font-mono font-bold">{wbs || h.shipmentIds.join(", ")}</span>
                            {h.shipmentIds.length > 1 && <Badge variant="secondary" className="text-[9px]">{h.shipmentIds.length} parcels</Badge>}
                            <Badge variant="secondary" className={`text-[9px] ${h.status === "confirmed" ? "bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300" : ""}`}>
                              {h.status.toUpperCase()}
                            </Badge>
                          </div>
                          <div className="flex items-center gap-2 mt-1.5 text-[11px] text-muted-foreground flex-wrap">
                            <div className="flex items-center gap-1">
                              <div className="w-3 h-3 rounded-full" style={{ backgroundColor: fromDriver?.color || "#999" }} />
                              <span>{fromDriver?.name}</span>
                              {h.fromConfirmed && <UserCheck className="w-3 h-3 text-green-500" />}
                            </div>
                            <ArrowRight className="w-2.5 h-2.5" />
                            <div className="flex items-center gap-1">
                              <div className="w-3 h-3 rounded-full" style={{ backgroundColor: toDriver?.color || "#999" }} />
                              <span>{toDriver?.name}</span>
                              {h.toConfirmed && <UserCheck className="w-3 h-3 text-green-500" />}
                            </div>
                          </div>
                          <div className="flex items-center gap-2 mt-1 text-[11px] text-muted-foreground flex-wrap">
                            <MapPin className="w-3 h-3" />
                            <span>{point?.name || h.pointId}</span>
                            <Separator orientation="vertical" className="h-3" />
                            <Clock className="w-3 h-3" />
                            <span className="tabular-nums">{h.plannedMeetStart} - {h.plannedMeetEnd}</span>
                          </div>
                        </div>
                        <div className="flex items-center gap-1 flex-shrink-0">
                          {!h.fromConfirmed && (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button variant="outline" size="icon" onClick={() => confirmHandoff(h.id, "from")} data-testid={`button-confirm-from-${h.id}`}>
                                  <UserCheck className="w-3.5 h-3.5" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>{fromDriver?.name} confirms</TooltipContent>
                            </Tooltip>
                          )}
                          {!h.toConfirmed && (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button variant="outline" size="icon" onClick={() => confirmHandoff(h.id, "to")} data-testid={`button-confirm-to-${h.id}`}>
                                  <UserCheck className="w-3.5 h-3.5" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>{toDriver?.name} confirms</TooltipContent>
                            </Tooltip>
                          )}
                          {h.status === "confirmed" && (
                            <Button variant="outline" size="sm" className="font-bold" onClick={() => completeHandoff(h.id)} data-testid={`button-complete-${h.id}`}>
                              <CheckCircle2 className="w-3 h-3 mr-1" />
                              Done
                            </Button>
                          )}
                          <Button variant="ghost" size="icon" onClick={() => removeHandoff(h.id)} data-testid={`button-remove-${h.id}`}>
                            <X className="w-3.5 h-3.5 text-muted-foreground" />
                          </Button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          )}

          {completedHandoffs.length > 0 && (
            <Card data-testid="completed-handoffs">
              <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-green-500" />
                  <span className="text-[14px] font-bold">Completed</span>
                  <Badge variant="secondary" className="text-[10px]">{completedHandoffs.length}</Badge>
                </div>
              </CardHeader>
              <CardContent className="pt-0 space-y-1">
                {completedHandoffs.map((h: HandoffEvent) => {
                  const fromDriver = fleet.find((d: any) => d.id === h.fromDriverId);
                  const toDriver = fleet.find((d: any) => d.id === h.toDriverId);
                  const point = handoffPoints.find((p: HandoffPoint) => p.id === h.pointId);
                  const shipment = ships.find((s: Shipment) => h.shipmentIds.includes(s.id));
                  return (
                    <div key={h.id} className="flex items-center gap-3 p-2 rounded-md bg-muted/20 text-[11px] text-muted-foreground" data-testid={`completed-${h.id}`}>
                      <CheckCircle2 className="w-3.5 h-3.5 text-green-500 flex-shrink-0" />
                      <span className="font-mono font-bold">{shipment?.wb || "?"}</span>
                      <span>{fromDriver?.name}</span>
                      <ArrowRight className="w-2.5 h-2.5" />
                      <span>{toDriver?.name}</span>
                      <span className="text-muted-foreground/60">at {point?.name}</span>
                      {h.completedAt && <span className="text-muted-foreground/50 ml-auto tabular-nums">{new Date(h.completedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>}
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          )}

          <Card data-testid="handoff-points">
            <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
              <div className="flex items-center gap-2">
                <Fuel className="w-4 h-4 text-muted-foreground" />
                <span className="text-[14px] font-bold">Meeting Points</span>
                <Badge variant="secondary" className="text-[10px]">{handoffPoints.filter((p: HandoffPoint) => p.active).length} active</Badge>
              </div>
            </CardHeader>
            <CardContent className="pt-0">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-1.5">
                {handoffPoints.map((p: HandoffPoint) => (
                  <div key={p.id} className={`flex items-center gap-2 p-2 rounded-md text-[11px] ${p.active ? "bg-muted/30" : "bg-muted/10 opacity-50"}`} data-testid={`point-${p.id}`}>
                    <Fuel className={`w-3 h-3 flex-shrink-0 ${p.active ? "text-green-500" : "text-muted-foreground/40"}`} />
                    <div className="flex-1 min-w-0">
                      <span className="font-medium">{p.name}</span>
                      <span className="text-muted-foreground ml-1">{p.address}</span>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      </PageBody>
    </ScrollArea>
  );
}

function DriverTab({ tl, drvView, setDrvView, stopSt, toggleStopStatus, fleet, ships, asgn, setAsgn, log }: any) {
  const trip = tl[drvView];
  const driver = fleet.find((d: any) => d.id === drvView);

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <PageHeader title="Driver View" bgImage={bgDriver}>
        <div className="flex gap-1.5">
          {fleet.map((d: any) => (
            <button
              key={d.id}
              className={`px-4 py-2 rounded-md text-[13px] font-bold transition-colors ${drvView === d.id ? "text-white border border-white/30 shadow-lg" : "text-white/80 bg-white/15 border border-white/20 hover:bg-white/25 backdrop-blur-sm"}`}
              style={drvView === d.id ? { backgroundColor: d.color } : {}}
              onClick={() => setDrvView(d.id)}
              data-testid={`button-driver-select-${d.id}`}
            >
              {d.name}
            </button>
          ))}
        </div>
      </PageHeader>
      <ScrollArea className="flex-1">
        <PageBody bgImages={[bgDriver, bgMetrics, bgTrips]}>
        <div className="px-6 pt-6">
          <WaybillSearch ships={ships} asgn={asgn} setAsgn={setAsgn} fleet={fleet} log={log} />
        </div>
        {trip && driver && (
          <div className="p-6 max-w-lg mx-auto space-y-4">
            <Card>
              <CardContent className="pt-5 pb-5">
                <div className="flex items-center gap-3 mb-4">
                  <div className="h-10 w-10 rounded-full flex items-center justify-center text-[14px] font-bold text-white shrink-0" style={{ backgroundColor: driver.color }}>
                    {driver.icon}
                  </div>
                  <div>
                    <p className="text-[15px] font-bold">{driver.name}</p>
                    <p className="text-[12px] text-muted-foreground">{driver.vehicle}</p>
                    <p className="text-[11px] text-muted-foreground font-mono">{driver.plate} · {driver.depot}</p>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div className="bg-muted rounded-md p-3 text-center">
                    <p className="text-[11px] text-muted-foreground">Stops</p>
                    <p className="text-[22px] font-semibold tabular-nums">{trip.stops.length}</p>
                  </div>
                  <div className="bg-muted rounded-md p-3 text-center">
                    <p className="text-[11px] text-muted-foreground">Distance</p>
                    <p className="text-[22px] font-semibold tabular-nums">{trip.stats.totalKm}<span className="text-[12px] text-muted-foreground">km</span></p>
                  </div>
                  <div className="bg-muted rounded-md p-3 text-center">
                    <p className="text-[11px] text-muted-foreground">Time</p>
                    <p className="text-[14px] font-semibold tabular-nums mt-1">{trip.stats.startTime}-{trip.stats.endTime}</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            {trip.stops.map((stop: Stop, i: number) => (
              <Card
                key={stop.key}
                className={`${stop.late ? "border-red-400/30 dark:border-red-800/30" : ""} ${stop.status === "DONE" ? "opacity-50" : ""}`}
                data-testid={`driver-stop-${stop.key}`}
              >
                <CardContent className="pt-4 pb-4">
                  <div className="flex items-start gap-3">
                    <div className="flex flex-col items-center">
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-bold text-white ${stop.type === "X" ? "bg-purple-500" : stop.type === "C" ? "bg-amber-500" : stop.type === "H" || stop.type === "RTN" ? "bg-muted-foreground" : "bg-blue-500"}`}>
                        {stop.seq}
                      </div>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`text-[10px] font-semibold uppercase tracking-wider ${stop.type === "X" ? "text-purple-600 dark:text-purple-400" : stop.type === "C" ? "text-amber-600 dark:text-amber-400" : stop.type === "H" || stop.type === "RTN" ? "text-muted-foreground" : "text-blue-600 dark:text-blue-400"}`}>
                          {stop.type === "X" ? "EXCHANGE" : stop.type === "C" ? "COLLECT" : stop.type === "H" || stop.type === "RTN" ? "HOME" : "DELIVER"}
                        </span>
                        {stop.type === "X" && <Badge variant="secondary" className="text-[9px] bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300">HANDOFF</Badge>}
                        {stop.late && <Badge variant="destructive" className="text-[9px]">LATE</Badge>}
                        {stop.spx && <Badge variant="destructive" className="text-[9px]">EXPRESS</Badge>}
                      </div>
                      <p className="text-[14px] font-medium mt-1">{subCity(stop.sub, stop.city)}</p>
                      {stop.addr && <p className="text-[12px] text-muted-foreground mt-0.5">{stop.addr}</p>}
                      <div className="flex items-center gap-3 mt-1.5 text-[11px] text-muted-foreground flex-wrap">
                        <span className="font-medium tabular-nums">ETA {stop.eta}</span>
                        {stop.win && <span>Window: {stop.win}</span>}
                        <span className="tabular-nums">{stop.legKm}km</span>
                      </div>
                      {stop.contact && (
                        <p className="text-[12px] mt-1.5">
                          {stop.contact}
                          {stop.phone && (
                            <a href={`tel:${stop.phone}`} className="text-blue-600 dark:text-blue-400 ml-1">{stop.phone}</a>
                          )}
                        </p>
                      )}
                      {stop.instr && (
                        <p className="text-[12px] text-amber-600 dark:text-amber-400 italic mt-1">{stop.instr}</p>
                      )}
                      {stop.wbs.length > 0 && (
                        <p className="text-[10px] font-mono text-muted-foreground mt-1">{stop.wbs.join(", ")}</p>
                      )}
                    </div>
                    <div className="flex flex-col items-center gap-1.5">
                      {stop.type !== "H" && (
                        <Button
                          variant={stop.status === "DONE" ? "default" : "outline"}
                          size="icon"
                          onClick={() => toggleStopStatus(stop.key)}
                          data-testid={`button-driver-stop-${stop.key}`}
                        >
                          {stop.status === "DONE" ? <CheckCircle2 className="w-4 h-4" /> : stop.status === "ARRIVED" ? <Play className="w-4 h-4" /> : <Circle className="w-4 h-4" />}
                        </Button>
                      )}
                      {stop.lat !== 0 && (
                        <a href={gMap(stop.lat, stop.lng)} target="_blank" rel="noopener noreferrer">
                          <Button variant="ghost" size="icon">
                            <MapPin className="w-4 h-4" />
                          </Button>
                        </a>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
        </PageBody>
      </ScrollArea>
    </div>
  );
}

function MetricsTab({ tl, totals, ships, fleet, fleetSettings }: any) {
  return (
    <ScrollArea className="flex-1">
      <PageHeader title="Fleet Metrics" subtitle="Fuel economics, utilization, and cost analysis" bgImage={bgMetrics} />
      <PageBody bgImages={[bgMetrics, bgDashboard, bgSettings]}>
      <div className="p-6 space-y-6">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <MetricCard label="Total Revenue" value={`R${totals.rev}`} trend={totals.rev > 0 ? "up" : undefined} color="green" />
          <MetricCard label="Total COGS" value={`R${totals.cogs}`} color="red" />
          <MetricCard label="Net Margin" value={`R${totals.margin}`} trend={totals.margin >= 0 ? "up" : "down"} color={totals.margin >= 0 ? "green" : "red"} />
          <MetricCard label="Dead km" value={`${totals.deadKm}`} color="amber" breakdown={totals.deadKm > 0 ? `Depot to 1st stop: ${totals.depotToFirstKm}km | Last stop to depot: ${totals.returnToDepotKm}km` : undefined} />
        </div>

        <Card>
          <CardHeader className="pb-3">
            <h3 className="text-[13px] font-semibold">Driver Breakdown</h3>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-[12px]" data-testid="table-metrics">
                <thead>
                  <tr className="border-b border-border">
                    {["Driver", "Jobs", "Stops", "km", "Dead km", "Fuel (L)", "Fuel (R)", "Revenue", "COGS", "Margin", "Peak Load", "Resilience"].map((h) => (
                      <th key={h} className="px-4 py-2.5 text-left font-medium text-muted-foreground whitespace-nowrap first:pl-5">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {fleet.map((d: any) => {
                    const trip = tl[d.id];
                    if (!trip) return null;
                    const st = trip.stats;
                    return (
                      <tr key={d.id} className="border-b border-border/50" data-testid={`metrics-row-${d.id}`}>
                        <td className="px-4 py-2.5 first:pl-5">
                          <div className="flex items-center gap-2">
                            <div className="w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold text-white" style={{ backgroundColor: d.color }}>{d.icon}</div>
                            <span className="font-medium" style={{ color: d.color }}>{d.name}</span>
                          </div>
                        </td>
                        <td className="px-4 py-2.5 font-semibold tabular-nums">{st.shipments}</td>
                        <td className="px-4 py-2.5 tabular-nums">{trip.stops.length}</td>
                        <td className="px-4 py-2.5 tabular-nums">{st.totalKm}</td>
                        <td className="px-4 py-2.5 text-muted-foreground tabular-nums">
                          <span>{st.deadKm}</span>
                          {st.deadKm > 0 && <p className="text-[9px] text-muted-foreground/70 leading-snug mt-0.5">{st.depotToFirstKm || 0} out + {st.returnToDepotKm || 0} back</p>}
                        </td>
                        <td className="px-4 py-2.5 tabular-nums">{st.fuelLitres}L</td>
                        <td className="px-4 py-2.5 tabular-nums text-amber-600 dark:text-amber-400">R{st.fuelCost}</td>
                        <td className="px-4 py-2.5 tabular-nums font-semibold text-emerald-600 dark:text-emerald-400">R{st.revenue}</td>
                        <td className="px-4 py-2.5 tabular-nums text-red-500 dark:text-red-400">R{st.cogs}</td>
                        <td className={`px-4 py-2.5 font-semibold tabular-nums ${st.margin >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-500 dark:text-red-400"}`}>R{st.margin}</td>
                        <td className="px-4 py-2.5 tabular-nums">{st.peakLoad}/{d.maxParcels}</td>
                        <td className="px-4 py-2.5">
                          <div className="flex items-center gap-1.5">
                            <Progress value={st.resilience || 0} className="h-1 w-12" />
                            <span className="text-[11px] tabular-nums">{st.resilience || 0}%</span>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <h3 className="text-[13px] font-semibold">Fleet Configuration</h3>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-[12px]" data-testid="table-fleet-config">
                <thead>
                  <tr className="border-b border-border">
                    {["Driver", "Vehicle", "Plate", "Type", "Max Parcels", "Max kg", "Fuel/100km", "Cost/km", "Depot", "Shift"].map((h) => (
                      <th key={h} className="px-4 py-2.5 text-left font-medium text-muted-foreground whitespace-nowrap first:pl-5">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {fleet.map((d: any) => (
                    <tr key={d.id} className="border-b border-border/50">
                      <td className="px-4 py-2.5 first:pl-5">
                        <div className="flex items-center gap-2">
                          <div className="w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold text-white" style={{ backgroundColor: d.color }}>{d.icon}</div>
                          <span className="font-medium" style={{ color: d.color }}>{d.name}</span>
                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-muted-foreground">{d.vehicle}</td>
                      <td className="px-4 py-2.5 font-mono text-[11px]">{d.plate}</td>
                      <td className="px-4 py-2.5"><Badge variant="secondary" className="text-[9px]">{d.type}</Badge></td>
                      <td className="px-4 py-2.5 text-center tabular-nums">{d.maxParcels}</td>
                      <td className="px-4 py-2.5 text-center tabular-nums">{d.maxKg}kg</td>
                      <td className="px-4 py-2.5 tabular-nums">{(d.fuelPer100 * fleetSettings.cityFactor).toFixed(1)}L</td>
                      <td className="px-4 py-2.5 tabular-nums text-amber-600 dark:text-amber-400">R{d.costPerKm}</td>
                      <td className="px-4 py-2.5 text-muted-foreground">{d.depot}</td>
                      <td className="px-4 py-2.5 tabular-nums">{d.shift[0]}-{d.shift[1]}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        <div className="text-[12px] text-muted-foreground px-1">
          Fuel: 95 ULP Gauteng R{fleetSettings.fuelPrice}/litre · City delivery factor: {fleetSettings.cityFactor}x
        </div>
      </div>
      </PageBody>
    </ScrollArea>
  );
}

function SettingsTab({ fleetSettings, setFleetSettings, log, editDriverId, clearEditDriverId, toggleDriverActive, onDriverRemoved, authUser, onUpdateProfile }: { fleetSettings: FleetSettings; setFleetSettings: (s: FleetSettings) => void; log: (msg: string, type?: string) => void; editDriverId?: string | null; clearEditDriverId?: () => void; toggleDriverActive: (id: string) => void; onDriverRemoved?: (removedId: string, updated: FleetSettings) => void; authUser?: AuthUser; onUpdateProfile?: (data: any) => Promise<any> }) {
  const { toast } = useToast();
  const [editingDriver, setEditingDriver] = useState<string | null>(null);
  const [draft, setDraft] = useState<DriverProfile | null>(null);
  const [fuelPrice, setFuelPrice] = useState(String(fleetSettings.fuelPrice));
  const [cityFactor, setCityFactor] = useState(String(fleetSettings.cityFactor));
  const driverCardRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const [profileEdit, setProfileEdit] = useState(false);
  const [profileData, setProfileData] = useState({ displayName: authUser?.displayName || "", email: authUser?.email || "", avatarColor: authUser?.avatarColor || "#4a9eff" });
  const [passwordChange, setPasswordChange] = useState({ currentPassword: "", newPassword: "", confirm: "" });
  const [profileSaving, setProfileSaving] = useState(false);
  const AVATAR_COLORS = ["#4a9eff", "#22c55e", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899", "#14b8a6", "#f97316"];

  useEffect(() => {
    if (editDriverId) {
      const dp = fleetSettings.drivers.find((d) => d.id === editDriverId);
      if (dp) {
        setDraft({ ...dp });
        setEditingDriver(editDriverId);
        setTimeout(() => {
          driverCardRefs.current[editDriverId]?.scrollIntoView({ behavior: "smooth", block: "center" });
        }, 100);
      }
      clearEditDriverId?.();
    }
  }, [editDriverId]);

  function startEdit(id: string) {
    const dp = fleetSettings.drivers.find((d) => d.id === id);
    if (dp) {
      setDraft({ ...dp });
      setEditingDriver(id);
    }
  }

  function cancelEdit() {
    setEditingDriver(null);
    setDraft(null);
  }

  function saveDriver() {
    if (!draft || !editingDriver) return;
    const updated: FleetSettings = {
      ...fleetSettings,
      drivers: fleetSettings.drivers.map((d) => d.id === editingDriver ? { ...draft } : d),
    };
    setFleetSettings(updated);
    log(`Updated profile for ${draft.name}`, "SYS");
    toast({ title: "Driver updated", description: `${draft.name}'s profile saved` });
    setEditingDriver(null);
    setDraft(null);
  }

  function saveGlobalSettings() {
    const fp = parseFloat(fuelPrice);
    const cf = parseFloat(cityFactor);
    if (isNaN(fp) || fp <= 0) { toast({ title: "Invalid fuel price", variant: "destructive" }); return; }
    if (isNaN(cf) || cf <= 0) { toast({ title: "Invalid city factor", variant: "destructive" }); return; }
    const updated: FleetSettings = { ...fleetSettings, fuelPrice: fp, cityFactor: cf };
    setFleetSettings(updated);
    log(`Updated fuel price to R${fp}/L, city factor to ${cf}x`, "SYS");
    toast({ title: "Settings saved", description: `Fuel: R${fp}/L · City factor: ${cf}x` });
  }

  function updateDraft(field: keyof DriverProfile, value: string | number | boolean) {
    if (!draft) return;
    setDraft({ ...draft, [field]: value });
  }

  function addNewDriver() {
    const newDriver = createBlankDriver(fleetSettings.drivers);
    const updated: FleetSettings = { ...fleetSettings, drivers: [...fleetSettings.drivers, newDriver] };
    setFleetSettings(updated);
    setDraft({ ...newDriver });
    setEditingDriver(newDriver.id);
    setTimeout(() => {
      driverCardRefs.current[newDriver.id]?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 100);
    log(`Added new driver: ${newDriver.name}`, "SYS");
    toast({ title: "Driver added", description: `${newDriver.name} created — fill in profile details below` });
  }

  function removeDriver(id: string) {
    if (fleetSettings.drivers.length <= 1) {
      toast({ title: "Cannot remove last driver", description: "At least one driver is required", variant: "destructive" });
      return;
    }
    const driver = fleetSettings.drivers.find((d) => d.id === id);
    const updated: FleetSettings = { ...fleetSettings, drivers: fleetSettings.drivers.filter((d) => d.id !== id) };
    setFleetSettings(updated);
    if (editingDriver === id) { setEditingDriver(null); setDraft(null); }
    onDriverRemoved?.(id, updated);
    log(`Removed driver: ${driver?.name ?? id}`, "SYS");
    toast({ title: "Driver removed", description: `${driver?.name ?? "Driver"} removed from fleet` });
  }

  return (
    <ScrollArea className="flex-1">
      <PageHeader title="Settings" subtitle="Fleet configuration, fuel costs, and driver profiles" bgImage={bgSettings} />
      <PageBody bgImages={[bgSettings, bgImport, bgDashboard]}>
      <div className="p-6 space-y-6">

        {authUser && (
          <Card data-testid="card-user-profile">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <h3 className="text-[13px] font-semibold flex items-center gap-2">
                  <UserCheck className="w-4 h-4 text-muted-foreground" />
                  My Profile
                </h3>
                <Button variant="outline" size="sm" onClick={() => setProfileEdit(!profileEdit)} data-testid="button-edit-profile">
                  <Pencil className="w-3 h-3 mr-1" />
                  {profileEdit ? "Cancel" : "Edit"}
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {!profileEdit ? (
                <div className="flex items-center gap-4">
                  <div
                    className="w-14 h-14 rounded-full flex items-center justify-center text-xl font-bold text-white shrink-0 border-2 border-white/20"
                    style={{ backgroundColor: authUser.avatarColor }}
                    data-testid="profile-avatar"
                  >
                    {(authUser.displayName || authUser.username).charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <p className="text-sm font-semibold" data-testid="text-profile-name">{authUser.displayName || authUser.username}</p>
                    <p className="text-xs text-muted-foreground">@{authUser.username}</p>
                    {authUser.email && <p className="text-xs text-muted-foreground mt-0.5">{authUser.email}</p>}
                    <Badge variant="secondary" className="mt-1 text-[10px]">{authUser.role}</Badge>
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="flex items-center gap-4">
                    <div
                      className="w-14 h-14 rounded-full flex items-center justify-center text-xl font-bold text-white shrink-0 border-2 border-white/20 cursor-pointer"
                      style={{ backgroundColor: profileData.avatarColor }}
                    >
                      {(profileData.displayName || authUser.username).charAt(0).toUpperCase()}
                    </div>
                    <div className="flex gap-1.5 flex-wrap">
                      {AVATAR_COLORS.map((c) => (
                        <button
                          key={c}
                          onClick={() => setProfileData({ ...profileData, avatarColor: c })}
                          className={`w-6 h-6 rounded-full border-2 transition-all ${profileData.avatarColor === c ? "border-white scale-110" : "border-transparent opacity-60 hover:opacity-100"}`}
                          style={{ backgroundColor: c }}
                          data-testid={`avatar-color-${c}`}
                        />
                      ))}
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label className="text-[12px] font-medium text-muted-foreground">Display Name</label>
                      <Input
                        value={profileData.displayName}
                        onChange={(e) => setProfileData({ ...profileData, displayName: e.target.value })}
                        data-testid="input-profile-name"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[12px] font-medium text-muted-foreground">Email</label>
                      <Input
                        type="email"
                        value={profileData.email}
                        onChange={(e) => setProfileData({ ...profileData, email: e.target.value })}
                        data-testid="input-profile-email"
                      />
                    </div>
                  </div>
                  <Separator />
                  <div>
                    <p className="text-[12px] font-medium text-muted-foreground mb-2">Change Password (optional)</p>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <Input
                        type="password"
                        placeholder="Current password"
                        value={passwordChange.currentPassword}
                        onChange={(e) => setPasswordChange({ ...passwordChange, currentPassword: e.target.value })}
                        data-testid="input-current-password"
                      />
                      <Input
                        type="password"
                        placeholder="New password"
                        value={passwordChange.newPassword}
                        onChange={(e) => setPasswordChange({ ...passwordChange, newPassword: e.target.value })}
                        data-testid="input-new-password"
                      />
                      <Input
                        type="password"
                        placeholder="Confirm new password"
                        value={passwordChange.confirm}
                        onChange={(e) => setPasswordChange({ ...passwordChange, confirm: e.target.value })}
                        data-testid="input-confirm-password"
                      />
                    </div>
                  </div>
                  <div className="flex justify-end">
                    <Button
                      disabled={profileSaving}
                      data-testid="button-save-profile"
                      onClick={async () => {
                        if (!onUpdateProfile) return;
                        if (passwordChange.newPassword && passwordChange.newPassword !== passwordChange.confirm) {
                          toast({ title: "Passwords don't match", variant: "destructive" });
                          return;
                        }
                        setProfileSaving(true);
                        try {
                          const data: any = {
                            displayName: profileData.displayName,
                            email: profileData.email,
                            avatarColor: profileData.avatarColor,
                          };
                          if (passwordChange.newPassword) {
                            data.currentPassword = passwordChange.currentPassword;
                            data.newPassword = passwordChange.newPassword;
                          }
                          await onUpdateProfile(data);
                          toast({ title: "Profile updated" });
                          setProfileEdit(false);
                          setPasswordChange({ currentPassword: "", newPassword: "", confirm: "" });
                        } catch (err: any) {
                          toast({ title: err.message || "Update failed", variant: "destructive" });
                        } finally {
                          setProfileSaving(false);
                        }
                      }}
                    >
                      {profileSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" /> : <Save className="w-3.5 h-3.5 mr-1.5" />}
                      Save Profile
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader className="pb-3">
            <h3 className="text-[13px] font-semibold flex items-center gap-2">
              <Fuel className="w-4 h-4 text-muted-foreground" />
              Cost Parameters
            </h3>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="space-y-1.5">
                <label className="text-[12px] font-medium text-muted-foreground" htmlFor="fuel-price">Fuel Price (R/litre)</label>
                <Input
                  id="fuel-price"
                  value={fuelPrice}
                  onChange={(e) => setFuelPrice(e.target.value)}
                  type="number"
                  step="0.01"
                  min="0"
                  className="font-mono"
                  data-testid="input-fuel-price"
                />
                <p className="text-[11px] text-muted-foreground">95 ULP Gauteng</p>
              </div>
              <div className="space-y-1.5">
                <label className="text-[12px] font-medium text-muted-foreground" htmlFor="city-factor">City Delivery Factor</label>
                <Input
                  id="city-factor"
                  value={cityFactor}
                  onChange={(e) => setCityFactor(e.target.value)}
                  type="number"
                  step="0.01"
                  min="1"
                  className="font-mono"
                  data-testid="input-city-factor"
                />
                <p className="text-[11px] text-muted-foreground">Multiplier for city driving fuel usage</p>
              </div>
              <div className="flex items-end">
                <Button onClick={saveGlobalSettings} className="font-bold" data-testid="button-save-costs">
                  <Save className="w-3.5 h-3.5 mr-1.5" />
                  Save Costs
                </Button>
              </div>
            </div>
            <div className="mt-3 text-[11px] text-muted-foreground">
              Cost/km is calculated: (L/100km × city factor / 100) × fuel price
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <h3 className="text-[13px] font-semibold flex items-center gap-2">
                <Truck className="w-4 h-4 text-muted-foreground" />
                Driver Profiles
                <span className="ml-1 text-[11px] font-normal text-muted-foreground">({fleetSettings.drivers.length} drivers)</span>
              </h3>
              <Button size="sm" variant="outline" onClick={addNewDriver} className="font-bold h-7 text-[11px] gap-1" data-testid="button-add-driver">
                <UserPlus className="w-3.5 h-3.5" />
                Add Driver
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {fleetSettings.drivers.map((dp) => {
              const isEditing = editingDriver === dp.id;
              const d = isEditing && draft ? draft : dp;
              const computedCostPerKm = fuelCostPerKm(d.fuelPer100, fleetSettings.fuelPrice, fleetSettings.cityFactor);

              return (
                <Card key={dp.id} className={`bg-muted/30 relative ${dp.active === false ? "opacity-85 border-red-400/40" : ""}`} data-testid={`settings-driver-${dp.id}`} ref={(el) => { driverCardRefs.current[dp.id] = el; }}>
                  <button
                    className={`absolute top-3 right-3 z-10 h-6 w-6 rounded-full flex items-center justify-center transition-colors ${dp.active !== false ? "bg-green-600/20 text-green-600 hover:bg-green-600/30" : "bg-red-500/20 text-red-500 hover:bg-red-500/30"}`}
                    onClick={() => toggleDriverActive(dp.id)}
                    data-testid={`button-settings-toggle-driver-${dp.id}`}
                  >
                    <Power className="w-3 h-3" />
                  </button>
                  <CardContent className="pt-4">
                    <div className="flex items-center justify-between gap-3 mb-4">
                      <div className="flex items-center gap-3">
                        <div className="h-9 w-9 rounded-full flex items-center justify-center text-[12px] font-bold text-white shrink-0" style={{ backgroundColor: dp.active !== false ? d.color : "#9ca3af" }}>
                          {d.icon}
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <p className="text-[14px] font-bold">{d.name}</p>
                            <Badge variant={dp.active !== false ? "default" : "secondary"} className={`text-[9px] ${dp.active !== false ? "bg-green-600" : dp.active === false ? "bg-red-500/15 text-red-500 border-red-500/30" : ""}`}>
                              {dp.active !== false ? "ONLINE" : "OFFLINE"}
                            </Badge>
                          </div>
                          <p className="text-[11px] text-muted-foreground">{d.vehicle}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 mr-8">
                        {!isEditing ? (
                          <>
                            <Button variant="outline" size="sm" className="font-bold" onClick={() => startEdit(dp.id)} data-testid={`button-edit-driver-${dp.id}`}>
                              <Pencil className="w-3 h-3 mr-1.5" />
                              Edit
                            </Button>
                            <Button variant="ghost" size="sm" className="font-bold text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30" onClick={() => removeDriver(dp.id)} data-testid={`button-remove-driver-${dp.id}`}>
                              <Trash2 className="w-3.5 h-3.5" />
                            </Button>
                          </>
                        ) : (
                          <div className="flex gap-2">
                            <Button variant="ghost" size="sm" className="font-bold" onClick={cancelEdit} data-testid={`button-cancel-driver-${dp.id}`}>
                              Cancel
                            </Button>
                            <Button size="sm" className="font-bold" onClick={saveDriver} data-testid={`button-save-driver-${dp.id}`}>
                              <Save className="w-3 h-3 mr-1.5" />
                              Save
                            </Button>
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                      <div className="space-y-1">
                        <label className="text-[11px] font-medium text-muted-foreground">Name</label>
                        {isEditing ? (
                          <Input
                            value={d.name}
                            onChange={(e) => updateDraft("name", e.target.value)}
                            className="text-[12px]"
                            data-testid={`input-name-${dp.id}`}
                          />
                        ) : (
                          <p className="text-[12px] py-2 truncate font-medium">{d.name}</p>
                        )}
                      </div>
                      <div className="space-y-1">
                        <label className="text-[11px] font-medium text-muted-foreground">Color</label>
                        {isEditing ? (
                          <div className="flex flex-wrap gap-1.5 py-1">
                            {DRIVER_COLORS.map((c) => (
                              <button
                                key={c}
                                type="button"
                                className={`h-5 w-5 rounded-full border-2 transition-all ${d.color === c ? "border-foreground scale-110" : "border-transparent hover:border-foreground/40"}`}
                                style={{ backgroundColor: c }}
                                onClick={() => updateDraft("color", c)}
                                data-testid={`button-color-${c.replace("#", "")}-${dp.id}`}
                              />
                            ))}
                          </div>
                        ) : (
                          <div className="flex items-center gap-2 py-2">
                            <div className="h-4 w-4 rounded-full" style={{ backgroundColor: d.color }} />
                            <span className="text-[11px] font-mono text-muted-foreground">{d.color}</span>
                          </div>
                        )}
                      </div>
                      <SettingsField label="Vehicle" value={d.vehicle} field="vehicle" isEditing={isEditing} onChange={(v) => updateDraft("vehicle", v)} testId={`input-vehicle-${dp.id}`} />
                      <SettingsField label="Plate" value={d.plate} field="plate" isEditing={isEditing} onChange={(v) => updateDraft("plate", v)} testId={`input-plate-${dp.id}`} />
                      <SettingsField label="Type" value={d.type} field="type" isEditing={isEditing} onChange={(v) => updateDraft("type", v)} testId={`input-type-${dp.id}`} />
                      <div className="space-y-1 col-span-2 sm:col-span-2">
                        <label className="text-[11px] font-medium text-muted-foreground flex items-center gap-1">
                          <MapPin className="w-3 h-3" /> Depot Address
                        </label>
                        {isEditing ? (
                          <AddressAutocomplete
                            value={d.depot}
                            onChange={(v) => updateDraft("depot", v)}
                            onSelect={(place: PlaceResult) => {
                              updateDraft("depot", place.address);
                              updateDraft("depotLat", place.lat);
                              updateDraft("depotLng", place.lng);
                            }}
                            placeholder="Search for depot address..."
                            data-testid={`input-depot-${dp.id}`}
                          />
                        ) : (
                          <p className="text-[12px] py-2 truncate">{d.depot}</p>
                        )}
                        {isEditing && d.depotLat && d.depotLng && (
                          <p className="text-[10px] text-muted-foreground font-mono">
                            GPS: {Number(d.depotLat).toFixed(4)}, {Number(d.depotLng).toFixed(4)}
                          </p>
                        )}
                      </div>
                      <div className="space-y-1">
                        <label className="text-[11px] font-medium text-muted-foreground">Fuel (L/100km)</label>
                        {isEditing ? (
                          <Input
                            value={d.fuelPer100}
                            onChange={(e) => updateDraft("fuelPer100", parseFloat(e.target.value) || 0)}
                            type="number"
                            step="0.1"
                            min="0"
                            className="text-[12px] font-mono"
                            data-testid={`input-fuel100-${dp.id}`}
                          />
                        ) : (
                          <p className="text-[12px] font-mono tabular-nums py-2">{d.fuelPer100} L/100km</p>
                        )}
                      </div>
                      <div className="space-y-1">
                        <label className="text-[11px] font-medium text-muted-foreground">Cost/km</label>
                        <p className="text-[12px] font-mono tabular-nums py-2">R{computedCostPerKm}</p>
                        <p className="text-[10px] text-muted-foreground">Auto-calculated</p>
                      </div>
                      <div className="space-y-1">
                        <label className="text-[11px] font-medium text-muted-foreground">Odometer (km)</label>
                        {isEditing ? (
                          <Input
                            value={d.odometer}
                            onChange={(e) => updateDraft("odometer", parseFloat(e.target.value) || 0)}
                            type="number"
                            step="1"
                            min="0"
                            className="text-[12px] font-mono"
                            data-testid={`input-odometer-${dp.id}`}
                          />
                        ) : (
                          <p className="text-[12px] font-mono tabular-nums py-2">{d.odometer > 0 ? d.odometer.toLocaleString() + " km" : "Not set"}</p>
                        )}
                      </div>
                      <div className="space-y-1">
                        <label className="text-[11px] font-medium text-muted-foreground">Shift</label>
                        {isEditing ? (
                          <div className="flex gap-1.5 items-center">
                            <Input
                              value={d.shiftStart}
                              onChange={(e) => updateDraft("shiftStart", e.target.value)}
                              className="text-[12px] font-mono flex-1"
                              placeholder="06:00"
                              data-testid={`input-shift-start-${dp.id}`}
                            />
                            <span className="text-[11px] text-muted-foreground">-</span>
                            <Input
                              value={d.shiftEnd}
                              onChange={(e) => updateDraft("shiftEnd", e.target.value)}
                              className="text-[12px] font-mono flex-1"
                              placeholder="18:00"
                              data-testid={`input-shift-end-${dp.id}`}
                            />
                          </div>
                        ) : (
                          <p className="text-[12px] font-mono tabular-nums py-2">{d.shiftStart} - {d.shiftEnd}</p>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </CardContent>
        </Card>

        <DriverAccountsManager fleetSettings={fleetSettings} />

        <AddressBookManager />

        <WebhookSettingsManager />

      </div>
      </PageBody>
    </ScrollArea>
  );
}

export function AddressBookManager() {
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [formData, setFormData] = useState({ accountCode: "", clientName: "", address: "" });

  const { data: accounts = [], isLoading } = useTanQuery({
    queryKey: ["/api/client-accounts"],
  });

  const createMutation = useMutation({
    mutationFn: async (data: { accountCode: string; clientName: string; address: string }) => {
      const res = await apiRequest("POST", "/api/client-accounts", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/client-accounts"] });
      setShowForm(false);
      setFormData({ accountCode: "", clientName: "", address: "" });
      toast({ title: "Client account added" });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: any }) => {
      const res = await apiRequest("PATCH", `/api/client-accounts/${id}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/client-accounts"] });
      setEditingId(null);
      setFormData({ accountCode: "", clientName: "", address: "" });
      toast({ title: "Client account updated" });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/client-accounts/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/client-accounts"] });
      toast({ title: "Client account deleted" });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const filtered = (accounts as any[]).filter((a: any) =>
    !search.trim() ||
    a.clientName?.toLowerCase().includes(search.toLowerCase()) ||
    a.accountCode?.toLowerCase().includes(search.toLowerCase()) ||
    a.address?.toLowerCase().includes(search.toLowerCase())
  );

  function startEdit(acc: any) {
    setEditingId(acc.id);
    setFormData({ accountCode: acc.accountCode, clientName: acc.clientName, address: acc.address || "" });
    setShowForm(false);
  }

  function handleSave() {
    if (!formData.accountCode.trim() || !formData.clientName.trim()) {
      toast({ title: "Account code and name are required", variant: "destructive" });
      return;
    }
    if (editingId) {
      updateMutation.mutate({ id: editingId, data: formData });
    } else {
      createMutation.mutate(formData);
    }
  }

  return (
    <Card data-testid="card-address-book">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <h3 className="text-[13px] font-semibold flex items-center gap-2">
            <Users className="w-4 h-4 text-muted-foreground" />
            Client Address Book
            <span className="ml-1 text-[11px] font-normal text-muted-foreground">({(accounts as any[]).length} clients)</span>
          </h3>
          <Button size="sm" variant="outline" onClick={() => { setShowForm(!showForm); setEditingId(null); setFormData({ accountCode: "", clientName: "", address: "" }); }} className="font-bold h-7 text-[11px] gap-1" data-testid="button-add-client">
            <Plus className="w-3.5 h-3.5" />
            Add Client
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <Input
            placeholder="Search clients..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 text-[12px] h-8"
            data-testid="input-search-clients"
          />
        </div>

        {(showForm || editingId) && (
          <Card className="bg-muted/30 p-4">
            <p className="text-[12px] font-semibold mb-3">{editingId ? "Edit Client" : "New Client"}</p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="space-y-1">
                <label className="text-[11px] font-medium text-muted-foreground">Account Code</label>
                <Input
                  value={formData.accountCode}
                  onChange={(e) => setFormData({ ...formData, accountCode: e.target.value })}
                  placeholder="e.g. BBN001"
                  className="text-[12px] font-mono"
                  disabled={!!editingId}
                  data-testid="input-account-code"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[11px] font-medium text-muted-foreground">Client Name</label>
                <Input
                  value={formData.clientName}
                  onChange={(e) => setFormData({ ...formData, clientName: e.target.value })}
                  placeholder="e.g. Baked By Nataleen"
                  className="text-[12px]"
                  data-testid="input-client-name"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[11px] font-medium text-muted-foreground">Address</label>
                <Input
                  value={formData.address}
                  onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                  placeholder="Client address (optional)"
                  className="text-[12px]"
                  data-testid="input-client-address"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-3">
              <Button variant="ghost" size="sm" onClick={() => { setShowForm(false); setEditingId(null); }} className="text-[11px]" data-testid="button-cancel-client">Cancel</Button>
              <Button size="sm" onClick={handleSave} disabled={createMutation.isPending || updateMutation.isPending} className="font-bold text-[11px]" data-testid="button-save-client">
                {(createMutation.isPending || updateMutation.isPending) ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Save className="w-3 h-3 mr-1" />}
                {editingId ? "Update" : "Add Client"}
              </Button>
            </div>
          </Card>
        )}

        {isLoading ? (
          <div className="flex items-center justify-center py-6 text-muted-foreground text-[12px]"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading clients...</div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-6 text-muted-foreground text-[12px]">
            {search ? "No clients match your search" : "No client accounts yet. They will be auto-created when you import CSV files."}
          </div>
        ) : (
          <div className="space-y-1.5">
            {filtered.map((acc: any) => (
              <div
                key={acc.id}
                className="flex items-center justify-between rounded-lg px-3 py-2 bg-muted/30 border border-border/30"
                data-testid={`client-account-${acc.id}`}
              >
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                    <span className="text-[10px] font-bold text-primary font-mono">{acc.accountCode?.slice(0, 3)}</span>
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-[12px] font-semibold truncate" data-testid={`text-client-name-${acc.id}`}>{acc.clientName}</p>
                      <Badge variant="secondary" className="text-[9px] font-mono shrink-0">{acc.accountCode}</Badge>
                    </div>
                    {acc.address && <p className="text-[10px] text-muted-foreground truncate">{acc.address}</p>}
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => startEdit(acc)} data-testid={`button-edit-client-${acc.id}`}>
                        <Pencil className="w-3.5 h-3.5" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent><p className="text-xs">Edit client</p></TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30" onClick={() => { if (confirm(`Delete client "${acc.clientName}" (${acc.accountCode})?`)) deleteMutation.mutate(acc.id); }} data-testid={`button-delete-client-${acc.id}`}>
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent><p className="text-xs">Delete client</p></TooltipContent>
                  </Tooltip>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function WebhookSettingsManager() {
  const { toast } = useToast();
  const [showKey, setShowKey] = useState(false);

  const { data: settings } = useTanQuery({
    queryKey: ["/api/webhooks/settings"],
  });

  const { data: events = [], isLoading: eventsLoading } = useTanQuery({
    queryKey: ["/api/webhooks/events"],
    refetchInterval: 30000,
  });

  const regenerateMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/webhooks/settings/regenerate-key");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/webhooks/settings"] });
      toast({ title: "Auth key regenerated", description: "Update this key in your ShipLogic webhook settings" });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const webhookSettings = settings as any;
  const webhookEvents = (events as any[]) || [];
  const fullUrl = publicUrl("/api/webhooks/shiplogic");

  function copyToClipboard(text: string, label: string) {
    navigator.clipboard.writeText(text);
    toast({ title: `${label} copied to clipboard` });
  }

  return (
    <Card data-testid="card-webhook-settings">
      <CardHeader className="pb-3">
        <h3 className="text-[13px] font-semibold flex items-center gap-2">
          <Waypoints className="w-4 h-4 text-muted-foreground" />
          ShipLogic Webhook Integration
        </h3>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-3">
          <div className="space-y-1.5">
            <label className="text-[11px] font-medium text-muted-foreground">Delivery URL</label>
            <p className="text-[10px] text-muted-foreground">Paste this URL into the ShipLogic webhook "Delivery URL" field</p>
            <div className="flex items-center gap-2">
              <Input value={fullUrl} readOnly className="text-[12px] font-mono flex-1 bg-muted/50" data-testid="input-webhook-url" />
              <Button variant="outline" size="sm" className="h-8 shrink-0" onClick={() => copyToClipboard(fullUrl, "Delivery URL")} data-testid="button-copy-url">
                <Copy className="w-3.5 h-3.5" />
              </Button>
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-[11px] font-medium text-muted-foreground">Auth Key (Bearer Token)</label>
            <p className="text-[10px] text-muted-foreground">Paste this key into the ShipLogic webhook "Auth key" field</p>
            <div className="flex items-center gap-2">
              <Input
                value={showKey ? (webhookSettings?.authKey || "") : (webhookSettings?.authKey ? "••••••••••••••••••••••••••••••••" : "")}
                readOnly
                className="text-[12px] font-mono flex-1 bg-muted/50"
                data-testid="input-webhook-key"
              />
              <Button variant="outline" size="sm" className="h-8 shrink-0" onClick={() => setShowKey(!showKey)} data-testid="button-toggle-key">
                {showKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
              </Button>
              <Button variant="outline" size="sm" className="h-8 shrink-0" onClick={() => copyToClipboard(webhookSettings?.authKey || "", "Auth key")} data-testid="button-copy-key">
                <Copy className="w-3.5 h-3.5" />
              </Button>
              <Button variant="outline" size="sm" className="h-8 shrink-0 text-amber-500" onClick={() => regenerateMutation.mutate()} disabled={regenerateMutation.isPending} data-testid="button-regenerate-key">
                <RefreshCw className={`w-3.5 h-3.5 ${regenerateMutation.isPending ? "animate-spin" : ""}`} />
              </Button>
            </div>
          </div>

          <div className="bg-muted/30 rounded-lg p-3 space-y-1.5">
            <p className="text-[11px] font-semibold">Supported Topics</p>
            <div className="flex gap-2 flex-wrap">
              <Badge variant="secondary" className="text-[10px]">Shipment tracking event</Badge>
              <Badge variant="secondary" className="text-[10px]">Shipment address changes</Badge>
            </div>
            <p className="text-[10px] text-muted-foreground mt-1">
              Create separate webhook subscriptions in ShipLogic for each topic above. Use the same Delivery URL and Auth key for both.
            </p>
          </div>
        </div>

        <Separator />

        <div>
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-[12px] font-semibold flex items-center gap-1.5">
              <Activity className="w-3.5 h-3.5 text-muted-foreground" />
              Recent Webhook Activity
            </h4>
            <span className="text-[10px] text-muted-foreground">{webhookEvents.length} events</span>
          </div>

          {eventsLoading ? (
            <div className="flex items-center justify-center py-4 text-muted-foreground text-[12px]"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading...</div>
          ) : webhookEvents.length === 0 ? (
            <div className="text-center py-4 text-muted-foreground text-[11px]">No webhook events received yet. Configure your ShipLogic webhooks to start receiving updates.</div>
          ) : (
            <div className="space-y-1 max-h-[200px] overflow-y-auto">
              {webhookEvents.slice(0, 20).map((ev: any) => {
                const decision = ev.payload?._decision || (ev.processed ? "processed" : (ev.error ? "error" : "ignored"));
                return (
                  <div key={ev.id} className="flex items-center gap-2 rounded px-2.5 py-1.5 bg-muted/20 border border-border/20" data-testid={`webhook-event-${ev.id}`}>
                    <div className={`w-2 h-2 rounded-full shrink-0 ${ev.processed ? "bg-green-500" : ev.error ? "bg-red-500" : "bg-amber-500"}`} />
                    <span className="text-[10px] font-mono text-muted-foreground shrink-0">
                      {new Date(ev.receivedAt).toLocaleString("en-ZA", { timeZone: "Africa/Johannesburg", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                    </span>
                    <Badge variant="outline" className="text-[9px] shrink-0">{ev.topic}</Badge>
                    <Badge variant="secondary" className="text-[9px] shrink-0" data-testid={`webhook-decision-${ev.id}`}>{decision}</Badge>
                    {ev.waybill && <span className="text-[10px] font-mono text-foreground">{ev.waybill}</span>}
                    {ev.error && <span className="text-[10px] text-red-400 truncate">{ev.error}</span>}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export function DriverAccountsManager({ fleetSettings }: { fleetSettings: FleetSettings }) {
  const { toast } = useToast();
  const [showForm, setShowForm] = useState(false);
  const [newUsername, setNewUsername] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newDriverName, setNewDriverName] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [showPasswords, setShowPasswords] = useState<Record<number, boolean>>({});
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editPassword, setEditPassword] = useState("");
  const [editPhone, setEditPhone] = useState("");
  const [editingPhoneId, setEditingPhoneId] = useState<number | null>(null);
  const [copied, setCopied] = useState<number | null>(null);

  const { data: accounts = [], isLoading } = useTanQuery({
    queryKey: ["/api/auth/driver-accounts"],
  });

  const createMutation = useMutation({
    mutationFn: async (data: { username: string; password: string; driverName: string; phone?: string }) => {
      const res = await apiRequest("POST", "/api/auth/driver-accounts", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/auth/driver-accounts"] });
      setShowForm(false);
      setNewUsername("");
      setNewPassword("");
      setNewDriverName("");
      setNewPhone("");
      toast({ title: "Driver account created" });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: any }) => {
      const res = await apiRequest("PATCH", `/api/auth/driver-accounts/${id}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/auth/driver-accounts"] });
      setEditingId(null);
      setEditPassword("");
      setEditingPhoneId(null);
      setEditPhone("");
      toast({ title: "Account updated" });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/auth/driver-accounts/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/auth/driver-accounts"] });
      toast({ title: "Driver account deleted" });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const handleCreate = () => {
    if (!newUsername.trim() || !newPassword.trim() || !newDriverName.trim()) {
      toast({ title: "All fields are required", variant: "destructive" });
      return;
    }
    createMutation.mutate({ username: newUsername.trim(), password: newPassword.trim(), driverName: newDriverName.trim(), phone: newPhone.trim() || undefined });
  };

  const copyCredentials = (username: string) => {
    navigator.clipboard.writeText(username);
    setCopied(Date.now());
    setTimeout(() => setCopied(null), 2000);
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <h3 className="text-[13px] font-semibold flex items-center gap-2">
            <Key className="w-4 h-4 text-muted-foreground" />
            Driver App Login Accounts
            <span className="ml-1 text-[11px] font-normal text-muted-foreground">({(accounts as any[]).length} accounts)</span>
          </h3>
          <Button size="sm" variant="outline" onClick={() => setShowForm(!showForm)} className="font-bold h-7 text-[11px] gap-1" data-testid="button-add-driver-account">
            <Plus className="w-3.5 h-3.5" />
            New Account
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {showForm && (
          <Card className="bg-muted/30 p-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <div className="space-y-1">
                <label className="text-[11px] font-medium text-muted-foreground">Driver Name</label>
                <Select value={newDriverName} onValueChange={setNewDriverName}>
                  <SelectTrigger className="text-[12px]" data-testid="select-driver-name">
                    <SelectValue placeholder="Select driver..." />
                  </SelectTrigger>
                  <SelectContent>
                    {fleetSettings.drivers.map((d) => (
                      <SelectItem key={d.id} value={d.name}>{d.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <label className="text-[11px] font-medium text-muted-foreground">Username</label>
                <Input value={newUsername} onChange={(e) => setNewUsername(e.target.value)} placeholder="e.g. john" className="text-[12px]" data-testid="input-new-driver-username" />
              </div>
              <div className="space-y-1">
                <label className="text-[11px] font-medium text-muted-foreground">Password</label>
                <Input value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="Set a password" className="text-[12px]" data-testid="input-new-driver-password" />
              </div>
              <div className="space-y-1">
                <label className="text-[11px] font-medium text-muted-foreground">Phone Number</label>
                <Input value={newPhone} onChange={(e) => setNewPhone(e.target.value)} placeholder="e.g. 071 234 5678" className="text-[12px]" data-testid="input-new-driver-phone" />
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-3">
              <Button variant="ghost" size="sm" onClick={() => setShowForm(false)} className="text-[11px]" data-testid="button-cancel-new-account">Cancel</Button>
              <Button size="sm" onClick={handleCreate} disabled={createMutation.isPending} className="font-bold text-[11px]" data-testid="button-save-new-account">
                {createMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Save className="w-3 h-3 mr-1" />}
                Create Account
              </Button>
            </div>
          </Card>
        )}

        {isLoading ? (
          <div className="flex items-center justify-center py-6 text-muted-foreground text-[12px]"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading accounts...</div>
        ) : (accounts as any[]).length === 0 ? (
          <div className="text-center py-6 text-muted-foreground text-[12px]">No driver accounts yet. Create one to give your drivers access to the Driver App.</div>
        ) : (
          <div className="space-y-2">
            {(accounts as any[]).map((acc: any) => (
              <Card key={acc.id} className="bg-muted/30" data-testid={`driver-account-${acc.id}`}>
                <CardContent className="py-3 px-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="h-8 w-8 rounded-full flex items-center justify-center text-[11px] font-bold text-white shrink-0" style={{ backgroundColor: acc.fleetColor || "#4a9eff" }}>
                        {(acc.driverName || "D").charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <p className="text-[13px] font-bold" data-testid={`text-account-name-${acc.id}`}>{acc.driverName}</p>
                          <Badge variant={acc.isOnline ? "default" : "secondary"} className={`text-[9px] ${acc.isOnline ? "bg-green-600" : ""}`}>
                            {acc.isOnline ? "ONLINE" : "OFFLINE"}
                          </Badge>
                        </div>
                        <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                          <span className="text-[11px] text-muted-foreground flex items-center gap-1">
                            <SmartphoneIcon className="w-3 h-3" />
                            Username: <span className="font-mono font-semibold text-foreground">{acc.username}</span>
                          </span>
                          {acc.vehiclePlate && <span className="text-[10px] text-muted-foreground">{acc.vehiclePlate}</span>}
                          {acc.phone ? (
                            <CallDriverButton phone={acc.phone} driverName={acc.driverName} variant="chip" testId={`link-call-driver-${acc.id}`} />
                          ) : (
                            <button
                              className="text-[10px] text-muted-foreground hover:text-primary flex items-center gap-1"
                              onClick={(e) => { e.stopPropagation(); setEditingPhoneId(acc.id); setEditPhone(""); }}
                              data-testid={`button-add-phone-${acc.id}`}
                            >
                              <Phone className="w-3 h-3" />
                              Add phone
                            </button>
                          )}
                        </div>
                        {editingPhoneId === acc.id && (
                          <div className="flex items-center gap-2 mt-1.5">
                            <Input
                              type="tel"
                              value={editPhone}
                              onChange={(e) => setEditPhone(e.target.value)}
                              placeholder="e.g. 071 234 5678"
                              className="h-7 w-40 text-[11px]"
                              data-testid={`input-edit-phone-${acc.id}`}
                            />
                            <Button
                              size="sm"
                              className="h-7 text-[11px] font-bold"
                              onClick={() => updateMutation.mutate({ id: acc.id, data: { phone: editPhone.trim() } })}
                              disabled={!editPhone.trim() || updateMutation.isPending}
                              data-testid={`button-save-phone-${acc.id}`}
                            >
                              Save
                            </Button>
                            <Button variant="ghost" size="sm" className="h-7 text-[11px]" onClick={() => { setEditingPhoneId(null); setEditPhone(""); }}>
                              Cancel
                            </Button>
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5">
                      {editingId === acc.id ? (
                        <div className="flex items-center gap-2">
                          <Input
                            type="text"
                            value={editPassword}
                            onChange={(e) => setEditPassword(e.target.value)}
                            placeholder="New password"
                            className="h-7 w-32 text-[11px]"
                            data-testid={`input-edit-password-${acc.id}`}
                          />
                          <Button
                            size="sm"
                            className="h-7 text-[11px] font-bold"
                            onClick={() => updateMutation.mutate({ id: acc.id, data: { password: editPassword } })}
                            disabled={!editPassword.trim() || updateMutation.isPending}
                            data-testid={`button-save-password-${acc.id}`}
                          >
                            Save
                          </Button>
                          <Button variant="ghost" size="sm" className="h-7 text-[11px]" onClick={() => { setEditingId(null); setEditPassword(""); }} data-testid={`button-cancel-password-${acc.id}`}>
                            Cancel
                          </Button>
                        </div>
                      ) : (
                        <>
                          {acc.phone && (
                            <CallDriverButton phone={acc.phone} driverName={acc.driverName} variant="icon-green" testId={`button-call-driver-${acc.id}`} />
                          )}
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => { setEditingPhoneId(acc.id); setEditPhone(acc.phone || ""); }} data-testid={`button-edit-phone-${acc.id}`}>
                                <SmartphoneIcon className="w-3.5 h-3.5" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent><p className="text-xs">{acc.phone ? "Edit" : "Add"} phone number</p></TooltipContent>
                          </Tooltip>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => { setEditingId(acc.id); setEditPassword(""); }} data-testid={`button-reset-password-${acc.id}`}>
                                <Key className="w-3.5 h-3.5" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent><p className="text-xs">Reset password</p></TooltipContent>
                          </Tooltip>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30" onClick={() => deleteMutation.mutate(acc.id)} data-testid={`button-delete-account-${acc.id}`}>
                                <Trash2 className="w-3.5 h-3.5" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent><p className="text-xs">Delete account</p></TooltipContent>
                          </Tooltip>
                        </>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function SettingsField({ label, value, field, isEditing, onChange, testId }: { label: string; value: string; field: string; isEditing: boolean; onChange: (v: string) => void; testId: string }) {
  return (
    <div className="space-y-1">
      <label className="text-[11px] font-medium text-muted-foreground">{label}</label>
      {isEditing ? (
        <Input value={value} onChange={(e) => onChange(e.target.value)} className="text-[12px]" data-testid={testId} />
      ) : (
        <p className="text-[12px] py-2 truncate">{value}</p>
      )}
    </div>
  );
}

function LogTab({ events }: { events: LogEntry[] }) {
  const typeStyles: Record<string, string> = {
    SYS: "text-blue-600 dark:text-blue-400",
    AI: "text-violet-600 dark:text-violet-400",
    OPS: "text-green-600 dark:text-green-400",
    ERR: "text-red-500",
  };

  return (
    <div className="flex-1 flex flex-col">
      <PageHeader title="Activity Log" subtitle={`${events.length} events recorded`} bgImage={bgTrips} />
      <ScrollArea className="flex-1">
        <PageBody bgImages={[bgTrips, bgSettings]}>
        <div className="px-6 py-4">
          <table className="w-full">
            <tbody>
              {events.map((ev, i) => (
                <tr key={i} className="border-b border-border/30" data-testid={`log-entry-${i}`}>
                  <td className="py-2 pr-4 text-[11px] text-muted-foreground whitespace-nowrap font-mono tabular-nums align-top">{ev.t}</td>
                  <td className="py-2 pr-4 align-top">
                    <span className={`text-[10px] font-semibold uppercase tracking-wider ${typeStyles[ev.type] || "text-muted-foreground"}`}>{ev.type}</span>
                  </td>
                  <td className="py-2 text-[12px] text-foreground align-top">{ev.msg}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        </PageBody>
      </ScrollArea>
    </div>
  );
}
