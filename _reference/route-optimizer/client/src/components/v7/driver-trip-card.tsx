import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useInspectorStore } from "@/stores/inspector-store";
import { DriverChip } from "@/components/ui/driver-chip";
import { StatusPill } from "@/components/ui/status-pill";
import type { TripData } from "@/lib/routing";
import type { Driver, Stop } from "@shared/schema";
import { TripSheet } from "./trip-sheet";
import { Clock, Navigation } from "lucide-react";
import { useDispatchData } from "@/hooks/use-dispatch-data";
import { useToast } from "@/hooks/use-toast";
import { refreshAfterAssign } from "@/lib/refresh-after-assign";

interface DriverLocation {
  id: number;
  driverName: string;
  lat: number | null;
  lng: number | null;
  isOnline: boolean;
  updatedAt: string | null;
  nextStopAddress: string;
  nextStopEta: string;
  etaMin: number | null;
  distanceKm: number | null;
}

interface Props {
  driver: Driver;
  trip: TripData;
  isActive: boolean;
}

function isLive(updatedAt: string | null): boolean {
  if (!updatedAt) return false;
  const diff = Date.now() - new Date(updatedAt).getTime();
  return diff < 2 * 60 * 1000;
}

export function DriverTripCard({ driver, trip, isActive }: Props) {
  const openWith = useInspectorStore((s) => s.openWith);
  const { fleet, asgn, setAsgn, log } = useDispatchData();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: locs = [] } = useQuery<DriverLocation[]>({
    queryKey: ["/api/dispatch/driver-locations"],
    refetchInterval: 60000,
  });

  function handleReassignStop(stop: Stop, toDriverId: string) {
    const shipIds = stop.ids ?? [];
    if (!shipIds.length) return;
    const toDriver = fleet.find((d) => d.id === toDriverId);
    const next = { ...asgn };
    shipIds.forEach((sid) => {
      next[sid] = toDriverId;
    });
    setAsgn(next);
    const label = stop.wbs?.length ? stop.wbs.join(", ") : (stop.sub || stop.addr || "Stop");
    log(`Reassigned ${label} from ${driver.name} to ${toDriver?.name || toDriverId}`, "MANUAL");
    toast({ title: "Shipment reassigned", description: `${label} moved to ${toDriver?.name || toDriverId}` });
    refreshAfterAssign(queryClient);
  }
  const loc = locs.find(
    (l) => l.driverName?.toLowerCase().trim() === driver.name?.toLowerCase().trim()
  );

  const live = !!loc && loc.isOnline && isLive(loc.updatedAt);
  const stops: Stop[] = trip.stops || [];
  const remaining = stops.filter((s) => s.status !== "DONE").length;
  const totalStops = stops.length;
  const completed = totalStops > 0 ? totalStops - remaining : 0;
  const progressPct = totalStops > 0 ? Math.round((completed / totalStops) * 100) : 0;
  const capacity = trip.stats?.capacityScore ?? 0;
  const nextStop = stops.find((s) => s.status !== "DONE");
  const eta = loc?.nextStopEta || nextStop?.eta || "—";
  const stopName = loc?.nextStopAddress || nextStop?.sub || nextStop?.addr || "No active stop";

  function open() {
    openWith({
      kind: "custom",
      title: `${driver.name} · Trip Sheet`,
      node: <TripSheet driverId={driver.id} driver={driver} trip={trip} fleet={fleet} onReassignStop={handleReassignStop} />,
    });
  }

  return (
    <button
      onClick={open}
      data-testid={`driver-trip-card-${driver.id}`}
      className={`group w-full text-left rounded-[var(--v7-radius-lg)] border border-hairline bg-surface-raised p-3 shadow-v7-sm hover:shadow-v7-md transition-shadow ${
        !isActive ? "opacity-60" : ""
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <DriverChip driver={driver.name?.toLowerCase().split(" ")[0] || "driver"} name={driver.name} size="md" />
          {live && isActive && (
            <StatusPill tone="success" size="sm" dot data-testid={`pill-live-${driver.id}`}>
              Live
            </StatusPill>
          )}
        </div>
        <div className="text-right shrink-0">
          <div className="text-[10px] uppercase tracking-[0.14em] text-text-quiet">Load</div>
          <div className="font-display text-sm font-medium text-text-primary tabular-nums">{capacity}%</div>
        </div>
      </div>

      <div className="mt-2 flex items-center gap-2 text-[11px] text-text-tertiary">
        <span className="font-mono uppercase">{driver.plate || "—"}</span>
        <span className="text-text-quiet">·</span>
        <span className="truncate">{driver.vehicle || ""}</span>
      </div>

      <div className="mt-2 text-xs text-text-secondary truncate" data-testid={`text-next-stop-${driver.id}`}>
        Next: <span className="text-text-primary">{stopName}</span>
      </div>

      <div className="mt-1.5 flex items-center gap-3 text-[11px] text-text-tertiary">
        <span className="inline-flex items-center gap-1">
          <Clock className="size-3" />
          <span className="tabular-nums" data-testid={`text-eta-${driver.id}`}>{eta}</span>
        </span>
        {loc?.distanceKm != null && (
          <span className="inline-flex items-center gap-1 tabular-nums">
            <Navigation className="size-3" />
            {loc.distanceKm.toFixed(1)} km
          </span>
        )}
        <span className="ml-auto tabular-nums" data-testid={`text-progress-${driver.id}`}>
          {completed}/{totalStops}
        </span>
      </div>

      <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-surface-overlay">
        <div
          className="h-full bg-jacaranda-500 transition-all"
          style={{ width: `${progressPct}%` }}
        />
      </div>
    </button>
  );
}
