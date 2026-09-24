"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  AllocationWallet,
  TreasuryDashboard,
  TreasuryPolicy,
  WalletForecast,
} from "@delicate/contracts";
import { api, ApiRequestError } from "@/lib/api";
import { dateTime, rands } from "@/lib/money";

/**
 * Treasury. Where the margin of every delivery has been earmarked, and whether this month's
 * bills are actually covered. Nothing on this page moves money.
 */
export default function AdminTreasury() {
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const onError = (e: unknown) => setError(e instanceof ApiRequestError ? e.message : String(e));

  const dash = useQuery({
    queryKey: ["admin", "treasury", "dashboard"],
    queryFn: () => api<TreasuryDashboard>("/v1/admin/treasury/dashboard"),
    refetchInterval: 30_000,
  });
  const wallets = useQuery({
    queryKey: ["admin", "treasury", "wallets"],
    queryFn: () => api<AllocationWallet[]>("/v1/admin/treasury/wallets"),
  });
  const policy = useQuery({
    queryKey: ["admin", "treasury", "policy"],
    queryFn: () => api<TreasuryPolicy>("/v1/admin/treasury/policy"),
  });

  const savePolicy = useMutation({
    mutationFn: (body: TreasuryPolicy) =>
      api("/v1/admin/treasury/policy", { method: "POST", json: body }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["admin", "treasury"] }),
    onError,
  });

  const d = dash.data;

  return (
    <div className="space-y-6">
      {error && (
        <p className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </p>
      )}

      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Treasury</h1>
          <p className="text-sm text-[#86817A]">
            Earmarks over money the ledger has already recorded — {d?.period ?? "…"}
          </p>
        </div>
        {d && <Health score={d.healthScore} />}
      </header>

      {d && (
        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Margin earmarked this month" value={rands(d.marginThisPeriodCents)} />
          <Stat
            label="Obligations covered"
            value={`${rands(d.obligationsFundedCents)} of ${rands(d.obligationsTotalCents)}`}
            tone={d.shortfallCents > 0 ? "warn" : "good"}
          />
          <Stat
            label="Still to find this month"
            value={rands(d.shortfallCents)}
            tone={d.shortfallCents > 0 ? "warn" : "good"}
          />
          <Stat
            label="Projected coverage by month end"
            value={`${(d.projectedCoverageBps / 100).toFixed(0)}%`}
            tone={d.projectedCoverageBps >= 10_000 ? "good" : "warn"}
          />
        </section>
      )}

      {d && d.upcomingDebitOrders.length > 0 && (
        <section className="rounded-xl border border-[#ECEAE6] bg-white">
          <h2 className="border-b border-[#ECEAE6] px-5 py-4 font-semibold">Next debit orders</h2>
          <table className="w-full text-left text-sm">
            <thead className="text-xs uppercase text-[#86817A]">
              <tr>
                <th className="px-5 py-2">Bill</th>
                <th className="px-5 py-2">Vendor</th>
                <th className="px-5 py-2">Due</th>
                <th className="px-5 py-2 text-right">Amount</th>
                <th className="px-5 py-2 text-right">Funded</th>
                <th className="px-5 py-2">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#F0EDE9]">
              {d.upcomingDebitOrders.map((o) => (
                <tr key={o.slug}>
                  <td className="px-5 py-2">{o.name}</td>
                  <td className="px-5 py-2 text-[#86817A]">{o.vendor || "—"}</td>
                  <td className="px-5 py-2">day {o.dueDay}</td>
                  <td className="px-5 py-2 text-right font-mono">{rands(o.amountCents)}</td>
                  <td className="px-5 py-2 text-right font-mono">{rands(o.fundedCents)}</td>
                  <td className="px-5 py-2">
                    {o.covered ? (
                      <span className="rounded-full bg-[#E7F5EC] px-2 py-0.5 text-xs text-[#1B7F4B]">
                        covered
                      </span>
                    ) : (
                      <span className="rounded-full bg-[#FCEEF4] px-2 py-0.5 text-xs text-[#C13B73]">
                        short {rands(o.amountCents - o.fundedCents)}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {d && (
        <div className="grid gap-6 lg:grid-cols-3">
          <WalletGroup title="Obligations" rows={d.operating} />
          <WalletGroup title="Reserves" rows={d.reserves} />
          <WalletGroup title="Capital" rows={d.capital} />
        </div>
      )}

      {d && (
        <section className="rounded-xl border border-[#ECEAE6] bg-white">
          <h2 className="border-b border-[#ECEAE6] px-5 py-4 font-semibold">Recent allocations</h2>
          <table className="w-full text-left text-sm">
            <thead className="text-xs uppercase text-[#86817A]">
              <tr>
                <th className="px-5 py-2">When</th>
                <th className="px-5 py-2">Wallet</th>
                <th className="px-5 py-2">Kind</th>
                <th className="px-5 py-2">From</th>
                <th className="px-5 py-2 text-right">Amount</th>
                <th className="px-5 py-2 text-right">Balance after</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#F0EDE9]">
              {d.recent.map((t) => (
                <tr key={t.id}>
                  <td className="px-5 py-2 text-[#86817A]">{dateTime(t.createdAt)}</td>
                  <td className="px-5 py-2">{t.walletSlug}</td>
                  <td className="px-5 py-2 text-[#86817A]">{t.kind}</td>
                  <td className="px-5 py-2 font-mono text-xs text-[#86817A]">
                    {t.reference?.replace(/^shipment:/, "") ?? "—"}
                  </td>
                  <td className="px-5 py-2 text-right font-mono">{rands(t.amountCents)}</td>
                  <td className="px-5 py-2 text-right font-mono text-[#86817A]">
                    {rands(t.balanceAfterCents)}
                  </td>
                </tr>
              ))}
              {d.recent.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-5 py-8 text-center text-[#86817A]">
                    Nothing allocated yet this month. Margin lands here as deliveries settle.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </section>
      )}

      {policy.data && (
        <PolicyCard
          policy={policy.data}
          saving={savePolicy.isPending}
          onSave={(p) => savePolicy.mutate(p)}
        />
      )}

      {wallets.data && <WalletTable wallets={wallets.data} />}
    </div>
  );
}

function Health({ score }: { score: number }) {
  const tone =
    score >= 90
      ? { bg: "bg-[#E7F5EC]", fg: "text-[#1B7F4B]", label: "healthy" }
      : score >= 60
        ? { bg: "bg-[#FDF3E3]", fg: "text-[#8A5A12]", label: "tight" }
        : { bg: "bg-[#FCEEF4]", fg: "text-[#C13B73]", label: "at risk" };
  return (
    <div className={`rounded-xl ${tone.bg} px-5 py-3 text-right`}>
      <div className={`text-3xl font-semibold ${tone.fg}`}>{score}</div>
      <div className={`text-xs ${tone.fg}`}>obligation health · {tone.label}</div>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "good" | "warn" }) {
  return (
    <div className="rounded-xl border border-[#ECEAE6] bg-white p-4">
      <div className="text-xs uppercase text-[#86817A]">{label}</div>
      <div
        className={`mt-1 font-mono text-lg ${tone === "warn" ? "text-[#C13B73]" : tone === "good" ? "text-[#1B7F4B]" : ""}`}
      >
        {value}
      </div>
    </div>
  );
}

function WalletGroup({ title, rows }: { title: string; rows: WalletForecast[] }) {
  return (
    <section className="rounded-xl border border-[#ECEAE6] bg-white p-5">
      <h2 className="font-semibold">{title}</h2>
      <ul className="mt-3 space-y-4">
        {rows.map((f) => (
          <li key={f.walletId}>
            <div className="flex items-baseline justify-between gap-2 text-sm">
              <span>{f.name}</span>
              <span className="font-mono text-xs text-[#86817A]">
                {rands(f.fundedCents)}
                {f.targetCents > 0 && ` / ${rands(f.targetCents)}`}
              </span>
            </div>
            {f.targetCents > 0 && (
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-[#F0EDE9]">
                <div
                  className={`h-full rounded-full ${f.atRisk ? "bg-[#E84A8A]" : "bg-[#1B7F4B]"}`}
                  style={{ width: `${Math.min(100, f.progressBps / 100)}%` }}
                />
              </div>
            )}
            <div className="mt-1 flex justify-between text-xs text-[#86817A]">
              <span>
                {f.daysUntilDue !== null
                  ? `due in ${f.daysUntilDue} day${f.daysUntilDue === 1 ? "" : "s"}`
                  : f.targetCents > 0
                    ? "monthly target"
                    : "unbounded"}
              </span>
              {f.atRisk && <span className="text-[#C13B73]">won&apos;t make it at this rate</span>}
            </div>
          </li>
        ))}
        {rows.length === 0 && <li className="text-sm text-[#86817A]">None configured.</li>}
      </ul>
    </section>
  );
}

function PolicyCard({
  policy,
  saving,
  onSave,
}: {
  policy: TreasuryPolicy;
  saving: boolean;
  onSave: (p: TreasuryPolicy) => void;
}) {
  const [draft, setDraft] = useState(policy);
  return (
    <section className="rounded-xl border border-[#ECEAE6] bg-white p-5">
      <h2 className="font-semibold">Allocation policy</h2>
      <p className="mt-1 text-sm text-[#86817A]">
        How hard an approaching debit order pulls margin towards itself, and how covered the bills
        must be before anything reaches reserves.
      </p>
      <div className="mt-4 grid gap-4 sm:grid-cols-3">
        <Field
          label="Urgency window (days)"
          value={draft.urgencyWindowDays}
          onChange={(v) => setDraft({ ...draft, urgencyWindowDays: v })}
        />
        <Field
          label="Max urgency (bps)"
          value={draft.urgencyMaxMultiplierBps}
          onChange={(v) => setDraft({ ...draft, urgencyMaxMultiplierBps: v })}
        />
        <Field
          label="Reserve gate (bps of coverage)"
          value={draft.reserveGateBps}
          onChange={(v) => setDraft({ ...draft, reserveGateBps: v })}
        />
      </div>
      <button
        onClick={() => onSave(draft)}
        disabled={saving}
        className="mt-4 rounded-full bg-[#0A0A0A] px-5 py-2 text-sm text-white hover:bg-[#E84A8A] disabled:opacity-50"
      >
        {saving ? "Saving…" : "Save policy"}
      </button>
    </section>
  );
}

function Field({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="block text-sm">
      <span className="text-xs uppercase text-[#86817A]">{label}</span>
      <input
        type="number"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-1 w-full rounded-lg border border-[#DAD6CF] px-3 py-2 font-mono"
      />
    </label>
  );
}

function WalletTable({ wallets }: { wallets: AllocationWallet[] }) {
  return (
    <section className="rounded-xl border border-[#ECEAE6] bg-white">
      <h2 className="border-b border-[#ECEAE6] px-5 py-4 font-semibold">Wallets</h2>
      <table className="w-full text-left text-sm">
        <thead className="text-xs uppercase text-[#86817A]">
          <tr>
            <th className="px-5 py-2">Wallet</th>
            <th className="px-5 py-2">Category</th>
            <th className="px-5 py-2">Bill / target</th>
            <th className="px-5 py-2">Due day</th>
            <th className="px-5 py-2 text-right">Balance</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[#F0EDE9]">
          {wallets.map((w) => (
            <tr key={w.id}>
              <td className="px-5 py-2">
                {w.name}
                {w.isRetainedEarnings && (
                  <span className="ml-2 rounded-full bg-[#F0EDE9] px-2 py-0.5 text-xs text-[#6B6661]">
                    sink
                  </span>
                )}
                {!w.active && <span className="ml-2 text-xs text-[#86817A]">(inactive)</span>}
              </td>
              <td className="px-5 py-2 text-[#86817A]">{w.category.replace(/_/g, " ")}</td>
              <td className="px-5 py-2 font-mono">
                {w.obligation
                  ? rands(w.obligation.monthlyAmountCents)
                  : w.monthlyTargetCents !== null
                    ? rands(w.monthlyTargetCents)
                    : "—"}
              </td>
              <td className="px-5 py-2">{w.obligation?.dueDay ?? "—"}</td>
              <td className="px-5 py-2 text-right font-mono">{rands(w.balanceCents)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="border-t border-[#ECEAE6] px-5 py-3 text-xs text-[#86817A]">
        These balances are earmarks, not bank accounts. The ledger remains the book of account.
      </p>
    </section>
  );
}
