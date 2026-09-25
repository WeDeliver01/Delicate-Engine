"use client";

import { Fragment, useState } from "react";
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

      {wallets.data && (
        <WalletEditor
          wallets={wallets.data}
          onDone={() => void qc.invalidateQueries({ queryKey: ["admin", "treasury"] })}
          onError={onError}
        />
      )}
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

/**
 * The bills themselves. This is where the seeded placeholders get replaced with what the
 * business actually pays — every allocation decision follows from these numbers, so they matter
 * more than the rate card does.
 */
function WalletEditor({
  wallets,
  onDone,
  onError,
}: {
  wallets: AllocationWallet[];
  onDone: () => void;
  onError: (e: unknown) => void;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const bills = wallets.filter((w) => w.category === "operating_expense");
  const targets = wallets.filter((w) => w.category !== "operating_expense");

  return (
    <section className="rounded-xl border border-[#ECEAE6] bg-white">
      <div className="flex items-center justify-between border-b border-[#ECEAE6] px-5 py-4">
        <div>
          <h2 className="font-semibold">Monthly bills &amp; reserves</h2>
          <p className="text-xs text-[#86817A]">
            Earmarks, not bank accounts — the ledger remains the book of account.
          </p>
        </div>
        <button
          onClick={() => {
            setAdding(!adding);
            setEditing(null);
          }}
          className="rounded-full bg-[#0A0A0A] px-4 py-1.5 text-sm text-white hover:bg-[#E84A8A]"
        >
          {adding ? "Cancel" : "Add a bill"}
        </button>
      </div>

      {adding && (
        <div className="border-b border-[#ECEAE6] bg-[#FAFAF9] p-5">
          <WalletForm
            onDone={() => {
              setAdding(false);
              onDone();
            }}
            onError={onError}
          />
        </div>
      )}

      <WalletGroupRows
        title="Monthly bills"
        rows={bills}
        editing={editing}
        setEditing={setEditing}
        onDone={onDone}
        onError={onError}
      />
      <WalletGroupRows
        title="Reserves & capital"
        rows={targets}
        editing={editing}
        setEditing={setEditing}
        onDone={onDone}
        onError={onError}
      />
    </section>
  );
}

function WalletGroupRows({
  title,
  rows,
  editing,
  setEditing,
  onDone,
  onError,
}: {
  title: string;
  rows: AllocationWallet[];
  editing: string | null;
  setEditing: (v: string | null) => void;
  onDone: () => void;
  onError: (e: unknown) => void;
}) {
  if (rows.length === 0) return null;
  return (
    <>
      <h3 className="px-5 pt-4 text-xs uppercase text-[#86817A]">{title}</h3>
      <table className="w-full text-left text-sm">
        <thead className="text-xs uppercase text-[#86817A]">
          <tr>
            <th className="px-5 py-2">Name</th>
            <th className="px-5 py-2">Paid to</th>
            <th className="px-5 py-2 text-right">Amount</th>
            <th className="px-5 py-2">Due day</th>
            <th className="px-5 py-2 text-right">Saved</th>
            <th className="px-5 py-2"></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[#F0EDE9]">
          {rows.map((w) => (
            <Fragment key={w.id}>
              <tr className={w.active ? "" : "opacity-50"}>
                <td className="px-5 py-2">
                  {w.name}
                  {w.isRetainedEarnings && (
                    <span className="ml-2 rounded-full bg-[#F0EDE9] px-2 py-0.5 text-xs text-[#6B6661]">
                      sink
                    </span>
                  )}
                  {!w.active && <span className="ml-2 text-xs">(inactive)</span>}
                  <div className="font-mono text-xs text-[#86817A]">{w.slug}</div>
                </td>
                <td className="px-5 py-2 text-[#86817A]">{w.obligation?.vendor || "—"}</td>
                <td className="px-5 py-2 text-right font-mono">
                  {w.obligation
                    ? rands(w.obligation.monthlyAmountCents)
                    : w.monthlyTargetCents !== null
                      ? rands(w.monthlyTargetCents)
                      : "unbounded"}
                </td>
                <td className="px-5 py-2">{w.obligation?.dueDay ?? "—"}</td>
                <td className="px-5 py-2 text-right font-mono">{rands(w.balanceCents)}</td>
                <td className="px-5 py-2 text-right">
                  {!w.isRetainedEarnings && (
                    <button
                      onClick={() => setEditing(editing === w.id ? null : w.id)}
                      className="text-xs text-[#E84A8A] hover:underline"
                    >
                      {editing === w.id ? "close" : "edit"}
                    </button>
                  )}
                </td>
              </tr>
              {editing === w.id && (
                <tr>
                  <td colSpan={6} className="bg-[#FAFAF9] p-5">
                    <WalletForm
                      wallet={w}
                      onDone={() => {
                        setEditing(null);
                        onDone();
                      }}
                      onError={onError}
                    />
                  </td>
                </tr>
              )}
            </Fragment>
          ))}
        </tbody>
      </table>
    </>
  );
}

function WalletForm({
  wallet,
  onDone,
  onError,
}: {
  wallet?: AllocationWallet;
  onDone: () => void;
  onError: (e: unknown) => void;
}) {
  const [slug, setSlug] = useState(wallet?.slug ?? "");
  const [name, setName] = useState(wallet?.name ?? "");
  const [category, setCategory] = useState<AllocationWallet["category"]>(
    wallet?.category ?? "operating_expense",
  );
  const [priority, setPriority] = useState(wallet?.priority ?? 10);
  const [active, setActive] = useState(wallet?.active ?? true);
  const [vendor, setVendor] = useState(wallet?.obligation?.vendor ?? "");
  const [amount, setAmount] = useState(
    wallet?.obligation ? String(wallet.obligation.monthlyAmountCents / 100) : "",
  );
  const [dueDay, setDueDay] = useState(wallet?.obligation?.dueDay ?? 1);
  const [target, setTarget] = useState(
    wallet?.monthlyTargetCents !== null && wallet?.monthlyTargetCents !== undefined
      ? String(wallet.monthlyTargetCents / 100)
      : "",
  );

  const isBill = category === "operating_expense";
  const cents = (v: string) => (v.trim() === "" ? null : Math.round(Number(v) * 100));

  const save = useMutation({
    mutationFn: () =>
      api(`/v1/admin/treasury/wallets/${slug.trim()}`, {
        method: "PUT",
        json: {
          name: name.trim(),
          category,
          priority,
          active,
          obligation: isBill
            ? { vendor: vendor.trim(), monthlyAmountCents: cents(amount) ?? 0, dueDay }
            : null,
          monthlyTargetCents: isBill ? null : cents(target),
        },
      }),
    onSuccess: onDone,
    onError,
  });

  const valid =
    /^[a-z0-9-]{2,60}$/.test(slug.trim()) &&
    name.trim().length >= 2 &&
    (!isBill || (cents(amount) ?? 0) > 0);

  return (
    <div className="space-y-4 text-sm">
      <div className="grid gap-4 sm:grid-cols-3">
        <Labelled label="Name">
          <input
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              if (!wallet && !slug) setSlug(slugify(e.target.value));
            }}
            placeholder="Premises rent"
            className="w-full rounded-lg border border-[#DAD6CF] px-3 py-2"
          />
        </Labelled>
        <Labelled label="Slug" hint={wallet ? "cannot be changed" : "lowercase, dashes"}>
          <input
            value={slug}
            disabled={!!wallet}
            onChange={(e) => setSlug(slugify(e.target.value))}
            placeholder="premises"
            className="w-full rounded-lg border border-[#DAD6CF] px-3 py-2 font-mono disabled:bg-[#F0EDE9]"
          />
        </Labelled>
        <Labelled label="Kind">
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value as AllocationWallet["category"])}
            className="w-full rounded-lg border border-[#DAD6CF] px-3 py-2"
          >
            <option value="operating_expense">Monthly bill</option>
            <option value="reserve">Reserve</option>
            <option value="capital">Capital</option>
          </select>
        </Labelled>
      </div>

      {isBill ? (
        <div className="grid gap-4 sm:grid-cols-3">
          <Labelled label="Paid to">
            <input
              value={vendor}
              onChange={(e) => setVendor(e.target.value)}
              placeholder="Landlord"
              className="w-full rounded-lg border border-[#DAD6CF] px-3 py-2"
            />
          </Labelled>
          <Labelled label="Amount per month (rands)">
            <input
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="9500"
              className="w-full rounded-lg border border-[#DAD6CF] px-3 py-2 font-mono"
            />
          </Labelled>
          <Labelled label="Debit order day" hint="1–28; urgency climbs as it approaches">
            <input
              type="number"
              min={1}
              max={28}
              value={dueDay}
              onChange={(e) => setDueDay(Number(e.target.value))}
              className="w-full rounded-lg border border-[#DAD6CF] px-3 py-2 font-mono"
            />
          </Labelled>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-3">
          <Labelled label="Monthly target (rands)" hint="blank = unbounded">
            <input
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              placeholder="15000"
              className="w-full rounded-lg border border-[#DAD6CF] px-3 py-2 font-mono"
            />
          </Labelled>
          <Labelled label="Priority" hint="lower fills first">
            <input
              type="number"
              value={priority}
              onChange={(e) => setPriority(Number(e.target.value))}
              className="w-full rounded-lg border border-[#DAD6CF] px-3 py-2 font-mono"
            />
          </Labelled>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-4">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={active}
            onChange={(e) => setActive(e.target.checked)}
            className="h-4 w-4"
          />
          Active
          <span className="text-xs text-[#86817A]">
            (an inactive wallet keeps its balance and history, it just stops receiving margin)
          </span>
        </label>
        <button
          onClick={() => save.mutate()}
          disabled={!valid || save.isPending}
          className="ml-auto rounded-full bg-[#0A0A0A] px-5 py-2 text-white hover:bg-[#E84A8A] disabled:opacity-40"
        >
          {wallet ? "Save changes" : "Add bill"}
        </button>
      </div>
    </div>
  );
}

function Labelled({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="text-xs uppercase text-[#86817A]">{label}</span>
      <div className="mt-1">{children}</div>
      {hint && <span className="mt-1 block text-xs text-[#86817A]">{hint}</span>}
    </label>
  );
}

function slugify(v: string): string {
  return v
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
}
