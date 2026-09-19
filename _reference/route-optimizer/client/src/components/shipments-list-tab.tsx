import { useState, useMemo, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Package, Search, RefreshCw, ChevronLeft, ChevronRight,
  Truck, MapPin, Clock, Phone, Mail, ExternalLink, Filter,
  X, ArrowUpDown, Hash, Weight, Box, User, FileDown,
  AlertTriangle, CheckCircle2, Loader2, Pencil,
} from "lucide-react";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { DeliveryWindowDialog } from "@/components/delivery-window-dialog";
import { useToast } from "@/hooks/use-toast";

interface WebhookEvent {
  timestamp: string;
  status: string;
  source: string;
  message: string;
}

interface ShipmentRow {
  id: string;
  wb: string;
  acc: string;
  client: string;
  clientName: string;
  pcs: number;
  kg: number;
  svc: string;
  rate: number;
  perish: boolean;
  cAddr: string;
  cSub: string;
  cCity: string;
  cPostal: string;
  cLat: number;
  cLng: number;
  cContact: string;
  cPhone: string;
  dAddr: string;
  dSub: string;
  dCity: string;
  dPostal: string;
  dLat: number;
  dLng: number;
  dContact: string;
  dPhone: string;
  dAfter: string;
  dBefore: string;
  origDAfter: string;
  origDBefore: string;
  hasDeliveryOverride: boolean;
  zone: string;
  status: string;
  source: string;
  colDate: string;
  delDate: string;
  lDelDate: string;
  created: string;
  trackUrl: string;
  parcelType: string;
  parcelCategory: string;
  webhookEvents: WebhookEvent[];
  projectName: string;
  projectId: string;
  assignedDriver: string;
  stopStatus: string;
}

interface ShipmentsResponse {
  shipments: ShipmentRow[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  projects: Array<{ id: string; name: string }>;
}

function getLatestStatus(s: ShipmentRow): string {
  if (s.webhookEvents.length > 0) {
    return s.webhookEvents[s.webhookEvents.length - 1].status;
  }
  if (s.stopStatus && s.stopStatus !== "pending") return s.stopStatus;
  if (s.status) return s.status;
  return "pending";
}

function statusBadgeStyle(status: string): string {
  const s = status.toLowerCase().replace(/[_-]/g, " ");
  if (s.includes("delivered") || s.includes("done") || s.includes("completed")) return "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400 border-green-300 dark:border-green-700";
  if (s.includes("collected") || s.includes("collection")) return "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400 border-blue-300 dark:border-blue-700";
  if (s.includes("out") || s.includes("transit") || s.includes("in_transit")) return "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400 border-purple-300 dark:border-purple-700";
  if (s.includes("failed") || s.includes("exception")) return "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400 border-red-300 dark:border-red-700";
  if (s.includes("arrived")) return "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400 border-amber-300 dark:border-amber-700";
  if (s.includes("skipped") || s.includes("cancelled")) return "bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400 border-gray-300 dark:border-gray-700";
  return "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300 border-slate-300 dark:border-slate-600";
}

function statusLabel(status: string): string {
  return status.replace(/[_-]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function sourceBadge(source: string) {
  if (source === "webhook") return <Badge variant="outline" className="text-[9px] px-1.5 py-0 bg-purple-50 text-purple-700 dark:bg-purple-900/20 dark:text-purple-400 border-purple-200 dark:border-purple-700">Webhook</Badge>;
  if (source === "csv+webhook") return <Badge variant="outline" className="text-[9px] px-1.5 py-0 bg-teal-50 text-teal-700 dark:bg-teal-900/20 dark:text-teal-400 border-teal-200 dark:border-teal-700">CSV+WH</Badge>;
  return <Badge variant="outline" className="text-[9px] px-1.5 py-0 bg-slate-50 text-slate-600 dark:bg-slate-800 dark:text-slate-400 border-slate-200 dark:border-slate-700">CSV</Badge>;
}

function fmtDate(dateStr: string): string {
  if (!dateStr) return "—";
  try {
    return new Date(dateStr).toLocaleDateString("en-ZA", { day: "2-digit", month: "short", year: "numeric" });
  } catch { return dateStr; }
}

function fmtDateTime(dateStr: string): string {
  if (!dateStr) return "—";
  try {
    return new Date(dateStr).toLocaleString("en-ZA", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
  } catch { return dateStr; }
}

const STATUS_OPTIONS = [
  { value: "all", label: "All statuses" },
  { value: "pending", label: "Pending" },
  { value: "collected", label: "Collected" },
  { value: "collection_assigned", label: "Collection assigned" },
  { value: "in_transit", label: "In transit" },
  { value: "out_for_delivery", label: "Out for delivery" },
  { value: "delivered", label: "Delivered" },
  { value: "arrived", label: "Arrived" },
  { value: "done", label: "Done" },
  { value: "failed", label: "Failed" },
  { value: "skipped", label: "Skipped" },
];

const SOURCE_OPTIONS = [
  { value: "all", label: "All sources" },
  { value: "csv", label: "CSV import" },
  { value: "webhook", label: "Webhook" },
  { value: "csv+webhook", label: "CSV + Webhook" },
];

export default function ShipmentsListTab() {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [sourceFilter, setSourceFilter] = useState("all");
  const [projectFilter, setProjectFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [selectedShipment, setSelectedShipment] = useState<ShipmentRow | null>(null);
  const [overrideShipment, setOverrideShipment] = useState<ShipmentRow | null>(null);
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const { toast } = useToast();

  const searchTimeout = useMemo(() => {
    let timer: ReturnType<typeof setTimeout>;
    return (val: string) => {
      clearTimeout(timer);
      timer = setTimeout(() => { setDebouncedSearch(val); setPage(1); }, 300);
    };
  }, []);

  const queryParams = useMemo(() => {
    const p = new URLSearchParams();
    if (debouncedSearch) p.set("search", debouncedSearch);
    if (statusFilter !== "all") p.set("status", statusFilter);
    if (sourceFilter !== "all") p.set("source", sourceFilter);
    if (projectFilter !== "all") p.set("project", projectFilter);
    p.set("page", String(page));
    p.set("limit", String(pageSize));
    return p.toString();
  }, [debouncedSearch, statusFilter, sourceFilter, projectFilter, page, pageSize]);

  const { data, isLoading, isFetching } = useQuery<ShipmentsResponse>({
    queryKey: ["/api/dispatch/all-shipments", queryParams],
    queryFn: async () => {
      const res = await fetch(`/api/dispatch/all-shipments?${queryParams}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch shipments");
      return res.json();
    },
  });

  const shipments = data?.shipments || [];
  const total = data?.total || 0;
  const totalPages = data?.totalPages || 1;
  const projects = data?.projects || [];

  const resetFilters = useCallback(() => {
    setSearch("");
    setDebouncedSearch("");
    setStatusFilter("all");
    setSourceFilter("all");
    setProjectFilter("all");
    setPage(1);
  }, []);

  const handleRefresh = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/dispatch/all-shipments"] });
  };

  const saveOverride = async (shipmentId: string, dAfter: string, dBefore: string, pinnedTime?: string) => {
    if (!overrideShipment) return;
    try {
      const body: Record<string, unknown> = { shipmentId };
      if (pinnedTime) body.pinnedTime = pinnedTime;
      else { body.dAfter = dAfter; body.dBefore = dBefore; }
      await apiRequest("PATCH", `/api/dispatch/projects/${overrideShipment.projectId}/delivery-overrides`, body);
      queryClient.invalidateQueries({ queryKey: ["/api/dispatch/all-shipments"] });
      // Force any open Dispatch session for this project to re-load + re-optimize
      // against the new window (the PATCH already cleared driverStopSequences
      // server-side; invalidating the session cache makes the page refetch).
      queryClient.invalidateQueries({ queryKey: ["/api/session", overrideShipment.projectId] });
      toast({
        title: pinnedTime ? "Delivery pinned" : "Delivery window overridden",
        description: pinnedTime
          ? `Pinned to ${pinnedTime}. Trip will re-optimize on next Dispatch load.`
          : `Saved ${dAfter}–${dBefore}. Trip will re-optimize on next Dispatch load.`,
      });
    } catch (err: any) {
      toast({ title: "Failed to save override", description: err?.message || "Unknown error", variant: "destructive" });
    }
  };

  const clearOverride = async (shipmentId: string) => {
    if (!overrideShipment) return;
    try {
      await apiRequest("PATCH", `/api/dispatch/projects/${overrideShipment.projectId}/delivery-overrides`, {
        shipmentId, clear: true,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/dispatch/all-shipments"] });
      queryClient.invalidateQueries({ queryKey: ["/api/session", overrideShipment.projectId] });
      toast({ title: "Override cleared", description: "Sender's requested window restored. Trip will re-optimize on next Dispatch load." });
    } catch (err: any) {
      toast({ title: "Failed to clear override", description: err?.message || "Unknown error", variant: "destructive" });
    }
  };

  const handleExportCSV = () => {
    if (!shipments.length) return;
    const headers = ["Waybill", "Account", "Client", "Status", "Service", "Source", "Collection Address", "Delivery Address", "Delivery Contact", "Delivery Phone", "Driver", "Project", "Created"];
    const rows = shipments.map((s) => [
      s.wb, s.acc, s.clientName, statusLabel(getLatestStatus(s)), s.svc, s.source,
      `${s.cAddr} ${s.cSub} ${s.cCity}`.trim(), `${s.dAddr} ${s.dSub} ${s.dCity}`.trim(),
      s.dContact, s.dPhone, s.assignedDriver, s.projectName, s.created,
    ]);
    const csv = [headers.join(","), ...rows.map((r) => r.map((c) => `"${(c || "").replace(/"/g, '""')}"`).join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `shipments-export-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click(); URL.revokeObjectURL(url);
  };

  const hasFilters = debouncedSearch || statusFilter !== "all" || sourceFilter !== "all" || projectFilter !== "all";

  return (
    <div className="h-full flex flex-col" data-testid="shipments-list-tab">
      <div className="flex-shrink-0 px-6 pt-6 pb-4 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Package className="w-6 h-6 text-primary" />
            <h1 className="text-[20px] font-bold" data-testid="text-shipments-title">Shipments</h1>
          </div>
          <div className="flex items-center gap-2">
            {hasFilters && (
              <Button variant="ghost" size="sm" onClick={resetFilters} className="text-red-500 hover:text-red-700 text-[12px] gap-1" data-testid="button-reset-filters">
                <X className="w-3.5 h-3.5" /> Reset filters
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={handleExportCSV} className="text-[12px] gap-1.5 text-green-600 dark:text-green-400 border-green-200 dark:border-green-800" data-testid="button-download-csv">
              <FileDown className="w-3.5 h-3.5" /> Download CSV
            </Button>
            <Button variant="outline" size="sm" onClick={handleRefresh} className="text-[12px] gap-1.5" data-testid="button-refresh-shipments">
              <RefreshCw className={`w-3.5 h-3.5 ${isFetching ? "animate-spin" : ""}`} /> Refresh
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-4 gap-3">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search waybill, account, address..."
              value={search}
              onChange={(e) => { setSearch(e.target.value); searchTimeout(e.target.value); }}
              className="pl-8 h-9 text-[13px]"
              data-testid="input-search-shipments"
            />
          </div>
          <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setPage(1); }}>
            <SelectTrigger className="h-9 text-[13px]" data-testid="select-status-filter">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              {STATUS_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={sourceFilter} onValueChange={(v) => { setSourceFilter(v); setPage(1); }}>
            <SelectTrigger className="h-9 text-[13px]" data-testid="select-source-filter">
              <SelectValue placeholder="Source" />
            </SelectTrigger>
            <SelectContent>
              {SOURCE_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={projectFilter} onValueChange={(v) => { setProjectFilter(v); setPage(1); }}>
            <SelectTrigger className="h-9 text-[13px]" data-testid="select-project-filter">
              <SelectValue placeholder="Project" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All projects</SelectItem>
              {projects.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center justify-between text-[12px] text-muted-foreground">
          <span data-testid="text-shipment-count">
            {isLoading ? "Loading..." : `Showing ${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, total)} of ${total} shipments`}
          </span>
        </div>
      </div>

      <div className="flex-1 overflow-auto px-6">
        <div className="border rounded-lg overflow-hidden bg-card">
          <table className="w-full text-[12px]">
            <thead>
              <tr className="bg-muted/40 border-b">
                <th className="text-left px-3 py-2.5 font-semibold text-muted-foreground whitespace-nowrap">ACCOUNT</th>
                <th className="text-left px-3 py-2.5 font-semibold text-muted-foreground whitespace-nowrap">WAYBILL NO.</th>
                <th className="text-left px-3 py-2.5 font-semibold text-muted-foreground whitespace-nowrap">STATUS</th>
                <th className="text-left px-3 py-2.5 font-semibold text-muted-foreground whitespace-nowrap">SERVICE</th>
                <th className="text-left px-3 py-2.5 font-semibold text-muted-foreground whitespace-nowrap">SOURCE</th>
                <th className="text-left px-3 py-2.5 font-semibold text-muted-foreground whitespace-nowrap">COLLECTION ADDRESS</th>
                <th className="text-left px-3 py-2.5 font-semibold text-muted-foreground whitespace-nowrap">DELIVERY ADDRESS</th>
                <th className="text-left px-3 py-2.5 font-semibold text-muted-foreground whitespace-nowrap">DELIVERY WINDOW</th>
                <th className="text-left px-3 py-2.5 font-semibold text-muted-foreground whitespace-nowrap">DRIVER</th>
                <th className="text-left px-3 py-2.5 font-semibold text-muted-foreground whitespace-nowrap">PROJECT</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={10} className="text-center py-12">
                    <Loader2 className="w-6 h-6 animate-spin mx-auto text-muted-foreground" />
                    <p className="text-[13px] text-muted-foreground mt-2">Loading shipments...</p>
                  </td>
                </tr>
              ) : shipments.length === 0 ? (
                <tr>
                  <td colSpan={10} className="text-center py-12">
                    <Package className="w-8 h-8 mx-auto text-muted-foreground/40" />
                    <p className="text-[13px] text-muted-foreground mt-2">No shipments found</p>
                    {hasFilters && <p className="text-[11px] text-muted-foreground/60 mt-1">Try adjusting your filters</p>}
                  </td>
                </tr>
              ) : (
                shipments.map((s, idx) => {
                  const latestStatus = getLatestStatus(s);
                  return (
                    <tr
                      key={`${s.projectId}-${s.id}-${idx}`}
                      className="border-b last:border-0 hover:bg-muted/20 cursor-pointer transition-colors"
                      onClick={() => setSelectedShipment(s)}
                      data-testid={`row-shipment-${s.wb}-${s.projectId}-${idx}`}
                    >
                      <td className="px-3 py-2.5 font-medium text-muted-foreground">{s.acc || "—"}</td>
                      <td className="px-3 py-2.5 font-bold">{s.wb || "—"}</td>
                      <td className="px-3 py-2.5">
                        <Badge variant="outline" className={`text-[10px] px-2 py-0.5 font-semibold ${statusBadgeStyle(latestStatus)}`}>
                          {statusLabel(latestStatus)}
                        </Badge>
                      </td>
                      <td className="px-3 py-2.5 text-muted-foreground">{s.svc || "—"}</td>
                      <td className="px-3 py-2.5">{sourceBadge(s.source)}</td>
                      <td className="px-3 py-2.5 max-w-[200px] truncate text-muted-foreground" title={`${s.cAddr} ${s.cSub}, ${s.cCity}`.trim()}>
                        {s.cAddr || s.cSub ? `${s.cAddr} ${s.cSub}, ${s.cCity}`.trim().replace(/, $/, "") : "—"}
                      </td>
                      <td className="px-3 py-2.5 max-w-[200px] truncate text-muted-foreground" title={`${s.dAddr} ${s.dSub}, ${s.dCity}`.trim()}>
                        {s.dAddr || s.dSub ? `${s.dAddr} ${s.dSub}, ${s.dCity}`.trim().replace(/, $/, "") : "—"}
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap">
                        <div className="flex items-center gap-1.5">
                          <span className="font-mono text-[11px] text-muted-foreground">
                            {s.dAfter || s.dBefore ? `${s.dAfter || "—"}–${s.dBefore || "—"}` : "—"}
                          </span>
                          {s.hasDeliveryOverride && (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Badge variant="secondary" className="text-[9px] px-1 py-0 cursor-help" data-testid={`badge-override-${s.wb}`}>OVR</Badge>
                              </TooltipTrigger>
                              <TooltipContent className="text-[11px]">
                                Sender requested {s.origDAfter || "—"}–{s.origDBefore || "—"}
                              </TooltipContent>
                            </Tooltip>
                          )}
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6"
                            onClick={(e) => { e.stopPropagation(); setOverrideShipment(s); }}
                            data-testid={`button-edit-window-${s.wb}`}
                            aria-label="Override delivery window"
                          >
                            <Pencil className="w-3 h-3" />
                          </Button>
                        </div>
                      </td>
                      <td className="px-3 py-2.5">
                        {s.assignedDriver ? (
                          <span className="flex items-center gap-1 text-muted-foreground">
                            <Truck className="w-3 h-3" />
                            {s.assignedDriver}
                          </span>
                        ) : <span className="text-muted-foreground/40">—</span>}
                      </td>
                      <td className="px-3 py-2.5 text-muted-foreground text-[11px]">{s.projectName}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="flex-shrink-0 px-6 py-3 border-t flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Button
            variant="ghost" size="sm" disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            className="text-[12px] text-primary"
            data-testid="button-prev-page"
          >
            <ChevronLeft className="w-4 h-4 mr-0.5" /> Previous
          </Button>
          <div className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
            Page
            <Input
              type="number" min={1} max={totalPages}
              value={page}
              onChange={(e) => {
                const v = parseInt(e.target.value);
                if (v >= 1 && v <= totalPages) setPage(v);
              }}
              className="w-12 h-7 text-center text-[12px] px-1"
              data-testid="input-page-number"
            />
            of {totalPages}
          </div>
          <Select value={String(pageSize)} onValueChange={(v) => { setPageSize(parseInt(v)); setPage(1); }}>
            <SelectTrigger className="h-7 w-16 text-[12px]" data-testid="select-page-size">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="20">20</SelectItem>
              <SelectItem value="50">50</SelectItem>
              <SelectItem value="100">100</SelectItem>
            </SelectContent>
          </Select>
          <Button
            variant="ghost" size="sm" disabled={page >= totalPages}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            className="text-[12px] text-primary"
            data-testid="button-next-page"
          >
            Next <ChevronRight className="w-4 h-4 ml-0.5" />
          </Button>
        </div>
      </div>

      {selectedShipment && (
        <ShipmentDetailModal
          shipment={selectedShipment}
          open={!!selectedShipment}
          onClose={() => setSelectedShipment(null)}
        />
      )}

      <DeliveryWindowDialog
        open={!!overrideShipment}
        onOpenChange={(v) => { if (!v) setOverrideShipment(null); }}
        shipment={overrideShipment as any}
        currentOverride={overrideShipment?.hasDeliveryOverride ? { dAfter: overrideShipment.dAfter, dBefore: overrideShipment.dBefore, setAt: "" } : undefined}
        onSave={saveOverride}
        onClear={clearOverride}
      />
    </div>
  );
}

function ShipmentDetailModal({ shipment: s, open, onClose }: { shipment: ShipmentRow; open: boolean; onClose: () => void }) {
  const latestStatus = getLatestStatus(s);

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto" data-testid="shipment-detail-modal">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <Package className="w-5 h-5 text-primary" />
            <DialogTitle className="text-[16px] font-bold">{s.wb || "Shipment Details"}</DialogTitle>
            <Badge variant="outline" className={`text-[10px] font-semibold ${statusBadgeStyle(latestStatus)}`}>
              {statusLabel(latestStatus)}
            </Badge>
            {sourceBadge(s.source)}
          </div>
        </DialogHeader>

        <div className="space-y-5 mt-2">
          <div className="grid grid-cols-4 gap-3">
            <InfoCell label="Account" value={s.acc} />
            <InfoCell label="Client" value={s.clientName || s.client} />
            <InfoCell label="Service" value={s.svc} />
            <InfoCell label="Zone" value={s.zone} />
            <InfoCell label="Parcels" value={s.pcs ? String(s.pcs) : "—"} icon={<Box className="w-3 h-3" />} />
            <InfoCell label="Weight" value={s.kg ? `${s.kg} kg` : "—"} icon={<Weight className="w-3 h-3" />} />
            <InfoCell label="Rate" value={s.rate ? `R${s.rate.toFixed(2)}` : "—"} />
            <InfoCell label="Perishable" value={s.perish ? "Yes" : "No"} />
          </div>

          <Separator />

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <h3 className="text-[12px] font-bold flex items-center gap-1.5 text-blue-600 dark:text-blue-400">
                <MapPin className="w-3.5 h-3.5" /> Collection
              </h3>
              <div className="p-3 rounded-lg bg-blue-50/50 dark:bg-blue-950/20 border border-blue-100 dark:border-blue-900/30 space-y-1">
                <p className="text-[12px] font-medium">{s.cAddr || "—"}</p>
                <p className="text-[11px] text-muted-foreground">{[s.cSub, s.cCity, s.cPostal].filter(Boolean).join(", ")}</p>
                {s.cContact && (
                  <p className="text-[11px] flex items-center gap-1"><User className="w-3 h-3" /> {s.cContact}</p>
                )}
                {s.cPhone && (
                  <p className="text-[11px] flex items-center gap-1">
                    <Phone className="w-3 h-3" />
                    <a href={`tel:${s.cPhone}`} className="text-primary hover:underline">{s.cPhone}</a>
                  </p>
                )}
                {s.colDate && <p className="text-[10px] text-muted-foreground flex items-center gap-1"><Clock className="w-3 h-3" /> {fmtDate(s.colDate)}</p>}
              </div>
            </div>

            <div className="space-y-2">
              <h3 className="text-[12px] font-bold flex items-center gap-1.5 text-green-600 dark:text-green-400">
                <MapPin className="w-3.5 h-3.5" /> Delivery
              </h3>
              <div className="p-3 rounded-lg bg-green-50/50 dark:bg-green-950/20 border border-green-100 dark:border-green-900/30 space-y-1">
                <p className="text-[12px] font-medium">{s.dAddr || "—"}</p>
                <p className="text-[11px] text-muted-foreground">{[s.dSub, s.dCity, s.dPostal].filter(Boolean).join(", ")}</p>
                {s.dContact && (
                  <p className="text-[11px] flex items-center gap-1"><User className="w-3 h-3" /> {s.dContact}</p>
                )}
                {s.dPhone && (
                  <p className="text-[11px] flex items-center gap-1">
                    <Phone className="w-3 h-3" />
                    <a href={`tel:${s.dPhone}`} className="text-primary hover:underline">{s.dPhone}</a>
                  </p>
                )}
                {s.delDate && <p className="text-[10px] text-muted-foreground flex items-center gap-1"><Clock className="w-3 h-3" /> {fmtDate(s.delDate)}</p>}
                {s.lDelDate && <p className="text-[10px] text-muted-foreground">Latest: {fmtDate(s.lDelDate)}</p>}
              </div>
            </div>
          </div>

          <Separator />

          <div className="grid grid-cols-3 gap-3">
            <InfoCell label="Assigned Driver" value={s.assignedDriver || "Unassigned"} icon={<Truck className="w-3 h-3" />} />
            <InfoCell label="Project" value={s.projectName} />
            <InfoCell label="Created" value={fmtDateTime(s.created)} />
            {s.parcelType && <InfoCell label="Parcel Type" value={s.parcelType} />}
            {s.parcelCategory && <InfoCell label="Category" value={s.parcelCategory} />}
            {s.trackUrl && (
              <div className="p-2 rounded-md bg-muted/30">
                <p className="text-[10px] text-muted-foreground font-medium mb-0.5">Tracking URL</p>
                <a href={s.trackUrl} target="_blank" rel="noopener noreferrer" className="text-[11px] text-primary hover:underline flex items-center gap-1" data-testid="link-tracking-url">
                  <ExternalLink className="w-3 h-3" /> Track
                </a>
              </div>
            )}
          </div>

          {s.webhookEvents.length > 0 && (
            <>
              <Separator />
              <div>
                <h3 className="text-[12px] font-bold mb-3 flex items-center gap-1.5">
                  <AlertTriangle className="w-3.5 h-3.5 text-primary" />
                  Tracking History ({s.webhookEvents.length} events)
                </h3>
                <div className="space-y-0">
                  {[...s.webhookEvents].reverse().map((evt, idx) => (
                    <div key={idx} className="flex items-start gap-3 text-[11px]">
                      <div className="flex flex-col items-center mt-0.5 flex-shrink-0">
                        <div className={`w-2.5 h-2.5 rounded-full ${
                          evt.status.includes("delivered") ? "bg-green-500"
                            : evt.status.includes("failed") ? "bg-red-500"
                            : evt.status.includes("collected") || evt.status.includes("collection") ? "bg-blue-500"
                            : evt.status.includes("transit") || evt.status.includes("out") ? "bg-purple-500"
                            : "bg-muted-foreground"
                        }`} />
                        {idx < s.webhookEvents.length - 1 && (
                          <div className="w-px h-6 bg-border mt-0.5" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0 pb-2">
                        <div className="flex items-center gap-2 flex-wrap">
                          <Badge variant="outline" className={`text-[9px] px-1.5 py-0 font-semibold ${statusBadgeStyle(evt.status)}`}>
                            {statusLabel(evt.status)}
                          </Badge>
                          <span className="text-muted-foreground/60">{fmtDateTime(evt.timestamp)}</span>
                          {evt.source && evt.source !== "shiplogic" && (
                            <span className="text-[9px] text-muted-foreground bg-muted/40 px-1.5 rounded">{evt.source}</span>
                          )}
                        </div>
                        {evt.message && <p className="text-muted-foreground mt-0.5">{evt.message}</p>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function InfoCell({ label, value, icon }: { label: string; value: string; icon?: React.ReactNode }) {
  return (
    <div className="p-2 rounded-md bg-muted/30">
      <p className="text-[10px] text-muted-foreground font-medium mb-0.5">{label}</p>
      <p className="text-[12px] font-semibold flex items-center gap-1">
        {icon}
        {value || "—"}
      </p>
    </div>
  );
}
