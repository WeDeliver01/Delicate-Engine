import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { useDriverAuth } from "@/hooks/use-driver-auth";
import { fetchTripSheet, goOffline, type DriverStop } from "@/lib/driver-api";
import { motion } from "framer-motion";
import { injectDriverManifest, setMobileViewportHeight } from "@/lib/driver-pwa";
import {
  ArrowLeft, Package, CheckCircle2, XCircle, SkipForward,
  MapPin, TrendingUp, Loader2, Power, Clock, Gauge, Fuel, Droplet,
} from "lucide-react";

interface VehicleLogSummary {
  tripId: number;
  endedAt: string;
  summary: {
    distanceKm: number;
    stopCount: number;
    fuelTotal: number;
    litresTotal: number;
  };
}

export default function DriverTripSummary() {
  const [, setLocation] = useLocation();
  const { isAuthenticated, driver, logout } = useDriverAuth();
  const [stops, setStops] = useState<DriverStop[]>([]);
  const [loading, setLoading] = useState(true);
  const [endingTrip, setEndingTrip] = useState(false);
  const [vehicleLog, setVehicleLog] = useState<VehicleLogSummary | null>(null);

  useEffect(() => {
    if (!isAuthenticated) { setLocation("/driver/login"); return; }
    injectDriverManifest();
    setMobileViewportHeight();
    try {
      const raw = sessionStorage.getItem("delicate-driver-last-trip-summary");
      if (raw) setVehicleLog(JSON.parse(raw) as VehicleLogSummary);
    } catch {}
    fetchTripSheet().then((data) => {
      setStops(data.stops);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [isAuthenticated, setLocation]);

  async function handleEndTrip() {
    setEndingTrip(true);
    try {
      await goOffline();
    } catch {
      // continue even if request fails
    }
    logout();
  }

  const completed = stops.filter((s) => s.status === "completed");
  const failed = stops.filter((s) => s.status === "failed");
  const skipped = stops.filter((s) => s.status === "skipped");
  const pending = stops.filter((s) => s.status === "pending" || s.status === "arrived");
  const totalKm = stops.reduce((s, stop) => s + (stop.legKm || 0), 0);
  const totalPcs = stops.reduce((s, stop) => s + (stop.pcs || 0), 0);
  const successRate = stops.length > 0 ? Math.round((completed.length / stops.length) * 100) : 0;
  const allDone = pending.length === 0 && stops.length > 0;

  const endTime = new Date();
  const sessionStartStr = localStorage.getItem("delicate-driver-session-start");
  const startTime = sessionStartStr ? new Date(sessionStartStr) : (() => { const d = new Date(); d.setHours(6, 0, 0, 0); return d; })();
  const activeMs = Math.max(0, endTime.getTime() - startTime.getTime());
  const activeHrs = Math.floor(activeMs / 3600000);
  const activeMins = Math.floor((activeMs % 3600000) / 60000);
  const fmtTime = (d: Date) => d.toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit" });

  const stats = [
    { label: "Total Stops", value: stops.length, icon: MapPin, color: "#4a9eff" },
    { label: "Completed", value: completed.length, icon: CheckCircle2, color: "#22c55e" },
    { label: "Failed", value: failed.length, icon: XCircle, color: "#ef4444" },
    { label: "Skipped", value: skipped.length, icon: SkipForward, color: "#eab308" },
    { label: "Success Rate", value: `${successRate}%`, icon: TrendingUp, color: "#4a9eff" },
    { label: "Total Distance", value: `${totalKm.toFixed(1)} km`, icon: MapPin, color: "#4a9eff" },
    { label: "Total Parcels", value: totalPcs, icon: Package, color: "#4a9eff" },
    { label: "Start Time", value: fmtTime(startTime), icon: Clock, color: "#4a9eff" },
    { label: "End Time", value: fmtTime(endTime), icon: Clock, color: "#4a9eff" },
    { label: "Active Time", value: `${activeHrs}h ${activeMins}m`, icon: Clock, color: "#4a9eff" },
  ];

  return (
    <div className="flex flex-col driver-fullscreen" style={{ background: "hsl(var(--v7-surface-base))" }}>
      <header className="flex-shrink-0 flex items-center gap-3 px-4" style={{ background: "hsl(var(--v7-surface-raised) / 0.95)", borderBottom: "1px solid hsl(var(--v7-border-hairline))", paddingTop: "max(0.5rem, env(safe-area-inset-top))", minHeight: "3.5rem" }}>
        <button onClick={() => history.back()} className="p-2 -ml-2 text-text-tertiary" data-testid="button-back">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="text-base font-semibold text-text-primary">Trip Summary</h1>
      </header>

      {loading ? (
        <div className="flex-1 flex items-center justify-center">
          <Loader2 className="w-8 h-8 text-jacaranda-400 animate-spin" />
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
          <div className="text-center mb-2">
            <p className="text-sm text-text-tertiary">{driver?.driverName}'s Trip</p>
            <p className="text-xs text-text-quiet">{new Date().toLocaleDateString("en-ZA", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}</p>
          </div>

          {allDone && (
            <div className="rounded-xl p-4 text-center" style={{ background: "hsl(var(--v7-success) / 0.12)", border: "1px solid hsl(var(--v7-success) / 0.28)" }}>
              <CheckCircle2 className="w-8 h-8 text-success mx-auto mb-2" />
              <p className="text-sm font-medium text-success">All stops completed!</p>
            </div>
          )}

          {vehicleLog && (
            <div
              className="rounded-xl p-4"
              style={{ background: "hsl(var(--v7-jacaranda-500) / 0.10)", border: "1px solid hsl(var(--v7-jacaranda-500) / 0.30)" }}
              data-testid="card-vehicle-log-summary"
            >
              <div className="flex items-center gap-2 mb-3">
                <Gauge className="w-4 h-4 text-jacaranda-400" />
                <h3 className="text-sm font-semibold text-text-primary">Vehicle Log #{vehicleLog.tripId}</h3>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div data-testid="stat-vehicle-distance">
                  <div className="flex items-center gap-1 text-[10px] text-text-quiet mb-1">
                    <MapPin className="w-3 h-3" /> Distance
                  </div>
                  <p className="text-base font-bold text-text-primary">{(vehicleLog.summary.distanceKm || 0).toFixed(1)} km</p>
                </div>
                <div data-testid="stat-vehicle-stops">
                  <div className="flex items-center gap-1 text-[10px] text-text-quiet mb-1">
                    <Package className="w-3 h-3" /> Stops
                  </div>
                  <p className="text-base font-bold text-text-primary">{vehicleLog.summary.stopCount || 0}</p>
                </div>
                <div data-testid="stat-vehicle-fuel">
                  <div className="flex items-center gap-1 text-[10px] text-text-quiet mb-1">
                    <Fuel className="w-3 h-3" /> Fuel
                  </div>
                  <p className="text-base font-bold text-text-primary">R{(vehicleLog.summary.fuelTotal || 0).toFixed(0)}</p>
                  {vehicleLog.summary.litresTotal > 0 && (
                    <p className="text-[10px] text-text-quiet flex items-center gap-1">
                      <Droplet className="w-2.5 h-2.5" /> {vehicleLog.summary.litresTotal.toFixed(1)} L
                    </p>
                  )}
                </div>
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            {stats.map((s, i) => (
              <motion.div
                key={s.label}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.05 }}
                className="rounded-xl p-4"
                style={{ background: "hsl(var(--v7-surface-overlay) / 0.5)", border: "1px solid hsl(var(--v7-border-hairline) / 0.7)" }}
                data-testid={`stat-${s.label.toLowerCase().replace(/\s/g, "-")}`}
              >
                <s.icon className="w-5 h-5 mb-2" style={{ color: s.color }} />
                <p className="text-xl font-bold text-text-primary">{s.value}</p>
                <p className="text-xs text-text-quiet">{s.label}</p>
              </motion.div>
            ))}
          </div>

          {completed.length > 0 && (
            <div>
              <h3 className="text-xs font-medium text-text-tertiary uppercase tracking-wider mb-2">Completed ({completed.length})</h3>
              <div className="space-y-2">
                {completed.map((s) => (
                  <div key={s.key} className="rounded-lg p-3 flex items-center gap-3" style={{ background: "hsl(var(--v7-success) / 0.08)", border: "1px solid hsl(var(--v7-success) / 0.22)" }}>
                    <CheckCircle2 className="w-5 h-5 text-success flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-text-secondary truncate">{s.addr || `${s.sub}, ${s.city}`}</p>
                      <p className="text-xs text-text-quiet">{s.wbs.join(", ")}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {failed.length > 0 && (
            <div>
              <h3 className="text-xs font-medium text-text-tertiary uppercase tracking-wider mb-2">Failed ({failed.length})</h3>
              <div className="space-y-2">
                {failed.map((s) => (
                  <div key={s.key} className="rounded-lg p-3 flex items-center gap-3" style={{ background: "hsl(var(--v7-danger) / 0.08)", border: "1px solid hsl(var(--v7-danger) / 0.22)" }}>
                    <XCircle className="w-5 h-5 text-red-400 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-text-secondary truncate">{s.addr || `${s.sub}, ${s.city}`}</p>
                      <p className="text-xs text-text-quiet">{s.wbs.join(", ")}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {pending.length > 0 && (
            <div>
              <h3 className="text-xs font-medium text-text-tertiary uppercase tracking-wider mb-2">Remaining ({pending.length})</h3>
              <div className="space-y-2">
                {pending.map((s) => (
                  <div key={s.key} className="rounded-lg p-3 flex items-center gap-3" style={{ background: "hsl(var(--v7-surface-overlay) / 0.4)", border: "1px solid hsl(var(--v7-border-hairline) / 0.6)" }}>
                    <Package className="w-5 h-5 text-text-quiet flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-text-secondary truncate">{s.addr || `${s.sub}, ${s.city}`}</p>
                      <p className="text-xs text-text-quiet">{s.wbs.join(", ")}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <button
            onClick={handleEndTrip}
            disabled={endingTrip}
            className="w-full h-14 rounded-xl bg-red-500/20 border border-red-500/30 text-red-400 font-semibold text-base flex items-center justify-center gap-2 active:scale-[0.98] disabled:opacity-50 mt-4"
            data-testid="button-end-trip"
          >
            {endingTrip ? <Loader2 className="w-5 h-5 animate-spin" /> : <><Power className="w-5 h-5" /> End Trip &amp; Go Offline</>}
          </button>

          <div style={{ height: "max(2rem, env(safe-area-inset-bottom))" }} />
        </div>
      )}
    </div>
  );
}
