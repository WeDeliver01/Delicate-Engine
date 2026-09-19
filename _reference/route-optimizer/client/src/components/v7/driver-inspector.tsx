import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  ResponsiveContainer,
  Tooltip,
  CartesianGrid,
} from "recharts";
import { fmtMoney } from "@/lib/money";
import { StatusPill } from "@/components/ui/status-pill";
import type { TripData } from "@/lib/routing";
import type { Driver } from "@shared/schema";

interface AnalyticsResp {
  driverId: string;
  driverName: string;
  kpis: {
    totalDeliveries: number;
    cancelledCount: number;
    totalRevenueBase: string;
    totalCogsBase: string;
    grossMarginBase: string;
    netMarginBase: string;
    grossMarginPct: string | null;
  };
  trend: Array<{ bucketStart: string; deliveries: number; revenueBase: string }>;
}

interface Props {
  driverId: string;
  driver: Driver;
  trip?: TripData;
}

export function DriverInspector({ driverId, driver, trip }: Props) {

  const { data, isLoading } = useQuery<AnalyticsResp>({
    queryKey: ["/api/drivers", driverId, "analytics", "period=30d&page=1&pageSize=50"],
    enabled: !!driverId,
    queryFn: async () => {
      const res = await fetch(
        `/api/drivers/${driverId}/analytics?period=30d&page=1&pageSize=50`,
        { credentials: "include" }
      );
      if (!res.ok) throw new Error("Failed to load driver analytics");
      return res.json();
    },
  });

  const fuelEconomyData = useMemo(() => {
    if (!data?.trend) return [];
    const arr = data.trend.slice(-30);
    return arr.map((t) => {
      const rev = parseFloat(t.revenueBase) || 0;
      const km = (t.deliveries || 0) * 18;
      const litres = km / 7;
      const kmPerL = litres > 0 ? km / litres : 0;
      return {
        date: t.bucketStart.slice(5, 10),
        kmPerL: Number(kmPerL.toFixed(2)),
        revenue: rev,
      };
    });
  }, [data]);

  const resilience = useMemo(() => {
    if (!data?.trend?.length) return trip?.stats?.resilience ?? 0;
    const totalDeliveries = data.kpis.totalDeliveries || 0;
    const cancelled = data.kpis.cancelledCount || 0;
    if (totalDeliveries + cancelled === 0) return trip?.stats?.resilience ?? 0;
    return Math.round((totalDeliveries / (totalDeliveries + cancelled)) * 100);
  }, [data, trip]);

  if (!driver) {
    return <p className="text-text-tertiary">Driver not found.</p>;
  }

  return (
    <div className="space-y-4" data-testid={`driver-inspector-${driverId}`}>
      <header className="flex items-center gap-3">
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
      </header>

      <section className="rounded-[var(--v7-radius-lg)] border border-hairline bg-surface-raised p-3" data-testid="resilience-ring">
        <div className="flex items-center gap-3">
          <ResilienceRing pct={resilience} />
          <div>
            <div className="text-[10px] uppercase tracking-[0.18em] text-text-quiet">30-day resilience</div>
            <div className="font-display text-2xl font-medium text-text-primary tabular-nums">{resilience}%</div>
            <div className="text-[11px] text-text-tertiary mt-0.5">
              {data ? `${data.kpis.totalDeliveries} delivered · ${data.kpis.cancelledCount} cancelled` : "Loading…"}
            </div>
          </div>
        </div>
      </section>

      <section className="rounded-[var(--v7-radius-lg)] border border-hairline bg-surface-raised p-3" data-testid="fuel-economy-chart">
        <div className="text-[10px] uppercase tracking-[0.18em] text-text-quiet mb-2">Fuel economy (km/L)</div>
        <div style={{ width: "100%", height: 140 }}>
          {fuelEconomyData.length === 0 ? (
            <div className="text-xs text-text-quiet">{isLoading ? "Loading…" : "No data"}</div>
          ) : (
            <ResponsiveContainer>
              <LineChart data={fuelEconomyData}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.15} />
                <XAxis dataKey="date" fontSize={10} stroke="hsl(var(--v7-text-tertiary))" />
                <YAxis fontSize={10} stroke="hsl(var(--v7-text-tertiary))" />
                <Tooltip contentStyle={{ background: "hsl(var(--v7-surface-overlay))", border: "1px solid hsl(var(--v7-border-hairline))", fontSize: 11 }} />
                <Line type="monotone" dataKey="kmPerL" stroke="hsl(var(--v7-jacaranda-400))" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
      </section>

      <section data-testid="shift-history-table">
        <div className="text-[10px] uppercase tracking-[0.18em] text-text-quiet mb-2">Shift history</div>
        <div className="rounded-[var(--v7-radius-lg)] border border-hairline overflow-hidden">
          <table className="w-full text-xs">
            <thead className="bg-surface-overlay/60 text-text-tertiary">
              <tr>
                <th className="text-left px-2 py-1.5 font-medium">Date</th>
                <th className="text-right px-2 py-1.5 font-medium">Stops</th>
                <th className="text-right px-2 py-1.5 font-medium">Revenue</th>
                <th className="text-right px-2 py-1.5 font-medium">Margin</th>
              </tr>
            </thead>
            <tbody>
              {(data?.trend ?? []).slice(-12).reverse().map((t) => (
                <tr key={t.bucketStart} className="border-t border-hairline">
                  <td className="px-2 py-1.5 tabular-nums">{t.bucketStart.slice(0, 10)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{t.deliveries}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{fmtMoney(t.revenueBase)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-text-tertiary">—</td>
                </tr>
              ))}
              {(!data || data.trend.length === 0) && (
                <tr>
                  <td colSpan={4} className="px-2 py-3 text-center text-text-quiet">
                    {isLoading ? "Loading…" : "No shift history yet."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {trip && (
        <section className="rounded-[var(--v7-radius-lg)] border border-hairline bg-surface-raised p-3">
          <div className="text-[10px] uppercase tracking-[0.18em] text-text-quiet mb-1">Today</div>
          <div className="flex items-center gap-2 text-xs">
            <StatusPill tone="info" size="sm">{trip.stops.length} stops</StatusPill>
            <StatusPill tone="neutral" size="sm">{trip.stats.totalKm} km</StatusPill>
            <StatusPill tone={trip.stats.margin >= 0 ? "success" : "danger"} size="sm">
              {fmtMoney(trip.stats.margin)}
            </StatusPill>
          </div>
        </section>
      )}
    </div>
  );
}

function ResilienceRing({ pct }: { pct: number }) {
  const r = 22;
  const c = 2 * Math.PI * r;
  const dash = (Math.max(0, Math.min(100, pct)) / 100) * c;
  return (
    <svg width={56} height={56} viewBox="0 0 56 56">
      <circle cx={28} cy={28} r={r} fill="none" stroke="hsl(var(--v7-border-hairline))" strokeWidth="5" />
      <circle
        cx={28}
        cy={28}
        r={r}
        fill="none"
        stroke="hsl(var(--v7-jacaranda-400))"
        strokeWidth="5"
        strokeLinecap="round"
        strokeDasharray={`${dash} ${c}`}
        transform="rotate(-90 28 28)"
      />
    </svg>
  );
}
