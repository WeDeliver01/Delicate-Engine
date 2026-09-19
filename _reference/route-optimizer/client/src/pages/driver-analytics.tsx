import { useEffect, useMemo, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Download, FileText, RefreshCw, ArrowDownAZ, ArrowUpZA, Sheet as SheetIcon } from "lucide-react";
import { DriverAnalyticsView, type AnalyticsViewData } from "@/components/driver-analytics-view";
import { useAuth } from "@/hooks/use-auth";

const FLEET_ROLES = new Set(["admin", "manager", "ops", "dispatcher"]);

type Period = "7d" | "this_week" | "this_month" | "30d" | "ytd" | "12m" | "custom";

interface DriverListItem { id: string; name: string; active: boolean; employeeNumber: string }
interface AnalyticsResp extends AnalyticsViewData {
  driverId: string;
  driverName: string;
  period: { type: string; startUtc: string; endUtc: string; bucket: string; tz: string; label: string };
}

interface FleetDriverRow {
  driverId: string;
  driverName: string;
  active: boolean;
  driverAccountId: number | null;
  accountOnly: boolean;
  deliveries: number;
  cancelled: number;
  revenueBase: string;
  cogsBase: string;
  shipmentExpensesBase: string;
  fuelExpense: string;
  otherVehicleExpenses: string;
  vehicleExpenses: string;
  totalExpensesBase: string;
  grossMarginBase: string;
  netMarginBase: string;
  grossMarginPct: string | null;
  netMarginPct: string | null;
  distanceKm: string;
  fuelLitres: string;
  costPerKm: string | null;
  costPerDelivery: string | null;
  litresPer100Km: string | null;
  avgRevenuePerDelivery: string | null;
  tripCount: number;
  closedTripCount: number;
}

type FleetSortKey =
  | "driverName" | "deliveries" | "cancelled"
  | "revenueBase" | "cogsBase" | "shipmentExpensesBase"
  | "fuelExpense" | "otherVehicleExpenses" | "vehicleExpenses"
  | "totalExpensesBase" | "grossMarginBase" | "netMarginBase"
  | "grossMarginPct" | "netMarginPct"
  | "distanceKm" | "fuelLitres" | "costPerKm" | "costPerDelivery"
  | "litresPer100Km" | "avgRevenuePerDelivery"
  | "tripCount" | "closedTripCount";

type FleetSortDir = "asc" | "desc";

interface FleetSummaryResp {
  baseCurrency: string;
  drivers: FleetDriverRow[];
  cached?: boolean;
  sort?: FleetSortKey;
  dir?: FleetSortDir;
  period?: { startUtc: string; endUtc: string; bucket: string; tz: string };
}

const FLEET_SORTABLE: Array<{ key: FleetSortKey; label: string; numeric: boolean }> = [
  { key: "driverName", label: "Driver", numeric: false },
  { key: "deliveries", label: "Deliveries", numeric: true },
  { key: "cancelled", label: "Cancelled", numeric: true },
  { key: "revenueBase", label: "Revenue", numeric: true },
  { key: "cogsBase", label: "COGS", numeric: true },
  { key: "shipmentExpensesBase", label: "Shipment Exp", numeric: true },
  { key: "fuelExpense", label: "Fuel Exp", numeric: true },
  { key: "otherVehicleExpenses", label: "Other Veh Exp", numeric: true },
  { key: "vehicleExpenses", label: "Vehicle Exp", numeric: true },
  { key: "totalExpensesBase", label: "Total Exp", numeric: true },
  { key: "grossMarginBase", label: "Gross", numeric: true },
  { key: "netMarginBase", label: "Net", numeric: true },
  { key: "grossMarginPct", label: "Gross %", numeric: true },
  { key: "netMarginPct", label: "Net %", numeric: true },
  { key: "distanceKm", label: "Distance (km)", numeric: true },
  { key: "fuelLitres", label: "Fuel (L)", numeric: true },
  { key: "costPerKm", label: "Cost/km", numeric: true },
  { key: "costPerDelivery", label: "Cost/Del", numeric: true },
  { key: "litresPer100Km", label: "L/100km", numeric: true },
  { key: "avgRevenuePerDelivery", label: "Avg Rev/Del", numeric: true },
  { key: "tripCount", label: "Trips", numeric: true },
  { key: "closedTripCount", label: "Closed", numeric: true },
];

const VALID_SORT_KEYS = new Set<string>(FLEET_SORTABLE.map((c) => c.key));

function readSortFromUrl(): { sort: FleetSortKey; dir: FleetSortDir } {
  if (typeof window === "undefined") return { sort: "revenueBase", dir: "desc" };
  const params = new URLSearchParams(window.location.search);
  const rawSort = params.get("fleetSort") || "";
  const rawDir = params.get("fleetDir") || "";
  const sort = (VALID_SORT_KEYS.has(rawSort) ? rawSort : "revenueBase") as FleetSortKey;
  const dir: FleetSortDir = rawDir === "asc" ? "asc" : "desc";
  return { sort, dir };
}

function writeSortToUrl(sort: FleetSortKey, dir: FleetSortDir): void {
  if (typeof window === "undefined") return;
  const params = new URLSearchParams(window.location.search);
  params.set("fleetSort", sort);
  params.set("fleetDir", dir);
  const newUrl = `${window.location.pathname}?${params.toString()}${window.location.hash}`;
  window.history.replaceState({}, "", newUrl);
}

export default function DriverAnalytics() {
  const { user } = useAuth();
  const canSeeFleet = !!user?.role && FLEET_ROLES.has(user.role);
  const [tab, setTab] = useState<"driver" | "fleet">("driver");
  useEffect(() => {
    if (!canSeeFleet && tab === "fleet") setTab("driver");
  }, [canSeeFleet, tab]);
  const [driverId, setDriverId] = useState<string>("");
  const [driverSearch, setDriverSearch] = useState("");
  const [period, setPeriod] = useState<Period>("7d");
  const [customStart, setCustomStart] = useState<string>("");
  const [customEnd, setCustomEnd] = useState<string>("");
  const [page, setPage] = useState<number>(1);
  const PAGE_SIZE = 50;

  const initialSort = useMemo(readSortFromUrl, []);
  const [fleetSort, setFleetSort] = useState<FleetSortKey>(initialSort.sort);
  const [fleetDir, setFleetDir] = useState<FleetSortDir>(initialSort.dir);
  const [manuallyRefreshing, setManuallyRefreshing] = useState(false);

  useEffect(() => { writeSortToUrl(fleetSort, fleetDir); }, [fleetSort, fleetDir]);

  const { data: driversList } = useQuery<{ drivers: DriverListItem[] }>({
    queryKey: ["/api/drivers/analytics/list"],
  });

  const allDrivers = driversList?.drivers || [];
  const drivers = useMemo(() => {
    const q = driverSearch.trim().toLowerCase();
    if (!q) return allDrivers;
    return allDrivers.filter(d => d.name.toLowerCase().includes(q) || d.employeeNumber.toLowerCase().includes(q));
  }, [allDrivers, driverSearch]);
  const effectiveDriver = driverId || drivers[0]?.id || allDrivers[0]?.id || "";

  useEffect(() => { setPage(1); }, [effectiveDriver, period, customStart, customEnd]);

  const [lastEndUtc, setLastEndUtc] = useState<string | null>(null);
  const periodIsLive = lastEndUtc
    ? new Date(lastEndUtc).getTime() > Date.now()
    : period !== "custom";
  const refetchMs: number | false = periodIsLive ? 5000 : false;

  const queryKey = useMemo(() => {
    const params = new URLSearchParams({ period, page: String(page), pageSize: String(PAGE_SIZE) });
    if (period === "custom" && customStart && customEnd) {
      params.set("start", customStart);
      params.set("end", customEnd);
    }
    return ["/api/drivers", effectiveDriver, "analytics", params.toString()];
  }, [effectiveDriver, period, customStart, customEnd, page]);

  const customRangeReady = period !== "custom" || (!!customStart && !!customEnd && customStart <= customEnd);

  const { data, isLoading, refetch } = useQuery<AnalyticsResp>({
    queryKey,
    enabled: !!effectiveDriver && tab === "driver" && customRangeReady,
    refetchInterval: refetchMs,
    refetchIntervalInBackground: false,
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const params = new URLSearchParams({ period, page: String(page), pageSize: String(PAGE_SIZE) });
      if (period === "custom" && customStart && customEnd) { params.set("start", customStart); params.set("end", customEnd); }
      const res = await fetch(`/api/drivers/${effectiveDriver}/analytics?${params}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load analytics");
      return res.json();
    },
  });

  const fleetQueryKey = useMemo(() => {
    const params = new URLSearchParams({ period, sort: fleetSort, dir: fleetDir });
    if (period === "custom" && customStart && customEnd) { params.set("start", customStart); params.set("end", customEnd); }
    return ["/api/drivers/analytics/fleet", params.toString()];
  }, [period, customStart, customEnd, fleetSort, fleetDir]);

  const { data: fleet, isLoading: fleetLoading, refetch: refetchFleet } = useQuery<FleetSummaryResp>({
    queryKey: fleetQueryKey,
    enabled: tab === "fleet" && canSeeFleet && customRangeReady,
    refetchInterval: refetchMs,
    refetchIntervalInBackground: false,
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const params = new URLSearchParams({ period, sort: fleetSort, dir: fleetDir });
      if (period === "custom" && customStart && customEnd) { params.set("start", customStart); params.set("end", customEnd); }
      const res = await fetch(`/api/drivers/analytics/fleet?${params}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load fleet leaderboard");
      return res.json();
    },
  });

  useEffect(() => {
    const ep = data?.period?.endUtc || fleet?.period?.endUtc;
    if (ep && ep !== lastEndUtc) setLastEndUtc(ep);
  }, [data?.period?.endUtc, fleet?.period?.endUtc, lastEndUtc]);

  const exportUrl = (kind: "csv" | "pdf" | "xlsx") => {
    const params = new URLSearchParams({ period });
    if (period === "custom" && customStart && customEnd) { params.set("start", customStart); params.set("end", customEnd); }
    return `/api/drivers/${effectiveDriver}/analytics/export.${kind}?${params}`;
  };
  const fleetExportUrl = (kind: "csv" | "pdf" | "xlsx") => {
    const params = new URLSearchParams({ period, sort: fleetSort, dir: fleetDir });
    if (period === "custom" && customStart && customEnd) { params.set("start", customStart); params.set("end", customEnd); }
    return `/api/drivers/analytics/fleet/export.${kind}?${params}`;
  };

  return (
    <div className="p-6 space-y-6 flex-1 min-h-0 overflow-y-auto" data-testid="page-driver-analytics">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-2xl font-bold" data-testid="text-page-title">Driver Analytics</h2>
          <p className="text-sm text-muted-foreground">Per-driver revenue, costs & vehicle KPIs · auto-refresh every 5s on live periods</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {tab === "driver" && (
            <>
              <Input
                placeholder="Search driver…"
                value={driverSearch}
                onChange={(e) => setDriverSearch(e.target.value)}
                className="w-[160px]"
                data-testid="input-driver-search"
              />
              <Select value={effectiveDriver} onValueChange={setDriverId}>
                <SelectTrigger className="w-[220px]" data-testid="select-driver"><SelectValue placeholder="Select driver" /></SelectTrigger>
                <SelectContent>
                  {drivers.length === 0 && <div className="p-2 text-xs text-muted-foreground">No matching drivers</div>}
                  {drivers.map((d) => (
                    <SelectItem key={d.id} value={d.id} data-testid={`option-driver-${d.id}`}>
                      {d.name}{!d.active && " (inactive)"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </>
          )}
          <Select value={period} onValueChange={(v) => setPeriod(v as Period)}>
            <SelectTrigger className="w-[160px]" data-testid="select-period"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="7d">Last 7 days</SelectItem>
              <SelectItem value="this_week">This week</SelectItem>
              <SelectItem value="this_month">This month</SelectItem>
              <SelectItem value="30d">Last 30 days</SelectItem>
              <SelectItem value="ytd">Year to date</SelectItem>
              <SelectItem value="12m">Last 12 months</SelectItem>
              <SelectItem value="custom">Custom range</SelectItem>
            </SelectContent>
          </Select>
          {period === "custom" && (
            <>
              <Input type="date" value={customStart} onChange={(e) => setCustomStart(e.target.value)} className="w-[150px]" data-testid="input-start-date" />
              <Input type="date" value={customEnd} onChange={(e) => setCustomEnd(e.target.value)} className="w-[150px]" data-testid="input-end-date" />
            </>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={async () => {
              setManuallyRefreshing(true);
              try {
                await (tab === "driver" ? refetch() : refetchFleet());
              } finally {
                setManuallyRefreshing(false);
              }
            }}
            disabled={manuallyRefreshing}
            data-testid="button-refresh"
          >
            <RefreshCw className={`h-4 w-4 ${manuallyRefreshing ? "animate-spin" : ""}`} />
          </Button>
          {tab === "driver" ? (
            <>
              <Button variant="outline" size="sm" asChild disabled={!effectiveDriver} data-testid="button-export-csv">
                <a href={exportUrl("csv")}><Download className="h-4 w-4 mr-1" /> CSV</a>
              </Button>
              <Button variant="outline" size="sm" asChild disabled={!effectiveDriver} data-testid="button-export-xlsx">
                <a href={exportUrl("xlsx")}><SheetIcon className="h-4 w-4 mr-1" /> XLSX</a>
              </Button>
              <Button variant="outline" size="sm" asChild disabled={!effectiveDriver} data-testid="button-export-pdf">
                <a href={exportUrl("pdf")}><FileText className="h-4 w-4 mr-1" /> PDF</a>
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" size="sm" asChild data-testid="button-fleet-export-csv">
                <a href={fleetExportUrl("csv")}><Download className="h-4 w-4 mr-1" /> CSV</a>
              </Button>
              <Button variant="outline" size="sm" asChild data-testid="button-fleet-export-xlsx">
                <a href={fleetExportUrl("xlsx")}><SheetIcon className="h-4 w-4 mr-1" /> XLSX</a>
              </Button>
              <Button variant="outline" size="sm" asChild data-testid="button-fleet-export-pdf">
                <a href={fleetExportUrl("pdf")}><FileText className="h-4 w-4 mr-1" /> PDF</a>
              </Button>
            </>
          )}
        </div>
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as "driver" | "fleet")}>
        <TabsList>
          <TabsTrigger value="driver" data-testid="tab-driver">Per Driver</TabsTrigger>
          {canSeeFleet && <TabsTrigger value="fleet" data-testid="tab-fleet">Fleet Leaderboard</TabsTrigger>}
        </TabsList>

        <TabsContent value="driver" className="mt-4">
          {!effectiveDriver && (
            <Card><CardContent className="py-10 text-center text-muted-foreground" data-testid="text-no-drivers">
              No drivers available. Run backfill or import shipment data.
            </CardContent></Card>
          )}
          {effectiveDriver && isLoading && !data && (
            <Card><CardContent className="py-10 text-center text-muted-foreground" data-testid="status-loading">Loading analytics…</CardContent></Card>
          )}
          {data && <DriverAnalyticsView data={data} variant="dispatch" onPageChange={setPage} />}
        </TabsContent>

        <TabsContent value="fleet" className="mt-4">
          <FleetLeaderboard
            data={fleet}
            loading={fleetLoading}
            sortKey={fleetSort}
            sortDir={fleetDir}
            onSort={(key) => {
              if (key === fleetSort) {
                setFleetDir(fleetDir === "asc" ? "desc" : "asc");
              } else {
                setFleetSort(key);
                setFleetDir(FLEET_SORTABLE.find((c) => c.key === key)?.numeric ? "desc" : "asc");
              }
            }}
            onSelectDriver={(id, accountOnly) => {
              if (accountOnly) return;
              setDriverId(id); setTab("driver");
            }}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function fmtMoney(v: string | number | null | undefined, currency = "ZAR") {
  if (v == null) return "—";
  const n = typeof v === "number" ? v : parseFloat(v);
  if (!isFinite(n)) return "—";
  try { return new Intl.NumberFormat("en-ZA", { style: "currency", currency, maximumFractionDigits: 2 }).format(n); }
  catch { return `${currency} ${n.toFixed(2)}`; }
}

function FleetLeaderboard({
  data, loading, sortKey, sortDir, onSort, onSelectDriver,
}: {
  data?: FleetSummaryResp;
  loading: boolean;
  sortKey: FleetSortKey;
  sortDir: FleetSortDir;
  onSort: (key: FleetSortKey) => void;
  onSelectDriver: (id: string, accountOnly: boolean) => void;
}) {
  const rows = data?.drivers ?? [];

  if (loading && !data) {
    return <Card><CardContent className="py-10 text-center text-muted-foreground" data-testid="status-fleet-loading">Loading fleet leaderboard…</CardContent></Card>;
  }
  if (!data || data.drivers.length === 0) {
    return <Card><CardContent className="py-10 text-center text-muted-foreground" data-testid="text-no-fleet-data">No drivers in this period.</CardContent></Card>;
  }
  const currency = data.baseCurrency || "ZAR";

  return (
    <Card>
      <CardContent className="overflow-x-auto py-4">
        <div className="flex items-center justify-between mb-2">
          <div className="text-xs text-muted-foreground" data-testid="text-fleet-meta">
            {data.drivers.length} drivers · sorted by <span className="font-medium">{FLEET_SORTABLE.find((c) => c.key === sortKey)?.label}</span> {sortDir === "asc" ? "↑" : "↓"}
          </div>
          {data.cached && <Badge variant="outline" className="text-[10px]" data-testid="badge-fleet-cached">cached</Badge>}
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              {FLEET_SORTABLE.map((c) => (
                <TableHead
                  key={c.key}
                  className={`whitespace-nowrap cursor-pointer select-none ${c.numeric ? "text-right" : ""}`}
                  onClick={() => onSort(c.key)}
                  data-testid={`th-fleet-${c.key}`}
                >
                  <span className="inline-flex items-center gap-1">
                    {c.label}
                    {sortKey === c.key && (sortDir === "asc" ? <ArrowUpZA className="h-3 w-3" /> : <ArrowDownAZ className="h-3 w-3" />)}
                  </span>
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow
                key={r.driverId}
                className={`hover:bg-muted/40 ${r.accountOnly ? "opacity-75" : "cursor-pointer"}`}
                onClick={() => onSelectDriver(r.driverId, r.accountOnly)}
                title={r.accountOnly ? "Vehicle-log activity only — no per-driver analytics view available." : undefined}
                data-testid={`row-fleet-${r.driverId}`}
              >
                <TableCell className="font-medium">
                  {r.driverName}
                  {!r.active && <Badge variant="outline" className="ml-1 text-[10px]">inactive</Badge>}
                  {r.accountOnly && <Badge variant="outline" className="ml-1 text-[10px]" data-testid={`badge-account-only-${r.driverId}`}>vehicle-log only</Badge>}
                </TableCell>
                <TableCell className="text-right">{r.deliveries}</TableCell>
                <TableCell className="text-right">{r.cancelled}</TableCell>
                <TableCell className="text-right text-xs">{fmtMoney(r.revenueBase, currency)}</TableCell>
                <TableCell className="text-right text-xs">{fmtMoney(r.cogsBase, currency)}</TableCell>
                <TableCell className="text-right text-xs">{fmtMoney(r.shipmentExpensesBase, currency)}</TableCell>
                <TableCell className="text-right text-xs">{fmtMoney(r.fuelExpense, currency)}</TableCell>
                <TableCell className="text-right text-xs">{fmtMoney(r.otherVehicleExpenses, currency)}</TableCell>
                <TableCell className="text-right text-xs">{fmtMoney(r.vehicleExpenses, currency)}</TableCell>
                <TableCell className="text-right text-xs">{fmtMoney(r.totalExpensesBase, currency)}</TableCell>
                <TableCell className="text-right text-xs">{fmtMoney(r.grossMarginBase, currency)}</TableCell>
                <TableCell className="text-right text-xs">{fmtMoney(r.netMarginBase, currency)}</TableCell>
                <TableCell className="text-right text-xs">{r.grossMarginPct == null ? "—" : `${r.grossMarginPct}%`}</TableCell>
                <TableCell className="text-right text-xs">{r.netMarginPct == null ? "—" : `${r.netMarginPct}%`}</TableCell>
                <TableCell className="text-right text-xs">{Number(r.distanceKm).toFixed(1)}</TableCell>
                <TableCell className="text-right text-xs">{Number(r.fuelLitres).toFixed(1)}</TableCell>
                <TableCell className="text-right text-xs">{r.costPerKm == null ? "—" : fmtMoney(r.costPerKm, currency)}</TableCell>
                <TableCell className="text-right text-xs">{r.costPerDelivery == null ? "—" : fmtMoney(r.costPerDelivery, currency)}</TableCell>
                <TableCell className="text-right text-xs">{r.litresPer100Km == null ? "—" : Number(r.litresPer100Km).toFixed(1)}</TableCell>
                <TableCell className="text-right text-xs">{r.avgRevenuePerDelivery == null ? "—" : fmtMoney(r.avgRevenuePerDelivery, currency)}</TableCell>
                <TableCell className="text-right">{r.tripCount}</TableCell>
                <TableCell className="text-right">{r.closedTripCount}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
