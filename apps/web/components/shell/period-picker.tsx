"use client";

import { useEffect, useRef, useState } from "react";
import {
  PERIOD_LABELS,
  formatRange,
  resolvePeriod,
  type DateRange,
  type PeriodKey,
} from "@delicate/contracts";

export interface PeriodState {
  key: PeriodKey;
  from: string | null;
  to: string | null;
}

export const DEFAULT_PERIOD: PeriodState = { key: "today", from: null, to: null };

/** What the picker currently means, in calendar dates. */
export function periodRange(state: PeriodState): DateRange {
  return resolvePeriod(state.key, { from: state.from, to: state.to });
}

/**
 * The period selector: a row of chips for the spans people actually ask for, and a custom
 * range behind the last one.
 *
 * Presets rather than two date boxes because almost every question is one of these — "what is
 * happening today", "how did last month go" — and making someone pick two dates to ask it is
 * friction charged on every visit. The custom range is there for the rest.
 */
export function PeriodPicker({
  value,
  onChange,
  presets = ["today", "yesterday", "last7", "last28", "this_month", "last_month"],
}: {
  value: PeriodState;
  onChange: (next: PeriodState) => void;
  presets?: PeriodKey[];
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<{ from: string; to: string }>(() => {
    const r = periodRange(value);
    return { from: r.from, to: r.to };
  });
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [open]);

  const chip = (active: boolean) =>
    `rounded-xl px-3 py-1.5 text-[13px] transition-colors ${
      active
        ? "bg-white font-medium text-ink shadow-sm"
        : "text-[#6B6661] hover:bg-white/70 hover:text-ink"
    }`;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex flex-wrap items-center gap-0.5 rounded-2xl bg-[#F3F1ED] p-1">
        {presets.map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => onChange({ key: k, from: null, to: null })}
            className={chip(value.key === k)}
          >
            {PERIOD_LABELS[k]}
          </button>
        ))}

        <div ref={box} className="relative">
          <button
            type="button"
            onClick={() => setOpen(!open)}
            aria-expanded={open}
            className={`${chip(value.key === "custom")} flex items-center gap-1`}
          >
            {value.key === "custom" ? formatRange(periodRange(value)) : "Custom"}
            <span className="material-symbols-outlined text-[16px]" aria-hidden="true">
              expand_more
            </span>
          </button>

          {open && (
            <div className="absolute right-0 top-full z-40 mt-2 w-72 rounded-xl border border-line bg-white p-4 shadow-lg">
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="field-label">From</span>
                  <input
                    type="date"
                    value={draft.from}
                    max={draft.to}
                    onChange={(e) => setDraft({ ...draft, from: e.target.value })}
                    className="input mt-1"
                  />
                </label>
                <label className="block">
                  <span className="field-label">To</span>
                  <input
                    type="date"
                    value={draft.to}
                    min={draft.from}
                    onChange={(e) => setDraft({ ...draft, to: e.target.value })}
                    className="input mt-1"
                  />
                </label>
              </div>
              <button
                type="button"
                disabled={!draft.from || !draft.to}
                onClick={() => {
                  onChange({ key: "custom", from: draft.from, to: draft.to });
                  setOpen(false);
                }}
                className="btn btn-primary btn-sm mt-3 w-full"
              >
                Apply
              </button>
            </div>
          )}
        </div>
      </div>

      {/* The chips say which preset; this says what that actually means in dates, because
          "last month" is ambiguous enough to be worth spelling out next to the numbers. */}
      <span className="text-xs text-muted">{formatRange(periodRange(value))}</span>
    </div>
  );
}
