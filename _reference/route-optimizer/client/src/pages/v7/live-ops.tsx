import { useMemo, useState } from "react";
import { useDispatchData } from "@/hooks/use-dispatch-data";
import { MetricCard } from "@/components/ui/metric-card";
import { fmtMoney } from "@/lib/money";
import { DriverTripCard } from "@/components/v7/driver-trip-card";
import { ActivityStrip } from "@/components/v7/activity-strip";
import { LiveMap } from "@/components/v7/live-map";
import { WaybillSearch } from "@/pages/dispatch";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar, CheckCheck, Loader2, Sparkles, Wand2 } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

function formatDayLabel(d: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d);
  if (!m) return d;
  const [, y, mo, da] = m;
  const date = new Date(Number(y), Number(mo) - 1, Number(da));
  if (isNaN(date.getTime())) return d;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diff = Math.round((date.getTime() - today.getTime()) / 86400000);
  const weekday = date.toLocaleDateString(undefined, { weekday: "short" });
  const dayMonth = date.toLocaleDateString(undefined, { day: "numeric", month: "short" });
  if (diff === 0) return `Today · ${dayMonth}`;
  if (diff === 1) return `Tomorrow · ${dayMonth}`;
  if (diff === -1) return `Yesterday · ${dayMonth}`;
  if (diff > 1) return `${weekday} ${dayMonth} · in ${diff}d`;
  return `${weekday} ${dayMonth}`;
}

export default function LiveOpsPage() {
  const { totals, fleet, fleetSettings, tl, dayShips, openDayShips, allShipsCount, asgn, setAsgn, runOptimizer, optimizing, log, selectedDay, setSelectedDay, availableDays } = useDispatchData();
  const { toast } = useToast();
  const [closeOpen, setCloseOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [purgeQuotes, setPurgeQuotes] = useState(true);
  const [closing, setClosing] = useState(false);

  const marginPct = totals.rev > 0 ? Math.round((totals.margin / totals.rev) * 100) : 0;
  const completedToday = dayShips.length - openDayShips.length;

  const toggleId = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const toggleAll = () => {
    setSelectedIds((prev) => {
      if (prev.size === openDayShips.length) return new Set();
      return new Set(openDayShips.map((s: any) => s.id).filter(Boolean));
    });
  };
  const runUndo = async () => {
    setClosing(true);
    try {
      const result = await apiRequest("POST", "/api/dispatch/unmark-shipments-delivered", {});
      const data = await result.json();
      toast({
        title: "Close-out reverted",
        description: `Restored ${data.revertedCount} shipment(s) to their previous status.`,
      });
      log(`[CloseOut] Reverted ${data.revertedCount}`, "SYS");
      setCloseOpen(false);
      queryClient.invalidateQueries({ queryKey: ["/api/dispatch/all-shipments"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dispatch/shipment-totals"] });
    } catch (e: any) {
      toast({ title: "Undo failed", description: e?.message || "Unknown error", variant: "destructive" });
    } finally {
      setClosing(false);
    }
  };
  const runCloseOut = async () => {
    setClosing(true);
    try {
      const ids = Array.from(selectedIds);
      const result = await apiRequest("POST", "/api/dispatch/mark-shipments-delivered", {
        shipmentIds: ids,
        purgeQuotes,
      });
      const data = await result.json();
      toast({
        title: "Day closed out",
        description: `Marked ${data.markedCount} delivered${data.purgedCount ? `, purged ${data.purgedCount} quote row(s)` : ""}.`,
      });
      log(`[CloseOut] Marked ${data.markedCount} delivered, purged ${data.purgedCount}`, "SYS");
      setSelectedIds(new Set());
      setCloseOpen(false);
      queryClient.invalidateQueries({ queryKey: ["/api/dispatch/all-shipments"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dispatch/shipment-totals"] });
    } catch (e: any) {
      toast({ title: "Close-out failed", description: e?.message || "Unknown error", variant: "destructive" });
    } finally {
      setClosing(false);
    }
  };
  const sparkData = useMemo(
    () =>
      fleet
        .map((d) => tl[d.id])
        .filter((t): t is NonNullable<typeof t> => Boolean(t))
        .map((t) => t.stats?.margin ?? 0),
    [fleet, tl],
  );
  const sparkMax = Math.max(1, ...sparkData.map((n) => Math.abs(n)));

  if (!dayShips.length) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-text-tertiary" data-testid="live-ops-empty">
        Import shipments to populate Live Ops.
      </div>
    );
  }

  const activeDriverCount = (fleetSettings.drivers || []).filter((d: any) => d.active !== false).length;

  return (
    <div className="flex flex-1 flex-col overflow-y-auto" data-testid="page-live-ops">
      <section
        className="flex items-center gap-2 px-4 pt-4 pb-2 shrink-0 flex-wrap"
        data-testid="live-ops-toolbar"
      >
        {availableDays.length > 0 && (
          <Select value={selectedDay || "all"} onValueChange={(v) => setSelectedDay(v)}>
            <SelectTrigger
              className="h-9 w-auto min-w-[180px] gap-2 border-hairline bg-surface-raised text-text-primary"
              data-testid="select-trip-day"
            >
              <Calendar className="size-4 text-jacaranda-400" />
              <SelectValue placeholder="All days" />
            </SelectTrigger>
            <SelectContent align="start">
              <SelectItem value="all" data-testid="option-day-all">
                All days · {availableDays.length} {availableDays.length === 1 ? "day" : "days"}
              </SelectItem>
              {availableDays.map((d) => (
                <SelectItem key={d} value={d} data-testid={`option-day-${d}`}>
                  {formatDayLabel(d)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <Button
          onClick={() => runOptimizer(null, false, false)}
          disabled={optimizing || activeDriverCount === 0}
          className="bg-jacaranda-gradient text-white hover:opacity-90 shadow-v7-sm border-0 font-semibold gap-2"
          data-testid="button-reoptimize-live"
        >
          {optimizing ? <Loader2 className="size-4 animate-spin" /> : <Wand2 className="size-4" />}
          {optimizing ? "Optimizing…" : "Re-optimize routes"}
        </Button>
        <Button
          variant="outline"
          onClick={() => runOptimizer(null, false, true)}
          disabled={optimizing || activeDriverCount === 0}
          className="gap-2 border-hairline text-text-secondary hover:text-text-primary"
          data-testid="button-reoptimize-explore"
          title="Re-optimize while keeping your manual driver changes"
        >
          <Sparkles className="size-4" />
          Re-optimize around changes
        </Button>
        <div className="flex-1 min-w-[260px] max-w-md">
          <WaybillSearch ships={dayShips} asgn={asgn} setAsgn={(next) => setAsgn(next)} fleet={fleet} log={log} />
        </div>
      </section>
      <section
        className="px-4 pt-1 pb-3 shrink-0"
        data-testid="live-ops-shipments-hero"
      >
        <div className="rounded-[var(--v7-radius-lg)] border border-hairline bg-surface-raised shadow-v7-sm overflow-hidden">
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 px-5 py-4">
            <div className="text-[10px] uppercase tracking-[0.18em] text-text-quiet">Open shipments</div>
            <div className="text-xs text-text-tertiary">
              {selectedDay && selectedDay !== "all"
                ? formatDayLabel(selectedDay)
                : `across ${availableDays.length || 1} ${availableDays.length === 1 ? "day" : "days"}`}
            </div>
            <div className="basis-full" />
            <div className="font-display text-5xl md:text-6xl font-semibold tracking-tight text-text-primary tabular-nums leading-none" data-testid="text-total-shipments">
              {openDayShips.length.toLocaleString()}
            </div>
            {dayShips.length > openDayShips.length && (
              <div className="ml-2 text-xs text-text-tertiary tabular-nums" data-testid="text-completed-shipments">
                {completedToday} of {dayShips.length} completed
              </div>
            )}
            <div className="ml-auto">
              <Popover open={closeOpen} onOpenChange={setCloseOpen}>
                <PopoverTrigger asChild>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={openDayShips.length === 0 && dayShips.length === 0}
                    className="gap-2 border-hairline text-text-secondary hover:text-text-primary"
                    data-testid="button-close-out-day"
                  >
                    <CheckCheck className="size-4" />
                    Close out day
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="end" className="w-[420px] p-0" data-testid="popover-close-out">
                  <div className="flex items-center justify-between px-4 py-3 border-b border-hairline">
                    <div className="text-sm font-semibold text-text-primary">Mark deliveries</div>
                    {openDayShips.length > 0 && (
                      <button
                        type="button"
                        onClick={toggleAll}
                        className="text-xs text-jacaranda-400 hover:underline"
                        data-testid="button-toggle-all-open"
                      >
                        {selectedIds.size === openDayShips.length ? "Clear all" : "Select all"}
                      </button>
                    )}
                  </div>
                  <div className="max-h-[280px] overflow-y-auto px-4 py-2">
                    {openDayShips.length === 0 ? (
                      <div className="py-6 text-center text-xs text-text-tertiary">No open shipments left today.</div>
                    ) : (
                      openDayShips.map((s: any) => (
                        <label
                          key={s.id}
                          className="flex items-center gap-3 py-2 cursor-pointer hover:bg-surface-hover rounded px-2"
                          data-testid={`row-open-${s.id}`}
                        >
                          <input
                            type="checkbox"
                            checked={selectedIds.has(s.id)}
                            onChange={() => toggleId(s.id)}
                            className="size-4 accent-jacaranda-500"
                            data-testid={`checkbox-open-${s.id}`}
                          />
                          <div className="flex-1 min-w-0">
                            <div className="text-xs font-medium text-text-primary truncate">
                              {s.wb || s.id} <span className="text-text-tertiary">· {s.dSub || s.cSub || ""}</span>
                            </div>
                            <div className="text-[10px] text-text-tertiary truncate">
                              {s.status || "(no status)"} · {s.source || "?"}
                            </div>
                          </div>
                        </label>
                      ))
                    )}
                  </div>
                  <div className="border-t border-hairline px-4 py-3 flex items-center justify-between gap-3">
                    <label className="flex items-center gap-2 text-xs text-text-secondary cursor-pointer">
                      <input
                        type="checkbox"
                        checked={purgeQuotes}
                        onChange={(e) => setPurgeQuotes(e.target.checked)}
                        className="size-3.5 accent-jacaranda-500"
                        data-testid="checkbox-purge-quotes"
                      />
                      Also purge quote rows
                    </label>
                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={runUndo}
                        disabled={closing}
                        className="text-xs text-text-tertiary hover:text-text-primary"
                        data-testid="button-undo-close-out"
                      >
                        Undo last close-out
                      </Button>
                      <Button
                        size="sm"
                        onClick={runCloseOut}
                        disabled={closing || (selectedIds.size === 0 && !purgeQuotes)}
                        className="bg-jacaranda-gradient text-white hover:opacity-90 border-0 gap-2"
                        data-testid="button-confirm-close-out"
                      >
                        {closing ? <Loader2 className="size-3.5 animate-spin" /> : <CheckCheck className="size-3.5" />}
                        {closing ? "Working…" : `Apply${selectedIds.size > 0 ? ` (${selectedIds.size})` : ""}`}
                      </Button>
                    </div>
                  </div>
                </PopoverContent>
              </Popover>
            </div>
          </div>
        </div>
      </section>

      <section
        className="grid grid-cols-2 md:grid-cols-4 gap-3 px-4 pb-3 shrink-0"
        style={{ minHeight: 120 }}
        data-testid="live-ops-kpi-strip"
      >
        <MetricCard
          label="Revenue"
          value={fmtMoney(totals.rev)}
          tone="success"
          delta={totals.rev > 0 ? 1 : 0}
          deltaLabel="today"
          data-testid="kpi-revenue"
        />
        <MetricCard
          label="COGS"
          value={fmtMoney(totals.cogs)}
          tone="warning"
          delta={totals.cogs > 0 ? -1 : 0}
          deltaLabel="today"
          data-testid="kpi-cogs"
        />
        <div className="rounded-[var(--v7-radius-lg)] border border-hairline bg-surface-raised p-4 shadow-v7-sm ring-1 ring-success/30 relative" data-testid="kpi-margin">
          <div className="flex items-start justify-between gap-3">
            <div className="text-[10px] uppercase tracking-[0.18em] text-text-quiet">Margin</div>
          </div>
          <div className="mt-3 flex items-baseline gap-1.5">
            <div className="font-display text-3xl font-medium tracking-tight text-text-primary tabular-nums">
              {fmtMoney(totals.margin)}
            </div>
          </div>
          <div className="mt-2 flex items-end justify-between gap-2">
            <div className={`inline-flex items-center text-xs font-medium ${totals.margin >= 0 ? "text-success" : "text-danger"}`}>
              <span>{marginPct >= 0 ? "+" : ""}{marginPct}% of revenue</span>
            </div>
            <Sparkline data={sparkData} max={sparkMax} />
          </div>
        </div>
        <MetricCard
          label="Dead km"
          value={`${totals.deadKm} km`}
          tone={totals.deadKm > 50 ? "danger" : "neutral"}
          delta={totals.km > 0 ? Math.round((totals.deadKm / totals.km) * 100) : 0}
          deltaLabel="of total"
          data-testid="kpi-dead-km"
        />
      </section>

      <section
        className="grid grid-cols-1 lg:grid-cols-[55fr_45fr] gap-3 px-4 shrink-0"
        style={{ minHeight: "60vh" }}
        data-testid="live-ops-main"
      >
        <div className="min-h-[60vh]">
          <LiveMap />
        </div>
        <div className="space-y-2.5" data-testid="driver-trip-card-stack">
          {fleet.map((d) => {
            const trip = tl[d.id];
            if (!trip) return null;
            const profile = (fleetSettings.drivers || []).find((p) => p.id === d.id);
            const isActive = profile?.active !== false;
            return (
              <DriverTripCard key={d.id} driver={d} trip={trip} isActive={isActive} />
            );
          })}
        </div>
      </section>

      <section
        className="px-4 py-3 shrink-0 border-t border-hairline mt-3"
        data-testid="live-ops-activity"
      >
        <div className="text-[10px] uppercase tracking-[0.18em] text-text-quiet mb-1.5">Activity</div>
        <ActivityStrip />
      </section>
    </div>
  );
}

// Wrapper so MetricCard can host children — re-exports MetricCard but with a sparkline slot.
function Sparkline({ data, max }: { data: number[]; max: number }) {
  if (data.length === 0) return null;
  const w = 80;
  const h = 18;
  const pts = data
    .map((v, i) => {
      const x = (i / Math.max(1, data.length - 1)) * w;
      const y = h - ((v + max) / (2 * max)) * h;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg width={w} height={h} className="mt-2" data-testid="kpi-margin-sparkline">
      <polyline
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        points={pts}
        className="text-jacaranda-400"
      />
    </svg>
  );
}
