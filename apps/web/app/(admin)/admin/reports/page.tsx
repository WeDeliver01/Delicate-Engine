"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { rands } from "@/lib/money";
import { Empty, PageHeader, Panel } from "@/components/ui";

interface Overview {
  from: string;
  to: string;
  deliveries: number;
  failed: number;
  bookings: number;
  revenueCents: number;
  vatCents: number;
  fuelCents: number;
  driverEarningsCents: number;
  marginCents: number;
  marginBps: number;
  averageOrderCents: number;
  averageKm: number;
  totalKm: number;
  activeAccounts: number;
  newAccounts: number;
}
interface DailyPoint {
  date: string;
  deliveries: number;
  revenueCents: number;
  marginCents: number;
}
interface TopAccount {
  accountId: string;
  name: string;
  deliveries: number;
  revenueCents: number;
  marginCents: number;
}
interface DriverRow {
  driverId: string;
  name: string;
  deliveries: number;
  km: number;
  earningsCents: number;
  fuelCents: number;
  marginCents: number;
}

const EXPORTS = [
  {
    kind: "settlements",
    label: "Settlements",
    note: "One row per delivery: revenue, fuel, driver pay, margin.",
  },
  {
    kind: "journals",
    label: "Journals",
    note: "Every ledger line, debits and credits in their own columns.",
  },
  {
    kind: "invoices",
    label: "Invoices",
    note: "Documents issued, with what is still outstanding.",
  },
  { kind: "bookings", label: "Bookings", note: "What was booked, when, and by whom." },
  {
    kind: "allocations",
    label: "Treasury allocations",
    note: "Where each delivery's margin was earmarked.",
  },
] as const;

/** How the business is doing, derived from the rows the money is made of. */
export default function AdminReports() {
  const [range, setRange] = useState(defaultRange());
  const q = `?from=${range.from}&to=${range.to}`;

  const overview = useQuery({
    queryKey: ["admin", "analytics", "overview", range],
    queryFn: () => api<Overview>(`/v1/admin/analytics/overview${q}`),
  });
  const daily = useQuery({
    queryKey: ["admin", "analytics", "daily", range],
    queryFn: () => api<DailyPoint[]>(`/v1/admin/analytics/daily${q}`),
  });
  const top = useQuery({
    queryKey: ["admin", "analytics", "top", range],
    queryFn: () => api<TopAccount[]>(`/v1/admin/analytics/top-accounts${q}`),
  });
  const drivers = useQuery({
    queryKey: ["admin", "analytics", "drivers", range],
    queryFn: () => api<DriverRow[]>(`/v1/admin/analytics/drivers${q}`),
  });

  const d = overview.data;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Reports"
        lede="Worked out from settlements and journals every time you ask, so this can never drift from the ledger."
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
        <>
          <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Tile label="Revenue (excl. VAT)" value={rands(d.revenueCents)} />
            <Tile
              label="Contribution margin"
              value={rands(d.marginCents)}
              hint={`${(d.marginBps / 100).toFixed(1)}% of revenue`}
              tone={d.marginCents >= 0 ? "good" : "bad"}
            />
            <Tile label="Deliveries" value={String(d.deliveries)} hint={`${d.failed} failed`} />
            <Tile
              label="Average delivery"
              value={rands(d.averageOrderCents)}
              hint={`${d.averageKm} km average`}
            />
          </section>

          <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Tile label="VAT collected" value={rands(d.vatCents)} hint="Owed to SARS" />
            <Tile label="Fuel" value={rands(d.fuelCents)} />
            <Tile label="Driver earnings" value={rands(d.driverEarningsCents)} />
            <Tile
              label="Accounts"
              value={String(d.activeAccounts)}
              hint={`${d.newAccounts} new, ${d.bookings} bookings`}
            />
          </section>
        </>
      )}

      {daily.data && daily.data.length > 0 && (
        <Panel title="Revenue and margin by day" className="p-5 sm:p-6">
          <Chart points={daily.data} />
        </Panel>
      )}

      <Panel title="Who the business runs on">
        {top.data?.length === 0 ? (
          <p className="table-empty">Nothing delivered in this range.</p>
        ) : (
          <table className="table-base">
            <thead>
              <tr>
                <th>Account</th>
                <th className="text-right">Deliveries</th>
                <th className="text-right">Revenue</th>
                <th className="text-right">Margin</th>
                <th className="text-right">Margin %</th>
              </tr>
            </thead>
            <tbody>
              {top.data?.map((a) => (
                <tr key={a.accountId}>
                  <td>{a.name}</td>
                  <td className="figure text-right">{a.deliveries}</td>
                  <td className="figure text-right">{rands(a.revenueCents)}</td>
                  <td className="figure text-right">{rands(a.marginCents)}</td>
                  <td className="figure text-right text-muted">
                    {a.revenueCents ? ((a.marginCents / a.revenueCents) * 100).toFixed(0) : 0}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>

      <Panel title="Drivers">
        {drivers.data?.length === 0 ? (
          <p className="table-empty">No deliveries by any driver in this range.</p>
        ) : (
          <table className="table-base">
            <thead>
              <tr>
                <th>Driver</th>
                <th className="text-right">Deliveries</th>
                <th className="text-right">Distance</th>
                <th className="text-right">Earned</th>
                <th className="text-right">Fuel</th>
                <th className="text-right">Margin produced</th>
              </tr>
            </thead>
            <tbody>
              {drivers.data?.map((r) => (
                <tr key={r.driverId}>
                  <td>{r.name}</td>
                  <td className="figure text-right">{r.deliveries}</td>
                  <td className="figure text-right">{r.km} km</td>
                  <td className="figure text-right">{rands(r.earningsCents)}</td>
                  <td className="figure text-right">{rands(r.fuelCents)}</td>
                  <td className="figure text-right">{rands(r.marginCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>

      <Panel
        title="Exports"
        description="Plain CSV, for a spreadsheet or your accountant. The selected range applies."
      >
        <ul className="divide-y divide-[#F0EDE9]">
          {EXPORTS.map((e) => (
            <li key={e.kind} className="flex flex-wrap items-center gap-3 px-5 py-3 sm:px-6">
              <div className="min-w-48 flex-1">
                <div className="text-sm font-medium">{e.label}</div>
                <div className="text-xs text-muted">{e.note}</div>
              </div>
              <a
                href={`/api/v1/admin/analytics/export.csv?kind=${e.kind}&from=${range.from}&to=${range.to}`}
                className="btn btn-secondary btn-sm"
              >
                Download
              </a>
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}

/**
 * Drawn as an inline SVG rather than pulling in a charting library: it is two series over a few
 * dozen days, and a dependency that ships a layout engine to do that is not worth the bytes.
 */
function Chart({ points }: { points: DailyPoint[] }) {
  const max = Math.max(1, ...points.map((p) => p.revenueCents));
  const w = 100;
  const h = 34;
  const step = points.length > 1 ? w / (points.length - 1) : w;
  const line = (pick: (p: DailyPoint) => number) =>
    points
      .map((p, i) => `${(i * step).toFixed(2)},${(h - (pick(p) / max) * h).toFixed(2)}`)
      .join(" ");

  const totalRevenue = points.reduce((s, p) => s + p.revenueCents, 0);
  const totalMargin = points.reduce((s, p) => s + p.marginCents, 0);
  const best = points.reduce((a, b) => (b.revenueCents > a.revenueCents ? b : a), points[0]!);

  if (totalRevenue === 0) return <Empty>Nothing delivered in this range yet.</Empty>;

  return (
    <div>
      <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="h-40 w-full" role="img">
        <title>Revenue and margin per day</title>
        <polyline
          points={line((p) => p.revenueCents)}
          fill="none"
          stroke="#0A0A0A"
          strokeWidth="0.6"
          vectorEffect="non-scaling-stroke"
        />
        <polyline
          points={line((p) => Math.max(0, p.marginCents))}
          fill="none"
          stroke="#E84A8A"
          strokeWidth="0.6"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <div className="mt-2 flex flex-wrap items-center gap-4 text-xs text-muted">
        <span className="flex items-center gap-1.5">
          <span className="h-0.5 w-4 bg-ink" /> revenue {rands(totalRevenue)}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-0.5 w-4 bg-brand-pink" /> margin {rands(totalMargin)}
        </span>
        <span className="ml-auto">
          Best day {best.date} · {rands(best.revenueCents)}
        </span>
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-muted">
        <span>{points[0]!.date}</span>
        <span>{points[points.length - 1]!.date}</span>
      </div>
    </div>
  );
}

function Tile({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "good" | "bad";
}) {
  const colour =
    tone === "good" ? "text-[#1B7F4B]" : tone === "bad" ? "text-[#C13B73]" : "text-ink";
  return (
    <div className="panel p-4">
      <div className="label-mini">{label}</div>
      <div className={`figure mt-1.5 text-lg ${colour}`}>{value}</div>
      {hint && <div className="mt-1 text-xs text-muted">{hint}</div>}
    </div>
  );
}

function defaultRange() {
  const now = new Date();
  const from = new Date(now.getTime() - 29 * 86_400_000);
  return { from: from.toISOString().slice(0, 10), to: now.toISOString().slice(0, 10) };
}
