import { useState } from "react";
import type { TripArchive, DriverSummary } from "@shared/schema";
import { useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/status-pill";
import { DriverChip } from "@/components/ui/driver-chip";
import { Eye, Download, RotateCcw, Package, Route, Clock, Banknote, AlertTriangle, Trash2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

function fmtZAR(n: number): string {
  return `R ${Math.round(n).toLocaleString("en-ZA")}`;
}

function fmtDate(s: string): string {
  try { return new Date(s).toLocaleDateString("en-ZA", { day: "2-digit", month: "short", year: "numeric" }); }
  catch { return s; }
}

function durationHours(drivers: DriverSummary[]): string {
  if (!drivers.length) return "—";
  let total = 0;
  let counted = 0;
  for (const d of drivers) {
    if (!d.startTime || !d.endTime) continue;
    const ms = new Date(d.endTime).getTime() - new Date(d.startTime).getTime();
    if (ms > 0) { total += ms; counted++; }
  }
  if (!counted) return "—";
  return `${(total / 1000 / 3600).toFixed(1)} h`;
}

function tripCsv(archive: TripArchive): string {
  const drivers = (archive.driverSummaries || []) as DriverSummary[];
  const headers = ["Driver", "Shipments", "Stops", "Total km", "Revenue (R)", "Margin (R)", "Late"];
  const rows = drivers.map((d) => [d.driverName, d.shipmentCount, d.stopCount, d.totalKm.toFixed(1), d.revenue.toFixed(2), d.margin.toFixed(2), d.lateCount]);
  const esc = (v: string | number) => { const s = String(v ?? ""); return /[,"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  return [headers.join(","), ...rows.map(r => r.map(esc).join(","))].join("\n");
}

export function TripSheetCard({
  archive,
  onView,
}: {
  archive: TripArchive;
  onView: (a: TripArchive) => void;
}) {
  const { toast } = useToast();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const drivers = (archive.driverSummaries || []) as DriverSummary[];

  const deleteM = useMutation({
    mutationFn: async () => { await apiRequest("DELETE", `/api/archives/${archive.id}`); },
    onSuccess: () => {
      toast({ title: "Archive deleted" });
      queryClient.invalidateQueries({ queryKey: ["/api/archives"] });
    },
  });

  function restore() {
    window.dispatchEvent(new CustomEvent("v7:restore-archive", { detail: archive }));
    toast({ title: "Archive restored", description: archive.name });
  }

  function exportCsv() {
    const blob = new Blob([tripCsv(archive)], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `trip_${archive.name.replace(/\s+/g, "_")}_${archive.runDate}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const totalKm = Number(archive.totalKm ?? 0);
  const totalRevenue = Number(archive.totalRevenue ?? 0);

  return (
    <article
      className="group rounded-[var(--v7-radius-lg)] border border-hairline bg-surface-raised p-4 shadow-v7-sm transition-all hover:shadow-v7-md hover:-translate-y-px"
      data-testid={`trip-sheet-${archive.id}`}
    >
      <header className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0">
          <div className="font-display text-[18px] tracking-tight text-text-primary leading-tight">
            {fmtDate(archive.runDate)}
          </div>
          <div className="text-xs text-text-tertiary mt-0.5 truncate" title={archive.name}>
            {archive.name}
          </div>
        </div>
        {archive.warningCount > 0 && (
          <StatusPill size="sm" tone="warning" dot>
            {archive.warningCount}
          </StatusPill>
        )}
      </header>

      {drivers.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 mb-3">
          {drivers.slice(0, 4).map((d) => (
            <DriverChip
              key={d.driverId}
              driver={d.driverName.split(/\s+/)[0].toLowerCase()}
              name={d.driverName}
              size="sm"
            />
          ))}
          {drivers.length > 4 && (
            <span className="text-[10px] text-text-tertiary">+{drivers.length - 4}</span>
          )}
        </div>
      )}

      <dl className="grid grid-cols-4 gap-2 mb-3">
        <Metric icon={<Package className="size-3" />} label="Jobs" value={String(archive.shipmentCount)} />
        <Metric icon={<Route className="size-3" />} label="km" value={totalKm.toFixed(0)} />
        <Metric icon={<Clock className="size-3" />} label="Hours" value={durationHours(drivers)} />
        <Metric icon={<Banknote className="size-3" />} label="Revenue" value={fmtZAR(totalRevenue)} />
      </dl>

      <footer className="flex items-center gap-1.5 pt-2 border-t border-hairline">
        <Button variant="secondary" size="sm" className="flex-1 h-8 text-xs" onClick={restore} data-testid={`trip-restore-${archive.id}`}>
          <RotateCcw className="size-3.5 mr-1" /> Restore
        </Button>
        <Button variant="ghost" size="sm" className="flex-1 h-8 text-xs" onClick={() => onView(archive)} data-testid={`trip-view-${archive.id}`}>
          <Eye className="size-3.5 mr-1" /> View
        </Button>
        <Button variant="ghost" size="sm" className="flex-1 h-8 text-xs" onClick={exportCsv} data-testid={`trip-export-${archive.id}`}>
          <Download className="size-3.5 mr-1" /> Export
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-text-quiet hover:text-danger"
          onClick={() => {
            if (confirmDelete) deleteM.mutate();
            else { setConfirmDelete(true); setTimeout(() => setConfirmDelete(false), 3000); }
          }}
          data-testid={`trip-delete-${archive.id}`}
          title={confirmDelete ? "Click again to confirm" : "Delete"}
        >
          <Trash2 className={`size-3.5 ${confirmDelete ? "text-danger" : ""}`} />
        </Button>
      </footer>
    </article>
  );
}

function Metric({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-[var(--v7-radius-md)] bg-surface-overlay/50 px-2 py-1.5">
      <div className="flex items-center gap-1 text-[9px] uppercase tracking-[0.14em] text-text-quiet">
        {icon}
        <span>{label}</span>
      </div>
      <div className="font-mono text-sm font-semibold text-text-primary tabular-nums mt-0.5 truncate">{value}</div>
    </div>
  );
}
