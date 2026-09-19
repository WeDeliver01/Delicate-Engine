import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, PieChart, Pie, Cell } from "recharts";
import { Loader2, Database, Activity } from "lucide-react";
import { useDispatchExtras } from "@/hooks/use-dispatch-data";
import { PanelHeader } from "./profile-panel";

interface ApiCallCount { total: number; cacheHits: number; errors: number; billable: number; }
interface ApiUsageReport {
  date: string;
  summary: Record<string, ApiCallCount>;
  recent: { type: string; cached: boolean; error: boolean; time: string }[];
  caches: Record<string, number>;
}

const PRICE_USD_PER_CALL: Record<string, number> = {
  routes_traffic: 0.005,
  routes_basic: 0.005,
  places_autocomplete: 0.00283,
  places_details: 0.017,
  geocoding: 0.005,
};
const DEFAULT_PRICE = 0.005;
const ZAR_PER_USD = 18.5;

function fmtZAR(value: number): string {
  try {
    return new Intl.NumberFormat("en-ZA", { style: "currency", currency: "ZAR", maximumFractionDigits: 2 }).format(value);
  } catch {
    return `R ${value.toFixed(2)}`;
  }
}

function prettyType(t: string): string {
  return t.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function ApiUsagePanel() {
  const { data, isLoading } = useQuery<ApiUsageReport>({
    queryKey: ["/api/admin/api-usage"],
    refetchInterval: 30_000,
  });

  const summary = data?.summary ?? {};
  const totals = useMemo(() => {
    let total = 0, billable = 0, cacheHits = 0, errors = 0, costUsd = 0;
    for (const [type, c] of Object.entries(summary)) {
      total += c.total; billable += c.billable; cacheHits += c.cacheHits; errors += c.errors;
      const price = PRICE_USD_PER_CALL[type] ?? DEFAULT_PRICE;
      costUsd += c.billable * price;
    }
    const cacheRate = total > 0 ? cacheHits / total : 0;
    return { total, billable, cacheHits, errors, costZar: costUsd * ZAR_PER_USD, cacheRate };
  }, [summary]);

  const breakdown = useMemo(
    () => Object.entries(summary)
      .map(([type, c]) => ({ type: prettyType(type), total: c.total, cacheHits: c.cacheHits, billable: c.billable }))
      .sort((a, b) => b.total - a.total),
    [summary],
  );

  const cacheData = [
    { name: "Cache hits", value: totals.cacheHits, fill: "hsl(var(--v7-jacaranda-400))" },
    { name: "Billable", value: totals.billable, fill: "hsl(var(--v7-border-soft))" },
  ];

  return (
    <div className="space-y-6" data-testid="v7-settings-api-usage">
      <PanelHeader
        title="API usage"
        subtitle="Live counters for Google Maps API consumption today, with cost estimates in ZAR."
      />

      {isLoading && !data ? (
        <div className="flex items-center gap-2 text-text-secondary text-sm">
          <Loader2 className="size-4 animate-spin" /> Loading usage…
        </div>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <BigStat label="Google calls today" value={totals.total.toLocaleString("en-ZA")} testid="v7-api-total-calls" />
            <BigStat label="Billable" value={totals.billable.toLocaleString("en-ZA")} testid="v7-api-billable" />
            <BigStat label="Estimated cost" value={fmtZAR(totals.costZar)} testid="v7-api-cost" accent />
            <BigStat label="Errors" value={totals.errors.toLocaleString("en-ZA")} testid="v7-api-errors" />
          </div>

          <div className="grid gap-6 lg:grid-cols-3">
            <div className="lg:col-span-2 rounded-[var(--v7-radius-lg,12px)] border border-hairline bg-surface-raised p-5">
              <div className="flex items-center gap-2 mb-3">
                <Activity className="size-4 text-text-tertiary" />
                <p className="text-[13px] font-medium text-text-primary">Calls by type</p>
              </div>
              <div style={{ width: "100%", height: 240 }} data-testid="v7-api-bar-chart">
                <ResponsiveContainer>
                  <BarChart data={breakdown}>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.25} />
                    <XAxis dataKey="type" fontSize={11} stroke="hsl(var(--v7-text-tertiary))" />
                    <YAxis fontSize={11} stroke="hsl(var(--v7-text-tertiary))" />
                    <Tooltip contentStyle={{ background: "hsl(var(--v7-surface-overlay))", border: "1px solid hsl(var(--v7-border-hairline))", color: "hsl(var(--v7-text-primary))" }} />
                    <Bar dataKey="cacheHits" stackId="a" fill="hsl(var(--v7-jacaranda-400))" name="Cache hits" />
                    <Bar dataKey="billable" stackId="a" fill="hsl(var(--v7-jacaranda-700))" name="Billable" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              {!breakdown.length && (
                <p className="text-[12px] text-text-secondary text-center py-6">No API activity recorded yet today.</p>
              )}
            </div>

            <div className="rounded-[var(--v7-radius-lg,12px)] border border-hairline bg-surface-raised p-5">
              <div className="flex items-center gap-2 mb-3">
                <Database className="size-4 text-text-tertiary" />
                <p className="text-[13px] font-medium text-text-primary">Cache hit rate</p>
              </div>
              <div className="relative" style={{ width: "100%", height: 200 }} data-testid="v7-api-ring-chart">
                <ResponsiveContainer>
                  <PieChart>
                    <Pie data={cacheData} dataKey="value" innerRadius={62} outerRadius={86} startAngle={90} endAngle={-270} paddingAngle={2}>
                      {cacheData.map((entry, i) => <Cell key={i} fill={entry.fill} />)}
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>
                <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                  <p className="font-display text-[28px] text-text-primary leading-none" data-testid="v7-api-cache-rate">
                    {Math.round(totals.cacheRate * 100)}%
                  </p>
                  <p className="text-[10px] uppercase tracking-[0.18em] text-text-quiet mt-1">Cache</p>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2 mt-2 text-[11px]">
                <Legend swatch="hsl(var(--v7-jacaranda-400))" label={`${totals.cacheHits} cache hits`} />
                <Legend swatch="hsl(var(--v7-border-soft))" label={`${totals.billable} billable`} />
              </div>
            </div>
          </div>

          {data?.caches && Object.keys(data.caches).length > 0 && (
            <div className="rounded-[var(--v7-radius-md,8px)] border border-hairline bg-surface-raised p-5" data-testid="v7-api-cache-sizes">
              <p className="text-[13px] font-medium text-text-primary mb-3">In-memory caches</p>
              <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-4">
                {Object.entries(data.caches).map(([k, v]) => (
                  <div key={k} className="flex items-baseline justify-between border-b border-hairline pb-1">
                    <span className="text-[11px] uppercase tracking-[0.14em] text-text-quiet">{k}</span>
                    <span className="font-mono text-[13px] text-text-primary tabular-nums">{v}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function BigStat({ label, value, testid, accent }: { label: string; value: string; testid: string; accent?: boolean }) {
  return (
    <div
      className={`rounded-[var(--v7-radius-md,8px)] border border-hairline px-4 py-4 ${accent ? "bg-jacaranda-gradient text-ivory" : "bg-surface-raised"}`}
      data-testid={testid}
    >
      <p className={`text-[10px] uppercase tracking-[0.18em] ${accent ? "text-ivory/80" : "text-text-quiet"}`}>{label}</p>
      <p className={`mt-1 font-display text-[28px] leading-none ${accent ? "text-ivory" : "text-text-primary"}`}>{value}</p>
    </div>
  );
}

function Legend({ swatch, label }: { swatch: string; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="size-2.5 rounded-sm" style={{ background: swatch }} />
      <span className="text-text-secondary">{label}</span>
    </div>
  );
}
