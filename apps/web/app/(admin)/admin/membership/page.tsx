"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import type { Membership, MembershipPlan } from "@delicate/contracts";
import { api, ApiRequestError } from "@/lib/api";
import { dateTime, rands } from "@/lib/money";
import { PlanEditor } from "@/components/admin/plan-editor";
import { useMe } from "@/components/use-me";

/**
 * Memberships: who is on a plan, what it buys them, and what is about to fall due.
 *
 * The renewals list is the working half. Renewal runs on its own overnight, but a wallet that
 * was short leaves a membership past due, and somebody has to be able to see that and chase
 * it rather than discovering it when the customer asks why they were charged full price.
 */
export default function AdminMembershipPage() {
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [dueOnly, setDueOnly] = useState(true);
  const [editing, setEditing] = useState<MembershipPlan | null | undefined>(undefined);
  const me = useMe();
  // Prices are a super-admin decision; finance can read this board but not reprice it.
  const canEdit = me.data?.user.platformRole === "super_admin";
  const onError = (e: unknown) => setError(e instanceof ApiRequestError ? e.message : String(e));
  const invalidate = () => void qc.invalidateQueries({ queryKey: ["admin", "membership"] });

  const plans = useQuery({
    queryKey: ["admin", "membership", "plans"],
    queryFn: () => api<MembershipPlan[]>("/v1/admin/membership/plans"),
  });
  const subs = useQuery({
    queryKey: ["admin", "membership", "subs", dueOnly],
    queryFn: () =>
      api<Membership[]>(`/v1/admin/membership/subscriptions${dueOnly ? "?dueWithinDays=7" : ""}`),
    refetchInterval: 60_000,
  });

  const renew = useMutation({
    mutationFn: (accountId: string) =>
      api(`/v1/admin/accounts/${accountId}/membership/renew`, { method: "POST" }),
    onSuccess: invalidate,
    onError,
  });

  return (
    <div className="space-y-6">
      <header>
        <p className="label-mini text-[#E84A8A]">Revenue</p>
        <h1 className="page-title">Membership</h1>
        <p className="mt-1 text-sm text-muted">
          Members pay monthly for a cheaper rate. Renewal runs overnight; anything it could not
          collect shows up here as past due.
        </p>
      </header>

      {error && <p className="alert-error">{error}</p>}

      <section className="grid gap-3 sm:grid-cols-3">
        {plans.data?.map((p) => (
          <div key={p.id} className="panel p-5">
            <div className="flex items-baseline justify-between gap-2">
              <h2 className="section-title">{p.name}</h2>
              <div className="flex items-center gap-2">
                {!p.active && <span className="chip chip-warn">off</span>}
                {canEdit && (
                  <button onClick={() => setEditing(p)} className="link-quiet text-xs">
                    Edit
                  </button>
                )}
              </div>
            </div>
            <p className="mt-1 font-mono text-2xl">{rands(p.priceCents)}</p>
            <p className="text-xs text-muted">per month</p>
            <ul className="mt-3 space-y-1 text-sm">
              <li>{(p.discountBps / 100).toFixed(0)}% off every delivery</li>
              {p.freeShipmentsPerPeriod > 0 && (
                <li>
                  {p.freeShipmentsPerPeriod} free shipment
                  {p.freeShipmentsPerPeriod === 1 ? "" : "s"} a month
                </li>
              )}
              {p.waivesAllSurcharges ? (
                <li>No surcharges at all</li>
              ) : (
                p.waivesHolidaySurcharge && <li>Public holiday delivery included</li>
              )}
              {p.includesApiAccess && <li>API access</li>}
              {p.dedicatedManager && <li>Dedicated account manager</li>}
            </ul>
          </div>
        ))}
      </section>

      {canEdit && (
        <button onClick={() => setEditing(null)} className="btn btn-secondary btn-sm">
          Add a plan
        </button>
      )}
      {editing !== undefined && <PlanEditor plan={editing} onClose={() => setEditing(undefined)} />}

      <section className="panel">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3">
          <h2 className="section-title">Subscriptions</h2>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={dueOnly}
              onChange={(e) => setDueOnly(e.target.checked)}
            />
            Only those due within a week
          </label>
        </div>
        <table className="table-base">
          <thead>
            <tr>
              <th>Account</th>
              <th>Plan</th>
              <th>Status</th>
              <th>Collected</th>
              <th>Pays</th>
              <th>Renews</th>
              <th className="text-right" />
            </tr>
          </thead>
          <tbody>
            {subs.data?.map((m) => {
              const overdue = new Date(m.currentPeriodEnd).getTime() < Date.now();
              return (
                <tr key={m.id}>
                  <td>
                    <Link
                      href={`/admin/accounts/${m.accountId}`}
                      className="font-mono text-xs hover:underline"
                    >
                      {m.accountId.slice(0, 8)}
                    </Link>
                  </td>
                  <td>{m.plan.name}</td>
                  <td>
                    <span
                      className={
                        m.status === "past_due"
                          ? "chip chip-bad"
                          : m.cancelAtPeriodEnd
                            ? "chip chip-warn"
                            : "chip chip-good"
                      }
                    >
                      {m.status === "past_due"
                        ? "past due"
                        : m.cancelAtPeriodEnd
                          ? "ending"
                          : m.status}
                    </span>
                  </td>
                  <td className="text-[#6B6661]">{m.collection}</td>
                  <td className="font-mono">{rands(m.priceCents)}</td>
                  <td className={overdue ? "text-[#C13B73]" : undefined}>
                    {dateTime(m.currentPeriodEnd)}
                  </td>
                  <td className="text-right">
                    <button
                      onClick={() => renew.mutate(m.accountId)}
                      disabled={renew.isPending}
                      className="btn btn-secondary btn-sm"
                    >
                      Renew now
                    </button>
                  </td>
                </tr>
              );
            })}
            {subs.data?.length === 0 && (
              <tr>
                <td colSpan={7} className="table-empty">
                  {dueOnly ? "Nothing due in the next week." : "Nobody is on a plan yet."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}
