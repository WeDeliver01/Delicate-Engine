"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { TopUp } from "@delicate/contracts";
import { api, ApiRequestError } from "@/lib/api";
import { dateTime, rands } from "@/lib/money";

/** Finance: match EFTs on the bank statement and confirm them; cancel stale requests. */
export default function AdminTopUps() {
  const qc = useQueryClient();
  const pending = useQuery({
    queryKey: ["admin", "top-ups", "pending"],
    queryFn: () => api<{ items: TopUp[] }>("/v1/admin/top-ups/pending?limit=100"),
    refetchInterval: 15_000,
  });
  const [refs, setRefs] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const confirm = useMutation({
    mutationFn: (t: TopUp) =>
      api(`/v1/admin/top-ups/${t.id}/confirm`, {
        method: "POST",
        json: { bankReference: refs[t.id] || undefined },
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["admin", "top-ups"] }),
    onError: (e) => setError(e instanceof ApiRequestError ? e.message : String(e)),
  });
  const cancel = useMutation({
    mutationFn: (t: TopUp) =>
      api(`/v1/admin/top-ups/${t.id}/cancel`, {
        method: "POST",
        json: { reason: "cancelled by finance" },
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["admin", "top-ups"] }),
    onError: (e) => setError(e instanceof ApiRequestError ? e.message : String(e)),
  });

  return (
    <section className="panel">
      <div className="border-b border-line px-5 py-4">
        <h2 className="section-title">Pending top-ups</h2>
        <p className="text-sm text-muted">
          Confirming credits the customer wallet immediately and is audited. Only confirm what you
          have matched on the bank statement.
        </p>
      </div>
      {error && <p className="px-5 py-2 text-sm text-[#C13B73]">{error}</p>}
      <table className="w-full text-left text-sm">
        <thead className="label-mini">
          <tr>
            <th className="px-5 py-2">Reference</th>
            <th className="px-5 py-2">Method</th>
            <th className="px-5 py-2">Amount</th>
            <th className="px-5 py-2">Requested</th>
            <th className="px-5 py-2">Bank ref</th>
            <th />
          </tr>
        </thead>
        <tbody className="divide-y divide-[#F0EDE9]">
          {pending.data?.items.map((t) => (
            <tr key={t.id}>
              <td className="px-5 py-2 font-mono">{t.reference}</td>
              <td className="px-5 py-2">{t.provider}</td>
              <td className="px-5 py-2 font-mono">{rands(t.amountCents)}</td>
              <td className="px-5 py-2">{dateTime(t.createdAt)}</td>
              <td className="px-5 py-2">
                <input
                  value={refs[t.id] ?? ""}
                  onChange={(e) => setRefs({ ...refs, [t.id]: e.target.value })}
                  placeholder="statement ref"
                  className="w-36 input px-2 py-1"
                />
              </td>
              <td className="px-5 py-2 text-right">
                <button
                  onClick={() => confirm.mutate(t)}
                  disabled={t.provider !== "manual_eft"}
                  className="rounded-full bg-ink px-3 py-1 text-xs text-white disabled:opacity-30"
                >
                  Confirm
                </button>
                <button
                  onClick={() => cancel.mutate(t)}
                  className="ml-2 rounded-full border border-[#DAD6CF] px-3 py-1 text-xs"
                >
                  Cancel
                </button>
              </td>
            </tr>
          ))}
          {pending.data?.items.length === 0 && (
            <tr>
              <td colSpan={6} className="table-empty">
                Nothing pending.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </section>
  );
}
