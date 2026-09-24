"use client";

import { useQuery } from "@tanstack/react-query";
import type { AccountBalance, Journal } from "@delicate/contracts";
import { api } from "@/lib/api";
import { dateTime, rands } from "@/lib/money";

/** The books. Debit-normal accounts read positive; credit-normal (liabilities, revenue) negative. */
export default function AdminLedger() {
  const tb = useQuery({
    queryKey: ["admin", "ledger", "trial-balance"],
    queryFn: () =>
      api<{ rows: AccountBalance[]; totalCents: number }>("/v1/admin/ledger/trial-balance"),
    refetchInterval: 20_000,
  });
  const journals = useQuery({
    queryKey: ["admin", "ledger", "journals"],
    queryFn: () => api<{ items: Journal[] }>("/v1/admin/ledger/journals?limit=40"),
    refetchInterval: 20_000,
  });

  const balanced = tb.data?.totalCents === 0;
  const byAccount = new Map<string, number>();
  for (const r of tb.data?.rows ?? [])
    byAccount.set(r.account, (byAccount.get(r.account) ?? 0) + r.balanceCents);

  return (
    <div className="space-y-6">
      <section
        className={`rounded-xl border p-5 ${balanced ? "border-[#ECEAE6] bg-white" : "border-red-300 bg-red-50"}`}
      >
        <div className="flex items-center justify-between">
          <h1 className="font-semibold">Trial balance</h1>
          <span className={`text-sm ${balanced ? "text-[#1B7F4B]" : "text-red-700"}`}>
            {tb.data
              ? balanced
                ? "Balanced ✓"
                : `OUT BY ${rands(tb.data.totalCents)} — investigate`
              : "…"}
          </span>
        </div>
        <table className="mt-4 w-full text-left text-sm">
          <thead className="text-xs uppercase text-[#86817A]">
            <tr>
              <th className="py-2">Account</th>
              <th className="py-2 text-right">Balance</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#F0EDE9]">
            {[...byAccount.entries()].map(([account, cents]) => (
              <tr key={account}>
                <td className="py-2">{account.replace(/_/g, " ").toLowerCase()}</td>
                <td className="py-2 text-right font-mono">{rands(cents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-3 text-xs text-[#86817A]">
          Customer prepaid liability and revenue are credit-normal, so they show negative here. What
          matters is that everything sums to zero.
        </p>
      </section>

      <section className="rounded-xl border border-[#ECEAE6] bg-white">
        <h2 className="border-b border-[#ECEAE6] px-5 py-4 font-semibold">Journals</h2>
        <ul className="divide-y divide-[#F0EDE9] text-sm">
          {journals.data?.items.map((j) => (
            <li key={j.id} className="px-5 py-3">
              <div className="flex items-center justify-between">
                <span className="font-medium">{j.description}</span>
                <span className="text-xs text-[#86817A]">
                  {j.kind} · {dateTime(j.occurredAt)}
                </span>
              </div>
              <table className="mt-2 w-full text-xs">
                <tbody>
                  {j.lines.map((l, i) => (
                    <tr key={i}>
                      <td className="py-0.5 text-[#6B6661]">
                        {l.account.replace(/_/g, " ").toLowerCase()}
                      </td>
                      <td className="py-0.5 text-[#86817A]">
                        {l.ownerType === "company"
                          ? "company"
                          : `${l.ownerType} ${l.ownerId?.slice(0, 8)}`}
                      </td>
                      <td className="py-0.5 text-right font-mono">
                        {l.amountCents > 0 ? rands(l.amountCents) : ""}
                      </td>
                      <td className="py-0.5 text-right font-mono">
                        {l.amountCents < 0 ? rands(-l.amountCents) : ""}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </li>
          ))}
          {journals.data?.items.length === 0 && (
            <li className="px-5 py-8 text-center text-[#86817A]">No journals yet.</li>
          )}
        </ul>
      </section>
    </div>
  );
}
