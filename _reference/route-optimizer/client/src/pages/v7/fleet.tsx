import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useDispatchData } from "@/hooks/use-dispatch-data";
import { StatusPill } from "@/components/ui/status-pill";
import { DriverDetailModal } from "@/pages/dispatch";
import { refreshAfterAssign } from "@/lib/refresh-after-assign";
import type { Driver } from "@shared/schema";
import type { TripData } from "@/lib/routing";
import type { DriverProfile } from "@/lib/fleet";
import { Power, Wand2, Sparkles, Loader2, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TestPushButton } from "@/components/dispatch/test-push-button";

export default function FleetPage() {
  const {
    fleet,
    fleetSettings,
    tl,
    dayShips,
    asgn,
    setAsgn,
    log,
    toggleDriverActive,
    runOptimizer,
    optimizing,
    moveStop,
    mergeStop,
    splitStop,
    tripSt,
  } = useDispatchData();
  const activeDriverCount = (fleetSettings.drivers || []).filter((d: any) => d.active !== false).length;
  const queryClient = useQueryClient();
  const [openDriverId, setOpenDriverId] = useState<string | null>(null);

  const openTrip: TripData | null = openDriverId ? tl[openDriverId] ?? null : null;

  function handleSetAsgn(updater: (prev: Record<string, string>) => Record<string, string>) {
    setAsgn(updater);
    refreshAfterAssign(queryClient);
  }

  return (
    <div className="flex-1 overflow-y-auto px-4 py-4" data-testid="page-fleet">
      <div className="mx-auto max-w-7xl space-y-4">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="font-display text-2xl font-medium tracking-tight text-text-primary">Drivers</h1>
            <p className="text-xs text-text-tertiary mt-0.5">
              {fleet.length} drivers · click any card for shipments &amp; manual reassignment
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              onClick={() => runOptimizer(null, false, false)}
              disabled={optimizing || activeDriverCount === 0 || dayShips.length === 0}
              className="bg-jacaranda-gradient text-white hover:opacity-90 shadow-v7-sm border-0 font-semibold gap-2"
              data-testid="button-reoptimize-fleet"
            >
              {optimizing ? <Loader2 className="size-4 animate-spin" /> : <Wand2 className="size-4" />}
              {optimizing ? "Optimizing…" : "Re-optimize routes"}
            </Button>
            <Button
              variant="outline"
              onClick={() => runOptimizer(null, false, true)}
              disabled={optimizing || activeDriverCount === 0 || dayShips.length === 0}
              className="gap-2 border-hairline text-text-secondary hover:text-text-primary"
              data-testid="button-reoptimize-explore-fleet"
              title="Re-optimize while keeping your manual driver changes"
            >
              <Sparkles className="size-4" />
              Around changes
            </Button>
          </div>
        </header>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {fleet.map((d) => {
            const trip = tl[d.id];
            const profile = (fleetSettings.drivers || []).find((p: DriverProfile) => p.id === d.id);
            const isActive = profile?.active !== false;
            return (
              <DriverMetricCard
                key={d.id}
                driver={d}
                trip={trip}
                isActive={isActive}
                onOpen={() => setOpenDriverId(d.id)}
                onToggleActive={() => {
                  toggleDriverActive(d.id);
                  refreshAfterAssign(queryClient);
                }}
              />
            );
          })}
        </div>

        {fleet.length === 0 && (
          <div className="rounded-[var(--v7-radius-lg)] border border-hairline bg-surface-raised p-6 text-center text-sm text-text-tertiary">
            No drivers configured.
          </div>
        )}
      </div>

      <DriverDetailModal
        open={!!openTrip}
        onClose={() => setOpenDriverId(null)}
        trip={openTrip}
        ships={dayShips}
        asgn={asgn}
        setAsgn={handleSetAsgn}
        fleet={fleet}
        fleetSettings={fleetSettings}
        log={log}
        onMoveStop={(driverId, fromIdx, toIdx) => {
          moveStop(driverId, fromIdx, toIdx);
          refreshAfterAssign(queryClient);
        }}
        onMergeStop={(driverId, idx) => {
          mergeStop(driverId, idx);
          refreshAfterAssign(queryClient);
        }}
        onSplitStop={(driverId, idx) => {
          splitStop(driverId, idx);
          refreshAfterAssign(queryClient);
        }}
        isLocked={openDriverId ? tripSt[openDriverId] === "LOCKED" : false}
      />
    </div>
  );
}

interface CardProps {
  driver: Driver;
  trip?: TripData;
  isActive: boolean;
  onOpen: () => void;
  onToggleActive: () => void;
}

function DriverMetricCard({ driver: d, trip, isActive, onOpen, onToggleActive }: CardProps) {
  const stops = trip?.stops?.length ?? 0;
  const st = trip?.stats;
  const shipments = st?.shipments ?? 0;
  const totalKm = st?.totalKm ?? 0;
  const cogs = st?.cogs ?? 0;
  const startTime = st?.startTime || "—";
  const endTime = st?.endTime || "—";
  const mileage = st?.mileage ?? 0;
  const capacityScore = Math.max(0, Math.min(100, st?.capacityScore ?? 0));
  const warnings = trip?.warnings ?? [];
  const highCount = warnings.filter((w) => w.sev === "HIGH").length;
  const medCount = warnings.filter((w) => w.sev === "MED").length;
  const lowCount = warnings.filter((w) => w.sev === "LOW").length;
  const worstTone: "danger" | "warning" | "info" | null =
    highCount > 0 ? "danger" : medCount > 0 ? "warning" : lowCount > 0 ? "info" : null;

  const capacityLabel =
    capacityScore < 30 ? "light load" : capacityScore < 70 ? "balanced" : capacityScore < 90 ? "heavy" : "at limit";
  const capacityTone =
    capacityScore < 30
      ? "text-success"
      : capacityScore < 70
        ? "text-jacaranda-400"
        : capacityScore < 90
          ? "text-warning"
          : "text-danger";

  return (
    <button
      onClick={onOpen}
      data-testid={`fleet-driver-card-${d.id}`}
      className={`group w-full text-left rounded-[var(--v7-radius-lg)] border border-hairline bg-surface-raised p-4 shadow-v7-sm hover:shadow-v7-md hover:border-jacaranda-400/40 transition-all ${
        !isActive ? "opacity-60" : ""
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div
            className="size-11 rounded-full flex items-center justify-center text-base font-bold text-white shrink-0"
            style={{ backgroundColor: d.color }}
          >
            {d.icon}
          </div>
          <div className="min-w-0">
            <div className="font-display text-base font-semibold text-text-primary truncate">{d.name}</div>
            <div className="text-[11px] text-text-tertiary truncate">{d.vehicle || "—"}</div>
            <div className="text-[10px] font-mono uppercase text-text-quiet">{d.plate || "—"}</div>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {worstTone && (
            <StatusPill
              tone={worstTone}
              size="sm"
              dot
              data-testid={`pill-warnings-${d.id}`}
              title={warnings.slice(0, 8).map((w) => `[${w.sev}] ${w.msg}`).join("\n") + (warnings.length > 8 ? `\n…+${warnings.length - 8} more` : "")}
            >
              <AlertTriangle className="size-3 mr-0.5" />
              {warnings.length} warn{warnings.length === 1 ? "" : "s"}
            </StatusPill>
          )}
          {trip ? (
            <StatusPill tone="success" size="sm" data-testid={`pill-generated-${d.id}`}>
              Generated
            </StatusPill>
          ) : !isActive ? (
            <StatusPill tone="danger" size="sm" data-testid={`pill-offline-${d.id}`}>
              Offline
            </StatusPill>
          ) : (
            <StatusPill tone="neutral" size="sm">Idle</StatusPill>
          )}
          {isActive && (
            <TestPushButton
              driverName={d.name}
              size="icon"
              testIdSuffix={d.id}
            />
          )}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onToggleActive();
            }}
            className={`grid size-7 place-items-center rounded-full border transition-colors ${
              isActive
                ? "border-success/40 bg-success/10 text-success hover:bg-success/20"
                : "border-hairline bg-surface-overlay text-text-quiet hover:bg-danger/10 hover:text-danger hover:border-danger/40"
            }`}
            aria-label={isActive ? "Deactivate driver" : "Activate driver"}
            data-testid={`button-toggle-active-${d.id}`}
            title={isActive ? "Click to take this driver offline" : "Click to bring this driver online"}
          >
            <Power className="size-3.5" />
          </button>
        </div>
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3">
        <Metric label="Shipments" value={String(shipments)} />
        <Metric label="Stops" value={String(stops)} />

        <Metric label="Distance" value={`${totalKm} km`} />
        <Metric label="COGS" value={`R${cogs}`} tone={cogs > 0 ? "danger" : undefined} />

        <Metric label="Time" value={trip ? `${startTime} – ${endTime}` : "—"} />
        <Metric label="Mileage" value={`${mileage} km/L`} />
      </dl>

      <div className="mt-4">
        <div className="flex items-center justify-between text-[10px] uppercase tracking-[0.16em] text-text-quiet">
          <span>Capacity</span>
          <span className={`font-medium tabular-nums ${capacityTone}`}>{capacityScore}%</span>
        </div>
        <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-surface-overlay">
          <div
            className={`h-full transition-all ${
              capacityScore < 30
                ? "bg-success"
                : capacityScore < 70
                  ? "bg-jacaranda-500"
                  : capacityScore < 90
                    ? "bg-warning"
                    : "bg-danger"
            }`}
            style={{ width: `${capacityScore}%` }}
          />
        </div>
        <div className="mt-1 text-[10px] text-text-tertiary">
          {stops > 0 ? `${stops}/20 trips · ${capacityLabel}` : "No trips planned"}
        </div>
      </div>
    </button>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: "danger" | "success" }) {
  return (
    <div>
      <dt className="text-[10px] uppercase tracking-[0.14em] text-text-quiet">{label}</dt>
      <dd
        className={`mt-0.5 font-display text-lg font-semibold tabular-nums leading-tight ${
          tone === "danger" ? "text-danger" : tone === "success" ? "text-success" : "text-text-primary"
        }`}
      >
        {value}
      </dd>
    </div>
  );
}
