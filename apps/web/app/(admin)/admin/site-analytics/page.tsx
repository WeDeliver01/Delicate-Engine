"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Empty, PageHeader, Panel } from "@/components/ui";

interface Overview {
  from: string;
  to: string;
  sessions: number;
  pageviews: number;
  uniqueVisitors: number;
  bounceRate: number;
  avgPageviewsPerSession: number;
}
interface DailyPoint {
  date: string;
  sessions: number;
  pageviews: number;
  uniqueVisitors: number;
}
interface TopPage {
  path: string;
  pageviews: number;
  uniqueVisitors: number;
}
interface Referrer {
  referrer: string;
  sessions: number;
}
interface Device {
  deviceType: string;
  sessions: number;
}
interface CustomEvent {
  name: string;
  count: number;
  uniqueVisitors: number;
}

/** Traffic and product events, worked out from our own rows instead of Google's dashboard. */
export default function AdminSiteAnalytics() {
  const [range, setRange] = useState(defaultRange());
  const q = `?from=${range.from}&to=${range.to}`;

  const overview = useQuery({
    queryKey: ["admin", "site-analytics", "overview", range],
    queryFn: () => api<Overview>(`/v1/admin/site-analytics/overview${q}`),
  });
  const daily = useQuery({
    queryKey: ["admin", "site-analytics", "daily", range],
    queryFn: () => api<DailyPoint[]>(`/v1/admin/site-analytics/daily${q}`),
  });
  const topPages = useQuery({
    queryKey: ["admin", "site-analytics", "top-pages", range],
    queryFn: () => api<TopPage[]>(`/v1/admin/site-analytics/top-pages${q}`),
  });
  const referrers = useQuery({
    queryKey: ["admin", "site-analytics", "referrers", range],
    queryFn: () => api<Referrer[]>(`/v1/admin/site-analytics/referrers${q}`),
  });
  const devices = useQuery({
    queryKey: ["admin", "site-analytics", "devices", range],
    queryFn: () => api<Device[]>(`/v1/admin/site-analytics/devices${q}`),
  });
  const events = useQuery({
    queryKey: ["admin", "site-analytics", "events", range],
    queryFn: () => api<CustomEvent[]>(`/v1/admin/site-analytics/events${q}`),
  });

  const d = overview.data;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Site analytics"
        lede="Visitors, pages and product moments, measured by our own beacon — not Google's."
        actions={
          <div className="flex items-center gap-2 text-sm">
            <input
              type="date"
              value={range.from}
              onChange={(e) => setRange({ ...range, from: e.target.value })}
              className="input py-1.5"
            />
            <span className="text-muted">to</span>
            <input
              type="date"
              value={range.to}
              onChange={(e) => setRange({ ...range, to: e.target.value })}
              className="input py-1.5"
            />
          </div>
        }
      />

      {d && (
        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <Tile label="Sessions" value={String(d.sessions)} />
          <Tile label="Pageviews" value={String(d.pageviews)} />
          <Tile label="Unique visitors" value={String(d.uniqueVisitors)} />
          <Tile label="Bounce rate" value={`${d.bounceRate}%`} hint="Single-page sessions" />
          <Tile label="Pages / session" value={d.avgPageviewsPerSession.toFixed(1)} />
        </section>
      )}

      {daily.data && daily.data.length > 0 && (
        <Panel title="Sessions and pageviews by day" className="p-5 sm:p-6">
          <Chart points={daily.data} />
        </Panel>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Top pages">
          {topPages.data?.length === 0 ? (
            <p className="table-empty">No pageviews in this range.</p>
          ) : (
            <table className="table-base">
              <thead>
                <tr>
                  <th>Path</th>
                  <th className="text-right">Views</th>
                  <th className="text-right">Visitors</th>
                </tr>
              </thead>
              <tbody>
                {topPages.data?.map((p) => (
                  <tr key={p.path}>
                    <td className="max-w-80 truncate">{p.path}</td>
                    <td className="figure text-right">{p.pageviews}</td>
                    <td className="figure text-right">{p.uniqueVisitors}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>

        <Panel title="Referrers">
          {referrers.data?.length === 0 ? (
            <p className="table-empty">No sessions in this range.</p>
          ) : (
            <table className="table-base">
              <thead>
                <tr>
                  <th>Source</th>
                  <th className="text-right">Sessions</th>
                </tr>
              </thead>
              <tbody>
                {referrers.data?.map((r) => (
                  <tr key={r.referrer}>
                    <td className="max-w-80 truncate">{r.referrer}</td>
                    <td className="figure text-right">{r.sessions}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>

        <Panel title="Devices">
          {devices.data?.length === 0 ? (
            <p className="table-empty">No sessions in this range.</p>
          ) : (
            <table className="table-base">
              <thead>
                <tr>
                  <th>Device</th>
                  <th className="text-right">Sessions</th>
                </tr>
              </thead>
              <tbody>
                {devices.data?.map((dv) => (
                  <tr key={dv.deviceType}>
                    <td className="capitalize">{dv.deviceType}</td>
                    <td className="figure text-right">{dv.sessions}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>

        <Panel title="Product events" description="Signups, bookings confirmed — not raw traffic.">
          {events.data?.length === 0 ? (
            <p className="table-empty">No custom events in this range.</p>
          ) : (
            <table className="table-base">
              <thead>
                <tr>
                  <th>Event</th>
                  <th className="text-right">Count</th>
                  <th className="text-right">Visitors</th>
                </tr>
              </thead>
              <tbody>
                {events.data?.map((e) => (
                  <tr key={e.name}>
                    <td>{e.name}</td>
                    <td className="figure text-right">{e.count}</td>
                    <td className="figure text-right">{e.uniqueVisitors}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>
      </div>
    </div>
  );
}

/** Same inline-SVG approach as the money reports page — no charting dependency for two lines. */
function Chart({ points }: { points: DailyPoint[] }) {
  const max = Math.max(1, ...points.map((p) => p.pageviews));
  const w = 100;
  const h = 34;
  const step = points.length > 1 ? w / (points.length - 1) : w;
  const line = (pick: (p: DailyPoint) => number) =>
    points
      .map((p, i) => `${(i * step).toFixed(2)},${(h - (pick(p) / max) * h).toFixed(2)}`)
      .join(" ");

  const totalSessions = points.reduce((s, p) => s + p.sessions, 0);
  const totalPageviews = points.reduce((s, p) => s + p.pageviews, 0);

  if (totalPageviews === 0) return <Empty>No traffic in this range yet.</Empty>;

  return (
    <div>
      <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="h-40 w-full" role="img">
        <title>Sessions and pageviews per day</title>
        <polyline
          points={line((p) => p.pageviews)}
          fill="none"
          stroke="#0A0A0A"
          strokeWidth="0.6"
          vectorEffect="non-scaling-stroke"
        />
        <polyline
          points={line((p) => p.sessions)}
          fill="none"
          stroke="#E84A8A"
          strokeWidth="0.6"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <div className="mt-2 flex flex-wrap items-center gap-4 text-xs text-muted">
        <span className="flex items-center gap-1.5">
          <span className="h-0.5 w-4 bg-ink" /> pageviews {totalPageviews}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-0.5 w-4 bg-brand-pink" /> sessions {totalSessions}
        </span>
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-muted">
        <span>{points[0]!.date}</span>
        <span>{points[points.length - 1]!.date}</span>
      </div>
    </div>
  );
}

function Tile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="panel p-4">
      <div className="label-mini">{label}</div>
      <div className="figure mt-1.5 text-lg text-ink">{value}</div>
      {hint && <div className="mt-1 text-xs text-muted">{hint}</div>}
    </div>
  );
}

function defaultRange() {
  const now = new Date();
  const from = new Date(now.getTime() - 29 * 86_400_000);
  return { from: from.toISOString().slice(0, 10), to: now.toISOString().slice(0, 10) };
}
