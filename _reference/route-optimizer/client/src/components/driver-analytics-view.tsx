import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle } from "lucide-react";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from "recharts";

export interface AnalyticsKpis {
  totalDeliveries: number; cancelledCount: number;
  totalRevenueBase: string; totalCogsBase: string; totalExpensesBase: string;
  grossMarginBase: string; netMarginBase: string;
  grossMarginPct: string | null; netMarginPct: string | null;
  avgRevenuePerDelivery: string | null;
  missingCogsCount: number;
  missingExpensesCount: number;
  distanceKm?: string;
  fuelLitres?: string;
  fuelExpense?: string;
  otherVehicleExpenses?: string;
  vehicleExpenses?: string;
  costPerKm?: string | null;
  costPerDelivery?: string | null;
  litresPer100Km?: string | null;
  tripCount?: number;
  closedTripCount?: number;
}
export interface AnalyticsShipment {
  id: string; waybill: string; deliveryDate: string; status: string;
  currency: string; revenue: string; cogs: string | null;
  revenueBase: string; cogsBase: string | null; expensesBase: string;
  grossMarginBase: string; netMarginBase: string;
  grossMarginPct: string | null; netMarginPct: string | null;
  missingCogs: boolean; missingExpenses: boolean; cancelled: boolean;
}
export interface AnalyticsTrend {
  bucketStart: string; deliveries: number; revenueBase: string;
  distanceKm?: string; fuelExpense?: string;
}
export interface AnalyticsViewData {
  baseCurrency: string;
  kpis: AnalyticsKpis;
  shipments: AnalyticsShipment[];
  shipmentsTotalCount?: number;
  shipmentsPage?: number;
  shipmentsPageSize?: number;
  trend: AnalyticsTrend[];
  cached?: boolean;
}

function fmtMoney(v: string | number | null | undefined, currency = "ZAR") {
  if (v == null) return "—";
  const n = typeof v === "number" ? v : parseFloat(v);
  if (!isFinite(n)) return "—";
  try { return new Intl.NumberFormat("en-ZA", { style: "currency", currency, maximumFractionDigits: 2 }).format(n); }
  catch { return `${currency} ${n.toFixed(2)}`; }
}

function fmtNum(v: string | number | null | undefined, suffix = "", places = 1) {
  if (v == null) return "—";
  const n = typeof v === "number" ? v : parseFloat(v);
  if (!isFinite(n)) return "—";
  return `${n.toLocaleString("en-ZA", { maximumFractionDigits: places, minimumFractionDigits: 0 })}${suffix}`;
}

interface Props {
  data: AnalyticsViewData;
  variant?: "dispatch" | "driver";
  onPageChange?: (page: number) => void;
}

export function DriverAnalyticsView({ data, variant = "dispatch", onPageChange }: Props) {
  const totalCount = data.shipmentsTotalCount ?? data.shipments.length;
  const pageSize = data.shipmentsPageSize ?? (data.shipments.length || 50);
  const currentPage = data.shipmentsPage ?? 1;
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const startIdx = (currentPage - 1) * pageSize;
  const endIdx = Math.min(startIdx + data.shipments.length, totalCount);
  const currency = data.baseCurrency || "ZAR";
  const isDriver = variant === "driver";
  const cardCls = isDriver ? "bg-slate-900 border-slate-800 text-white" : "";
  const kpiCls  = isDriver ? "bg-slate-900 border border-slate-800 text-white" : "";

  return (
    <div className="space-y-4" data-testid="view-driver-analytics">
      {(data.kpis.missingCogsCount > 0 || data.kpis.missingExpensesCount > 0) && (
        <div className="space-y-2">
          {data.kpis.missingCogsCount > 0 && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-amber-50 dark:bg-amber-950/40 text-amber-900 dark:text-amber-200 text-sm" data-testid="alert-missing-cogs">
              <AlertTriangle className="h-4 w-4" /> {data.kpis.missingCogsCount} delivered shipments are missing COGS data; gross margin understates true margin.
            </div>
          )}
          {data.kpis.missingExpensesCount > 0 && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-amber-50 dark:bg-amber-950/40 text-amber-900 dark:text-amber-200 text-sm" data-testid="alert-missing-expenses">
              <AlertTriangle className="h-4 w-4" /> {data.kpis.missingExpensesCount} delivered shipments have no allocated expenses; net margin may overstate true margin.
            </div>
          )}
        </div>
      )}

      <div className="grid gap-3 grid-cols-2 md:grid-cols-3 lg:grid-cols-7">
        <Kpi label="Deliveries" value={String(data.kpis.totalDeliveries)} testid="kpi-deliveries" cls={kpiCls} />
        <Kpi label="Cancelled" value={String(data.kpis.cancelledCount)} testid="kpi-cancelled" cls={kpiCls} />
        <Kpi label="Revenue" value={fmtMoney(data.kpis.totalRevenueBase, currency)} testid="kpi-revenue" cls={kpiCls} />
        <Kpi label="COGS" value={fmtMoney(data.kpis.totalCogsBase, currency)} testid="kpi-cogs" cls={kpiCls} />
        <Kpi label="Expenses" value={fmtMoney(data.kpis.totalExpensesBase, currency)} testid="kpi-expenses" cls={kpiCls} />
        <Kpi label="Gross Margin" value={fmtMoney(data.kpis.grossMarginBase, currency)} sub={data.kpis.grossMarginPct ? `${data.kpis.grossMarginPct}%` : undefined} testid="kpi-gross-margin" cls={kpiCls} />
        <Kpi label="Net Margin" value={fmtMoney(data.kpis.netMarginBase, currency)} sub={data.kpis.netMarginPct ? `${data.kpis.netMarginPct}%` : undefined} testid="kpi-net-margin" cls={kpiCls} />
      </div>

      <div className="grid gap-3 grid-cols-2 md:grid-cols-3 lg:grid-cols-8">
        <Kpi label="Distance" value={fmtNum(data.kpis.distanceKm, " km", 1)} sub={data.kpis.tripCount != null ? `${data.kpis.closedTripCount ?? 0}/${data.kpis.tripCount} trips closed` : undefined} testid="kpi-distance" cls={kpiCls} />
        <Kpi label="Fuel Litres" value={fmtNum(data.kpis.fuelLitres, " L", 1)} testid="kpi-fuel-litres" cls={kpiCls} />
        <Kpi label="Fuel Expense" value={fmtMoney(data.kpis.fuelExpense, currency)} testid="kpi-fuel-expense" cls={kpiCls} />
        <Kpi label="Other Vehicle Exp" value={fmtMoney(data.kpis.otherVehicleExpenses, currency)} testid="kpi-other-vehicle-exp" cls={kpiCls} />
        <Kpi label="Vehicle Expenses (Total)" value={fmtMoney(data.kpis.vehicleExpenses, currency)} testid="kpi-vehicle-expenses-total" cls={kpiCls} />
        <Kpi label="Cost / km" value={data.kpis.costPerKm == null ? "—" : fmtMoney(data.kpis.costPerKm, currency)} testid="kpi-cost-per-km" cls={kpiCls} />
        <Kpi label="Cost / Delivery" value={data.kpis.costPerDelivery == null ? "—" : fmtMoney(data.kpis.costPerDelivery, currency)} testid="kpi-cost-per-delivery" cls={kpiCls} />
        <Kpi label="L / 100km" value={fmtNum(data.kpis.litresPer100Km, " L", 1)} testid="kpi-litres-per-100km" cls={kpiCls} />
      </div>

      <Card className={cardCls}>
        <CardHeader><CardTitle className="text-base">Revenue, deliveries & vehicle trend</CardTitle></CardHeader>
        <CardContent>
          <div style={{ width: "100%", height: 280 }} data-testid="chart-trend">
            <ResponsiveContainer>
              <LineChart data={data.trend.map(t => ({
                date: t.bucketStart.slice(0, 10),
                revenue: parseFloat(t.revenueBase),
                deliveries: t.deliveries,
                distance: t.distanceKm ? parseFloat(t.distanceKm) : 0,
                fuel: t.fuelExpense ? parseFloat(t.fuelExpense) : 0,
              }))}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                <XAxis dataKey="date" fontSize={11} stroke={isDriver ? "#94a3b8" : undefined} />
                <YAxis yAxisId="rev" fontSize={11} orientation="left" stroke={isDriver ? "#94a3b8" : undefined} />
                <YAxis yAxisId="del" fontSize={11} orientation="right" stroke={isDriver ? "#94a3b8" : undefined} />
                <Tooltip contentStyle={isDriver ? { background: "#0f172a", border: "1px solid #334155", color: "#fff" } : undefined} />
                <Legend />
                <Line yAxisId="rev" type="monotone" dataKey="revenue" name={`Revenue (${currency})`} stroke="#2563eb" strokeWidth={2} dot={false} />
                <Line yAxisId="rev" type="monotone" dataKey="fuel" name={`Fuel (${currency})`} stroke="#f97316" strokeWidth={2} dot={false} />
                <Line yAxisId="del" type="monotone" dataKey="deliveries" name="Deliveries" stroke="#16a34a" strokeWidth={2} dot={false} />
                <Line yAxisId="del" type="monotone" dataKey="distance" name="Distance (km)" stroke="#a855f7" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      <Card className={cardCls}>
        <CardHeader>
          <CardTitle className="text-base flex items-center justify-between">
            <span>Shipments ({totalCount})</span>
            {data.cached && <Badge variant="outline" className="text-[10px]" data-testid="badge-cached">cached</Badge>}
          </CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Waybill</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Revenue</TableHead>
                <TableHead className="text-right">COGS</TableHead>
                <TableHead className="text-right">Expenses</TableHead>
                <TableHead className="text-right">Gross Margin</TableHead>
                <TableHead className="text-right">Gross %</TableHead>
                <TableHead className="text-right">Net Margin</TableHead>
                <TableHead className="text-right">Net %</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.shipments.map((s) => (
                <TableRow key={s.id} data-testid={`row-shipment-${s.id}`}>
                  <TableCell className="text-xs">{s.deliveryDate.slice(0, 10)}</TableCell>
                  <TableCell className="font-mono text-xs">{s.waybill}</TableCell>
                  <TableCell>
                    <Badge variant={s.cancelled ? "destructive" : "outline"} className="text-[10px]">{s.status}</Badge>
                    {s.missingCogs && <Badge variant="secondary" className="ml-1 text-[10px]" data-testid={`badge-missing-cogs-${s.id}`}>no COGS</Badge>}
                    {s.missingExpenses && <Badge variant="secondary" className="ml-1 text-[10px]" data-testid={`badge-missing-expenses-${s.id}`}>no exp</Badge>}
                  </TableCell>
                  <TableCell className="text-right text-xs">{fmtMoney(s.revenueBase, currency)}</TableCell>
                  <TableCell className="text-right text-xs">{s.cogsBase == null ? "—" : fmtMoney(s.cogsBase, currency)}</TableCell>
                  <TableCell className="text-right text-xs">{fmtMoney(s.expensesBase, currency)}</TableCell>
                  <TableCell className="text-right text-xs">{s.cogsBase == null ? "—" : fmtMoney(s.grossMarginBase, currency)}</TableCell>
                  <TableCell className="text-right text-xs">{s.grossMarginPct == null ? "—" : `${s.grossMarginPct}%`}</TableCell>
                  <TableCell className="text-right text-xs">{fmtMoney(s.netMarginBase, currency)}</TableCell>
                  <TableCell className="text-right text-xs">{s.netMarginPct == null ? "—" : `${s.netMarginPct}%`}</TableCell>
                </TableRow>
              ))}
              {data.shipments.length === 0 && (
                <TableRow><TableCell colSpan={10} className="text-center text-muted-foreground py-6" data-testid="text-no-shipments">No shipments in this period</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
          {totalCount > pageSize && onPageChange && (
            <div className="flex items-center justify-between mt-3 text-xs">
              <span data-testid="text-pagination-info">
                Showing {totalCount === 0 ? 0 : startIdx + 1}–{endIdx} of {totalCount}
              </span>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" disabled={currentPage <= 1} onClick={() => onPageChange(Math.max(1, currentPage - 1))} data-testid="button-prev-page">Prev</Button>
                <Button variant="outline" size="sm" disabled={currentPage >= totalPages} onClick={() => onPageChange(currentPage + 1)} data-testid="button-next-page">Next</Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Kpi({ label, value, sub, testid, cls }: { label: string; value: string; sub?: string; testid: string; cls?: string }) {
  return (
    <Card className={cls} data-testid={testid}>
      <CardContent className="py-3">
        <div className={`text-[11px] uppercase tracking-wide ${cls ? "text-slate-400" : "text-muted-foreground"}`}>{label}</div>
        <div className="text-lg font-semibold mt-0.5">{value}</div>
        {sub && <div className={`text-xs ${cls ? "text-slate-400" : "text-muted-foreground"}`}>{sub}</div>}
      </CardContent>
    </Card>
  );
}
