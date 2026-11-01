"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Membership, MembershipPlan } from "@delicate/contracts";
import { api, ApiRequestError } from "@/lib/api";
import { dateTime, rands } from "@/lib/money";

/**
 * The customer's own membership: what they are on, what it saves them, and how to change it.
 *
 * Cancelling runs to the end of the period they have already paid for rather than stopping
 * dead, and the page says so before they press it — a customer who loses their discount the
 * moment they cancel, having paid for the month, is right to be annoyed.
 */
export default function PortalMembershipPage() {
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const onError = (e: unknown) => setError(e instanceof ApiRequestError ? e.message : String(e));
  const invalidate = () => void qc.invalidateQueries({ queryKey: ["portal", "membership"] });

  const plans = useQuery({
    queryKey: ["portal", "membership", "plans"],
    queryFn: () => api<MembershipPlan[]>("/v1/public/membership/plans", { account: null }),
  });
  const current = useQuery({
    queryKey: ["portal", "membership", "current"],
    queryFn: () => api<{ membership: Membership | null }>("/v1/account/membership"),
  });

  const start = useMutation({
    mutationFn: (planCode: string) =>
      api("/v1/account/membership", { method: "POST", json: { planCode, collection: "wallet" } }),
    onSuccess: invalidate,
    onError,
  });
  const cancel = useMutation({
    mutationFn: () => api("/v1/account/membership", { method: "DELETE" }),
    onSuccess: () => {
      setConfirming(false);
      invalidate();
    },
    onError,
  });

  const mine = current.data?.membership ?? null;

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-10">
      <header>
        <h1 className="page-title">Membership</h1>
        <p className="mt-1 text-sm text-[#6B6661]">
          Pay monthly, pay less on every delivery. The discount comes off automatically when you
          book — there is nothing to remember.
        </p>
      </header>

      {error && <p className="alert-error">{error}</p>}

      {mine && (
        <section className="panel p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="label-mini">Your plan</p>
              <h2 className="section-title">{mine.plan.name}</h2>
              <p className="mt-1 text-sm text-[#6B6661]">
                {rands(mine.priceCents)} a month · {(mine.discountBps / 100).toFixed(0)}% off every
                delivery
              </p>
              {mine.freeShipmentsLeft !== null && (
                <p className="text-sm text-[#6B6661]">
                  {mine.freeShipmentsLeft} free shipment
                  {mine.freeShipmentsLeft === 1 ? "" : "s"} left this month
                </p>
              )}
            </div>
            <div className="text-right text-sm">
              {mine.status === "past_due" && (
                <p className="chip chip-bad">We could not collect your last payment</p>
              )}
              {mine.cancelAtPeriodEnd ? (
                <p className="text-[#6B6661]">Ends {dateTime(mine.currentPeriodEnd)}</p>
              ) : (
                <p className="text-[#6B6661]">Renews {dateTime(mine.currentPeriodEnd)}</p>
              )}
              {!mine.cancelAtPeriodEnd &&
                (confirming ? (
                  <div className="mt-2 flex gap-2">
                    <button
                      onClick={() => cancel.mutate()}
                      disabled={cancel.isPending}
                      className="btn btn-secondary btn-sm"
                    >
                      Yes, stop renewing
                    </button>
                    <button onClick={() => setConfirming(false)} className="btn btn-ghost btn-sm">
                      Keep it
                    </button>
                  </div>
                ) : (
                  <button onClick={() => setConfirming(true)} className="mt-2 link-quiet text-xs">
                    Cancel membership
                  </button>
                ))}
            </div>
          </div>
          {confirming && (
            <p className="mt-3 rounded-xl bg-[#FAFAF9] p-3 text-xs text-[#6B6661]">
              You keep your discount until {dateTime(mine.currentPeriodEnd)}, which you have already
              paid for. Nothing is taken after that.
            </p>
          )}
        </section>
      )}

      <section className="grid gap-4 md:grid-cols-3">
        {plans.data?.map((p) => {
          const isMine = mine?.plan.id === p.id;
          return (
            <div
              key={p.id}
              className={`panel flex flex-col p-6 ${isMine ? "ring-2 ring-[#E84A8A]" : ""}`}
            >
              <h2 className="section-title">{p.name}</h2>
              <p className="mt-2 font-mono text-3xl">{rands(p.priceCents)}</p>
              <p className="text-xs text-muted">per month</p>
              {p.suitedFromDeliveries > 0 && (
                <p className="mt-2 text-sm text-[#6B6661]">
                  Worth it from about {p.suitedFromDeliveries} deliveries a month.
                </p>
              )}
              <ul className="mt-4 flex-1 space-y-2 text-sm">
                <li>{(p.discountBps / 100).toFixed(0)}% off default rates</li>
                {p.freeShipmentsPerPeriod > 0 && (
                  <li>
                    {p.freeShipmentsPerPeriod} free shipment
                    {p.freeShipmentsPerPeriod === 1 ? "" : "s"} a month
                  </li>
                )}
                {p.waivesAllSurcharges ? (
                  <li>Zero surcharges</li>
                ) : (
                  p.waivesHolidaySurcharge && <li>Public holiday delivery</li>
                )}
                {p.includesApiAccess && <li>API integration</li>}
                {p.prioritySupport && <li>Priority support</li>}
                {p.dedicatedManager && <li>Dedicated account manager</li>}
              </ul>
              <button
                onClick={() => start.mutate(p.code)}
                disabled={isMine || start.isPending}
                className={`mt-5 ${isMine ? "btn btn-secondary" : "btn btn-primary"}`}
              >
                {isMine ? "Your current plan" : mine ? "Switch to this" : "Get started"}
              </button>
            </div>
          );
        })}
      </section>

      <p className="text-xs text-muted">
        The monthly fee comes off your wallet balance. If there is not enough in it we will tell you
        rather than quietly cancelling — your discount keeps working while you sort it out.
      </p>
    </div>
  );
}
