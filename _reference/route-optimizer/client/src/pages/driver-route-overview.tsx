import { useState, useEffect, useMemo, useRef } from "react";
import { useLocation } from "wouter";
import { useDriverAuth } from "@/hooks/use-driver-auth";
import { fetchTripSheet, fetchRoutePolyline, type DriverStop } from "@/lib/driver-api";
import { injectDriverManifest, setMobileViewportHeight } from "@/lib/driver-pwa";
import { MapContainer, TileLayer, Marker, Polyline, useMap } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import { ArrowLeft, Loader2, MapPin, Package, CheckCircle2 } from "lucide-react";
import {
  collectionIcon, deliveryIcon,
  CARTO_DARK_NOLABELS, CARTO_DARK_ONLY_LABELS,
  CARTO_LIGHT_NOLABELS, CARTO_LIGHT_ONLY_LABELS,
  POLYLINE_OPTIONS,
} from "@/components/v7/map-pins";
import { useTheme } from "@/components/theme-provider";

const PRETORIA_CENTER: [number, number] = [-25.7479, 28.2293];
const SELF_FALLBACK = "#9F66D9";

function stopIcon(seq: number, type: "C" | "D", status: string, _isCurrent: boolean, color: string) {
  const tone = status === "completed" || status === "skipped" || status === "failed"
    ? "#5b637a"
    : color;
  return type === "C" ? collectionIcon(tone) : deliveryIcon(tone, seq);
}

function FitBounds({ stops }: { stops: DriverStop[] }) {
  const map = useMap();
  useEffect(() => {
    const pts = stops.filter((s) => s.lat && s.lng).map((s) => [s.lat, s.lng] as [number, number]);
    if (pts.length > 0) {
      map.fitBounds(pts, { padding: [40, 40] });
    }
  }, [stops, map]);
  return null;
}

export default function DriverRouteOverview() {
  const [, setLocation] = useLocation();
  const { isAuthenticated } = useDriverAuth();
  const { theme } = useTheme();
  const [stops, setStops] = useState<DriverStop[]>([]);
  const [loading, setLoading] = useState(true);
  const [fleetColor, setFleetColor] = useState<string>(SELF_FALLBACK);

  useEffect(() => {
    if (!isAuthenticated) { setLocation("/driver/login"); return; }
    injectDriverManifest();
    setMobileViewportHeight();
    fetchTripSheet().then((data) => {
      setStops(data.stops);
      if (data.fleetColor) setFleetColor(data.fleetColor);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [isAuthenticated, setLocation]);

  const [routeLine, setRouteLine] = useState<[number, number][]>([]);
  const routeFetchedRef = useRef(false);

  useEffect(() => {
    if (stops.length < 2 || routeFetchedRef.current) return;
    const waypoints = stops.filter((s) => s.lat && s.lng).map((s) => ({ lat: s.lat, lng: s.lng }));
    if (waypoints.length < 2) return;
    routeFetchedRef.current = true;
    fetchRoutePolyline(waypoints).then((pts) => {
      if (pts.length > 0) setRouteLine(pts);
      else setRouteLine(waypoints.map(w => [w.lat, w.lng] as [number, number]));
    }).catch(() => {
      setRouteLine(waypoints.map(w => [w.lat, w.lng] as [number, number]));
    });
  }, [stops]);

  const center = useMemo<[number, number]>(() => {
    const first = stops.find((s) => s.lat && s.lng);
    return first ? [first.lat, first.lng] : PRETORIA_CENTER;
  }, [stops]);

  const completedCount = stops.filter((s) => s.status === "completed").length;
  const totalKm = stops.reduce((s, stop) => s + (stop.legKm || 0), 0);

  return (
    <div className="flex flex-col driver-fullscreen bg-surface-base">
      <header className="flex-shrink-0 flex items-center gap-3 px-4 bg-surface-raised/95 border-b border-hairline" style={{ paddingTop: "max(0.5rem, env(safe-area-inset-top))", minHeight: "3.5rem" }}>
        <button onClick={() => history.back()} className="p-2 -ml-2 text-text-tertiary" data-testid="button-back">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="text-base font-semibold text-text-primary">Route Overview</h1>
      </header>

      <div className="flex-shrink-0 px-4 py-3 flex items-center gap-4 bg-surface-raised/80">
        <div className="flex items-center gap-1.5 text-xs text-text-tertiary">
          <MapPin className="w-3.5 h-3.5 text-jacaranda-400" />
          <span data-testid="text-stop-count">{stops.length} stops</span>
        </div>
        <div className="flex items-center gap-1.5 text-xs text-text-tertiary">
          <CheckCircle2 className="w-3.5 h-3.5 text-success" />
          <span>{completedCount} done</span>
        </div>
        <div className="flex items-center gap-1.5 text-xs text-text-tertiary">
          <Package className="w-3.5 h-3.5" />
          <span>{totalKm.toFixed(1)} km</span>
        </div>
      </div>

      {loading ? (
        <div className="flex-1 flex items-center justify-center">
          <Loader2 className="w-8 h-8 text-jacaranda-400 animate-spin" />
        </div>
      ) : (
        <div className="flex-1 min-h-0">
          <style>{`.leaflet-container { background: hsl(var(--v7-surface-base)); }`}</style>
          <MapContainer center={center} zoom={12} style={{ width: "100%", height: "100%" }} zoomControl={false} attributionControl={false}>
            <TileLayer url={theme === "light" ? CARTO_LIGHT_NOLABELS : CARTO_DARK_NOLABELS} maxZoom={19} />
            <TileLayer url={theme === "light" ? CARTO_LIGHT_ONLY_LABELS : CARTO_DARK_ONLY_LABELS} maxZoom={19} pane="overlayPane" />
            <FitBounds stops={stops} />
            {routeLine.length > 1 && (
              <Polyline positions={routeLine} pathOptions={POLYLINE_OPTIONS(fleetColor)} />
            )}
            {(() => {
              const firstPending = stops.find((s) => s.status === "pending" || s.status === "arrived");
              return stops.map((s) => {
                if (!s.lat || !s.lng) return null;
                const isCurrent = firstPending?.key === s.key;
                return (
                  <Marker key={s.key} position={[s.lat, s.lng]} icon={stopIcon(s.seq, (s.type as "C" | "D") || "D", s.status, isCurrent, fleetColor)} />
                );
              });
            })()}
          </MapContainer>
        </div>
      )}

      <div className="flex-shrink-0 overflow-y-auto bg-surface-base" style={{ maxHeight: "35vh" }}>
        <div className="px-4 py-3 space-y-2">
          {(() => {
            const firstPending = stops.find((s) => s.status === "pending" || s.status === "arrived");
            return stops.map((s) => {
              const isCurrent = firstPending?.key === s.key;
              return (
            <div
              key={s.key}
              className={`rounded-lg p-3 flex items-center gap-3 border ${
                isCurrent ? "bg-jacaranda-500/10 border-jacaranda-400/30" : "bg-surface-overlay/40 border-hairline"
              } ${s.status === "completed" || s.status === "skipped" ? "opacity-50" : ""}`}
              data-testid={`card-route-stop-${s.seq}`}
            >
              <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold text-text-primary flex-shrink-0 ${
                s.status === "completed" ? "bg-text-quiet"
                : s.status === "failed" ? "bg-danger"
                : s.status === "skipped" ? "bg-warning"
                : isCurrent ? "bg-jacaranda-500" : "bg-jacaranda-700"
              }`}>
                {s.seq}
              </div>
              <div className="flex-1 min-w-0">
                <p className={`text-sm truncate ${s.status === "completed" || s.status === "skipped" ? "text-text-quiet" : "text-text-secondary"}`}>{s.addr || `${s.sub}, ${s.city}`}</p>
                <div className="flex items-center gap-2 text-xs text-text-quiet mt-0.5">
                  <span>{s.wbs.join(", ")}</span>
                  {s.eta && <span>{s.eta}</span>}
                </div>
              </div>
              <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${
                s.status === "completed" ? "bg-text-quiet/20 text-text-tertiary"
                : s.status === "failed" ? "bg-danger/20 text-danger"
                : s.status === "skipped" ? "bg-warning/20 text-warning"
                : "bg-surface-overlay text-text-quiet"
              }`}>
                {s.status}
              </span>
            </div>
              );
            });
          })()}
        </div>
      </div>
    </div>
  );
}
