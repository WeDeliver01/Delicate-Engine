"use client";

import { useQuery } from "@tanstack/react-query";
import type { LoyaltyStatus } from "@delicate/contracts";
import { api } from "@/lib/api";
import { dateOnly, rands } from "@/lib/money";
import { Empty, PageHeader, Panel } from "@/components/ui";

/** Cashback, in plain terms: what you are on, what you have earned, what the next tier needs. */
export default function PortalRewards() {
  const s = useQuery({
    queryKey: ["portal", "loyalty"],
    queryFn: () => api<LoyaltyStatus>("/v1/account/loyalty"),
  });

  if (!s.data) return <p className="text-sm text-muted">Loading…</p>;
  const d = s.data;

  if (!d.enabled) {
    return (
      <div className="space-y-6">
        <PageHeader title="Rewards" />
        <Empty>There is no rewards programme running at the moment.</Empty>
      </div>
    );
  }

  const progress = d.nextTier
    ? Math.min(100, Math.round((d.windowSpendCents / d.nextTier.minSpendCents) * 100))
    : 100;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={`${d.tier.name} member`}
        title={`${(d.tier.cashbackBps / 100).toFixed(1)}% back on every delivery`}
        lede={`Cashback lands in your wallet, so it pays for the next delivery. Earned on the delivery charge, excluding VAT.`}
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="panel p-4">
          <div className="label-mini">Earned all time</div>
          <div className="figure mt-1.5 text-lg text-[#1B7F4B]">{rands(d.earnedAllTimeCents)}</div>
        </div>
        <div className="panel p-4">
          <div className="label-mini">Earned in the last {d.windowDays} days</div>
          <div className="figure mt-1.5 text-lg">{rands(d.earnedThisWindowCents)}</div>
        </div>
        <div className="panel p-4">
          <div className="label-mini">Spend counting towards your tier</div>
          <div className="figure mt-1.5 text-lg">{rands(d.windowSpendCents)}</div>
        </div>
      </div>

      {d.nextTier && (
        <Panel title={`Next: ${d.nextTier.name}`} className="p-5 sm:p-6">
          <p className="lede">
            Another <span className="figure">{rands(d.toNextTierCents ?? 0)}</span> of deliveries in
            the next {d.windowDays} days takes you to {(d.nextTier.cashbackBps / 100).toFixed(1)}%
            back.
          </p>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-[#F0EDE9]">
            <div className="h-full rounded-full bg-brand-pink" style={{ width: `${progress}%` }} />
          </div>
          <div className="mt-1 flex justify-between text-xs text-muted">
            <span>{rands(d.windowSpendCents)}</span>
            <span>{rands(d.nextTier.minSpendCents)}</span>
          </div>
        </Panel>
      )}

      <Panel title="Cashback you have earned">
        {d.recent.length === 0 ? (
          <p className="table-empty">
            Nothing yet. Cashback is added when a delivery is completed and charged.
          </p>
        ) : (
          <table className="table-base">
            <thead>
              <tr>
                <th>When</th>
                <th>Booking</th>
                <th>Tier</th>
                <th className="text-right">Rate</th>
                <th className="text-right">Earned</th>
              </tr>
            </thead>
            <tbody>
              {d.recent.map((a) => (
                <tr key={a.id}>
                  <td className="text-muted">{dateOnly(a.createdAt)}</td>
                  <td className="font-mono">{a.reference}</td>
                  <td className="capitalize">{a.tierCode}</td>
                  <td className="figure text-right">{(a.cashbackBps / 100).toFixed(1)}%</td>
                  <td className="figure text-right text-[#1B7F4B]">+{rands(a.amountCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
    </div>
  );
}
