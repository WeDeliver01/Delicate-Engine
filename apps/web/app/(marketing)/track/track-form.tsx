"use client";

import { useState } from "react";
import type { TrackingView } from "@delicate/contracts";
import { api, ApiRequestError } from "@/lib/api";
import { dateTime } from "@/lib/money";

const LABELS: Record<TrackingView["status"], string> = {
  booked: "Booked",
  assigned: "Driver assigned",
  collected: "Collected",
  in_transit: "On its way",
  delivered: "Delivered",
  failed: "Delivery attempt failed",
  cancelled: "Cancelled",
};

export default function TrackForm({ initial = "" }: { initial?: string }) {
  const [waybill, setWaybill] = useState(initial);
  const [view, setView] = useState<TrackingView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function track(e?: React.FormEvent) {
    e?.preventDefault();
    setBusy(true);
    setError(null);
    setView(null);
    try {
      setView(
        await api<TrackingView>(`/v1/public/track/${encodeURIComponent(waybill.trim())}`, {
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
  }

  return (
    <div className="mx-auto max-w-lg">
      <form onSubmit={track} className="mt-8 flex flex-col sm:flex-row gap-3">
        <input
          value={waybill}
          onChange={(e) => setWaybill(e.target.value)}
          placeholder="e.g. DC-260920-00042"
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
