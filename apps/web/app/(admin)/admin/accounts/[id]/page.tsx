"use client";

import { use, useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { BillingMode, WalletEntry, WalletSummary } from "@delicate/contracts";
import { api, ApiRequestError } from "@/lib/api";
import { setActiveAccountId } from "@/lib/session";
import { useMe } from "@/components/use-me";
import { dateTime, rands } from "@/lib/money";
import { AddTransaction } from "@/components/admin/add-transaction";

/** Finance view of one account: wallet, ledger, credit terms, adjustments. All audited. */
export default function AdminAccountPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const qc = useQueryClient();
  const key = ["admin", "accounts", id];
  const wallet = useQuery({
    queryKey: [...key, "wallet"],
    queryFn: () => api<WalletSummary>(`/v1/admin/accounts/${id}/wallet`),
  });
  const entries = useQuery({
    queryKey: [...key, "entries"],
    queryFn: () =>
      api<{ items: WalletEntry[] }>(`/v1/admin/accounts/${id}/wallet/entries?limit=100`),
  });
  const verify = useQuery({
    queryKey: [...key, "verify"],
    queryFn: () =>
      api<{ ok: boolean; cachedCents: number; derivedCents: number }>(
        `/v1/admin/accounts/${id}/wallet/verify`,
      ),
  });
  const [error, setError] = useState<string | null>(null);
  const onError = (e: unknown) => setError(e instanceof ApiRequestError ? e.message : String(e));
  const invalidate = () => void qc.invalidateQueries({ queryKey: key });

  const [terms, setTerms] = useState({
    billingMode: "prepaid" as BillingMode,
    creditLimit: "0",
    statementDay: 1,
    paymentTermsDays: 30,
  });
  useEffect(() => {
    if (wallet.data)
      setTerms((t) => ({
        ...t,
        billingMode: wallet.data.billingMode,
        creditLimit: (wallet.data.creditLimitCents / 100).toFixed(2),
      }));
  }, [wallet.data]);
  const saveTerms = useMutation({
    mutationFn: () =>
      api(`/v1/admin/accounts/${id}/credit-terms`, {
        method: "PUT",
        json: {
          billingMode: terms.billingMode,
          creditLimitCents: Math.round(Number(terms.creditLimit) * 100),
          statementDay: terms.statementDay,
          paymentTermsDays: terms.paymentTermsDays,
        },
      }),
    onSuccess: invalidate,
    onError,
  });

  const [adj, setAdj] = useState({ amount: "", reason: "" });
  const adjust = useMutation({
    mutationFn: () =>
      api(`/v1/admin/accounts/${id}/wallet/adjust`, {
        method: "POST",
        json: { amountCents: Math.round(Number(adj.amount) * 100), reason: adj.reason },
      }),
    onSuccess: () => {
      setAdj({ amount: "", reason: "" });
      invalidate();
    },
    onError,
  });

  const me = useMe();
  const canActAs = me.data?.user.platformRole === "super_admin";

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      {canActAs && (
        <section className="panel flex flex-wrap items-center justify-between gap-3 p-4 lg:col-span-3">
          <p className="text-sm text-[#6B6661]">
            Open the portal as this account — to see what they see, or to book for them against
            their wallet. Everything you do is recorded against your name.
          </p>
          <button
            type="button"
            onClick={() => {
              setActiveAccountId(id);
              // A full load, not a client navigation: the portal has to fetch everything
              // fresh as this account rather than reuse anything cached as the console.
              window.location.assign("/portal");
            }}
            className="btn btn-secondary btn-sm"
          >
            Act as this account
          </button>
        </section>
      )}
      <div className="space-y-6 lg:col-span-2">
        <section className="panel p-5">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <h2 className="section-title">Money on this account</h2>
            <AddTransaction
              accountId={id}
              balanceCents={wallet.data?.balanceCents ?? 0}
              onDone={invalidate}
            />
          </div>
          <p className="font-mono text-xs text-muted">{id}</p>
          {wallet.data && (
            <dl className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
              <div>
                <dt className="text-muted">Balance</dt>
                <dd className="font-mono text-lg">{rands(wallet.data.balanceCents)}</dd>
              </div>
              <div>
                <dt className="text-muted">Reserved</dt>
                <dd className="font-mono text-lg">{rands(wallet.data.heldCents)}</dd>
              </div>
              <div>
                <dt className="text-muted">Credit</dt>
                <dd className="font-mono text-lg">{rands(wallet.data.creditLimitCents)}</dd>
              </div>
              <div>
                <dt className="text-muted">Available</dt>
                <dd className="font-mono text-lg font-bold">{rands(wallet.data.availableCents)}</dd>
              </div>
            </dl>
          )}
          {verify.data && (
            <p className={`mt-3 text-xs ${verify.data.ok ? "text-[#1B7F4B]" : "text-[#C13B73]"}`}>
              Ledger check: cached {rands(verify.data.cachedCents)} vs derived{" "}
              {rands(verify.data.derivedCents)} —{" "}
              {verify.data.ok ? "consistent" : "MISMATCH, investigate"}
            </p>
          )}
        </section>
        <section className="panel">
          <h2 className="border-b border-line px-5 py-3 section-title">Ledger</h2>
          <ul className="divide-y divide-[#F0EDE9] text-sm">
            {entries.data?.items.map((e) => (
              <li key={e.id} className="flex justify-between px-5 py-2">
                <div>
                  <p>{e.description}</p>
                  <p className="text-xs text-muted">
                    {e.kind} · {dateTime(e.createdAt)}
                  </p>
                </div>
                <div className="text-right font-mono">
                  <p>
                    {e.amountCents > 0 ? "+" : ""}
                    {rands(e.amountCents)}
                  </p>
                  <p className="text-xs text-muted">{rands(e.balanceAfterCents)}</p>
                </div>
              </li>
            ))}
          </ul>
        </section>
      </div>
      <div className="space-y-6 text-sm">
        {error && <p className="alert-error">{error}</p>}
        <section className="panel p-5">
          <h2 className="section-title">Credit terms</h2>
          <label className="mt-3 block">
            <span className="text-[#6B6661]">Billing mode</span>
            <select
              value={terms.billingMode}
              onChange={(e) => setTerms({ ...terms, billingMode: e.target.value as BillingMode })}
              className="mt-1 w-full input px-2 py-1.5 bg-white"
            >
              <option value="prepaid">prepaid</option>
              <option value="postpaid">postpaid (monthly account)</option>
            </select>
          </label>
          {terms.billingMode === "postpaid" && (
            <>
              <label className="mt-2 block">
                <span className="text-[#6B6661]">Credit limit (R)</span>
                <input
                  type="number"
                  step="0.01"
                  value={terms.creditLimit}
                  onChange={(e) => setTerms({ ...terms, creditLimit: e.target.value })}
                  className="mt-1 w-full input px-2 py-1.5 font-mono"
                />
              </label>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <label>
                  <span className="text-[#6B6661]">Statement day</span>
                  <input
                    type="number"
                    min={1}
                    max={28}
                    value={terms.statementDay}
                    onChange={(e) => setTerms({ ...terms, statementDay: Number(e.target.value) })}
                    className="mt-1 w-full input px-2 py-1.5 font-mono"
                  />
                </label>
                <label>
                  <span className="text-[#6B6661]">Terms (days)</span>
                  <input
                    type="number"
                    min={0}
                    value={terms.paymentTermsDays}
                    onChange={(e) =>
                      setTerms({ ...terms, paymentTermsDays: Number(e.target.value) })
                    }
                    className="mt-1 w-full input px-2 py-1.5 font-mono"
                  />
                </label>
              </div>
            </>
          )}
          <button
            onClick={() => saveTerms.mutate()}
            className="mt-3 w-full rounded-full bg-ink py-1.5 text-white hover:bg-brand-pink"
          >
            Save terms
          </button>
        </section>
        <section className="panel p-5">
          <h2 className="section-title">Manual adjustment</h2>
          <p className="mt-1 text-xs text-muted">
            The blunt instrument: positive credits, negative debits, with a reason. Prefer a
            transaction above, which says what kind of movement it was and books it to the right
            place.
          </p>
          <input
            type="number"
            step="0.01"
            value={adj.amount}
            onChange={(e) => setAdj({ ...adj, amount: e.target.value })}
            placeholder="Amount (R)"
            className="mt-3 w-full input px-2 py-1.5 font-mono"
          />
          <input
            value={adj.reason}
            onChange={(e) => setAdj({ ...adj, reason: e.target.value })}
            placeholder="Reason (required)"
            className="mt-2 w-full input px-2 py-1.5"
          />
          <button
            disabled={!adj.amount || adj.reason.length < 5}
            onClick={() => adjust.mutate()}
            className="mt-3 w-full rounded-full border border-[#DAD6CF] py-1.5 hover:border-[#0A0A0A] disabled:opacity-40"
          >
            Post adjustment
          </button>
        </section>
      </div>
    </div>
  );
}
