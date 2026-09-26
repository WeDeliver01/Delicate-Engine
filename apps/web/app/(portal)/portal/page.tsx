"use client";

import Link from "next/link";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  PERIOD_LABELS,
  formatRange,
  type DateRange,
  type ShipmentStatus,
} from "@delicate/contracts";
import { useMe } from "@/components/use-me";
import { api } from "@/lib/api";
import { rands } from "@/lib/money";
import { StatusBadge } from "@/components/booking/status-badge";
import {
  DEFAULT_PERIOD,
  PeriodPicker,
  periodRange,
  type PeriodState,
} from "@/components/shell/period-picker";

interface Trend {
  value: number;
  previous: number;
}

interface Dashboard {
  today: {
    date: string;
    total: number;
    scheduled: number;
    inFlight: number;
    delivered: number;
    failed: number;
    cancelled: number;
  };
  live: {
    id: string;
    waybill: string;
    status: ShipmentStatus;
    slotDate: string | null;
    slotWindowKey: string | null;
    recipient: { name: string; phone: string | null };
    deliveryAddress: { formatted: string; suburb: string | null };
    driver: { id: string; name: string | null } | null;
    trackable: boolean;
  }[];
  upcoming: { date: string; count: number }[];
  range: DateRange;
  shipments: Trend;
  delivered: Trend;
  failed: Trend;
  onTimeRate: number | null;
  spend: { bookings: number; totalCents: number };
  wallet: {
    balanceCents: number;
    creditLimitCents: number;
    heldCents: number;
    availableCents: number;
    billingMode: string;
    outstandingInvoices: number;
    outstandingCents: number;
    overdueInvoices: number;
  };
}

/**
 * The customer's home screen.
 *
 * Built around one question: is today going to be fine? So today is the whole top of the page
 * and does not move when the period changes — the period below it is for "how are we doing",
 * which is a different question asked less often.
 */
export default function PortalHome() {
  const me = useMe();
  const account = me.activeAccount;
  const [period, setPeriod] = useState<PeriodState>({ ...DEFAULT_PERIOD, key: "last28" });
  const range = periodRange(period);

  const dash = useQuery({
    queryKey: ["account", account?.id, "dashboard", period.key, range.from, range.to],
    queryFn: () =>
      api<Dashboard>(
        `/v1/account/dashboard?period=${period.key}&from=${range.from}&to=${range.to}`,
      ),
    enabled: !!account,
    // Something on the road moves; a page left open on a desk should not go stale.
    refetchInterval: 60_000,
  });

  if (!me.data) return null;

  if (!account) {
    return (
      <section className="panel p-8">
        <h1 className="page-title">Welcome, {me.data.user.fullName ?? me.data.user.email}</h1>
        <p className="mt-2 text-[#6B6661]">
          You don&apos;t have an account yet. Create one to start booking deliveries.
        </p>
        <Link href="/portal/accounts/new" className="btn btn-primary mt-6">
          Create an account
        </Link>
      </section>
    );
  }

  const d = dash.data;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="eyebrow">{account.name}</p>
          <h1 className="page-title mt-1">Today</h1>
          <p className="lede mt-1">
            {d ? prettyDate(d.today.date) : "…"} ·{" "}
            {account.type === "business" ? "Business" : "Personal"} account
          </p>
        </div>
        <Link href="/portal/book" className="btn btn-primary">
          Book a delivery
        </Link>
      </header>

      {/* ── Today ─────────────────────────────────────────────────────────── */}
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <TodayTile
          label="Scheduled"
          value={d?.today.scheduled}
          hint="waiting for collection"
          href="/portal/shipments?period=today&status=booked&status=assigned"
        />
        <TodayTile
          label="On the way"
          value={d?.today.inFlight}
          hint="with a driver"
          tone="live"
          href="/portal/shipments?period=today&status=collected&status=in_transit"
        />
        <TodayTile
          label="Delivered"
          value={d?.today.delivered}
          hint="completed today"
          tone="good"
          href="/portal/shipments?period=today&status=delivered"
        />
        <TodayTile
          label="Needs attention"
          value={d?.today.failed}
          hint="failed delivery"
          tone={d?.today.failed ? "bad" : "quiet"}
          href="/portal/shipments?period=today&status=failed"
        />
      </section>

      {/* ── On the road ───────────────────────────────────────────────────── */}
      <section className="panel">
        <div className="panel-head">
          <div>
            <h2 className="section-title">On the road</h2>
            <p className="lede">Everything with a driver right now</p>
          </div>
          {!!d?.live.length && (
            <span className="chip chip-info">
              {d.live.length} active {d.live.length === 1 ? "shipment" : "shipments"}
            </span>
          )}
        </div>

        {dash.isLoading ? (
          <p className="table-empty">Loading…</p>
        ) : !d?.live.length ? (
          <p className="table-empty">
            Nothing is out for delivery at the moment.{" "}
            <Link href="/portal/shipments" className="link-accent">
              See all shipments
            </Link>
          </p>
        ) : (
          <ul className="divide-y divide-[#F0EDE9]">
            {d.live.map((s) => (
              <li key={s.id}>
                <Link
                  href={`/portal/shipments/${s.id}`}
                  className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3 transition-colors hover:bg-[#FAFAF9] sm:px-6"
                >
                  <span className="font-mono text-sm">{s.waybill}</span>
                  <StatusBadge status={s.status} />
                  <span className="min-w-0 flex-1 truncate text-sm text-[#6B6661]">
                    {s.recipient.name} · {s.deliveryAddress.suburb ?? s.deliveryAddress.formatted}
                  </span>
                  {s.driver?.name && <span className="text-xs text-muted">{s.driver.name}</span>}
                  {s.trackable && (
                    <span className="chip chip-good">
                      <span className="relative flex h-1.5 w-1.5">
                        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#1B7F4B] opacity-75" />
                        <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-[#1B7F4B]" />
                      </span>
                      Track live
                    </span>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ── Performance over a period ─────────────────────────────────────── */}
      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="section-title">How it is going</h2>
          <PeriodPicker value={period} onChange={setPeriod} />
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <TrendTile label="Shipments" trend={d?.shipments} />
          <TrendTile label="Delivered" trend={d?.delivered} />
          <TrendTile
            label="On time"
            value={d?.onTimeRate != null ? `${d.onTimeRate}%` : "—"}
            hint={d?.onTimeRate != null ? "of delivered shipments" : "nothing delivered yet"}
          />
          <TrendTile
            label="Spend"
            value={d ? rands(d.spend.totalCents) : undefined}
            hint={d ? `${d.spend.bookings} booking${d.spend.bookings === 1 ? "" : "s"}` : undefined}
          />
        </div>
        <p className="text-xs text-muted">
          {PERIOD_LABELS[period.key]} · {formatRange(range)}, compared with the same length
          immediately before it.
        </p>
      </section>

      {/* ── Money and what is next ────────────────────────────────────────── */}
      <div className="grid gap-6 lg:grid-cols-3">
        <section className="panel lg:col-span-2">
          <div className="panel-head">
            <h2 className="section-title">Coming up</h2>
            <Link href="/portal/shipments?period=next7" className="link-quiet text-xs">
              Next 7 days →
            </Link>
          </div>
          {!d?.upcoming.length ? (
            <p className="table-empty">Nothing booked beyond today.</p>
          ) : (
            <ul className="divide-y divide-[#F0EDE9]">
              {d.upcoming.map((u) => (
                <li key={u.date}>
                  <Link
                    href={`/portal/shipments?period=custom&from=${u.date}&to=${u.date}`}
                    className="flex items-center justify-between px-5 py-2.5 text-sm transition-colors hover:bg-[#FAFAF9] sm:px-6"
                  >
                    <span>{prettyDate(u.date)}</span>
                    <span className="figure text-[#6B6661]">
                      {u.count} {u.count === 1 ? "shipment" : "shipments"}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="panel">
          <div className="panel-head">
            <h2 className="section-title">Wallet</h2>
            <Link href="/portal/wallet" className="link-quiet text-xs">
              Top up →
            </Link>
          </div>
          <div className="panel-body space-y-3">
            <div>
              <p className="label-mini">Available to spend</p>
              <p className="figure mt-0.5 text-2xl font-semibold">
                {d ? rands(d.wallet.availableCents) : "—"}
              </p>
            </div>
            {!!d?.wallet.heldCents && (
              <p className="text-xs text-muted">
                {rands(d.wallet.heldCents)} held against shipments in progress
              </p>
            )}
            {!!d?.wallet.outstandingInvoices && (
              <Link href="/portal/invoices" className="block">
                <div className={d.wallet.overdueInvoices ? "alert-error" : "alert-info"}>
                  {d.wallet.outstandingInvoices} unpaid{" "}
                  {d.wallet.outstandingInvoices === 1 ? "invoice" : "invoices"} ·{" "}
                  {rands(d.wallet.outstandingCents)}
                  {!!d.wallet.overdueInvoices && ` · ${d.wallet.overdueInvoices} overdue`}
                </div>
              </Link>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

function TodayTile({
  label,
  value,
  hint,
  tone = "quiet",
  href,
}: {
  label: string;
  value?: number;
  hint: string;
  tone?: "quiet" | "live" | "good" | "bad";
  href: string;
}) {
  const accent =
    tone === "live"
      ? "text-[#1F4E8C]"
      : tone === "good"
        ? "text-[#1B7F4B]"
        : tone === "bad"
          ? "text-[#C13B73]"
          : "text-ink";
  return (
    <Link href={href} className="panel card p-5">
      <p className="label-mini">{label}</p>
      <p className={`figure mt-1 text-3xl font-semibold ${accent}`}>{value ?? "—"}</p>
      <p className="mt-0.5 text-xs text-muted">{hint}</p>
    </Link>
  );
}

function TrendTile({
  label,
  trend,
  value,
  hint,
}: {
  label: string;
  trend?: Trend;
  value?: string;
  hint?: string;
}) {
  const delta = trend ? trend.value - trend.previous : null;
  // A percentage against zero is either infinity or a lie, so the previous figure is shown
  // as a plain number instead.
  const pct =
    trend && trend.previous > 0
      ? Math.round(((trend.value - trend.previous) / trend.previous) * 100)
      : null;

  return (
    <div className="panel p-5">
      <p className="label-mini">{label}</p>
      <p className="figure mt-1 text-3xl font-semibold">{value ?? trend?.value ?? "—"}</p>
      {hint ? (
        <p className="mt-0.5 text-xs text-muted">{hint}</p>
      ) : delta != null && trend ? (
        <p className="mt-0.5 text-xs text-muted">
          {delta === 0 ? (
            "unchanged"
          ) : (
            <>
              <span className={delta > 0 ? "text-[#1B7F4B]" : "text-[#C13B73]"}>
                {delta > 0 ? "▲" : "▼"} {Math.abs(delta)}
                {pct != null && ` (${Math.abs(pct)}%)`}
              </span>{" "}
              vs {trend.previous} before
            </>
          )}
        </p>
      ) : null}
    </div>
  );
}

function prettyDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-ZA", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  });
}
