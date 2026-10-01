"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  CreateTopUpResponse,
  PaymentProviderName,
  TopUp,
  WalletEntry,
  WalletSummary,
} from "@delicate/contracts";
import { useMe } from "@/components/use-me";
import { api, ApiRequestError } from "@/lib/api";
import { dateTime, rands } from "@/lib/money";

const PROVIDER_LABELS: Record<PaymentProviderName, string> = {
  manual_eft: "Bank transfer (EFT)",
  payfast: "Card / Instant EFT via PayFast",
  yoco: "Card via Yoco",
  bobpay: "Bob Pay",
};

/**
 * `useSearchParams` reads the ?result= the payment provider sends the customer back with, and
 * Next requires it to sit inside a Suspense boundary: without one the prerendered page throws
 * on hydration and the whole route renders as "a client-side exception has occurred", with no
 * clue that a query parameter was behind it.
 */
export default function WalletPage() {
  return (
    <Suspense fallback={<p className="lede">Loading your wallet…</p>}>
      <Wallet />
    </Suspense>
  );
}

function Wallet() {
  const me = useMe();
  const qc = useQueryClient();
  const params = useSearchParams();
  const account = me.activeAccount;
  const key = ["account", account?.id, "wallet"];

  const summary = useQuery({
    queryKey: key,
    queryFn: () => api<WalletSummary>("/v1/account/wallet"),
    enabled: !!account,
    refetchInterval: params.get("result") === "return" ? 4_000 : false,
  });
  const entries = useQuery({
    queryKey: [...key, "entries"],
    queryFn: () => api<{ items: WalletEntry[] }>("/v1/account/wallet/entries?limit=50"),
    enabled: !!account,
  });
  const topUps = useQuery({
    queryKey: [...key, "top-ups"],
    queryFn: () => api<{ items: TopUp[] }>("/v1/account/wallet/top-ups?limit=20"),
    enabled: !!account,
  });
  const providers = useQuery({
    queryKey: ["wallet", "providers"],
    queryFn: () => api<{ providers: PaymentProviderName[] }>("/v1/account/wallet/providers"),
    enabled: !!account,
  });

  const [provider, setProvider] = useState<PaymentProviderName | "">("");
  const [amount, setAmount] = useState("500");
  const [result, setResult] = useState<CreateTopUpResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!provider && providers.data?.providers[0]) setProvider(providers.data.providers[0]);
  }, [providers.data, provider]);

  async function topUp(e: React.FormEvent) {
    e.preventDefault();
    if (!provider) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api<CreateTopUpResponse>("/v1/account/wallet/top-ups", {
        method: "POST",
        json: { provider, amountCents: Math.round(Number(amount) * 100) },
      });
      setResult(res);
      void qc.invalidateQueries({ queryKey: key });
      if (res.instructions.type === "redirect") submitRedirect(res.instructions);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  if (!account) return null;
  const s = summary.data;

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="space-y-6 lg:col-span-2">
        <section className="panel p-6">
          <h1 className="page-title">Wallet · {account.name}</h1>
          {s && (
            <dl className="mt-4 grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
              <Stat label="Balance" value={rands(s.balanceCents)} />
              <Stat
                label="Reserved"
                value={rands(s.heldCents)}
                hint="Confirmed bookings not yet delivered"
              />
              {s.billingMode === "postpaid" && (
                <Stat label="Credit limit" value={rands(s.creditLimitCents)} />
              )}
              <Stat label="Available" value={rands(s.availableCents)} strong />
            </dl>
          )}
          {params.get("result") === "return" && (
            <p className="mt-4 rounded-xl bg-[#FCEEF4] p-3 text-sm">
              Thanks — we are waiting for the payment provider to confirm. Your balance updates
              automatically.
            </p>
          )}
          {params.get("result") === "cancel" && (
            <p className="mt-4 rounded-xl bg-[#FAFAF9] p-3 text-sm text-[#6B6661]">
              Payment cancelled. Nothing was charged.
            </p>
          )}
        </section>

        <section className="panel p-6">
          <h2 className="section-title">Statement</h2>
          <ul className="mt-3 divide-y divide-[#F0EDE9] text-sm">
            {entries.data?.items.map((e) => (
              <li key={e.id} className="flex items-center justify-between py-2">
                <div>
                  <p>{e.description}</p>
                  <p className="text-xs text-muted">{dateTime(e.createdAt)}</p>
                </div>
                <div className="text-right">
                  <p className={`font-mono ${e.amountCents < 0 ? "text-ink" : "text-[#1B7F4B]"}`}>
                    {e.amountCents > 0 ? "+" : ""}
                    {rands(e.amountCents)}
                  </p>
                  <p className="font-mono text-xs text-muted">{rands(e.balanceAfterCents)}</p>
                </div>
              </li>
            ))}
            {entries.data?.items.length === 0 && (
              <li className="py-6 text-center text-muted">No movements yet.</li>
            )}
          </ul>
        </section>
      </div>

      <div className="space-y-6">
        <form onSubmit={topUp} className="panel p-6 text-sm">
          <h2 className="section-title">Top up</h2>
          {providers.data?.providers.length === 0 ? (
            <p className="mt-3 text-[#6B6661]">
              Top-ups are not configured yet. Contact us to load your account.
            </p>
          ) : (
            <>
              <label className="mt-3 block">
                <span className="font-medium">Method</span>
                <select
                  value={provider}
                  onChange={(e) => setProvider(e.target.value as PaymentProviderName)}
                  className="mt-1 w-full rounded-xl border border-[#DAD6CF] p-3 bg-white"
                >
                  {providers.data?.providers.map((p) => (
                    <option key={p} value={p}>
                      {PROVIDER_LABELS[p]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="mt-3 block">
                <span className="font-medium">Amount (R)</span>
                <input
                  type="number"
                  min={50}
                  step="1"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-[#DAD6CF] p-3"
                  required
                />
              </label>
              <div className="mt-2 flex gap-2">
                {[250, 500, 1000, 2500].map((v) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => setAmount(String(v))}
                    className="btn btn-secondary btn-sm"
                  >
                    R{v}
                  </button>
                ))}
              </div>
              <button
                disabled={busy || !provider}
                className="mt-4 w-full rounded-2xl bg-ink py-3 font-medium text-white hover:bg-brand-pink transition-colors disabled:opacity-40"
              >
                {busy ? "Please wait…" : "Continue"}
              </button>
            </>
          )}
          {error && <p className="mt-3 text-[#C13B73]">{error}</p>}
        </form>

        {result?.instructions.type === "eft" && (
          <div className="rounded-xl border border-[#0A0A0A] bg-white p-6 text-sm">
            <h2 className="section-title">Pay {rands(result.topUp.amountCents)} by EFT</h2>
            <dl className="mt-3 space-y-1">
              <Row k="Account name" v={result.instructions.bank.accountName} />
              <Row k="Bank" v={result.instructions.bank.bankName} />
              <Row k="Account number" v={result.instructions.bank.accountNumber} mono />
              <Row k="Branch code" v={result.instructions.bank.branchCode} mono />
              <Row k="Reference" v={result.instructions.reference} mono strong />
            </dl>
            <p className="mt-3 text-xs text-[#6B6661]">{result.instructions.note}</p>
          </div>
        )}

        <section className="panel p-6 text-sm">
          <h2 className="section-title">Top-up history</h2>
          <ul className="mt-3 divide-y divide-[#F0EDE9]">
            {topUps.data?.items.map((t) => (
              <li key={t.id} className="flex justify-between py-2">
                <div>
                  <p className="font-mono">{t.reference}</p>
                  <p className="text-xs text-muted">
                    {PROVIDER_LABELS[t.provider]} · {dateTime(t.createdAt)}
                  </p>
                </div>
                <div className="text-right">
                  <p className="font-mono">{rands(t.amountCents)}</p>
                  <p
                    className={`text-xs ${t.status === "confirmed" ? "text-[#1B7F4B]" : t.status === "pending" ? "text-[#B7791F]" : "text-muted"}`}
                  >
                    {t.status}
                  </p>
                </div>
              </li>
            ))}
            {topUps.data?.items.length === 0 && (
              <li className="py-4 text-center text-muted">No top-ups yet.</li>
            )}
          </ul>
        </section>
      </div>
    </div>
  );
}

function submitRedirect(i: {
  url: string;
  method: "GET" | "POST";
  fields?: Record<string, string>;
}) {
  if (i.method === "GET") {
    window.location.assign(i.url);
    return;
  }
  const form = document.createElement("form");
  form.method = "POST";
  form.action = i.url;
  for (const [k, v] of Object.entries(i.fields ?? {})) {
    const input = document.createElement("input");
    input.type = "hidden";
    input.name = k;
    input.value = v;
    form.appendChild(input);
  }
  document.body.appendChild(form);
  form.submit();
}

function Stat({
  label,
  value,
  hint,
  strong,
}: {
  label: string;
  value: string;
  hint?: string;
  strong?: boolean;
}) {
  return (
    <div>
      <dt className="text-muted">{label}</dt>
      <dd className={`font-mono ${strong ? "text-xl font-bold" : "text-lg"}`}>{value}</dd>
      {hint && <dd className="text-xs text-muted">{hint}</dd>}
    </div>
  );
}

function Row({ k, v, mono, strong }: { k: string; v: string; mono?: boolean; strong?: boolean }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-muted">{k}</dt>
      <dd className={`${mono ? "font-mono" : ""} ${strong ? "font-bold text-brand-pink" : ""}`}>
        {v}
      </dd>
    </div>
  );
}
