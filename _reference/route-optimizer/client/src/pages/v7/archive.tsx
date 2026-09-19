import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import type { TripArchive, CsvImport, AuditLog, DriverSummary } from "@shared/schema";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusPill } from "@/components/ui/status-pill";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  Search, Archive as ArchiveIcon, Upload, History, Calendar, X,
  Truck, AlertTriangle, FileText, User, Package, Filter,
  type LucideIcon,
} from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { TripSheetCard } from "@/components/v7/trip-sheet-card";
import { PetalIcon } from "@/components/v7/petal-icon";
import { cn } from "@/lib/utils";

type Tab = "archives" | "imports" | "audit";

const TABS: { id: Tab; label: string; icon: LucideIcon }[] = [
  { id: "archives", label: "Trip Archives", icon: ArchiveIcon },
  { id: "imports", label: "Import History", icon: Upload },
  { id: "audit", label: "Audit Log", icon: History },
];

const TRAFFIC_OPTIONS = ["normal", "moderate", "heavy"];

function fmtDate(s: string): string {
  try { return new Date(s).toLocaleDateString("en-ZA", { day: "2-digit", month: "short", year: "numeric" }); }
  catch { return s; }
}
function fmtDT(s: string | Date): string {
  try { return new Date(s).toLocaleString("en-ZA", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }); }
  catch { return String(s); }
}

export default function ArchivePage() {
  const [location] = useLocation();
  const initialTab: Tab = location.startsWith("/archive/audit") ? "audit"
    : location.startsWith("/archive/imports") ? "imports" : "archives";
  const [tab, setTab] = useState<Tab>(initialTab);
  const [search, setSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [driverFilter, setDriverFilter] = useState<string[]>([]);
  const [trafficFilter, setTrafficFilter] = useState<string | null>(null);
  const [warningsOnly, setWarningsOnly] = useState(false);
  const [viewing, setViewing] = useState<TripArchive | null>(null);

  const { data: archives = [], isLoading: loadingA } = useQuery<TripArchive[]>({
    queryKey: ["/api/archives"],
  });
  const { data: imports = [] } = useQuery<CsvImport[]>({
    queryKey: ["/api/imports"],
    refetchInterval: tab === "imports" ? 15_000 : false,
  });
  const { data: audit = [] } = useQuery<AuditLog[]>({
    queryKey: ["/api/audit"],
    refetchInterval: tab === "audit" ? 15_000 : false,
  });

  const allDrivers = useMemo(() => {
    const m = new Map<string, string>();
    for (const a of archives) {
      for (const d of (a.driverSummaries || []) as DriverSummary[]) {
        m.set(d.driverId, d.driverName);
      }
    }
    return Array.from(m.entries()).map(([id, name]) => ({ id, name }));
  }, [archives]);

  const filteredArchives = useMemo(() => {
    return archives.filter((a) => {
      if (search.trim()) {
        const q = search.toLowerCase();
        if (!a.name.toLowerCase().includes(q) && !a.runDate.toLowerCase().includes(q) && !a.trafficCondition.toLowerCase().includes(q)) return false;
      }
      if (dateFrom && a.runDate < dateFrom) return false;
      if (dateTo && a.runDate > dateTo) return false;
      if (trafficFilter && a.trafficCondition !== trafficFilter) return false;
      if (warningsOnly && (a.warningCount || 0) === 0) return false;
      if (driverFilter.length > 0) {
        const ds = (a.driverSummaries || []) as DriverSummary[];
        if (!ds.some((d) => driverFilter.includes(d.driverId))) return false;
      }
      return true;
    });
  }, [archives, search, dateFrom, dateTo, trafficFilter, warningsOnly, driverFilter]);

  const hasFilters = search || dateFrom || dateTo || trafficFilter || warningsOnly || driverFilter.length > 0;

  function clearFilters() {
    setSearch(""); setDateFrom(""); setDateTo(""); setTrafficFilter(null); setWarningsOnly(false); setDriverFilter([]);
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface-base text-text-primary" data-testid="archive-page">
      <header className="border-b border-hairline px-6 py-4 space-y-4">
        <div className="flex items-center gap-3">
          <ArchiveIcon className="size-5 text-jacaranda-400" />
          <div className="font-display text-2xl tracking-tight">Archive</div>
          <span className="text-xs text-text-tertiary">
            {archives.length} archives · {imports.length} imports · {audit.length} audit entries
          </span>
        </div>

        {/* Search + filter chips */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[260px] max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-text-quiet pointer-events-none" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search archives by name, date, traffic…"
              className="pl-9"
              data-testid="archive-search"
            />
          </div>

          <DateRangeChip from={dateFrom} to={dateTo} onChange={(f, t) => { setDateFrom(f); setDateTo(t); }} />

          <DriverChipFilter all={allDrivers} value={driverFilter} onChange={setDriverFilter} />

          <Popover>
            <PopoverTrigger asChild>
              <button
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-[var(--v7-radius-pill)] border px-3 py-1.5 text-xs font-medium transition-colors",
                  trafficFilter
                    ? "border-jacaranda-400/30 bg-jacaranda-500/15 text-jacaranda-200"
                    : "border-hairline bg-surface-overlay/60 text-text-secondary hover:bg-surface-overlay"
                )}
                data-testid="chip-traffic"
              >
                <Filter className="size-3" />
                Traffic{trafficFilter ? `: ${trafficFilter}` : ""}
              </button>
            </PopoverTrigger>
            <PopoverContent className="w-44 p-1.5" align="start">
              <button
                onClick={() => setTrafficFilter(null)}
                className="w-full text-left rounded px-2 py-1.5 text-xs hover:bg-surface-overlay"
              >
                Any
              </button>
              {TRAFFIC_OPTIONS.map((t) => (
                <button
                  key={t}
                  onClick={() => setTrafficFilter(t)}
                  className="w-full text-left rounded px-2 py-1.5 text-xs hover:bg-surface-overlay capitalize"
                  data-testid={`chip-traffic-${t}`}
                >
                  {t}
                </button>
              ))}
            </PopoverContent>
          </Popover>

          <button
            onClick={() => setWarningsOnly((v) => !v)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-[var(--v7-radius-pill)] border px-3 py-1.5 text-xs font-medium transition-colors",
              warningsOnly
                ? "border-warning/40 bg-warning/15 text-warning"
                : "border-hairline bg-surface-overlay/60 text-text-secondary hover:bg-surface-overlay"
            )}
            data-testid="chip-warnings"
          >
            <AlertTriangle className="size-3" />
            Warnings only
          </button>

          {hasFilters && (
            <Button variant="ghost" size="sm" onClick={clearFilters} className="h-8 text-xs gap-1" data-testid="archive-clear-filters">
              <X className="size-3" /> Clear
            </Button>
          )}
        </div>

        {/* Tabs */}
        <div className="flex gap-1 p-1 bg-surface-overlay/50 rounded-[var(--v7-radius-md)] w-fit" data-testid="archive-tabs">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 rounded-[var(--v7-radius-md)] text-xs font-semibold transition-all",
                tab === id ? "bg-surface-raised shadow-v7-sm text-text-primary" : "text-text-tertiary hover:text-text-primary"
              )}
              data-testid={`archive-tab-${id}`}
            >
              <Icon className="size-3.5" /> {label}
            </button>
          ))}
        </div>
      </header>

      <div className="flex-1 overflow-y-auto px-6 py-5">
        {tab === "archives" && (
          loadingA ? (
            <div className="text-sm text-text-tertiary">Loading archives…</div>
          ) : filteredArchives.length === 0 ? (
            <EmptyState
              icon={<PetalIcon className="size-6 text-jacaranda-300" />}
              title="No archives yet."
              description="Your first trip will appear here."
            />
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3" data-testid="trip-archive-grid">
              {filteredArchives.map((a) => (
                <TripSheetCard key={a.id} archive={a} onView={setViewing} />
              ))}
            </div>
          )
        )}

        {tab === "imports" && <ImportHistoryList imports={imports} />}

        {tab === "audit" && <AuditLogList logs={audit} />}
      </div>

      {viewing && <ArchiveDetailDialog archive={viewing} onClose={() => setViewing(null)} />}
    </div>
  );
}

function DateRangeChip({ from, to, onChange }: { from: string; to: string; onChange: (f: string, t: string) => void }) {
  const active = !!(from || to);
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          className={cn(
            "inline-flex items-center gap-1.5 rounded-[var(--v7-radius-pill)] border px-3 py-1.5 text-xs font-medium transition-colors",
            active
              ? "border-jacaranda-400/30 bg-jacaranda-500/15 text-jacaranda-200"
              : "border-hairline bg-surface-overlay/60 text-text-secondary hover:bg-surface-overlay"
          )}
          data-testid="chip-date-range"
        >
          <Calendar className="size-3" />
          {active ? `${from || "…"} → ${to || "…"}` : "Date range"}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-3 space-y-2" align="start">
        <label className="text-[10px] uppercase tracking-[0.14em] text-text-quiet">From</label>
        <Input type="date" value={from} onChange={(e) => onChange(e.target.value, to)} data-testid="date-from" />
        <label className="text-[10px] uppercase tracking-[0.14em] text-text-quiet">To</label>
        <Input type="date" value={to} onChange={(e) => onChange(from, e.target.value)} data-testid="date-to" />
        {(from || to) && (
          <Button variant="ghost" size="sm" onClick={() => onChange("", "")} className="w-full h-8 text-xs">Clear</Button>
        )}
      </PopoverContent>
    </Popover>
  );
}

function DriverChipFilter({ all, value, onChange }: { all: { id: string; name: string }[]; value: string[]; onChange: (v: string[]) => void }) {
  const active = value.length > 0;
  function toggle(id: string) {
    onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);
  }
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          className={cn(
            "inline-flex items-center gap-1.5 rounded-[var(--v7-radius-pill)] border px-3 py-1.5 text-xs font-medium transition-colors",
            active
              ? "border-jacaranda-400/30 bg-jacaranda-500/15 text-jacaranda-200"
              : "border-hairline bg-surface-overlay/60 text-text-secondary hover:bg-surface-overlay"
          )}
          data-testid="chip-drivers"
        >
          <Truck className="size-3" />
          Drivers{active ? ` (${value.length})` : ""}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-56 p-1.5 max-h-72 overflow-y-auto" align="start">
        {all.length === 0 ? (
          <p className="text-xs text-text-tertiary px-2 py-1.5">No drivers in archives.</p>
        ) : all.map((d) => (
          <button
            key={d.id}
            onClick={() => toggle(d.id)}
            className={cn(
              "w-full text-left rounded px-2 py-1.5 text-xs hover:bg-surface-overlay flex items-center gap-2",
              value.includes(d.id) && "bg-jacaranda-500/10 text-jacaranda-200"
            )}
            data-testid={`chip-driver-${d.id}`}
          >
            <span className={cn("size-1.5 rounded-full", value.includes(d.id) ? "bg-jacaranda-400" : "bg-hairline")} />
            {d.name}
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
}

function ImportHistoryList({ imports }: { imports: CsvImport[] }) {
  if (imports.length === 0) {
    return (
      <EmptyState
        icon={<Upload className="size-5" />}
        title="No imports yet"
        description="Each CSV you upload will appear here with row counts and warnings."
      />
    );
  }
  return (
    <ul className="space-y-2 max-w-3xl" data-testid="import-history-list">
      {imports.map((imp) => {
        const warnings = (imp.warnings as string[]) || [];
        return (
          <li
            key={imp.id}
            className="rounded-[var(--v7-radius-md)] border border-hairline bg-surface-raised p-3"
            data-testid={`import-${imp.id}`}
          >
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-2 min-w-0">
                <FileText className="size-4 text-text-tertiary" />
                <span className="font-mono text-xs font-medium truncate" title={imp.fileName || "pasted"}>
                  {imp.fileName || "Pasted CSV"}
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <StatusPill size="sm" tone="success">{imp.newCount} new</StatusPill>
                {imp.updatedCount > 0 && <StatusPill size="sm" tone="info">{imp.updatedCount} updated</StatusPill>}
                {imp.failedCount > 0 && <StatusPill size="sm" tone="warning" dot>{imp.failedCount} warn</StatusPill>}
              </div>
            </div>
            <div className="mt-1.5 flex items-center gap-3 text-[11px] text-text-tertiary">
              <span><Package className="inline size-3 mr-0.5" />{imp.rowCount} rows</span>
              <span>{fmtDT(imp.importedAt)}</span>
            </div>
            {warnings.length > 0 && (
              <ul className="mt-1.5 text-[11px] text-warning list-disc list-inside">
                {warnings.slice(0, 3).map((w, i) => <li key={i}>{w}</li>)}
              </ul>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function AuditLogList({ logs }: { logs: AuditLog[] }) {
  if (logs.length === 0) {
    return (
      <EmptyState
        icon={<History className="size-5" />}
        title="No audit entries"
        description="System changes will be recorded here."
      />
    );
  }
  return (
    <ol className="space-y-1.5 max-w-3xl" data-testid="audit-log-list">
      {logs.map((l) => (
        <li
          key={l.id}
          className="rounded-[var(--v7-radius-md)] border border-hairline bg-surface-raised px-3 py-2 flex items-start gap-3"
          data-testid={`audit-${l.id}`}
        >
          <User className="size-3.5 mt-0.5 text-text-tertiary shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 text-xs">
              <span className="font-medium text-text-primary">{l.eventType}</span>
              <span className="text-text-quiet">·</span>
              <span className="text-text-tertiary">{l.entityType}</span>
              <span className="font-mono text-[10px] text-text-quiet truncate">{l.entityId}</span>
            </div>
            {l.details && <p className="text-[11px] text-text-tertiary mt-0.5">{l.details}</p>}
            <p className="text-[10px] text-text-quiet mt-0.5">{fmtDT(l.createdAt)} · {l.actorType}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}

function ArchiveDetailDialog({ archive, onClose }: { archive: TripArchive; onClose: () => void }) {
  const drivers = (archive.driverSummaries || []) as DriverSummary[];
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto" data-testid="archive-detail">
        <DialogHeader>
          <DialogTitle className="font-display tracking-tight">{archive.name}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 text-sm">
          <div className="flex items-center gap-2 text-xs text-text-tertiary">
            <Calendar className="size-3.5" /> {fmtDate(archive.runDate)} · Traffic: {archive.trafficCondition}
          </div>
          <div className="grid grid-cols-4 gap-2">
            <Stat label="Shipments" value={String(archive.shipmentCount)} />
            <Stat label="Drivers" value={String(archive.driverCount)} />
            <Stat label="km" value={Number(archive.totalKm ?? 0).toFixed(0)} />
            <Stat label="Revenue" value={`R ${Math.round(Number(archive.totalRevenue ?? 0)).toLocaleString("en-ZA")}`} />
          </div>
          <div>
            <h4 className="text-[10px] uppercase tracking-[0.18em] text-text-quiet mb-2">Driver breakdown</h4>
            <ul className="space-y-1.5">
              {drivers.map((d) => (
                <li key={d.driverId} className="flex items-center justify-between rounded-[var(--v7-radius-md)] bg-surface-overlay/50 px-3 py-2 text-xs">
                  <span className="font-medium">{d.driverName}</span>
                  <span className="font-mono text-text-tertiary tabular-nums">
                    {d.shipmentCount} jobs · {d.totalKm.toFixed(1)} km · R {Math.round(d.revenue).toLocaleString("en-ZA")}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[var(--v7-radius-md)] bg-surface-overlay/50 px-2 py-1.5">
      <div className="text-[9px] uppercase tracking-[0.14em] text-text-quiet">{label}</div>
      <div className="font-mono text-sm font-semibold tabular-nums">{value}</div>
    </div>
  );
}
