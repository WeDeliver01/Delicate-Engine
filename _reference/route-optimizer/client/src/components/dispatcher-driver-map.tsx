import { useState, useEffect, useMemo, useCallback } from "react";
import { createPortal } from "react-dom";
import { MapContainer, TileLayer, Marker, Popup, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useQuery, useMutation } from "@tanstack/react-query";
import { MapPin, Truck, X, ChevronRight, Clock, Navigation, Package, Power, PhoneCall, Lightbulb, ArrowRight, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { driverLiveIcon, CARTO_DARK_NOLABELS, CARTO_DARK_ONLY_LABELS } from "@/components/v7/map-pins";
import { useTheme } from "@/components/theme-provider";

interface StopEta {
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

interface ReassignmentSuggestion {
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

interface DriverLocation {
  id: number;
  driverName: string;
  lat: number | null;
  lng: number | null;
  speed: number | null;
  heading: number | null;
  updatedAt: string | null;
  isOnline: boolean;
  isIdle?: boolean;
  presence?: "fresh" | "stale" | "offline";
  lastSeenMin?: number | null;
  onlineSince?: string | null;
  opsOnlinePending?: boolean;
  opsOnlineRequestedAt?: string | null;
  color: string;
  plate: string;
  nextStopAddress: string;
  nextStopType: "C" | "D" | null;
  nextStopEta: string;
  etaMin: number | null;
  distanceKm: number | null;
  trafficDelayMin: number | null;
  congestionLevel: string | null;
  isTrafficAware: boolean;
  allStops: StopEta[];
}

const PRETORIA_CENTER: [number, number] = [-25.7479, 28.2293];

function congestionColor(level: string | null): string {
  switch (level) {
    case "STANDSTILL": return "#ef4444";
    case "HEAVY": return "#f97316";
    case "SLOW": return "#eab308";
    case "NORMAL": return "#22c55e";
    default: return "#9ca3af";
  }
}

function congestionBg(level: string | null): string {
  switch (level) {
    case "STANDSTILL": return "rgba(239,68,68,0.12)";
    case "HEAVY": return "rgba(249,115,22,0.12)";
    case "SLOW": return "rgba(234,179,8,0.12)";
    case "NORMAL": return "rgba(34,197,94,0.12)";
    default: return "rgba(156,163,175,0.1)";
  }
}

function congestionLabel(level: string | null): string {
  switch (level) {
    case "STANDSTILL": return "Standstill";
    case "HEAVY": return "Heavy";
    case "SLOW": return "Slow";
    case "NORMAL": return "Clear";
    default: return "N/A";
  }
}

function driverMarkerIcon(name: string, color: string, isOnline: boolean, updatedAt: string | null) {
  const bg = isOnline ? color : "#6b7280";
  const borderColor = isOnline ? "white" : "#9ca3af";
  const opacity = isOnline ? 1 : 0.6;
  const offlineLabel = !isOnline && updatedAt
    ? `<div style="font-size:9px;color:#f87171;margin-top:1px">Offline since ${new Date(updatedAt).toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit" })}</div>`
    : !isOnline ? `<div style="font-size:9px;color:#f87171;margin-top:1px">Offline</div>` : "";
  return L.divIcon({
    className: "dispatcher-driver-marker",
    html: `<div style="display:flex;flex-direction:column;align-items:center;opacity:${opacity}">
      <div style="width:20px;height:20px;border-radius:50%;background:${bg};border:2.5px solid ${borderColor};box-shadow:0 2px 8px rgba(0,0,0,0.4)${isOnline ? `;animation:dpulse 2s infinite` : ''}"></div>
      <div style="margin-top:2px;background:rgba(0,0,0,0.7);color:white;font-size:10px;font-weight:600;padding:1px 5px;border-radius:3px;white-space:nowrap;letter-spacing:0.3px;text-align:center">${name}${offlineLabel}</div>
    </div>`,
    iconSize: [120, 52],
    iconAnchor: [60, 10],
  });
}

function driverIdleIcon(name: string, color: string, updatedAt: string | null) {
  const ageMin = updatedAt ? Math.max(1, Math.floor((Date.now() - new Date(updatedAt).getTime()) / 60000)) : null;
  const idleLabel = ageMin != null
    ? `<div style="font-size:9px;color:#f59e0b;margin-top:1px">Idle ${ageMin}m</div>`
    : `<div style="font-size:9px;color:#f59e0b;margin-top:1px">Idle</div>`;
  return L.divIcon({
    className: "dispatcher-driver-marker",
    html: `<div style="display:flex;flex-direction:column;align-items:center">
      <div style="width:20px;height:20px;border-radius:50%;background:${color};border:2.5px solid #f59e0b;box-shadow:0 0 0 3px rgba(245,158,11,0.25),0 2px 8px rgba(0,0,0,0.4)"></div>
      <div style="margin-top:2px;background:rgba(0,0,0,0.7);color:white;font-size:10px;font-weight:600;padding:1px 5px;border-radius:3px;white-space:nowrap;letter-spacing:0.3px;text-align:center">${name}${idleLabel}</div>
    </div>`,
    iconSize: [120, 52],
    iconAnchor: [60, 10],
  });
}

function FitBounds({ drivers }: { drivers: DriverLocation[] }) {
  const map = useMap();
  const onlineDrivers = useMemo(
    () => drivers.filter((d) => d.isOnline && d.lat != null && d.lng != null),
    [drivers]
  );
  const posKey = useMemo(
    () => onlineDrivers.map((d) => `${d.id}:${d.lat?.toFixed(4)},${d.lng?.toFixed(4)}`).join("|"),
    [onlineDrivers]
  );

  useEffect(() => {
    if (onlineDrivers.length === 0) {
      map.setView(PRETORIA_CENTER, 11);
      return;
    }
    if (onlineDrivers.length === 1) {
      map.setView([onlineDrivers[0].lat!, onlineDrivers[0].lng!], 14);
      return;
    }
    const bounds = L.latLngBounds(
      onlineDrivers.map((d) => [d.lat!, d.lng!] as [number, number])
    );
    map.fitBounds(bounds, { padding: [40, 40], maxZoom: 15 });
  }, [posKey, map]);

  return null;
}

function timeSince(dateStr: string | null): string {
  if (!dateStr) return "Unknown";
  const diff = Date.now() - new Date(dateStr).getTime();
  const secs = Math.floor(diff / 1000);
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ${mins % 60}m ago`;
}

function RouteItineraryPanel({ driver, phoneMap, onClose }: { driver: DriverLocation; phoneMap: Record<string, string>; onClose: () => void }) {
  const stops = driver.allStops || [];
  const phone = phoneMap[driver.driverName.toLowerCase().trim()];

  return (
    <div
      className="absolute top-0 right-0 bottom-0 w-[340px] bg-card border-l border-border z-[500] flex flex-col shadow-xl"
      data-testid="route-itinerary-panel"
    >
      <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-card shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <span
            style={{ width: 10, height: 10, borderRadius: "50%", background: driver.isOnline ? driver.color : "#6b7280", flexShrink: 0 }}
            className="inline-block"
          />
          <span className="text-sm font-semibold truncate" data-testid="text-itinerary-driver-name">{driver.driverName}</span>
          {phone && (
            <a
              href={`tel:${phone}`}
              className="text-green-500 hover:text-green-400 shrink-0"
              title={`Call: ${phone}`}
              data-testid="button-call-itinerary-driver"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
            </a>
          )}
        </div>
        <button
          onClick={onClose}
          className="w-7 h-7 rounded-lg flex items-center justify-center hover:bg-muted/70 transition-colors shrink-0"
          data-testid="button-close-itinerary"
        >
          <X className="w-3.5 h-3.5 text-muted-foreground" />
        </button>
      </div>

      <div className="px-4 py-2 border-b border-border bg-muted/30 shrink-0">
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          {driver.plate && <span data-testid="text-itinerary-plate">{driver.plate}</span>}
          <span>{driver.speed != null ? `${Math.round(driver.speed * 3.6)} km/h` : "—"}</span>
          <span>Updated {timeSince(driver.updatedAt)}</span>
        </div>
        <div className="flex items-center gap-2 mt-1">
          <span className="text-xs font-medium" data-testid="text-itinerary-stop-count">
            {stops.length} stop{stops.length !== 1 ? "s" : ""} remaining
          </span>
          {stops.length > 0 && (
            <span className="text-xs text-muted-foreground">
              · {stops[stops.length - 1].distanceFromDriverKm.toFixed(1)} km total
            </span>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto" data-testid="itinerary-stop-list">
        {stops.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center px-6">
            <Package className="w-8 h-8 text-muted-foreground mb-2" />
            <p className="text-sm text-muted-foreground">No pending stops</p>
          </div>
        )}
        {stops.map((stop, idx) => (
          <div
            key={stop.stopKey}
            className="border-b border-border/50 last:border-b-0"
            data-testid={`itinerary-stop-${idx}`}
          >
            <div className="px-4 py-3">
              <div className="flex items-start gap-3">
                <div className="flex flex-col items-center shrink-0 pt-0.5">
                  <div
                    className="w-6 h-6 rounded-full flex items-center justify-center text-white text-[10px] font-bold"
                    style={{ background: stop.type === "C" ? "#ca8a04" : "#3b82f6" }}
                    data-testid={`badge-stop-type-${idx}`}
                  >
                    {idx + 1}
                  </div>
                  {idx < stops.length - 1 && (
                    <div className="w-px h-full bg-border/60 mt-1 min-h-[20px]" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span
                      className="text-[10px] font-semibold px-1.5 py-0.5 rounded"
                      style={{
                        background: stop.type === "C" ? "rgba(234,179,8,0.15)" : "rgba(59,130,246,0.15)",
                        color: stop.type === "C" ? "#ca8a04" : "#3b82f6",
                      }}
                      data-testid={`text-stop-type-label-${idx}`}
                    >
                      {stop.type === "C" ? "Collection" : "Delivery"}
                    </span>
                    {stop.waybills.length > 0 && (
                      <span className="text-[10px] text-muted-foreground" data-testid={`text-stop-waybills-${idx}`}>
                        {stop.waybills.length} WB
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-foreground leading-tight mb-1.5 line-clamp-2" data-testid={`text-stop-addr-${idx}`}>
                    {stop.addr}
                  </p>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="inline-flex items-center gap-1 text-xs font-semibold" style={{ color: "#4a9eff" }} data-testid={`text-stop-eta-clock-${idx}`}>
                      <Clock className="w-3 h-3" />
                      {stop.etaClockTime}
                    </span>
                    <span className="text-muted-foreground text-[10px]">·</span>
                    <span className="text-xs text-muted-foreground" data-testid={`text-stop-eta-min-${idx}`}>
                      {stop.etaMin} min
                    </span>
                    <span className="text-muted-foreground text-[10px]">·</span>
                    <span className="inline-flex items-center gap-0.5 text-xs text-muted-foreground" data-testid={`text-stop-distance-${idx}`}>
                      <Navigation className="w-3 h-3" />
                      {stop.distanceFromDriverKm.toFixed(1)} km
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 mt-1">
                    <span
                      className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded"
                      style={{
                        background: congestionBg(stop.congestionLevel),
                        color: congestionColor(stop.congestionLevel),
                      }}
                      data-testid={`badge-traffic-${idx}`}
                    >
                      <span
                        style={{
                          width: 5, height: 5, borderRadius: "50%",
                          background: congestionColor(stop.congestionLevel),
                          display: "inline-block",
                        }}
                      />
                      {congestionLabel(stop.congestionLevel)}
                    </span>
                    {stop.trafficDelayMin > 0 && (
                      <span className="text-[10px] text-red-500" data-testid={`text-traffic-delay-${idx}`}>
                        +{stop.trafficDelayMin.toFixed(0)} min delay
                      </span>
                    )}
                    {!stop.isTrafficAware && (
                      <span className="text-[9px] text-muted-foreground italic">est.</span>
                    )}
                  </div>
                  <div className="text-[10px] text-muted-foreground mt-1" data-testid={`text-stop-leg-${idx}`}>
                    Leg: {stop.legDistanceKm.toFixed(1)} km / {stop.legDriveMin} min drive + {stop.dwellMin} min dwell
                  </div>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function presenceMeta(d: DriverLocation): { label: string; color: string } {
  if (d.presence === "fresh") return { label: "Online", color: "#16a34a" };
  if (d.presence === "stale") return { label: "Online (stale)", color: "#f59e0b" };
  return { label: "Offline", color: "#6b7280" };
}

// Roster panel lists EVERY driver — including those with no GPS fix — so Ops can
// trigger the force-online fallback even when a driver's location flow is broken
// and they never appear as a map marker.
function DriverRosterPanel({
  drivers,
  onClose,
  onRequestOnline,
  onForceOffline,
  requestPending,
  forcePending,
}: {
  drivers: DriverLocation[];
  onClose: () => void;
  onRequestOnline: (id: number) => void;
  onForceOffline: (id: number) => void;
  requestPending: boolean;
  forcePending: boolean;
}) {
  const sorted = useMemo(() => {
    const rank = (d: DriverLocation) => (d.presence === "fresh" ? 0 : d.presence === "stale" ? 1 : 2);
    return [...drivers].sort((a, b) => rank(a) - rank(b) || a.driverName.localeCompare(b.driverName));
  }, [drivers]);

  return (
    <div
      className="absolute top-0 left-0 bottom-0 w-[320px] bg-card border-r border-border z-[500] flex flex-col shadow-xl"
      data-testid="driver-roster-panel"
    >
      <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-card shrink-0">
        <span className="text-sm font-semibold">Driver roster</span>
        <button
          onClick={onClose}
          className="w-7 h-7 rounded-lg flex items-center justify-center hover:bg-muted/70 transition-colors"
          data-testid="button-close-roster"
        >
          <X className="w-3.5 h-3.5 text-muted-foreground" />
        </button>
      </div>
      <div className="px-4 py-2 border-b border-border bg-muted/30 shrink-0">
        <p className="text-[11px] text-muted-foreground leading-snug">
          Place a driver online even if their app's location isn't reporting. They confirm on their phone before going live.
        </p>
      </div>
      <div className="flex-1 overflow-y-auto" data-testid="roster-list">
        {sorted.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center px-6">
            <Truck className="w-8 h-8 text-muted-foreground mb-2" />
            <p className="text-sm text-muted-foreground">No drivers found</p>
          </div>
        )}
        {sorted.map((d) => {
          const meta = presenceMeta(d);
          const hasGps = d.lat != null && d.lng != null;
          return (
            <div
              key={d.id}
              className="px-4 py-3 border-b border-border/50 last:border-b-0"
              data-testid={`roster-row-${d.id}`}
            >
              <div className="flex items-center gap-2 mb-1">
                <span
                  style={{ width: 9, height: 9, borderRadius: "50%", background: d.color, flexShrink: 0 }}
                  className="inline-block"
                />
                <span className="text-sm font-medium truncate flex-1" data-testid={`roster-name-${d.id}`}>
                  {d.driverName}
                </span>
                <span
                  className="text-[10px] font-bold uppercase tracking-wide"
                  style={{ color: meta.color }}
                  data-testid={`roster-presence-${d.id}`}
                >
                  {meta.label}
                </span>
              </div>
              <div className="flex items-center gap-2 text-[11px] text-muted-foreground mb-2">
                {d.plate && <span>{d.plate}</span>}
                {d.presence !== "offline" && d.lastSeenMin != null && <span>seen {d.lastSeenMin}m ago</span>}
                {!hasGps && <span className="text-amber-500">no GPS fix</span>}
              </div>
              {d.opsOnlinePending && (
                <div className="text-[11px] font-semibold text-amber-500 mb-1.5" data-testid={`roster-pending-${d.id}`}>
                  Awaiting driver confirmation…
                </div>
              )}
              <div className="flex gap-2 flex-wrap">
                {d.presence !== "fresh" && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 gap-1 text-xs text-green-600 dark:text-green-400 border-green-600/30"
                    disabled={requestPending || d.opsOnlinePending}
                    onClick={() => onRequestOnline(d.id)}
                    data-testid={`button-roster-request-online-${d.id}`}
                  >
                    <PhoneCall className="w-3 h-3" />
                    {d.opsOnlinePending ? "Request sent" : "Place online"}
                  </Button>
                )}
                {d.presence !== "offline" && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 gap-1 text-xs text-red-500 border-red-500/30"
                    disabled={forcePending}
                    onClick={() => onForceOffline(d.id)}
                    data-testid={`button-roster-force-offline-${d.id}`}
                  >
                    <Power className="w-3 h-3" />
                    Set offline
                  </Button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function DriverMapButton() {
  const [open, setOpen] = useState(false);

  const { data: drivers = [] } = useQuery<DriverLocation[]>({
    queryKey: ["/api/dispatch/driver-locations"],
    refetchInterval: 15000,
  });

  const onlineCount = drivers.filter((d) => d.isOnline).length;
  const totalWithPos = drivers.filter((d) => d.lat != null && d.lng != null).length;

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        className="gap-1.5 font-bold bg-white/20 border-white/30 text-white backdrop-blur-sm"
        data-testid="button-open-driver-map"
      >
        <MapPin className="w-4 h-4" />
        Live Map
        {onlineCount > 0 ? (
          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-green-500/20 text-green-600 dark:text-green-400 font-medium">
            {onlineCount}
          </span>
        ) : totalWithPos > 0 ? (
          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground font-medium">
            {totalWithPos}
          </span>
        ) : null}
      </Button>
      {open && createPortal(<DriverMapModal onClose={() => setOpen(false)} />, document.body)}
    </>
  );
}

function DriverMapModal({ onClose }: { onClose: () => void }) {
  const { data: drivers = [], isLoading } = useQuery<DriverLocation[]>({
    queryKey: ["/api/dispatch/driver-locations"],
    refetchInterval: 15000,
  });

  const { data: driverAccounts = [] } = useQuery<any[]>({
    queryKey: ["/api/auth/driver-accounts"],
  });
  const phoneMap = useMemo(() => {
    const map: Record<string, string> = {};
    (driverAccounts || []).forEach((acc: any) => {
      if (acc.phone && acc.driverName) {
        map[acc.driverName.toLowerCase().trim()] = acc.phone;
      }
    });
    return map;
  }, [driverAccounts]);

  const [selectedDriverId, setSelectedDriverId] = useState<number | null>(null);
  const [showRoster, setShowRoster] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const { toast } = useToast();

  const { data: suggestions = [] } = useQuery<ReassignmentSuggestion[]>({
    queryKey: ["/api/dispatch/reassignment-suggestions"],
    refetchInterval: 15000,
  });

  const requestOnline = useMutation({
    mutationFn: async (driverId: number) => {
      await apiRequest("POST", `/api/dispatch/drivers/${driverId}/request-online`, {});
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/dispatch/driver-locations"] });
      toast({ title: "Online request sent", description: "The driver has been prompted to confirm going online." });
    },
    onError: (e: any) => {
      toast({ title: "Could not send request", description: e?.message || "Try again.", variant: "destructive" });
    },
  });

  const forceOffline = useMutation({
    mutationFn: async (driverId: number) => {
      await apiRequest("POST", `/api/dispatch/drivers/${driverId}/force-offline`, {});
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/dispatch/driver-locations"] });
      toast({ title: "Driver set offline" });
    },
    onError: (e: any) => {
      toast({ title: "Could not set offline", description: e?.message || "Try again.", variant: "destructive" });
    },
  });

  const selectedDriver = useMemo(
    () => drivers.find((d) => d.id === selectedDriverId) || null,
    [drivers, selectedDriverId]
  );

  const driversWithPos = useMemo(
    () => drivers.filter((d) => d.lat != null && d.lng != null),
    [drivers]
  );
  const onlineCount = drivers.filter((d) => d.isOnline).length;
  const offlineCount = driversWithPos.length - onlineCount;
  const { theme } = useTheme();
  const baseTileUrl = theme === "light"
    ? "https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png"
    : CARTO_DARK_NOLABELS;
  const labelTileUrl = theme === "light"
    ? "https://{s}.basemaps.cartocdn.com/light_only_labels/{z}/{x}/{y}{r}.png"
    : CARTO_DARK_ONLY_LABELS;

  useEffect(() => {
    function handleEsc(e: KeyboardEvent) {
      if (e.key === "Escape") {
        if (showRoster) {
          setShowRoster(false);
        } else if (selectedDriverId) {
          setSelectedDriverId(null);
        } else {
          onClose();
        }
      }
    }
    document.addEventListener("keydown", handleEsc);
    return () => document.removeEventListener("keydown", handleEsc);
  }, [onClose, selectedDriverId, showRoster]);

  const handleMarkerClick = useCallback((driverId: number) => {
    setSelectedDriverId((prev) => (prev === driverId ? null : driverId));
  }, []);

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center"
      data-testid="driver-map-modal"
    >
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />

      <div className="relative w-[95vw] max-w-6xl h-[80vh] max-h-[700px] rounded-xl border border-border bg-card shadow-2xl overflow-hidden flex flex-col">
        <style>{`
          @keyframes dpulse {
            0% { box-shadow: 0 0 0 0 rgba(74,158,255,0.5); }
            70% { box-shadow: 0 0 0 8px rgba(74,158,255,0); }
            100% { box-shadow: 0 0 0 0 rgba(74,158,255,0); }
          }
        `}</style>

        <div className="flex items-center justify-between px-5 py-3 border-b border-border bg-card shrink-0">
          <div className="flex items-center gap-2.5">
            <MapPin className="w-4 h-4 text-primary" />
            <span className="text-sm font-semibold">Live Driver Map</span>
            {onlineCount > 0 && (
              <span className="text-xs px-2 py-0.5 rounded-full bg-green-500/20 text-green-600 dark:text-green-400 font-medium">
                {onlineCount} online
              </span>
            )}
            {offlineCount > 0 && (
              <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground font-medium">
                {offlineCount} offline
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant={showSuggestions ? "default" : "outline"}
              size="sm"
              className="h-8 gap-1.5 text-xs relative"
              onClick={() => { setShowSuggestions((v) => !v); setShowRoster(false); }}
              data-testid="button-toggle-suggestions"
            >
              <Lightbulb className="w-3.5 h-3.5" />
              Suggestions
              {suggestions.length > 0 && (
                <span
                  className="absolute -top-1.5 -right-1.5 min-w-[16px] h-[16px] px-1 rounded-full bg-amber-500 text-white text-[10px] font-bold flex items-center justify-center"
                  data-testid="badge-suggestion-count"
                >
                  {suggestions.length}
                </span>
              )}
            </Button>
            <Button
              variant={showRoster ? "default" : "outline"}
              size="sm"
              className="h-8 gap-1.5 text-xs"
              onClick={() => { setShowRoster((v) => !v); setShowSuggestions(false); }}
              data-testid="button-toggle-roster"
            >
              <Power className="w-3.5 h-3.5" />
              Roster
            </Button>
            <button
              onClick={onClose}
              className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-muted/70 transition-colors"
              data-testid="button-close-driver-map"
            >
              <X className="w-4 h-4 text-muted-foreground" />
            </button>
          </div>
        </div>

        <div className="flex-1 relative">
          {isLoading && (
            <div className="absolute inset-0 flex items-center justify-center bg-muted/50 z-10">
              <span className="text-sm text-muted-foreground animate-pulse">Loading driver locations...</span>
            </div>
          )}

          {!isLoading && onlineCount === 0 && (
            <div className="absolute inset-0 z-10 flex flex-col items-center justify-center pointer-events-none">
              <div className="bg-background/80 backdrop-blur-sm rounded-xl px-6 py-4 text-center border border-border shadow-lg">
                <Truck className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
                <p className="text-sm font-medium text-foreground">No drivers online</p>
                <p className="text-xs text-muted-foreground mt-1">
                  {offlineCount > 0 ? `${offlineCount} driver${offlineCount > 1 ? "s" : ""} offline at last known positions` : "Driver locations will appear here when drivers log in"}
                </p>
              </div>
            </div>
          )}

          <MapContainer
            center={PRETORIA_CENTER}
            zoom={11}
            style={{ width: "100%", height: "100%" }}
            zoomControl={true}
            attributionControl={false}
          >
            <TileLayer url={baseTileUrl} maxZoom={19} />
            <TileLayer url={labelTileUrl} maxZoom={19} pane="overlayPane" />
            <FitBounds drivers={driversWithPos} />

            {driversWithPos.map((d) => (
              <Marker
                key={d.id}
                position={[d.lat!, d.lng!]}
                icon={
                  d.isOnline && d.isIdle
                    ? driverIdleIcon(d.driverName, d.color, d.updatedAt)
                    : d.isOnline
                      ? driverLiveIcon(d.color)
                      : driverMarkerIcon(d.driverName, d.color, d.isOnline, d.updatedAt)
                }
                eventHandlers={{
                  click: () => handleMarkerClick(d.id),
                }}
              >
                <Popup>
                  <div style={{ minWidth: 200, fontSize: 13, lineHeight: 1.6 }}>
                    <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4, display: "flex", alignItems: "center", gap: 6 }}>
                      <span style={{ width: 10, height: 10, borderRadius: "50%", background: d.isOnline ? d.color : "#6b7280", display: "inline-block" }}></span>
                      {d.driverName}
                      {phoneMap[d.driverName.toLowerCase().trim()] && (
                        <a
                          href={`tel:${phoneMap[d.driverName.toLowerCase().trim()]}`}
                          style={{
                            display: "inline-flex", alignItems: "center", justifyContent: "center",
                            width: 22, height: 22, borderRadius: "50%",
                            background: "rgba(34,197,94,0.15)", color: "#22c55e",
                            textDecoration: "none", fontSize: 12,
                          }}
                          title={`Call: ${phoneMap[d.driverName.toLowerCase().trim()]}`}
                          data-testid={`button-call-driver-map-${d.id}`}
                        >
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
                        </a>
                      )}
                    </div>
                    {d.plate && (
                      <div style={{ color: "#666", fontSize: 12 }}>
                        <strong>Vehicle:</strong> {d.plate}
                      </div>
                    )}
                    <div style={{ color: "#666", fontSize: 12 }}>
                      <strong>Speed:</strong> {d.speed != null ? `${Math.round(d.speed * 3.6)} km/h` : "\u2014"}
                    </div>
                    <div style={{ color: "#666", fontSize: 12 }}>
                      <strong>Updated:</strong> {timeSince(d.updatedAt)}
                    </div>
                    {d.isOnline && d.isIdle && (
                      <div style={{ color: "#f59e0b", fontSize: 12, fontWeight: 600 }} data-testid={`text-driver-idle-${d.id}`}>
                        Idle — last update {timeSince(d.updatedAt)}
                      </div>
                    )}
                    {!d.isOnline && (
                      <div style={{ color: "#ef4444", fontSize: 12, fontWeight: 600 }}>
                        Offline since {d.updatedAt ? new Date(d.updatedAt).toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit" }) : "unknown"}
                      </div>
                    )}
                    <div style={{ marginTop: 6, paddingTop: 6, borderTop: "1px solid #eee", display: "flex", flexDirection: "column", gap: 4 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11 }}>
                        <span style={{
                          fontWeight: 700,
                          textTransform: "uppercase",
                          letterSpacing: "0.04em",
                          color: d.presence === "fresh" ? "#16a34a" : d.presence === "stale" ? "#f59e0b" : "#6b7280",
                        }} data-testid={`text-presence-${d.id}`}>
                          {d.presence === "fresh" ? "Online" : d.presence === "stale" ? "Online (stale)" : "Offline"}
                        </span>
                        {d.presence !== "offline" && d.lastSeenMin != null && (
                          <span style={{ color: "#999" }}>seen {d.lastSeenMin}m ago</span>
                        )}
                      </div>
                      {d.opsOnlinePending && (
                        <div style={{ fontSize: 11, color: "#f59e0b", fontWeight: 600 }} data-testid={`text-ops-pending-${d.id}`}>
                          Awaiting driver confirmation…
                        </div>
                      )}
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                        {d.presence !== "fresh" && (
                          <button
                            onClick={() => requestOnline.mutate(d.id)}
                            disabled={requestOnline.isPending || d.opsOnlinePending}
                            style={{
                              display: "inline-flex", alignItems: "center", gap: 4,
                              fontSize: 11, fontWeight: 600, padding: "3px 8px", borderRadius: 4,
                              background: "rgba(34,197,94,0.15)", color: "#16a34a",
                              border: "none", cursor: d.opsOnlinePending ? "default" : "pointer",
                              opacity: d.opsOnlinePending ? 0.6 : 1,
                            }}
                            data-testid={`button-request-online-${d.id}`}
                          >
                            <PhoneCall style={{ width: 12, height: 12 }} />
                            {d.opsOnlinePending ? "Request sent" : "Place online"}
                          </button>
                        )}
                        {d.presence !== "offline" && (
                          <button
                            onClick={() => forceOffline.mutate(d.id)}
                            disabled={forceOffline.isPending}
                            style={{
                              display: "inline-flex", alignItems: "center", gap: 4,
                              fontSize: 11, fontWeight: 600, padding: "3px 8px", borderRadius: 4,
                              background: "rgba(239,68,68,0.12)", color: "#ef4444",
                              border: "none", cursor: "pointer",
                            }}
                            data-testid={`button-force-offline-${d.id}`}
                          >
                            <Power style={{ width: 12, height: 12 }} />
                            Set offline
                          </button>
                        )}
                      </div>
                    </div>
                    {d.nextStopAddress && (
                      <div style={{ marginTop: 6, paddingTop: 6, borderTop: "1px solid #eee" }}>
                        <div style={{ fontSize: 12, display: "flex", alignItems: "center", gap: 4, marginBottom: 3 }}>
                          <strong>Next stop:</strong>
                          {d.nextStopType && (
                            <span style={{
                              fontSize: 10,
                              fontWeight: 600,
                              padding: "1px 5px",
                              borderRadius: 3,
                              background: d.nextStopType === "C" ? "rgba(234,179,8,0.15)" : "rgba(59,130,246,0.15)",
                              color: d.nextStopType === "C" ? "#ca8a04" : "#3b82f6",
                            }}>
                              {d.nextStopType === "C" ? "Collection" : "Delivery"}
                            </span>
                          )}
                        </div>
                        <div style={{ fontSize: 12, color: "#666", marginBottom: 4 }}>{d.nextStopAddress}</div>
                        {d.etaMin != null && (
                          <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}>
                            <span style={{ fontWeight: 700, color: "#4a9eff" }}>
                              {d.etaMin} min
                            </span>
                            <span style={{ color: "#999" }}>&middot;</span>
                            <span style={{ color: "#888" }}>{d.distanceKm?.toFixed(1)} km</span>
                            {d.isTrafficAware && (
                              <>
                                <span style={{ color: "#999" }}>&middot;</span>
                                <span style={{
                                  display: "inline-flex",
                                  alignItems: "center",
                                  gap: 3,
                                  fontSize: 10,
                                  fontWeight: 600,
                                  padding: "1px 5px",
                                  borderRadius: 3,
                                  background: congestionBg(d.congestionLevel),
                                  color: congestionColor(d.congestionLevel),
                                }} data-testid={`congestion-${d.id}`}>
                                  <span style={{
                                    width: 6,
                                    height: 6,
                                    borderRadius: "50%",
                                    background: congestionColor(d.congestionLevel),
                                    display: "inline-block",
                                  }}></span>
                                  {congestionLabel(d.congestionLevel)}
                                </span>
                              </>
                            )}
                          </div>
                        )}
                        {d.isTrafficAware && d.trafficDelayMin != null && d.trafficDelayMin > 0 && (
                          <div style={{ fontSize: 11, color: "#ef4444", marginTop: 2 }}>
                            +{d.trafficDelayMin.toFixed(0)} min traffic delay
                          </div>
                        )}
                        {!d.isTrafficAware && d.etaMin != null && (
                          <div style={{ fontSize: 10, color: "#999", marginTop: 2, fontStyle: "italic" }}>
                            Estimated (no live traffic)
                          </div>
                        )}
                      </div>
                    )}
                    {(d.allStops?.length || 0) > 0 && (
                      <div style={{ marginTop: 6, paddingTop: 6, borderTop: "1px solid #eee" }}>
                        <button
                          onClick={() => handleMarkerClick(d.id)}
                          style={{
                            display: "flex", alignItems: "center", gap: 4,
                            fontSize: 11, color: "#4a9eff", fontWeight: 600,
                            background: "none", border: "none", cursor: "pointer", padding: 0,
                          }}
                          data-testid={`button-view-route-${d.id}`}
                        >
                          View full route ({d.allStops.length} stops)
                          <ChevronRight style={{ width: 14, height: 14 }} />
                        </button>
                      </div>
                    )}
                  </div>
                </Popup>
              </Marker>
            ))}
          </MapContainer>

          {selectedDriver && (
            <RouteItineraryPanel
              driver={selectedDriver}
              phoneMap={phoneMap}
              onClose={() => setSelectedDriverId(null)}
            />
          )}

          {showRoster && (
            <DriverRosterPanel
              drivers={drivers}
              onClose={() => setShowRoster(false)}
              onRequestOnline={(id) => requestOnline.mutate(id)}
              onForceOffline={(id) => forceOffline.mutate(id)}
              requestPending={requestOnline.isPending}
              forcePending={forceOffline.isPending}
            />
          )}

          {showSuggestions && (
            <ReassignmentSuggestionsPanel
              suggestions={suggestions}
              onClose={() => setShowSuggestions(false)}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function ReassignmentSuggestionsPanel({
  suggestions,
  onClose,
}: {
  suggestions: ReassignmentSuggestion[];
  onClose: () => void;
}) {
  const { toast } = useToast();
  const [appliedIds, setAppliedIds] = useState<Set<string>>(new Set());

  const apply = useMutation({
    mutationFn: async (s: ReassignmentSuggestion) => {
      await apiRequest("POST", "/api/dispatch/reassignment-suggestions/apply", {
        projectId: s.projectId,
        shipmentIds: s.shipmentIds,
        toAssignmentId: s.toAssignmentId,
      });
    },
    onSuccess: (_data, s) => {
      setAppliedIds((prev) => new Set(prev).add(s.id));
      queryClient.invalidateQueries({ queryKey: ["/api/dispatch/reassignment-suggestions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dispatch/driver-locations"] });
      toast({ title: "Reassigned", description: `${s.stopAddr} moved to ${s.toDriverName}` });
    },
    onError: (e: any) => {
      toast({ title: "Could not reassign", description: e?.message || "Try again.", variant: "destructive" });
    },
  });

  return (
    <div className="absolute top-0 right-0 bottom-0 w-[340px] max-w-[85vw] bg-card border-l border-border shadow-2xl z-[20] flex flex-col" data-testid="panel-reassignment-suggestions">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
        <div className="flex items-center gap-2">
          <Lightbulb className="w-4 h-4 text-amber-500" />
          <span className="text-sm font-semibold">Reassignment Suggestions</span>
        </div>
        <button
          onClick={onClose}
          className="w-7 h-7 rounded-lg flex items-center justify-center hover:bg-muted/70 transition-colors"
          data-testid="button-close-suggestions"
        >
          <X className="w-4 h-4 text-muted-foreground" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {suggestions.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center py-10">
            <Lightbulb className="w-7 h-7 text-muted-foreground mb-2" />
            <p className="text-sm font-medium text-foreground">No suggestions right now</p>
            <p className="text-xs text-muted-foreground mt-1">
              When another online driver is much closer to a stop, we'll suggest the move here.
            </p>
          </div>
        )}

        {suggestions.map((s) => {
          const applied = appliedIds.has(s.id);
          return (
            <div
              key={s.id}
              className="rounded-lg border border-border bg-background p-3 space-y-2"
              data-testid={`card-suggestion-${s.stopKey}`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className={`text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded ${s.stopType === "C" ? "bg-blue-500/15 text-blue-600 dark:text-blue-400" : "bg-purple-500/15 text-purple-600 dark:text-purple-400"}`}>
                  {s.stopType === "C" ? "Collection" : "Delivery"}
                </span>
                <span className="text-[11px] font-bold text-green-600 dark:text-green-400" data-testid={`text-improvement-${s.stopKey}`}>
                  −{s.improvementMin} min
                </span>
              </div>

              <div className="text-xs font-medium text-foreground leading-snug" data-testid={`text-stop-addr-${s.stopKey}`}>
                {s.stopAddr}
              </div>
              {s.waybills.length > 0 && (
                <div className="text-[11px] text-muted-foreground truncate">
                  {s.waybills.join(", ")}
                </div>
              )}

              <div className="flex items-center gap-1.5 text-[11px]">
                <span className="text-muted-foreground line-through" data-testid={`text-from-driver-${s.stopKey}`}>
                  {s.fromDriverName} · {s.currentEtaMin}m
                </span>
                <ArrowRight className="w-3 h-3 text-muted-foreground shrink-0" />
                <span className="font-semibold text-foreground" data-testid={`text-to-driver-${s.stopKey}`}>
                  {s.toDriverName} · {s.suggestedEtaMin}m
                </span>
              </div>

              <Button
                size="sm"
                className="w-full h-8 text-xs gap-1.5"
                disabled={applied || apply.isPending}
                onClick={() => apply.mutate(s)}
                data-testid={`button-apply-suggestion-${s.stopKey}`}
              >
                <Check className="w-3.5 h-3.5" />
                {applied ? "Reassigned" : "Approve & reassign"}
              </Button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default DriverMapButton;
