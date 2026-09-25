"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { PackageType, RateCard, ServiceLevel } from "@delicate/contracts";
import { api, ApiRequestError } from "@/lib/api";

/**
 * Pricing levers. Money fields are edited in rands and stored in cents; percentages edited as
 * % and stored in basis points. Every save is audited on the engine.
 */
export default function AdminCatalog() {
  const qc = useQueryClient();
  const cards = useQuery({
    queryKey: ["admin", "catalog", "rate-cards"],
    queryFn: () => api<RateCard[]>("/v1/admin/catalog/rate-cards"),
  });
  const levels = useQuery({
    queryKey: ["admin", "catalog", "service-levels"],
    queryFn: () => api<ServiceLevel[]>("/v1/admin/catalog/service-levels"),
  });
  const types = useQuery({
    queryKey: ["admin", "catalog", "package-types"],
    queryFn: () => api<PackageType[]>("/v1/admin/catalog/package-types"),
  });
  const [error, setError] = useState<string | null>(null);
  const invalidate = () => void qc.invalidateQueries({ queryKey: ["admin", "catalog"] });
  const onError = (e: unknown) =>
    setError(
      e instanceof ApiRequestError
        ? `${e.message} ${JSON.stringify(e.error.details ?? "")}`
        : String(e),
    );

  return (
    <div className="space-y-6">
      {error && <p className="alert-error">{error}</p>}
      {cards.data?.map((c) => (
        <RateCardForm key={c.id} card={c} onSaved={invalidate} onError={onError} />
      ))}
      <section className="panel p-5">
        <h2 className="section-title">Service levels</h2>
        <div className="mt-3 grid gap-4 md:grid-cols-2">
          {levels.data?.map((s) => (
            <ServiceLevelForm key={s.id} level={s} onSaved={invalidate} onError={onError} />
          ))}
        </div>
      </section>
      <section className="panel p-5">
        <h2 className="section-title">Package types</h2>
        <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {types.data?.map((p) => (
            <PackageTypeForm key={p.id} pt={p} onSaved={invalidate} onError={onError} />
          ))}
        </div>
      </section>
    </div>
  );
}

const MONEY: (keyof RateCard)[] = [
  "costPerKmCents",
  "minFeeCents",
  "extraDropFeeCents",
  "liabilityCoverMinCents",
  "earlyCollectionFeeCents",
  "signatureFeeCents",
  "weddingVenueFeeCents",
];
const PCT: (keyof RateCard)[] = [
  "marginBps",
  "fuelSurchargeBps",
  "liabilityCoverBps",
  "roadFactorBps",
];
const LABELS: Partial<Record<keyof RateCard, string>> = {
  costPerKmCents: "Cost per km (R)",
  marginBps: "Gross margin (%)",
  fuelSurchargeBps: "Fuel surcharge (%)",
  minFeeCents: "Minimum fee (R)",
  extraDropFeeCents: "Extra drop fee (R)",
  liabilityCoverBps: "Liability cover (% of declared)",
  liabilityCoverMinCents: "Liability cover minimum (R)",
  earlyCollectionFeeCents: "Early collection (R)",
  signatureFeeCents: "Signature on delivery (R)",
  weddingVenueFeeCents: "Wedding venue (R)",
  roadFactorBps: "Road factor (% of straight line)",
};

function RateCardForm({
  card,
  onSaved,
  onError,
}: {
  card: RateCard;
  onSaved: () => void;
  onError: (e: unknown) => void;
}) {
  const [form, setForm] = useState<Record<string, string>>({});
  useEffect(() => {
    const f: Record<string, string> = {};
    for (const k of MONEY) f[k] = (Number(card[k]) / 100).toFixed(2);
    for (const k of PCT) f[k] = (Number(card[k]) / 100).toFixed(2);
    setForm(f);
  }, [card]);
  const save = useMutation({
    mutationFn: () => {
      const body: Record<string, unknown> = {
        name: card.name,
        isDefault: card.isDefault,
        active: card.active,
      };
      for (const k of MONEY) body[k] = Math.round(Number(form[k]) * 100);
      for (const k of PCT) body[k] = Math.round(Number(form[k]) * 100);
      return api(`/v1/admin/catalog/rate-cards/${card.id}`, { method: "PUT", json: body });
    },
    onSuccess: onSaved,
    onError,
  });
  return (
    <section className="panel p-5">
      <div className="flex items-center justify-between">
        <h2 className="section-title">
          Rate card · {card.name}{" "}
          {card.isDefault && (
            <span className="ml-2 rounded-full bg-[#EFE9FF] px-2 py-0.5 text-xs text-[#5B43C9]">
              default
            </span>
          )}
        </h2>
        <button
          onClick={() => save.mutate()}
          disabled={save.isPending}
          className="btn btn-primary btn-sm disabled:opacity-40"
        >
          Save
        </button>
      </div>
      <p className="mt-1 text-xs text-muted">
        price = distance × cost/km ÷ (1 − margin) × service multiplier + surcharges, floored at the
        minimum fee, then VAT.
      </p>
      <div className="mt-4 grid gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {[...MONEY, ...PCT].map((k) => (
          <label key={k} className="block text-sm">
            <span className="text-[#6B6661]">{LABELS[k]}</span>
            <input
              type="number"
              step="0.01"
              value={form[k] ?? ""}
              onChange={(e) => setForm({ ...form, [k]: e.target.value })}
              className="mt-1 w-full input px-2 py-1.5 font-mono"
            />
          </label>
        ))}
      </div>
    </section>
  );
}

function ServiceLevelForm({
  level,
  onSaved,
  onError,
}: {
  level: ServiceLevel;
  onSaved: () => void;
  onError: (e: unknown) => void;
}) {
  const [f, setF] = useState({
    name: level.name,
    description: level.description ?? "",
    multiplier: (level.multiplierBps / 100).toFixed(0),
    surcharge: (level.surchargeCents / 100).toFixed(2),
    active: level.active,
  });
  const save = useMutation({
    mutationFn: () =>
      api(`/v1/admin/catalog/service-levels/${level.id}`, {
        method: "PUT",
        json: {
          code: level.code,
          name: f.name,
          description: f.description || null,
          multiplierBps: Math.round(Number(f.multiplier) * 100),
          surchargeCents: Math.round(Number(f.surcharge) * 100),
          requiresSlot: level.requiresSlot,
          sameDayCutoffMinutes: level.sameDayCutoffMinutes,
          sortOrder: level.sortOrder,
          active: f.active,
        },
      }),
    onSuccess: onSaved,
    onError,
  });
  return (
    <div className="panel p-4 text-sm">
      <div className="flex items-center justify-between">
        <span className="font-mono text-xs text-muted">{level.code}</span>
        <label className="flex items-center gap-1 text-xs">
          <input
            type="checkbox"
            checked={f.active}
            onChange={(e) => setF({ ...f, active: e.target.checked })}
          />{" "}
          active
        </label>
      </div>
      <input
        value={f.name}
        onChange={(e) => setF({ ...f, name: e.target.value })}
        className="mt-2 w-full input px-2 py-1.5 font-semibold"
      />
      <textarea
        value={f.description}
        onChange={(e) => setF({ ...f, description: e.target.value })}
        rows={2}
        className="mt-2 w-full input px-2 py-1.5"
      />
      <div className="mt-2 grid grid-cols-2 gap-2">
        <label>
          <span className="text-xs text-[#6B6661]">Multiplier (%)</span>
          <input
            type="number"
            value={f.multiplier}
            onChange={(e) => setF({ ...f, multiplier: e.target.value })}
            className="mt-1 w-full input px-2 py-1 font-mono"
          />
        </label>
        <label>
          <span className="text-xs text-[#6B6661]">Surcharge (R)</span>
          <input
            type="number"
            step="0.01"
            value={f.surcharge}
            onChange={(e) => setF({ ...f, surcharge: e.target.value })}
            className="mt-1 w-full input px-2 py-1 font-mono"
          />
        </label>
      </div>
      <p className="mt-2 text-xs text-muted">
        {level.requiresSlot ? "Needs a delivery slot" : "Immediate dispatch"}
      </p>
      <button onClick={() => save.mutate()} className="mt-3 btn btn-secondary btn-sm">
        Save
      </button>
    </div>
  );
}

function PackageTypeForm({
  pt,
  onSaved,
  onError,
}: {
  pt: PackageType;
  onSaved: () => void;
  onError: (e: unknown) => void;
}) {
  const [f, setF] = useState({
    name: pt.name,
    maxWeightKg: pt.maxWeightKg?.toString() ?? "",
    surcharge: (pt.surchargeCents / 100).toFixed(2),
    active: pt.active,
  });
  const save = useMutation({
    mutationFn: () =>
      api(`/v1/admin/catalog/package-types/${pt.id}`, {
        method: "PUT",
        json: {
          code: pt.code,
          name: f.name,
          description: pt.description,
          category: pt.category,
          maxWeightKg: f.maxWeightKg ? Number(f.maxWeightKg) : null,
          surchargeCents: Math.round(Number(f.surcharge) * 100),
          sortOrder: pt.sortOrder,
          active: f.active,
        },
      }),
    onSuccess: onSaved,
    onError,
  });
  return (
    <div className="panel p-3 text-sm">
      <div className="flex items-center justify-between">
        <span className="font-mono text-xs text-muted">{pt.code}</span>
        <label className="flex items-center gap-1 text-xs">
          <input
            type="checkbox"
            checked={f.active}
            onChange={(e) => setF({ ...f, active: e.target.checked })}
          />{" "}
          active
        </label>
      </div>
      <input
        value={f.name}
        onChange={(e) => setF({ ...f, name: e.target.value })}
        className="mt-2 w-full input px-2 py-1 font-semibold"
      />
      <div className="mt-2 grid grid-cols-2 gap-2">
        <label>
          <span className="text-xs text-[#6B6661]">Max kg</span>
          <input
            type="number"
            step="0.5"
            value={f.maxWeightKg}
            onChange={(e) => setF({ ...f, maxWeightKg: e.target.value })}
            className="mt-1 w-full input px-2 py-1 font-mono"
          />
        </label>
        <label>
          <span className="text-xs text-[#6B6661]">Handling (R)</span>
          <input
            type="number"
            step="0.01"
            value={f.surcharge}
            onChange={(e) => setF({ ...f, surcharge: e.target.value })}
            className="mt-1 w-full input px-2 py-1 font-mono"
          />
        </label>
      </div>
      <button onClick={() => save.mutate()} className="mt-3 btn btn-secondary btn-sm">
        Save
      </button>
    </div>
  );
}
