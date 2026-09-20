"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import type { Address, CatalogResponse, EstimateResponse } from "@delicate/contracts";
import { api, ApiRequestError } from "@/lib/api";
import { AddressInput } from "@/components/booking/address-input";
import { Breakdown } from "@/components/booking/breakdown";

export function Estimator() {
  const catalog = useQuery({
    queryKey: ["catalog"],
    queryFn: () => api<CatalogResponse>("/v1/public/catalog", { account: null }),
  });
  const [serviceLevel, setServiceLevel] = useState("standard");
  const [collection, setCollection] = useState<Address | null>(null);
  const [drops, setDrops] = useState<(Address | null)[]>([null]);
  const [packageType, setPackageType] = useState("");
  const [liability, setLiability] = useState(false);
  const [declared, setDeclared] = useState("");
  const [result, setResult] = useState<EstimateResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const ready = collection && drops.every(Boolean) && drops.length > 0;

  async function estimate(e: React.FormEvent) {
    e.preventDefault();
    if (!ready) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api<EstimateResponse>("/v1/public/estimate", {
        method: "POST",
        account: null,
        json: {
          serviceLevelCode: serviceLevel,
          collection,
          drops,
          packageTypeCodes: packageType ? drops.map(() => packageType) : [],
          options: {
            liabilityCover: liability,
            declaredValueCents: liability ? Math.round(Number(declared || 0) * 100) : 0,
          },
        },
      });
      setResult(res);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={estimate}
      className="rounded-xl border border-[#ECEAE6] bg-white p-6 sm:p-8 space-y-5"
    >
      <fieldset className="grid grid-cols-2 gap-3">
        {catalog.data?.serviceLevels.map((sl) => (
          <label
            key={sl.code}
            className={`cursor-pointer rounded-xl border p-4 ${serviceLevel === sl.code ? "border-[#0A0A0A] bg-[#FAFAF9]" : "border-[#ECEAE6]"}`}
          >
            <input
              type="radio"
              className="sr-only"
              checked={serviceLevel === sl.code}
              onChange={() => setServiceLevel(sl.code)}
            />
            <span className="block font-semibold">{sl.name}</span>
            <span className="mt-1 block text-xs text-[#6B6661]">{sl.description}</span>
          </label>
        ))}
      </fieldset>

      <AddressInput
        label="Collect from"
        value={collection}
        onChange={setCollection}
        placeholder="Bakery or business address"
      />

      {drops.map((d, i) => (
        <div key={i} className="flex items-end gap-2">
          <div className="flex-1">
            <AddressInput
              label={drops.length > 1 ? `Deliver to (drop ${i + 1})` : "Deliver to"}
              value={d}
              onChange={(a) => setDrops((ds) => ds.map((x, j) => (j === i ? a : x)))}
            />
          </div>
          {drops.length > 1 && (
            <button
              type="button"
              onClick={() => setDrops((ds) => ds.filter((_, j) => j !== i))}
              className="mb-1 rounded-xl border border-[#DAD6CF] px-3 py-3 text-sm"
              aria-label="Remove drop"
            >
              ×
            </button>
          )}
        </div>
      ))}
      {drops.length < 10 && (
        <button
          type="button"
          onClick={() => setDrops((ds) => [...ds, null])}
          className="text-sm font-medium text-[#E84A8A] hover:text-[#0A0A0A]"
        >
          + Add another drop
        </button>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block text-sm">
          <span className="font-medium">What are we carrying?</span>
          <select
            value={packageType}
            onChange={(e) => setPackageType(e.target.value)}
            className="mt-1 w-full rounded-xl border border-[#DAD6CF] p-3 bg-white"
          >
            <option value="">Select…</option>
            {catalog.data?.packageTypes.map((p) => (
              <option key={p.code} value={p.code}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <div className="text-sm">
          <label className="flex items-center gap-2 pt-7">
            <input
              type="checkbox"
              checked={liability}
              onChange={(e) => setLiability(e.target.checked)}
            />
            <span>Add liability cover</span>
          </label>
          {liability && (
            <input
              type="number"
              min={0}
              step="1"
              value={declared}
              onChange={(e) => setDeclared(e.target.value)}
              placeholder="Declared value (R)"
              className="mt-2 w-full rounded-xl border border-[#DAD6CF] p-3"
            />
          )}
        </div>
      </div>

      <button
        disabled={!ready || busy}
        className="w-full rounded-2xl bg-[#0A0A0A] py-3 text-[14px] font-medium text-white hover:bg-[#E84A8A] transition-colors disabled:opacity-40"
      >
        {busy ? "Calculating…" : "Get estimate"}
      </button>
      {error && <p className="text-sm text-red-600">{error}</p>}

      {result && (
        <div className="rounded-xl bg-[#FAFAF9] p-5">
          <Breakdown b={result.breakdown} />
          <Link
            href="/login?next=/portal/book"
            className="mt-5 block rounded-2xl bg-[#E84A8A] py-3 text-center text-[14px] font-medium text-white hover:bg-[#0A0A0A] transition-colors"
          >
            Book this delivery
          </Link>
          <p className="mt-2 text-center text-xs text-[#86817A]">
            Sign in or create an account to book. Account holders may have negotiated rates.
          </p>
        </div>
      )}
    </form>
  );
}
