"use client";

import { useCallback, useEffect, useState } from "react";
import type { TrackingView } from "@delicate/contracts";
import { SHIPMENT_STATUS_LABELS as LABELS } from "@delicate/contracts";
import { api, ApiRequestError } from "@/lib/api";
import { dateTime } from "@/lib/money";

export default function TrackForm({ initial = "" }: { initial?: string }) {
  const [waybill, setWaybill] = useState(initial);
  const [view, setView] = useState<TrackingView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const lookUp = useCallback(async (number: string) => {
    const trimmed = number.trim();
    if (!trimmed) return;
    setBusy(true);
    setError(null);
    setView(null);
    try {
      setView(
        await api<TrackingView>(`/v1/public/track/${encodeURIComponent(trimmed)}`, {
          account: null,
        }),
      );
    } catch (err) {
      setError(
        err instanceof ApiRequestError && err.status === 404
          ? "We could not find that waybill. Check the number on your booking confirmation."
          : String(err),
      );
    } finally {
      setBusy(false);
    }
  }, []);

  /*
    A link that carries the waybill has already asked the question.

    Every notification we send links here with the number in it, and the page put it in the
    box and waited to be asked again -- so "Track your delivery" landed on a form that said
    "where is my delivery?" and showed nothing. Somebody who clicked a tracking link has
    tracked.
  */
  useEffect(() => {
    if (initial.trim()) void lookUp(initial);
  }, [initial, lookUp]);

  async function track(e?: React.FormEvent) {
    e?.preventDefault();
    await lookUp(waybill);
  }

  return (
    <div className="mx-auto max-w-lg">
      <form onSubmit={track} className="mt-8 flex flex-col sm:flex-row gap-3">
        <input
          value={waybill}
          onChange={(e) => setWaybill(e.target.value)}
          placeholder="e.g. W9RT4H"
          required
          className="flex-1 rounded-2xl border border-[#DAD6CF] px-5 py-3 font-mono text-[14px] focus:outline-none focus:border-[#0A0A0A]"
        />
        <button
          disabled={busy}
          className="bg-[#0A0A0A] text-white px-8 py-3 rounded-2xl text-[14px] font-medium hover:bg-[#E84A8A] transition-colors active:scale-95 disabled:opacity-50"
        >
          Track
        </button>
      </form>
      {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

      {view && (
        <div className="mt-8 rounded-xl border border-[#ECEAE6] bg-white p-6 text-left">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="font-mono text-sm text-[#86817A]">{view.waybill}</p>
              <p className="mt-1 text-2xl font-bold">{LABELS[view.status]}</p>
              <p className="mt-1 text-sm text-[#6B6661]">
                {view.serviceLevel}
                {view.slot && ` · ${view.slot.date} · ${view.slot.label}`}
                {view.destination.suburb && ` · to ${view.destination.suburb}`}
              </p>
            </div>
            <span
              aria-hidden
              className={`material-symbols-outlined text-3xl ${view.status === "delivered" ? "text-[#7C5CFF]" : "text-[#E84A8A]"}`}
            >
              {view.status === "delivered" ? "task_alt" : "local_shipping"}
            </span>
          </div>
          <ol className="mt-6 space-y-3 border-l-2 border-[#F0EDE9] pl-4">
            {view.timeline.map((t, i) => (
              <li key={i} className="relative text-sm">
                <span className="absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full bg-[#E84A8A]" />
                <span className="font-medium">{LABELS[t.status]}</span>
                <span className="ml-2 text-[#86817A]">{dateTime(t.occurredAt)}</span>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}
