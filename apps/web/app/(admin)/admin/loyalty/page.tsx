"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { LoyaltyProgram, LoyaltyTier } from "@delicate/contracts";
import { api, ApiRequestError } from "@/lib/api";
import { rands } from "@/lib/money";
import { Notice, PageHeader, Panel } from "@/components/ui";

interface Cost {
  awards: number;
  totalCents: number;
  byTier: Record<string, number>;
}

/** The rewards programme is a business decision about margin, so it is set here, not in code. */
export default function AdminLoyalty() {
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const program = useQuery({
    queryKey: ["admin", "loyalty", "program"],
    queryFn: () => api<LoyaltyProgram>("/v1/admin/loyalty/program"),
  });
  const cost = useQuery({
    queryKey: ["admin", "loyalty", "cost"],
    queryFn: () => api<Cost>("/v1/admin/loyalty/cost"),
  });

  const [draft, setDraft] = useState<LoyaltyProgram | null>(null);
  useEffect(() => {
    if (program.data) setDraft(program.data);
  }, [program.data]);

  const save = useMutation({
    mutationFn: (body: LoyaltyProgram) =>
      api("/v1/admin/loyalty/program", { method: "PUT", json: body }),
    onSuccess: () => {
      setError(null);
      setSaved(true);
      void qc.invalidateQueries({ queryKey: ["admin", "loyalty"] });
    },
    onError: (e: unknown) => {
      setSaved(false);
      setError(e instanceof ApiRequestError ? e.message : String(e));
    },
  });

  if (!draft) return <p className="text-sm text-muted">Loading…</p>;

  const set = (patch: Partial<LoyaltyProgram>) => {
    setSaved(false);
    setDraft({ ...draft, ...patch });
  };
  const setTier = (i: number, patch: Partial<LoyaltyTier>) => {
    const tiers = draft.tiers.map((t, n) => (n === i ? { ...t, ...patch } : t));
    set({ tiers });
  };

  return (
    <div className="max-w-3xl space-y-6">
      <PageHeader
        title="Rewards"
        lede="Cashback is paid into the customer's wallet, so it costs exactly what it says and comes back as the next delivery. Earned on the charge excluding VAT — VAT is SARS's money passing through."
      />

      <Notice tone="error">{error}</Notice>
      {saved && <Notice tone="success">Programme saved.</Notice>}

      {cost.data && (
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="panel p-4">
            <div className="label-mini">Cashback paid out</div>
            <div className="figure mt-1.5 text-lg">{rands(cost.data.totalCents)}</div>
          </div>
          <div className="panel p-4">
            <div className="label-mini">Awards made</div>
            <div className="figure mt-1.5 text-lg">{cost.data.awards}</div>
          </div>
          <div className="panel p-4">
            <div className="label-mini">Average award</div>
            <div className="figure mt-1.5 text-lg">
              {rands(cost.data.awards ? Math.round(cost.data.totalCents / cost.data.awards) : 0)}
            </div>
          </div>
        </div>
      )}

      <Panel title="Programme" className="p-5 sm:p-6">
        <label className="flex items-center gap-3 text-sm">
          <input
            type="checkbox"
            checked={draft.enabled}
            onChange={(e) => set({ enabled: e.target.checked })}
            className="checkbox"
          />
          Run a rewards programme
        </label>

        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <label className="block text-sm">
            <span className="field-label">Tier window (days)</span>
            <input
              type="number"
              value={draft.windowDays}
              onChange={(e) => set({ windowDays: Number(e.target.value) })}
              className="input mt-1.5 font-mono"
            />
            <span className="field-hint">
              How far back spend is counted when working out someone&apos;s tier.
            </span>
          </label>
          <label className="block text-sm">
            <span className="field-label">Smallest award (rands)</span>
            <input
              type="number"
              value={draft.minAwardCents / 100}
              onChange={(e) => set({ minAwardCents: Math.round(Number(e.target.value) * 100) })}
              className="input mt-1.5 font-mono"
            />
            <span className="field-hint">
              Below this nothing is paid — it costs more to explain than it is worth.
            </span>
          </label>
        </div>

        <h3 className="mt-6 label-mini">Tiers</h3>
        <p className="mt-1 text-xs text-muted">
          The first tier must start at 0 so every customer has one. A tier is earned on spend before
          a delivery, so one large booking cannot promote itself.
        </p>
        <div className="mt-3 space-y-3">
          {draft.tiers.map((t, i) => (
            <div key={i} className="grid gap-3 rounded-xl bg-[#FAFAF9] p-3 sm:grid-cols-4">
              <label className="block text-sm">
                <span className="field-label">Name</span>
                <input
                  value={t.name}
                  onChange={(e) => setTier(i, { name: e.target.value })}
                  className="input mt-1.5"
                />
              </label>
              <label className="block text-sm">
                <span className="field-label">Code</span>
                <input
                  value={t.code}
                  onChange={(e) =>
                    setTier(i, { code: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "") })
                  }
                  className="input mt-1.5 font-mono"
                />
              </label>
              <label className="block text-sm">
                <span className="field-label">Reached at (rands)</span>
                <input
                  type="number"
                  value={t.minSpendCents / 100}
                  onChange={(e) =>
                    setTier(i, { minSpendCents: Math.round(Number(e.target.value) * 100) })
                  }
                  className="input mt-1.5 font-mono"
                />
              </label>
              <label className="block text-sm">
                <span className="field-label">Cashback (bps)</span>
                <input
                  type="number"
                  value={t.cashbackBps}
                  onChange={(e) => setTier(i, { cashbackBps: Number(e.target.value) })}
                  className="input mt-1.5 font-mono"
                />
                <span className="field-hint">{(t.cashbackBps / 100).toFixed(2)}% back</span>
              </label>
            </div>
          ))}
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          {draft.tiers.length < 6 && (
            <button
              onClick={() =>
                set({
                  tiers: [
                    ...draft.tiers,
                    {
                      code: `tier-${draft.tiers.length + 1}`,
                      name: "New tier",
                      minSpendCents: 0,
                      cashbackBps: 100,
                    },
                  ],
                })
              }
              className="btn btn-secondary btn-sm"
            >
              Add a tier
            </button>
          )}
          {draft.tiers.length > 1 && (
            <button
              onClick={() => set({ tiers: draft.tiers.slice(0, -1) })}
              className="link-quiet text-sm"
            >
              remove the last tier
            </button>
          )}
          <button
            onClick={() => save.mutate(draft)}
            disabled={save.isPending}
            className="btn btn-primary ml-auto"
          >
            Save programme
          </button>
        </div>

        <p className="mt-5 rounded-xl bg-[#FAFAF9] p-3 text-xs text-[#6B6661]">
          A R500 delivery excluding VAT earns{" "}
          <span className="figure">
            {rands(Math.floor((50_000 * (draft.tiers[0]?.cashbackBps ?? 0)) / 10_000))}
          </span>{" "}
          at {draft.tiers[0]?.name ?? "the first tier"} and{" "}
          <span className="figure">
            {rands(
              Math.floor(
                (50_000 * (draft.tiers[draft.tiers.length - 1]?.cashbackBps ?? 0)) / 10_000,
              ),
            )}
          </span>{" "}
          at {draft.tiers[draft.tiers.length - 1]?.name ?? "the top tier"}.
        </p>
      </Panel>
    </div>
  );
}
