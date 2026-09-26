"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  SHIPMENT_DATE_TYPE_LABELS,
  SHIPMENT_FLAG_LABELS,
  type SavedFilter,
  type ShipmentDateType,
  type ShipmentFlag,
  type ShipmentStatus,
} from "@delicate/contracts";
import { api } from "@/lib/api";
import { PeriodPicker, periodRange, type PeriodState } from "@/components/shell/period-picker";

export interface ShipmentFilters {
  search: string;
  status: ShipmentStatus[];
  dateType: ShipmentDateType;
  period: PeriodState;
  flags: ShipmentFlag[];
  serviceLevelCode: string | null;
  sort: "newest" | "oldest" | "slot_asc" | "slot_desc";
}

export const EMPTY_FILTERS: ShipmentFilters = {
  search: "",
  status: [],
  dateType: "slot",
  period: { key: "last28", from: null, to: null },
  flags: [],
  serviceLevelCode: null,
  sort: "slot_desc",
};

const STATUSES: { value: ShipmentStatus; label: string }[] = [
  { value: "booked", label: "Booked" },
  { value: "assigned", label: "Assigned" },
  { value: "collected", label: "Collected" },
  { value: "in_transit", label: "Out for delivery" },
  { value: "delivered", label: "Delivered" },
  { value: "failed", label: "Failed" },
  { value: "cancelled", label: "Cancelled" },
];

/** Turn the filter state into the query string the engine expects. */
export function filtersToQuery(f: ShipmentFilters, extra: Record<string, string> = {}): string {
  const p = new URLSearchParams();
  if (f.search.trim()) p.set("search", f.search.trim());
  for (const s of f.status) p.append("status", s);
  for (const fl of f.flags) p.append("flags", fl);
  p.set("dateType", f.dateType);
  const range = periodRange(f.period);
  p.set("period", f.period.key);
  p.set("from", range.from);
  p.set("to", range.to);
  if (f.serviceLevelCode) p.set("serviceLevelCode", f.serviceLevelCode);
  p.set("sort", f.sort);
  for (const [k, v] of Object.entries(extra)) p.set(k, v);
  return p.toString();
}

/** How many narrowing choices are in force, for the "clear" affordance. */
export function activeFilterCount(f: ShipmentFilters): number {
  return (
    (f.search.trim() ? 1 : 0) +
    f.status.length +
    f.flags.length +
    (f.serviceLevelCode ? 1 : 0) +
    (f.period.key === "last28" ? 0 : 1)
  );
}

/**
 * The filter bar.
 *
 * Six controls sit on the bar and answer nearly every question; everything rarer is behind
 * "More filters", found by name rather than scanned for. The reference system puts all sixty
 * on screen at once, which makes the six anyone uses harder to find, not easier.
 */
export function ShipmentFilterBar({
  value,
  onChange,
  scope,
  serviceLevels,
}: {
  value: ShipmentFilters;
  onChange: (next: ShipmentFilters) => void;
  scope: "portal" | "admin";
  serviceLevels?: { code: string; name: string }[];
}) {
  const [more, setMore] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);
  const [name, setName] = useState("");
  const qc = useQueryClient();
  const base = scope === "admin" ? "/v1/admin" : "/v1/account";

  const saved = useQuery({
    queryKey: [scope, "saved-filters"],
    queryFn: () =>
      api<{ items: SavedFilter[] }>(
        scope === "admin" ? "/v1/admin/saved-filters" : "/v1/account/saved-filters?scope=portal",
      ),
  });

  const save = useMutation({
    mutationFn: (filterName: string) =>
      api<SavedFilter>(`${base}/saved-filters`, {
        method: "POST",
        json: { name: filterName, scope, query: value as unknown as Record<string, unknown> },
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: [scope, "saved-filters"] });
      setSaveOpen(false);
      setName("");
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) => api(`${base}/saved-filters/${id}`, { method: "DELETE" }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: [scope, "saved-filters"] }),
  });

  const set = <K extends keyof ShipmentFilters>(key: K, v: ShipmentFilters[K]) =>
    onChange({ ...value, [key]: v });

  const toggle = <T,>(list: T[], item: T): T[] =>
    list.includes(item) ? list.filter((x) => x !== item) : [...list, item];

  const count = activeFilterCount(value);

  return (
    <div className="panel">
      {/* ── The bar ─────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-3 px-5 py-4 sm:px-6">
        <div className="relative min-w-52 flex-1">
          <span
            className="material-symbols-outlined pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[18px] text-muted"
            aria-hidden="true"
          >
            search
          </span>
          <input
            value={value.search}
            onChange={(e) => set("search", e.target.value)}
            placeholder="Waybill, reference, recipient, phone or address"
            className="input pl-9"
          />
        </div>

        <select
          value={value.dateType}
          onChange={(e) => set("dateType", e.target.value as ShipmentDateType)}
          className="input w-auto"
          aria-label="Which date"
        >
          {Object.entries(SHIPMENT_DATE_TYPE_LABELS).map(([k, label]) => (
            <option key={k} value={k}>
              {label}
            </option>
          ))}
        </select>

        <PeriodPicker
          value={value.period}
          onChange={(p) => set("period", p)}
          presets={["today", "tomorrow", "yesterday", "last7", "this_month", "last_month"]}
        />

        <button
          type="button"
          onClick={() => setMore(!more)}
          className="btn btn-secondary btn-sm"
          aria-expanded={more}
        >
          More filters
          {count > 0 && <span className="chip chip-accent">{count}</span>}
        </button>

        {count > 0 && (
          <button
            type="button"
            onClick={() => onChange({ ...EMPTY_FILTERS, sort: value.sort })}
            className="link-quiet text-xs"
          >
            Clear
          </button>
        )}
      </div>

      {/* ── Status, always visible: it is the one filter used every time ── */}
      <div className="flex flex-wrap items-center gap-1.5 border-t border-line px-5 py-3 sm:px-6">
        {STATUSES.map((s) => {
          const on = value.status.includes(s.value);
          return (
            <button
              key={s.value}
              type="button"
              onClick={() => set("status", toggle(value.status, s.value))}
              className={`chip transition-colors ${
                on ? "bg-ink text-white" : "chip-outline hover:border-ink hover:text-ink"
              }`}
            >
              {s.label}
            </button>
          );
        })}
      </div>

      {/* ── The long tail ────────────────────────────────────────────────── */}
      {more && (
        <div className="space-y-4 border-t border-line bg-[#FCFBFA] px-5 py-4 sm:px-6">
          <div>
            <p className="field-label">Only show</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {(Object.keys(SHIPMENT_FLAG_LABELS) as ShipmentFlag[]).map((f) => {
                const on = value.flags.includes(f);
                return (
                  <button
                    key={f}
                    type="button"
                    onClick={() => set("flags", toggle(value.flags, f))}
                    className={`chip transition-colors ${
                      on
                        ? "bg-brand-pink text-white"
                        : "chip-outline hover:border-ink hover:text-ink"
                    }`}
                  >
                    {SHIPMENT_FLAG_LABELS[f]}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {!!serviceLevels?.length && (
              <label className="block">
                <span className="field-label">Service level</span>
                <select
                  value={value.serviceLevelCode ?? ""}
                  onChange={(e) => set("serviceLevelCode", e.target.value || null)}
                  className="input mt-1"
                >
                  <option value="">Any</option>
                  {serviceLevels.map((sl) => (
                    <option key={sl.code} value={sl.code}>
                      {sl.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label className="block">
              <span className="field-label">Sort by</span>
              <select
                value={value.sort}
                onChange={(e) => set("sort", e.target.value as ShipmentFilters["sort"])}
                className="input mt-1"
              >
                <option value="slot_desc">Scheduled date, newest first</option>
                <option value="slot_asc">Scheduled date, oldest first</option>
                <option value="newest">Booked, newest first</option>
                <option value="oldest">Booked, oldest first</option>
              </select>
            </label>
          </div>
        </div>
      )}

      {/* ── Saved searches ───────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2 border-t border-line px-5 py-3 sm:px-6">
        <span className="label-mini">Saved</span>
        {saved.data?.items.length ? (
          saved.data.items.map((f) => (
            <span key={f.id} className="group inline-flex items-center">
              <button
                type="button"
                onClick={() => onChange({ ...EMPTY_FILTERS, ...(f.query as object) })}
                className="chip chip-outline hover:border-ink hover:text-ink"
              >
                {f.name}
              </button>
              <button
                type="button"
                onClick={() => remove.mutate(f.id)}
                aria-label={`Delete ${f.name}`}
                className="ml-0.5 text-muted opacity-0 transition-opacity hover:text-[#C13B73] group-hover:opacity-100"
              >
                <span className="material-symbols-outlined text-[15px]">close</span>
              </button>
            </span>
          ))
        ) : (
          <span className="text-xs text-muted">None yet</span>
        )}

        <div className="relative ml-auto">
          <button
            type="button"
            onClick={() => setSaveOpen(!saveOpen)}
            disabled={count === 0}
            className="link-quiet text-xs disabled:opacity-40"
            title={count === 0 ? "Narrow the list first" : "Save this search"}
          >
            + Save this search
          </button>
          {saveOpen && (
            <div className="absolute right-0 top-full z-30 mt-2 w-64 rounded-xl border border-line bg-white p-3 shadow-lg">
              <label className="block">
                <span className="field-label">Name</span>
                <input
                  autoFocus
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && name.trim() && save.mutate(name.trim())}
                  placeholder="Late deliveries"
                  className="input mt-1"
                />
              </label>
              <button
                type="button"
                disabled={!name.trim() || save.isPending}
                onClick={() => save.mutate(name.trim())}
                className="btn btn-primary btn-sm mt-2 w-full"
              >
                {save.isPending ? "Saving…" : "Save"}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** Debounce the search box so a filtered list is not refetched on every keystroke. */
export function useDebounced<T>(value: T, ms = 300): T {
  const [debounced, setDebounced] = useState(value);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}
