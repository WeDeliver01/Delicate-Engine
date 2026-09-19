import { StatusPill } from "@/components/ui/status-pill";
import { fmtMoney } from "@/lib/money";
import type { TripData } from "@/lib/routing";
import type { Driver, Stop, Shipment } from "@shared/schema";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowRightLeft, Pencil, Pin } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useDispatchData } from "@/hooks/use-dispatch-data";
import { DeliveryWindowDialog, type StopOverrideKind } from "@/components/delivery-window-dialog";

interface Props {
  driverId: string;
  driver: Driver;
  trip: TripData;
  fleet?: Driver[];
  onReassignStop?: (stop: Stop, toDriverId: string) => void;
}

type TimeMode = "eta" | "requested";
const TIME_MODE_KEY = "v7.tripSheet.timeMode";

export function TripSheet({ driverId, driver, trip, fleet, onReassignStop }: Props) {
  const [timeMode, setTimeMode] = useState<TimeMode>(() => {
    try {
      const v = localStorage.getItem(TIME_MODE_KEY);
      return v === "requested" ? "requested" : "eta";
    } catch { return "eta"; }
  });
  useEffect(() => {
    try { localStorage.setItem(TIME_MODE_KEY, timeMode); } catch { /* noop */ }
  }, [timeMode]);

  const {
    dayShips,
    deliveryOverrides,
    collectionOverrides,
    setDeliveryOverride,
    clearDeliveryOverride,
    setCollectionOverride,
    clearCollectionOverride,
  } = useDispatchData();

  const shipsById = useMemo(() => {
    const map = new Map<string, Shipment>();
    for (const s of dayShips) map.set(s.id, s);
    return map;
  }, [dayShips]);

  const [editing, setEditing] = useState<{ ship: Shipment; kind: StopOverrideKind } | null>(null);
  const currentOverride = editing
    ? (editing.kind === "D" ? deliveryOverrides[editing.ship.id] : collectionOverrides[editing.ship.id])
    : undefined;

  function openEditor(stop: Stop) {
    if (!stop.ids || stop.ids.length !== 1) return;
    const ship = shipsById.get(stop.ids[0]);
    if (!ship) return;
    const kind: StopOverrideKind = stop.type === "C" ? "C" : "D";
    setEditing({ ship, kind });
  }

  function handleSave(id: string, after: string, before: string, pinnedTime?: string) {
    if (!editing) return;
    if (editing.kind === "C") setCollectionOverride(id, after, before, pinnedTime);
    else setDeliveryOverride(id, after, before, pinnedTime);
  }
  function handleClear(id: string) {
    if (!editing) return;
    if (editing.kind === "C") clearCollectionOverride(id);
    else clearDeliveryOverride(id);
  }

  if (!trip || !driver) {
    return <p className="text-text-tertiary">No trip data for this driver today.</p>;
  }

  const st = trip.stats;

  return (
    <div className="space-y-4" data-testid={`trip-sheet-${driverId}`}>
      <div className="rounded-[var(--v7-radius-lg)] border border-hairline bg-surface-raised p-3">
        <div className="flex items-center gap-3">
          <div
            className="size-10 rounded-full flex items-center justify-center text-sm font-bold text-white shrink-0"
            style={{ backgroundColor: driver.color }}
          >
            {driver.icon}
          </div>
          <div className="min-w-0">
            <div className="font-display text-base font-medium text-text-primary truncate">{driver.name}</div>
            <div className="text-xs text-text-tertiary truncate">{driver.vehicle}</div>
            <div className="text-[11px] font-mono text-text-quiet">{driver.plate}</div>
          </div>
        </div>
        <div className="mt-3 grid grid-cols-4 gap-2 text-center">
          <Stat label="Stops" value={String(trip.stops.length)} />
          <Stat label="Km" value={String(st.totalKm)} />
          <Stat label="Margin" value={fmtMoney(st.margin)} />
          <Stat label="Late" value={String(st.lateCount ?? 0)} />
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between mb-2">
          <div className="text-[10px] uppercase tracking-[0.18em] text-text-quiet">Stops</div>
          <div
            className="inline-flex rounded-full border border-hairline bg-surface-overlay/40 p-0.5 text-[10px]"
            role="tablist"
            data-testid={`trip-sheet-time-mode-${driverId}`}
          >
            <button
              type="button"
              onClick={() => setTimeMode("eta")}
              className={`px-2 py-0.5 rounded-full transition-colors ${
                timeMode === "eta"
                  ? "bg-jacaranda-500 text-white"
                  : "text-text-tertiary hover:text-text-primary"
              }`}
              data-testid={`button-time-mode-eta-${driverId}`}
            >
              ETA
            </button>
            <button
              type="button"
              onClick={() => setTimeMode("requested")}
              className={`px-2 py-0.5 rounded-full transition-colors ${
                timeMode === "requested"
                  ? "bg-jacaranda-500 text-white"
                  : "text-text-tertiary hover:text-text-primary"
              }`}
              data-testid={`button-time-mode-requested-${driverId}`}
            >
              Requested
            </button>
          </div>
        </div>
        <ol className="space-y-1.5">
          {trip.stops.map((stop: Stop, i: number) => {
            const editable = (stop.type === "C" || stop.type === "D") && (stop.ids?.length ?? 0) === 1 && stop.status !== "DONE";
            const overridden = !!stop.origWin && stop.origWin !== stop.win;
            const pinned = !!stop.pinnedTime;
            return (
            <li
              key={stop.key}
              data-testid={`trip-sheet-stop-${stop.key}`}
              className={`flex items-start gap-2 rounded-[var(--v7-radius-md)] border border-hairline bg-surface-overlay/40 p-2 text-xs ${
                stop.status === "DONE" ? "opacity-60" : ""
              } ${overridden || pinned ? "ring-1 ring-jacaranda-500/40" : ""}`}
            >
              <div
                className={`size-6 shrink-0 rounded-full flex items-center justify-center text-[10px] font-bold text-white ${
                  stop.type === "C"
                    ? "bg-warning"
                    : stop.type === "X"
                      ? "bg-jacaranda-500"
                      : stop.type === "H" || stop.type === "RTN"
                        ? "bg-text-quiet"
                        : "bg-info"
                }`}
              >
                {stop.seq ?? i + 1}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-[10px] uppercase tracking-wider text-text-tertiary">
                    {stop.type === "C" ? "Collect" : stop.type === "X" ? "Handoff" : stop.type === "H" || stop.type === "RTN" ? "Home" : "Deliver"}
                  </span>
                  {stop.late && <StatusPill tone="danger" size="sm">Late</StatusPill>}
                  {stop.status === "DONE" && <StatusPill tone="success" size="sm">Done</StatusPill>}
                  {pinned && (
                    <span
                      className="inline-flex items-center gap-0.5 rounded-full bg-jacaranda-500/15 text-jacaranda-600 dark:text-jacaranda-300 px-1.5 py-px text-[9px] font-semibold uppercase tracking-wider"
                      data-testid={`badge-pinned-${stop.key}`}
                      title={`Pinned to ${stop.pinnedTime}`}
                    >
                      <Pin className="size-2.5" /> {stop.pinnedTime}
                    </span>
                  )}
                  {overridden && !pinned && (
                    <span
                      className="rounded-full bg-jacaranda-500/15 text-jacaranda-600 dark:text-jacaranda-300 px-1.5 py-px text-[9px] font-semibold uppercase tracking-wider"
                      data-testid={`badge-overridden-${stop.key}`}
                      title={`Sender requested ${stop.origWin}`}
                    >
                      OVR
                    </span>
                  )}
                </div>
                <div className="mt-0.5 text-text-primary truncate">{stop.sub || stop.addr}</div>
                <div className="mt-0.5 flex items-center gap-2 text-text-quiet text-[11px] tabular-nums flex-wrap">
                  {timeMode === "requested" && (stop.origWin || stop.win) ? (
                    <>
                      <span className="text-text-primary font-medium">REQ {stop.origWin || stop.win}</span>
                      {overridden && <span className="text-jacaranda-500">→ {stop.win}</span>}
                      {stop.eta && <span>· ETA {stop.eta}</span>}
                    </>
                  ) : (
                    <>
                      <span className="text-text-primary font-medium">ETA {stop.eta}</span>
                      {stop.win && <span>· {stop.win}</span>}
                      {overridden && stop.origWin && (
                        <span className="text-text-quiet line-through" title="Sender's original window">{stop.origWin}</span>
                      )}
                    </>
                  )}
                  <span>· {stop.legKm} km</span>
                </div>
              </div>
              {editable && (
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); openEditor(stop); }}
                  className="shrink-0 size-7 rounded-md border border-hairline bg-surface-overlay/60 hover:bg-jacaranda-50 dark:hover:bg-jacaranda-900/30 text-text-tertiary hover:text-jacaranda-500 flex items-center justify-center"
                  data-testid={`button-edit-window-${stop.key}`}
                  title={`Override ${stop.type === "C" ? "collection" : "delivery"} time`}
                  aria-label="Edit time window"
                >
                  <Pencil className="size-3.5" />
                </button>
              )}
              {onReassignStop && fleet && stop.status !== "DONE" && stop.type !== "H" && stop.type !== "RTN" && (stop.ids?.length ?? 0) > 0 && (
                <div className="shrink-0">
                  <Select
                    onValueChange={(toId) => {
                      if (toId && toId !== driverId) onReassignStop(stop, toId);
                    }}
                  >
                    <SelectTrigger
                      className="h-7 w-7 p-0 border-hairline bg-surface-overlay/60 hover:bg-jacaranda-50 dark:hover:bg-jacaranda-900/30 text-text-tertiary hover:text-jacaranda-500 [&>svg:last-child]:hidden justify-center"
                      data-testid={`button-reassign-${stop.key}`}
                      title="Reassign this stop to another driver"
                      aria-label="Reassign stop"
                    >
                      <ArrowRightLeft className="size-3.5" />
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent align="end">
                      {fleet.filter((d) => d.id !== driverId).map((d) => (
                        <SelectItem key={d.id} value={d.id} data-testid={`option-reassign-${stop.key}-${d.id}`}>
                          <div className="flex items-center gap-2">
                            <div
                              className="size-4 rounded-full text-[9px] font-bold text-white flex items-center justify-center"
                              style={{ backgroundColor: d.color }}
                            >
                              {d.icon}
                            </div>
                            {d.name}
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </li>
            );
          })}
        </ol>
      </div>

      <DeliveryWindowDialog
        open={!!editing}
        onOpenChange={(o) => { if (!o) setEditing(null); }}
        shipment={editing?.ship ?? null}
        kind={editing?.kind ?? "D"}
        currentOverride={currentOverride}
        onSave={handleSave}
        onClear={handleClear}
      />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[9px] uppercase tracking-[0.14em] text-text-quiet">{label}</div>
      <div className="font-display text-sm font-medium text-text-primary tabular-nums">{value}</div>
    </div>
  );
}
