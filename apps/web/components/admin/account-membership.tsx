"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { Membership, MembershipPlan } from "@delicate/contracts";
import { api, ApiRequestError } from "@/lib/api";
import { dateTime, rands } from "@/lib/money";
import { useMe } from "@/components/use-me";

/**
 * This customer's membership, where ops already is.
 *
 * Worth having on the account page rather than only on the membership board: the questions
 * that prompt it — why is this account being charged this, can they use the API — get asked
 * while looking at the account, not while looking at a list of subscriptions.
 */
export function AccountMembership({ accountId }: { accountId: string }) {
  const qc = useQueryClient();
  const me = useMe();
  const canWrite = me.data?.user.platformRole === "super_admin";
  const [error, setError] = useState<string | null>(null);
  const [choice, setChoice] = useState("");
  const onError = (e: unknown) => setError(e instanceof ApiRequestError ? e.message : String(e));
  const invalidate = () =>
    void qc.invalidateQueries({ queryKey: ["admin", "accounts", accountId] });

  const data = useQuery({
    queryKey: ["admin", "accounts", accountId, "membership"],
    queryFn: () =>
      api<{ membership: Membership | null; history: Membership[] }>(
        `/v1/admin/accounts/${accountId}/membership`,
      ),
  });
  const plans = useQuery({
    queryKey: ["admin", "membership", "plans"],
    queryFn: () => api<MembershipPlan[]>("/v1/admin/membership/plans"),
  });

  const start = useMutation({
    mutationFn: (planCode: string) =>
      api(`/v1/admin/accounts/${accountId}/membership`, {
        method: "POST",
        json: { planCode, collection: "wallet" },
      }),
    onSuccess: invalidate,
    onError,
  });
  const renew = useMutation({
    mutationFn: () => api(`/v1/admin/accounts/${accountId}/membership/renew`, { method: "POST" }),
    onSuccess: invalidate,
    onError,
  });

  if (!data.data) return null;
  const m = data.data.membership;

  return (
    <section className="panel p-5">
      <h2 className="section-title">Membership</h2>
      {error && <p className="alert-error mt-2">{error}</p>}

      {m ? (
        <div className="mt-3 space-y-1 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{m.plan.name}</span>
            <span className={m.status === "past_due" ? "chip chip-bad" : "chip chip-good"}>
              {m.status === "past_due" ? "past due" : m.status}
            </span>
            {m.cancelAtPeriodEnd && <span className="chip chip-warn">ending</span>}
          </div>
          <p className="text-muted">
            {rands(m.priceCents)}/month · {(m.discountBps / 100).toFixed(0)}% off deliveries ·
            collected by {m.collection}
          </p>
          <p className="text-muted">
            {m.cancelAtPeriodEnd ? "Ends" : "Renews"} {dateTime(m.currentPeriodEnd)}
          </p>
          {m.freeShipmentsLeft !== null && (
            <p className="text-muted">{m.freeShipmentsLeft} free shipment(s) left this period</p>
          )}
          {/* Advisory: granting API access is a separate, deliberate act by an admin. */}
          <p className="text-muted">
            API access {m.plan.includesApiAccess ? "included in this plan" : "not in this plan"}
          </p>
          {canWrite && m.status === "past_due" && (
            <button
              onClick={() => renew.mutate()}
              disabled={renew.isPending}
              className="btn btn-secondary btn-sm mt-2"
            >
              Try collecting again
            </button>
          )}
        </div>
      ) : (
        <p className="mt-2 text-sm text-muted">Not on a plan.</p>
      )}

      {canWrite && (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <select
            value={choice}
            onChange={(e) => setChoice(e.target.value)}
            className="input px-2 py-1 text-sm"
          >
            <option value="">Put on a plan…</option>
            {plans.data
              ?.filter((p) => p.active && p.id !== m?.plan.id)
              .map((p) => (
                <option key={p.id} value={p.code}>
                  {p.name} — {rands(p.priceCents)}/mo
                </option>
              ))}
          </select>
          <button
            onClick={() => choice && start.mutate(choice)}
            disabled={!choice || start.isPending}
            className="btn btn-secondary btn-sm"
          >
            {m ? "Move to plan" : "Start membership"}
          </button>
        </div>
      )}

      {data.data.history.length > 1 && (
        <details className="mt-4 text-xs text-muted">
          <summary className="cursor-pointer">Previous plans</summary>
          <ul className="mt-2 space-y-1">
            {data.data.history.slice(1).map((h) => (
              <li key={h.id}>
                {h.plan.name} · {rands(h.priceCents)}/mo · from {dateTime(h.startedAt)}
                {h.cancelledAt ? ` to ${dateTime(h.cancelledAt)}` : ""}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
