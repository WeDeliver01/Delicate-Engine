import { useState, useMemo, useCallback } from "react";
import type { TripArchive, DriverSummary, Shipment, CsvImport, AuditLog } from "@shared/schema";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import {
  Database, Search, Download, Trash2, Eye, Package,
  Truck, TrendingUp, Clock, AlertTriangle, Calendar,
  FileDown, ChevronDown, ChevronRight, Route, Fuel, DollarSign, X,
  MapPin, ArrowRight, Navigation, Upload, History, ClipboardList,
  CheckCircle2, RefreshCw, UserCheck, ArrowRightLeft, RotateCcw
} from "lucide-react";

function n(v: unknown, fallback = 0): number {
  if (v == null) return fallback;
  const x = typeof v === "number" ? v : parseFloat(String(v));
  return isFinite(x) ? x : fallback;
}

function fmtDate(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    return d.toLocaleDateString("en-ZA", { day: "2-digit", month: "short", year: "numeric" });
  } catch {
    return dateStr;
  }
}

function fmtDateTime(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    return d.toLocaleDateString("en-ZA", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
  } catch {
    return dateStr;
  }
}

function generateShipmentCSV(archive: TripArchive): string {
  const shipments = (archive.shipments || []) as Shipment[];
  const assignments = (archive.assignments || {}) as Record<string, string>;
  const driverSummaries = (archive.driverSummaries || []) as DriverSummary[];
  const driverMap = new Map<string, string>();
  driverSummaries.forEach((ds) => driverMap.set(ds.driverId, ds.driverName));

  const headers = [
    "Waybill", "Client", "Account", "Service", "Pieces", "Weight (kg)", "Rate (R)",
    "Collection Suburb", "Collection City", "Collection Address", "Collection Window",
    "Delivery Suburb", "Delivery City", "Delivery Address", "Delivery Window",
    "Assigned Driver", "Zone", "Status", "Collection Date", "Delivery Date"
  ];

  const rows = shipments.map((s: any) => [
    s.wb, s.client, s.acc, s.svc, s.pcs, s.kg, s.rate,
    s.cSub, s.cCity || "", s.cAddr, `${s.cAfter}-${s.cBefore}`,
    s.dSub, s.dCity || "", s.dAddr, `${s.dAfter}-${s.dBefore}`,
    driverMap.get(assignments[s.id] || "") || assignments[s.id] || "Unassigned",
    s.zone, s.status, s.colDate, s.delDate
  ]);

  const escape = (v: any) => {
    const str = String(v ?? "");
    if (str.includes(",") || str.includes('"') || str.includes("\n")) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  return [headers.join(","), ...rows.map((r) => r.map(escape).join(","))].join("\n");
}

function generateTripSummaryCSV(archive: TripArchive): string {
  const driverSummaries = (archive.driverSummaries || []) as DriverSummary[];

  const headers = [
    "Driver", "Shipments", "Stops", "Total km", "Dead km",
    "Revenue (R)", "COGS (R)", "Fuel Cost (R)", "Fuel (L)", "Margin (R)",
    "Late Deliveries", "Start Time", "End Time"
  ];

  const rows = driverSummaries.map((ds) => [
    ds.driverName, ds.shipmentCount, ds.stopCount, n(ds.totalKm).toFixed(1), n(ds.deadKm).toFixed(1),
    n(ds.revenue).toFixed(2), n(ds.cogs).toFixed(2), n(ds.fuelCost).toFixed(2), n(ds.fuelLitres).toFixed(1), n(ds.margin).toFixed(2),
    ds.lateCount, ds.startTime || "", ds.endTime || ""
  ]);

  const totals = [
    "TOTAL",
    driverSummaries.reduce((a, d) => a + d.shipmentCount, 0),
    driverSummaries.reduce((a, d) => a + d.stopCount, 0),
    driverSummaries.reduce((a, d) => a + n(d.totalKm), 0).toFixed(1),
    driverSummaries.reduce((a, d) => a + n(d.deadKm), 0).toFixed(1),
    driverSummaries.reduce((a, d) => a + n(d.revenue), 0).toFixed(2),
    driverSummaries.reduce((a, d) => a + n(d.cogs), 0).toFixed(2),
    driverSummaries.reduce((a, d) => a + n(d.fuelCost), 0).toFixed(2),
    driverSummaries.reduce((a, d) => a + n(d.fuelLitres), 0).toFixed(1),
    driverSummaries.reduce((a, d) => a + n(d.margin), 0).toFixed(2),
    driverSummaries.reduce((a, d) => a + d.lateCount, 0),
    "", ""
  ];

  const escape = (v: any) => {
    const str = String(v ?? "");
    if (str.includes(",") || str.includes('"') || str.includes("\n")) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  return [headers.join(","), ...rows.map((r) => r.map(escape).join(",")), totals.map(escape).join(",")].join("\n");
}

function downloadCSV(content: string, filename: string) {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

interface MetricCardProps {
  label: string;
  value: string;
  sub?: string;
  icon: any;
}

function MetricCard({ label, value, sub, icon: Icon }: MetricCardProps) {
  return (
    <div className="flex items-center gap-3 p-3 rounded-md bg-muted/30">
      <div className="w-9 h-9 rounded-md bg-primary/10 flex items-center justify-center shrink-0">
        <Icon className="w-4 h-4 text-primary" />
      </div>
      <div className="min-w-0">
        <p className="text-[11px] text-muted-foreground">{label}</p>
        <p className="text-[14px] font-bold">{value}</p>
        {sub && <p className="text-[10px] text-muted-foreground">{sub}</p>}
      </div>
    </div>
  );
}

type DataTab = "archives" | "imports" | "audit";

interface DataCentreTabProps {
  onRestore?: (archive: TripArchive) => void;
}

export default function DataCentreTab({ onRestore }: DataCentreTabProps) {
  const { toast } = useToast();
  const [dcTab, setDcTab] = useState<DataTab>("archives");
  const [search, setSearch] = useState("");
  const [selectedArchive, setSelectedArchive] = useState<TripArchive | null>(null);
  const [expandedDrivers, setExpandedDrivers] = useState<Record<string, boolean>>({});
  const [selectedImport, setSelectedImport] = useState<CsvImport | null>(null);
  const [confirmRestoreId, setConfirmRestoreId] = useState<string | null>(null);

  const { data: archives = [], isLoading } = useQuery<TripArchive[]>({
    queryKey: ["/api/archives"],
  });

  const { data: csvImports = [], isLoading: importsLoading } = useQuery<CsvImport[]>({
    queryKey: ["/api/imports"],
    refetchInterval: dcTab === "imports" ? 15_000 : false,
  });

  const { data: auditLogs = [], isLoading: auditLoading } = useQuery<AuditLog[]>({
    queryKey: ["/api/audit"],
    refetchInterval: dcTab === "audit" ? 15_000 : false,
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/archives/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/archives"] });
      toast({ title: "Archive deleted" });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const filtered = useMemo(() => {
    if (!search.trim()) return archives;
    const q = search.toLowerCase();
    return archives.filter((a) =>
      a.name.toLowerCase().includes(q) ||
      a.runDate.toLowerCase().includes(q) ||
      a.trafficCondition.toLowerCase().includes(q)
    );
  }, [archives, search]);

  const handleDownloadShipments = useCallback((archive: TripArchive) => {
    const csv = generateShipmentCSV(archive);
    const safeName = archive.name.replace(/[^a-zA-Z0-9-_ ]/g, "").replace(/\s+/g, "_");
    downloadCSV(csv, `shipments_${safeName}_${archive.runDate}.csv`);
    toast({ title: "Downloaded", description: `Shipments CSV for ${archive.name}` });
  }, [toast]);

  const handleDownloadTrips = useCallback((archive: TripArchive) => {
    const csv = generateTripSummaryCSV(archive);
    const safeName = archive.name.replace(/[^a-zA-Z0-9-_ ]/g, "").replace(/\s+/g, "_");
    downloadCSV(csv, `trip_summary_${safeName}_${archive.runDate}.csv`);
    toast({ title: "Downloaded", description: `Trip summary CSV for ${archive.name}` });
  }, [toast]);

  const handleDownloadAll = useCallback(() => {
    if (archives.length === 0) return;
    const headers = [
      "Archive Name", "Run Date", "Saved At", "Shipments", "Drivers", "Total km",
      "Dead km", "Revenue (R)", "Fuel Cost (R)", "Margin (R)", "Warnings", "Traffic"
    ];
    const escape = (v: any) => {
      const str = String(v ?? "");
      if (str.includes(",") || str.includes('"') || str.includes("\n")) return `"${str.replace(/"/g, '""')}"`;
      return str;
    };
    const rows = archives.map((a) => [
      a.name, a.runDate, fmtDateTime(a.createdAt as any), a.shipmentCount, a.driverCount,
      n(a.totalKm).toFixed(1), n(a.totalDeadKm).toFixed(1), n(a.totalRevenue).toFixed(2),
      n(a.totalFuelCost).toFixed(2), n(a.totalMargin).toFixed(2), a.warningCount, a.trafficCondition
    ]);
    const csv = [headers.join(","), ...rows.map((r) => r.map(escape).join(","))].join("\n");
    downloadCSV(csv, `delicate_courier_all_archives_${new Date().toISOString().slice(0, 10)}.csv`);
    toast({ title: "Downloaded", description: `All archives summary CSV (${archives.length} records)` });
  }, [archives, toast]);

  const driverSummaries = selectedArchive ? (selectedArchive.driverSummaries || []) as DriverSummary[] : [];

  return (
    <>
      <ScrollArea className="flex-1">
        <div className="p-6 space-y-6">
          {/* Header */}
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-md bg-primary/10 flex items-center justify-center">
                <Database className="w-5 h-5 text-primary" />
              </div>
              <div>
                <h2 className="text-lg font-bold" data-testid="text-data-centre-title">Data Centre</h2>
                <p className="text-[12px] text-muted-foreground">
                  {archives.length} archives · {csvImports.length} imports · {auditLogs.length} audit entries
                </p>
              </div>
            </div>
            {dcTab === "archives" && archives.length > 0 && (
              <Button variant="outline" onClick={handleDownloadAll} data-testid="button-download-all-archives">
                <FileDown className="w-4 h-4 mr-1.5" />
                Export All Summary
              </Button>
            )}
          </div>

          {/* Internal tab bar */}
          <div className="flex gap-1 p-1 bg-muted/40 rounded-lg w-fit" data-testid="data-centre-tabs">
            {([
              { id: "archives", label: "Trip Archives", icon: ClipboardList },
              { id: "imports", label: "Import History", icon: Upload },
              { id: "audit", label: "Audit Log", icon: History },
            ] as { id: DataTab; label: string; icon: any }[]).map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                onClick={() => setDcTab(id)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] font-semibold transition-all ${
                  dcTab === id ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
                }`}
                data-testid={`tab-dc-${id}`}
              >
                <Icon className="w-3.5 h-3.5" />
                {label}
              </button>
            ))}
          </div>

          {/* ── TRIP ARCHIVES TAB ─────────────────────────────────────────────── */}
          {dcTab === "archives" && (
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search archives by name, date, or traffic condition..."
                className="pl-9 pr-9 bg-muted/40 border-border/50"
                data-testid="input-archive-search"
              />
              {search && (
                <button
                  onClick={() => setSearch("")}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  data-testid="button-clear-archive-search"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
          )}

          {dcTab === "archives" && isLoading && (
            <div className="flex items-center justify-center py-16">
              <div className="text-center space-y-2">
                <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto" />
                <p className="text-sm text-muted-foreground">Loading archives...</p>
              </div>
            </div>
          )}

          {dcTab === "archives" && !isLoading && filtered.length === 0 && (
            <Card>
              <CardContent className="py-16">
                <div className="text-center space-y-3">
                  <div className="w-14 h-14 rounded-full bg-muted flex items-center justify-center mx-auto">
                    <Database className="w-6 h-6 text-muted-foreground" />
                  </div>
                  <h3 className="text-[15px] font-semibold">
                    {search ? "No matching archives" : "No archived trip sheets yet"}
                  </h3>
                  <p className="text-[13px] text-muted-foreground max-w-sm mx-auto">
                    {search
                      ? `No archives match "${search}". Try a different search term.`
                      : "After optimizing routes on the Dashboard, use the \"Save to Data Centre\" button to archive your trip sheets for future reference and reporting."}
                  </p>
                </div>
              </CardContent>
            </Card>
          )}

          {!isLoading && filtered.length > 0 && dcTab === "archives" && (
            <div className="space-y-3">
              {filtered.map((archive) => {
                const drivers = (archive.driverSummaries || []) as DriverSummary[];
                return (
                  <Card key={archive.id} className="hover-elevate" data-testid={`card-archive-${archive.id}`}>
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between gap-3 flex-wrap">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap mb-1">
                            <h3 className="font-bold text-[14px]" data-testid={`text-archive-name-${archive.id}`}>{archive.name}</h3>
                            <Badge variant="outline" className="text-[10px]">
                              <Calendar className="w-3 h-3 mr-1" />
                              {archive.runDate}
                            </Badge>
                            {archive.warningCount > 0 && (
                              <Badge variant="outline" className="text-[10px] bg-amber-500/10 border-amber-500/30 text-amber-700 dark:text-amber-400">
                                <AlertTriangle className="w-3 h-3 mr-1" />
                                {archive.warningCount} warnings
                              </Badge>
                            )}
                          </div>

                          <div className="flex items-center gap-4 text-[12px] text-muted-foreground flex-wrap mt-2">
                            <span className="flex items-center gap-1">
                              <Package className="w-3.5 h-3.5" />
                              {archive.shipmentCount} shipments
                            </span>
                            <span className="flex items-center gap-1">
                              <Truck className="w-3.5 h-3.5" />
                              {archive.driverCount} drivers
                            </span>
                            <span className="flex items-center gap-1">
                              <Route className="w-3.5 h-3.5" />
                              {n(archive.totalKm).toFixed(0)}km
                            </span>
                            <span className="flex items-center gap-1">
                              <DollarSign className="w-3.5 h-3.5" />
                              R{n(archive.totalRevenue).toFixed(0)}
                            </span>
                            <span className="flex items-center gap-1">
                              <TrendingUp className="w-3.5 h-3.5" />
                              R{n(archive.totalMargin).toFixed(0)} margin
                            </span>
                          </div>

                          {drivers.length > 0 && (
                            <div className="flex items-center gap-2 mt-2 flex-wrap">
                              {drivers.map((ds) => (
                                <div key={ds.driverId} className="flex items-center gap-1.5 text-[11px]">
                                  <div className="w-5 h-5 rounded-full flex items-center justify-center text-white text-[9px] font-bold shrink-0" style={{ backgroundColor: ds.driverColor }}>
                                    {ds.driverName[0]}
                                  </div>
                                  <span className="text-muted-foreground">{ds.driverName}: {ds.shipmentCount} shipments, {n(ds.totalKm).toFixed(0)}km</span>
                                </div>
                              ))}
                            </div>
                          )}

                          <p className="text-[10px] text-muted-foreground mt-2">
                            Saved {fmtDateTime(archive.createdAt as any)} | Traffic: {archive.trafficCondition}
                          </p>
                        </div>

                        <div className="flex items-center gap-1.5 shrink-0">
                          {onRestore && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="text-[11px] h-7 px-2 gap-1 text-primary border-primary/40 hover:bg-primary/10"
                              onClick={() => setConfirmRestoreId(archive.id)}
                              data-testid={`button-restore-archive-${archive.id}`}
                            >
                              <RotateCcw className="w-3.5 h-3.5" />
                              Restore
                            </Button>
                          )}
                          <Button size="icon" variant="ghost" onClick={() => setSelectedArchive(archive)} data-testid={`button-view-archive-${archive.id}`}>
                            <Eye className="w-4 h-4" />
                          </Button>
                          <Button size="icon" variant="ghost" onClick={() => handleDownloadShipments(archive)} data-testid={`button-download-shipments-${archive.id}`}>
                            <Download className="w-4 h-4" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => {
                              if (confirm("Delete this archived trip sheet? This cannot be undone.")) {
                                deleteMutation.mutate(archive.id);
                              }
                            }}
                            data-testid={`button-delete-archive-${archive.id}`}
                          >
                            <Trash2 className="w-4 h-4 text-destructive" />
                          </Button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
          {/* ── IMPORT HISTORY TAB ─────────────────────────────────────────────── */}
          {dcTab === "imports" && (
            <div className="space-y-3">
              {importsLoading && (
                <div className="flex items-center justify-center py-16">
                  <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                </div>
              )}
              {!importsLoading && csvImports.length === 0 && (
                <Card>
                  <CardContent className="py-16 text-center space-y-3">
                    <div className="w-14 h-14 rounded-full bg-muted flex items-center justify-center mx-auto">
                      <Upload className="w-6 h-6 text-muted-foreground" />
                    </div>
                    <h3 className="text-[15px] font-semibold">No import records yet</h3>
                    <p className="text-[13px] text-muted-foreground max-w-sm mx-auto">
                      Every time you load a CSV on the Import tab, a record is saved here with the file name, shipment counts, and any warnings.
                    </p>
                  </CardContent>
                </Card>
              )}
              {!importsLoading && csvImports.map((imp) => {
                const changeLog = (imp.changeLog as any[]) || [];
                const warnings = (imp.warnings as string[]) || [];
                return (
                  <Card key={imp.id} className="hover-elevate" data-testid={`card-import-${imp.id}`}>
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between gap-3 flex-wrap">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap mb-1">
                            <h3 className="font-semibold text-[13px] font-mono truncate max-w-[280px]" title={imp.fileName || "pasted"}>
                              {imp.fileName || "Pasted CSV"}
                            </h3>
                            <Badge variant="outline" className="text-[10px] bg-green-500/10 border-green-500/30 text-green-700 dark:text-green-400">
                              <CheckCircle2 className="w-3 h-3 mr-1" />{imp.newCount} new
                            </Badge>
                            {imp.updatedCount > 0 && (
                              <Badge variant="outline" className="text-[10px] bg-blue-500/10 border-blue-500/30 text-blue-700 dark:text-blue-400">
                                <RefreshCw className="w-3 h-3 mr-1" />{imp.updatedCount} updated
                              </Badge>
                            )}
                            {imp.failedCount > 0 && (
                              <Badge variant="outline" className="text-[10px] bg-amber-500/10 border-amber-500/30 text-amber-700 dark:text-amber-400">
                                <AlertTriangle className="w-3 h-3 mr-1" />{imp.failedCount} warnings
                              </Badge>
                            )}
                          </div>
                          <div className="flex items-center gap-4 text-[12px] text-muted-foreground mt-1">
                            <span><Package className="w-3 h-3 inline mr-0.5" />{imp.rowCount} total rows</span>
                            <span><Clock className="w-3 h-3 inline mr-0.5" />{fmtDateTime(imp.importedAt as any)}</span>
                          </div>
                          {warnings.length > 0 && (
                            <div className="mt-2 space-y-0.5">
                              {warnings.slice(0, 3).map((w, i) => (
                                <p key={i} className="text-[11px] text-amber-600 dark:text-amber-400">{w}</p>
                              ))}
                              {warnings.length > 3 && <p className="text-[11px] text-muted-foreground">+{warnings.length - 3} more warnings</p>}
                            </div>
                          )}
                        </div>
                        <Button size="icon" variant="ghost" onClick={() => setSelectedImport(imp)} data-testid={`button-view-import-${imp.id}`}>
                          <Eye className="w-4 h-4" />
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}

          {/* ── AUDIT LOG TAB ─────────────────────────────────────────────────── */}
          {dcTab === "audit" && (
            <div className="space-y-3">
              {auditLoading && (
                <div className="flex items-center justify-center py-16">
                  <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                </div>
              )}
              {!auditLoading && auditLogs.length === 0 && (
                <Card>
                  <CardContent className="py-16 text-center space-y-3">
                    <div className="w-14 h-14 rounded-full bg-muted flex items-center justify-center mx-auto">
                      <History className="w-6 h-6 text-muted-foreground" />
                    </div>
                    <h3 className="text-[15px] font-semibold">No audit entries yet</h3>
                    <p className="text-[13px] text-muted-foreground max-w-sm mx-auto">
                      Driver reassignments and trip reorders are logged here automatically with timestamps and before/after values.
                    </p>
                  </CardContent>
                </Card>
              )}
              {!auditLoading && auditLogs.length > 0 && (
                <Card>
                  <div className="overflow-x-auto">
                    <table className="w-full text-[12px]">
                      <thead>
                        <tr className="border-b border-border bg-muted/40">
                          {["Time", "Event", "Entity", "Detail", "From → To"].map((h) => (
                            <th key={h} className="px-3 py-2 text-left font-medium text-muted-foreground whitespace-nowrap">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {auditLogs.map((entry) => {
                          const prev = entry.previousValue as any;
                          const next = entry.newValue as any;
                          const eventIcon = entry.eventType === "DRIVER_REASSIGNED"
                            ? <ArrowRightLeft className="w-3 h-3 text-blue-500" />
                            : entry.eventType === "TRIP_SEQUENCE_UPDATED"
                            ? <ClipboardList className="w-3 h-3 text-purple-500" />
                            : <History className="w-3 h-3 text-muted-foreground" />;
                          return (
                            <tr key={entry.id} className="border-b border-border/40 hover:bg-muted/20" data-testid={`row-audit-${entry.id}`}>
                              <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">{fmtDateTime(entry.createdAt as any)}</td>
                              <td className="px-3 py-2">
                                <span className="flex items-center gap-1 font-medium">
                                  {eventIcon}
                                  {entry.eventType.replace(/_/g, " ")}
                                </span>
                              </td>
                              <td className="px-3 py-2 text-muted-foreground font-mono text-[11px] truncate max-w-[120px]">{entry.entityId}</td>
                              <td className="px-3 py-2 text-muted-foreground max-w-[200px] truncate">{entry.details || "-"}</td>
                              <td className="px-3 py-2">
                                {prev?.driverName && next?.driverName && (
                                  <span className="flex items-center gap-1 text-[11px]">
                                    <span className="text-muted-foreground">{prev.driverName}</span>
                                    <ArrowRight className="w-3 h-3" />
                                    <span className="font-medium">{next.driverName}</span>
                                  </span>
                                )}
                                {prev?.position != null && next?.position != null && (
                                  <span className="text-muted-foreground text-[11px]">#{prev.position + 1} → #{next.position + 1}</span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </Card>
              )}
            </div>
          )}

        </div>
      </ScrollArea>

      <Dialog open={!!selectedArchive} onOpenChange={(open) => { if (!open) setSelectedArchive(null); }}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 flex-wrap" data-testid="text-archive-detail-title">
              <Database className="w-5 h-5 text-primary" />
              {selectedArchive?.name}
              <Badge variant="outline" className="text-[11px]">{selectedArchive?.runDate}</Badge>
            </DialogTitle>
          </DialogHeader>

          {selectedArchive && (
              <div className="space-y-5">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <MetricCard label="Shipments" value={String(selectedArchive.shipmentCount)} icon={Package} />
                  <MetricCard label="Total km" value={`${n(selectedArchive.totalKm).toFixed(1)}`} sub={`${n(selectedArchive.totalDeadKm).toFixed(1)}km dead`} icon={Route} />
                  <MetricCard label="Revenue" value={`R${n(selectedArchive.totalRevenue).toFixed(0)}`} icon={DollarSign} />
                  <MetricCard label="COGS" value={`R${(driverSummaries.reduce((a, d) => a + n(d.cogs ?? (selectedArchive.tripSheets as any)?.[d.driverId]?.stats?.cogs), 0)).toFixed(0)}`} sub={`Fuel: R${n(selectedArchive.totalFuelCost).toFixed(0)}`} icon={Truck} />
                  <MetricCard label="Margin" value={`R${n(selectedArchive.totalMargin).toFixed(0)}`} icon={TrendingUp} />
                </div>

                <Separator />

                <div>
                  <h4 className="font-bold text-[13px] mb-3">Driver Summaries</h4>
                  <div className="space-y-2">
                    {driverSummaries.map((ds) => {
                      const expanded = expandedDrivers[ds.driverId];
                      return (
                        <Card key={ds.driverId} data-testid={`card-driver-summary-${ds.driverId}`}>
                          <CardContent className="p-3">
                            <div
                              className="flex items-center justify-between cursor-pointer gap-2 flex-wrap"
                              onClick={() => setExpandedDrivers((prev) => ({ ...prev, [ds.driverId]: !prev[ds.driverId] }))}
                              data-testid={`toggle-driver-${ds.driverId}`}
                            >
                              <div className="flex items-center gap-2">
                                <div className="w-7 h-7 rounded-full flex items-center justify-center text-white text-[11px] font-bold shrink-0" style={{ backgroundColor: ds.driverColor }}>
                                  {ds.driverName[0]}
                                </div>
                                <span className="font-semibold text-[13px]">{ds.driverName}</span>
                                <Badge variant="outline" className="text-[10px]">{ds.shipmentCount} shipments</Badge>
                              </div>
                              <div className="flex items-center gap-3 text-[11px] text-muted-foreground flex-wrap">
                                <span>{n(ds.totalKm).toFixed(1)}km</span>
                                <span>R{n(ds.revenue).toFixed(0)} rev</span>
                                <span>R{n(ds.cogs ?? (selectedArchive?.tripSheets as any)?.[ds.driverId]?.stats?.cogs).toFixed(0)} COGS</span>
                                <span>R{n(ds.margin).toFixed(0)} margin</span>
                                {ds.lateCount > 0 && <Badge variant="outline" className="text-[9px] bg-red-500/10 border-red-500/30 text-red-700 dark:text-red-400">{ds.lateCount} late</Badge>}
                                {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                              </div>
                            </div>
                            {expanded && (() => {
                              const tripData = (selectedArchive?.tripSheets as any)?.[ds.driverId];
                              const stops: any[] = tripData?.stops || [];
                              return (
                                <div className="mt-3 space-y-3">
                                  <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-[11px]">
                                    <div className="bg-muted/40 rounded-md p-2">
                                      <span className="text-muted-foreground">Stops</span>
                                      <p className="font-bold">{ds.stopCount}</p>
                                    </div>
                                    <div className="bg-muted/40 rounded-md p-2">
                                      <span className="text-muted-foreground">Dead km</span>
                                      <p className="font-bold">{n(ds.deadKm).toFixed(1)}</p>
                                    </div>
                                    <div className="bg-muted/40 rounded-md p-2">
                                      <span className="text-muted-foreground">COGS</span>
                                      <p className="font-bold">R{n(ds.cogs ?? (selectedArchive?.tripSheets as any)?.[ds.driverId]?.stats?.cogs).toFixed(0)}</p>
                                    </div>
                                    <div className="bg-muted/40 rounded-md p-2">
                                      <span className="text-muted-foreground">Fuel</span>
                                      <p className="font-bold">{n(ds.fuelLitres).toFixed(1)}L / R{n(ds.fuelCost).toFixed(0)}</p>
                                    </div>
                                    <div className="bg-muted/40 rounded-md p-2">
                                      <span className="text-muted-foreground">Hours</span>
                                      <p className="font-bold">{ds.startTime || "-"} to {ds.endTime || "-"}</p>
                                    </div>
                                  </div>

                                  {stops.length > 0 && (
                                    <div>
                                      <h5 className="text-[11px] font-semibold text-muted-foreground mb-2 flex items-center gap-1">
                                        <Navigation className="w-3 h-3" />
                                        Individual Trips ({stops.length} stops)
                                      </h5>
                                      <div className="border rounded-md overflow-hidden">
                                        <table className="w-full text-[11px]">
                                          <thead>
                                            <tr className="bg-muted/50 text-muted-foreground">
                                              <th className="text-left px-2 py-1.5 font-medium">#</th>
                                              <th className="text-left px-2 py-1.5 font-medium">Type</th>
                                              <th className="text-left px-2 py-1.5 font-medium">Location</th>
                                              <th className="text-left px-2 py-1.5 font-medium">Waybills</th>
                                              <th className="text-right px-2 py-1.5 font-medium">Leg km</th>
                                              <th className="text-right px-2 py-1.5 font-medium">ETA</th>
                                              <th className="text-left px-2 py-1.5 font-medium">Window</th>
                                              <th className="text-right px-2 py-1.5 font-medium">Pcs</th>
                                              <th className="text-center px-2 py-1.5 font-medium">Status</th>
                                            </tr>
                                          </thead>
                                          <tbody>
                                            {stops.map((stop: any, idx: number) => {
                                              const typeLabel = stop.type === "C" ? "Collect" : stop.type === "D" ? "Deliver" : stop.type === "X" ? "Exchange" : stop.type;
                                              const typeBg = stop.type === "C"
                                                ? "bg-blue-500/15 text-blue-700 dark:text-blue-400"
                                                : stop.type === "D"
                                                ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
                                                : "bg-purple-500/15 text-purple-700 dark:text-purple-400";
                                              const location = stop.city ? `${stop.sub}, ${stop.city}` : stop.sub;
                                              return (
                                                <tr
                                                  key={stop.key || idx}
                                                  className={`border-t border-border/40 ${stop.late ? "bg-red-500/5" : idx % 2 === 0 ? "" : "bg-muted/20"}`}
                                                  data-testid={`row-stop-${ds.driverId}-${idx}`}
                                                >
                                                  <td className="px-2 py-1.5 text-muted-foreground">{stop.seq ?? idx + 1}</td>
                                                  <td className="px-2 py-1.5">
                                                    <Badge variant="outline" className={`text-[9px] px-1.5 py-0 ${typeBg}`}>
                                                      {typeLabel}
                                                    </Badge>
                                                  </td>
                                                  <td className="px-2 py-1.5 font-medium max-w-[150px] truncate" title={`${location} — ${stop.addr || ""}`}>
                                                    {location}
                                                  </td>
                                                  <td className="px-2 py-1.5 text-muted-foreground max-w-[100px] truncate" title={(stop.wbs || []).join(", ")}>
                                                    {(stop.wbs || []).join(", ") || "-"}
                                                  </td>
                                                  <td className="px-2 py-1.5 text-right">{n(stop.legKm).toFixed(1)}</td>
                                                  <td className="px-2 py-1.5 text-right font-medium">{stop.eta || "-"}</td>
                                                  <td className="px-2 py-1.5 text-muted-foreground">{stop.win || "-"}</td>
                                                  <td className="px-2 py-1.5 text-right">{stop.pcs ?? "-"}</td>
                                                  <td className="px-2 py-1.5 text-center">
                                                    {stop.late ? (
                                                      <Badge variant="outline" className="text-[9px] px-1.5 py-0 bg-red-500/10 border-red-500/30 text-red-700 dark:text-red-400">Late</Badge>
                                                    ) : (
                                                      <Badge variant="outline" className="text-[9px] px-1.5 py-0 bg-emerald-500/10 border-emerald-500/30 text-emerald-700 dark:text-emerald-400">On Time</Badge>
                                                    )}
                                                  </td>
                                                </tr>
                                              );
                                            })}
                                          </tbody>
                                          <tfoot>
                                            <tr className="border-t bg-muted/40 font-semibold">
                                              <td className="px-2 py-1.5" colSpan={4}>Total</td>
                                              <td className="px-2 py-1.5 text-right">{stops.reduce((s: number, st: any) => s + n(st.legKm), 0).toFixed(1)}</td>
                                              <td className="px-2 py-1.5" colSpan={2}></td>
                                              <td className="px-2 py-1.5 text-right">{stops.reduce((s: number, st: any) => s + (st.pcs || 0), 0)}</td>
                                              <td className="px-2 py-1.5 text-center text-muted-foreground">{stops.filter((st: any) => st.late).length} late</td>
                                            </tr>
                                          </tfoot>
                                        </table>
                                      </div>
                                    </div>
                                  )}
                                </div>
                              );
                            })()}
                          </CardContent>
                        </Card>
                      );
                    })}
                  </div>
                </div>

                <Separator />

                <div className="flex gap-2 flex-wrap pb-2">
                  {onRestore && (
                    <Button
                      variant="default"
                      onClick={() => { setConfirmRestoreId(selectedArchive.id); setSelectedArchive(null); }}
                      data-testid="button-restore-detail"
                    >
                      <RotateCcw className="w-4 h-4 mr-1.5" />
                      Restore This Assignment
                    </Button>
                  )}
                  <Button variant="outline" onClick={() => handleDownloadShipments(selectedArchive)} data-testid="button-download-detail-shipments">
                    <Download className="w-4 h-4 mr-1.5" />
                    Download Shipments CSV
                  </Button>
                  <Button variant="outline" onClick={() => handleDownloadTrips(selectedArchive)} data-testid="button-download-detail-trips">
                    <FileDown className="w-4 h-4 mr-1.5" />
                    Download Trip Summary CSV
                  </Button>
                </div>
              </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Restore confirmation dialog */}
      {(() => {
        const archiveToRestore = archives.find((a) => a.id === confirmRestoreId) ?? null;
        return (
          <Dialog open={!!confirmRestoreId} onOpenChange={(open) => { if (!open) setConfirmRestoreId(null); }}>
            <DialogContent className="max-w-md">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <RotateCcw className="w-5 h-5 text-primary" />
                  Restore Assignment
                </DialogTitle>
              </DialogHeader>
              {archiveToRestore && (
                <div className="space-y-4">
                  <p className="text-[13px] text-muted-foreground">
                    This will replace your current shipments and driver assignments with the saved version from:
                  </p>
                  <div className="rounded-md bg-muted/40 p-3 space-y-1">
                    <p className="font-bold text-[14px]">{archiveToRestore.name}</p>
                    <p className="text-[12px] text-muted-foreground">
                      {archiveToRestore.shipmentCount} shipments · {archiveToRestore.driverCount} drivers · {archiveToRestore.runDate}
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      Saved {fmtDateTime(archiveToRestore.createdAt as any)}
                    </p>
                  </div>
                  <p className="text-[12px] text-amber-700 dark:text-amber-400">
                    Your current unsaved session will be overwritten. This cannot be undone.
                  </p>
                  <div className="flex gap-2 justify-end">
                    <Button variant="outline" onClick={() => setConfirmRestoreId(null)} data-testid="button-cancel-restore">
                      Cancel
                    </Button>
                    <Button
                      onClick={() => {
                        if (onRestore && archiveToRestore) onRestore(archiveToRestore);
                        setConfirmRestoreId(null);
                      }}
                      data-testid="button-confirm-restore"
                    >
                      <RotateCcw className="w-4 h-4 mr-1.5" />
                      Restore
                    </Button>
                  </div>
                </div>
              )}
            </DialogContent>
          </Dialog>
        );
      })()}

      {/* Import detail dialog */}
      <Dialog open={!!selectedImport} onOpenChange={(open) => { if (!open) setSelectedImport(null); }}>
        <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Upload className="w-5 h-5 text-primary" />
              Import Detail
            </DialogTitle>
          </DialogHeader>
          {selectedImport && (
            <div className="space-y-4 text-[13px]">
              <div className="grid grid-cols-2 gap-3">
                <div className="p-3 rounded-md bg-muted/30">
                  <p className="text-[11px] text-muted-foreground mb-0.5">File</p>
                  <p className="font-medium font-mono text-[12px] break-all">{selectedImport.fileName || "Pasted CSV"}</p>
                </div>
                <div className="p-3 rounded-md bg-muted/30">
                  <p className="text-[11px] text-muted-foreground mb-0.5">Imported</p>
                  <p className="font-medium">{fmtDateTime(selectedImport.importedAt as any)}</p>
                </div>
                <div className="p-3 rounded-md bg-green-500/10 border border-green-500/20">
                  <p className="text-[11px] text-muted-foreground mb-0.5">New</p>
                  <p className="font-bold text-green-700 dark:text-green-400">{selectedImport.newCount}</p>
                </div>
                <div className="p-3 rounded-md bg-blue-500/10 border border-blue-500/20">
                  <p className="text-[11px] text-muted-foreground mb-0.5">Updated</p>
                  <p className="font-bold text-blue-700 dark:text-blue-400">{selectedImport.updatedCount}</p>
                </div>
                <div className="p-3 rounded-md bg-muted/30">
                  <p className="text-[11px] text-muted-foreground mb-0.5">Total rows</p>
                  <p className="font-bold">{selectedImport.rowCount}</p>
                </div>
                {selectedImport.failedCount > 0 && (
                  <div className="p-3 rounded-md bg-amber-500/10 border border-amber-500/20">
                    <p className="text-[11px] text-muted-foreground mb-0.5">Warnings</p>
                    <p className="font-bold text-amber-700 dark:text-amber-400">{selectedImport.failedCount}</p>
                  </div>
                )}
              </div>
              {(selectedImport.warnings as string[] || []).length > 0 && (
                <div>
                  <p className="font-semibold text-[12px] mb-2">Parse Warnings</p>
                  <div className="space-y-1 max-h-40 overflow-y-auto">
                    {(selectedImport.warnings as string[]).map((w, i) => (
                      <p key={i} className="text-[11px] text-amber-700 dark:text-amber-400 bg-amber-500/5 px-2 py-1 rounded">{w}</p>
                    ))}
                  </div>
                </div>
              )}
              {(selectedImport.changeLog as any[] || []).length > 0 && (
                <div>
                  <p className="font-semibold text-[12px] mb-2">Change Log ({(selectedImport.changeLog as any[]).length})</p>
                  <div className="space-y-1 max-h-40 overflow-y-auto">
                    {(selectedImport.changeLog as any[]).map((c, i) => (
                      <p key={i} className="text-[11px] text-muted-foreground bg-muted/30 px-2 py-1 rounded">{c.wb}: {c.type}</p>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
