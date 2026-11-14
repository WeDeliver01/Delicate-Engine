"use client";

import Link from "next/link";
import { use, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Booking } from "@delicate/contracts";
import { api, ApiRequestError } from "@/lib/api";
import { dateTime, minutesToClock } from "@/lib/money";
import { Breakdown } from "@/components/booking/breakdown";
import { StatusBadge } from "@/components/booking/status-badge";
import { useMe } from "@/components/use-me";

/**
 * One booking as the office sees it: the collection, the price, and every drop on it with a
 * link through to the drop. The console's bookings table used to be the end of the road; a
 * reference you could read but not open.
 */
export default function AdminBookingDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const me = useMe();
  const qc = useQueryClient();
  const role = me.data?.user.platformRole;
  const canCancel = role === "super_admin" || role === "dispatcher";

  const booking = useQuery({
    queryKey: ["admin", "booking", id],
    queryFn: () => api<Booking>(`/v1/admin/bookings/${id}`),
  });

  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const cancel = useMutation({
    mutationFn: () =>
      api<Booking>(`/v1/admin/bookings/${id}/cancel`, { method: "POST", json: { reason } }),
    onSuccess: () => {
      setError(null);
      void qc.invalidateQueries({ queryKey: ["admin"] });
    },
    onError: (err) => setError(err instanceof ApiRequestError ? err.message : String(err)),
  });

  if (booking.isLoading) return <p className="lede">Loading…</p>;
  if (booking.error) return <p className="alert-error">{(booking.error as Error).message}</p>;
  const b = booking.data;
  if (!b) return null;

  const cancellable =
    canCancel &&
    (b.status === "confirmed" || b.status === "in_progress") &&
    b.shipments.every((s) => ["booked", "assigned", "cancelled"].includes(s.status));
  const collectionWhen = b.slotDate
    ? [
        b.slotDate,
        b.slotWindowKey,
        b.collectionWindow &&
          `${minutesToClock(b.collectionWindow.startMinute)}–${minutesToClock(b.collectionWindow.endMinute)}`,
      ]
        .filter(Boolean)
        .join(" · ")
    : "Not scheduled";

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/admin/bookings" className="link-quiet text-xs">
            ← All bookings
          </Link>
          <h1 className="page-title mt-1 font-mono">{b.reference}</h1>
          <p className="lede mt-1">
            {b.serviceLevelCode.replace(/_/g, " ")}
            {b.customerReference && ` · ref ${b.customerReference}`} · placed{" "}
            {dateTime(b.createdAt)}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={b.status} />
          <Link href={`/admin/accounts/${b.accountId}`} className="btn btn-secondary btn-sm">
            Account
          </Link>
        </div>
      </header>

      {b.rejectionReason && <p className="alert-error">{b.rejectionReason}</p>}

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <section className="panel">
            <div className="panel-head">
              <h2 className="section-title">Collection</h2>
            </div>
            <div className="panel-body grid gap-4 text-sm sm:grid-cols-2">
              <div>
                <p className="label-mini">Collect from</p>
                <p className="mt-1">{b.collection.address.formatted}</p>
                {b.collection.contact ? (
                  <p className="mt-1 text-[#6B6661]">
                    {b.collection.contact.name} ·{" "}
                    <a href={`tel:${b.collection.contact.phone}`} className="link-accent">
                      {b.collection.contact.phone}
                    </a>
                    {b.collection.contact.altPhone && (
                      <>
                        {" / "}
                        <a href={`tel:${b.collection.contact.altPhone}`} className="link-accent">
                          {b.collection.contact.altPhone}
                        </a>
                      </>
                    )}
                  </p>
                ) : (
                  <p className="mt-1 text-muted">No contact given.</p>
                )}
              </div>
              <div>
                <p className="label-mini">Requested collection</p>
                <p className="mt-1 font-semibold">{collectionWhen}</p>
                <p className="label-mini mt-3">Collection instructions</p>
                {b.collection.instructions ? (
                  <p className="mt-1 whitespace-pre-line rounded-xl border border-[#F3E2A7] bg-[#FBF1D6] px-3 py-2 text-[#5A4206]">
                    {b.collection.instructions}
                  </p>
                ) : (
                  <p className="mt-1 text-muted">None given.</p>
                )}
              </div>
            </div>
          </section>

          <section className="panel">
            <div className="panel-head">
              <h2 className="section-title">
                {b.shipments.length} {b.shipments.length === 1 ? "drop" : "drops"}
              </h2>
            </div>
            {b.shipments.length === 0 ? (
              <p className="table-empty">No shipments on this booking.</p>
            ) : (
              <ul className="divide-y divide-[#F0EDE9] text-sm">
                {b.shipments.map((s) => (
                  <li key={s.id} className="px-5 py-4 sm:px-6">
                    <div className="flex items-center justify-between gap-4">
                      <Link
                        href={`/admin/shipments/${s.id}`}
                        className="font-mono font-semibold hover:underline"
                      >
                        {s.waybill}
                      </Link>
                      <StatusBadge status={s.status} />
                    </div>
                    <p className="mt-1">{s.deliveryAddress.formatted}</p>
                    <p className="text-[#6B6661]">
                      {s.recipient.name} ·{" "}
                      <a href={`tel:${s.recipient.phone}`} className="link-accent">
                        {s.recipient.phone}
                      </a>
                      {s.slotDate &&
                        ` · ${s.slotDate}${s.slotWindowKey ? ` ${s.slotWindowKey}` : ""}`}
                    </p>
                    {s.instructions && (
                      <p className="mt-1 text-xs text-[#5A4206]">{s.instructions}</p>
                    )}
                    <p className="mt-1 text-xs text-muted">
                      {s.parcels
                        .map((p) => `${p.quantity} × ${p.description ?? "parcel"}`)
                        .join(", ") || "No parcels listed"}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <aside className="space-y-5">
          <section className="panel p-6">
            <h2 className="section-title">Price</h2>
            <div className="mt-3">
              <Breakdown b={b.breakdown} />
            </div>
          </section>

          {cancellable && (
            <section className="panel p-6 text-sm">
              <h2 className="section-title">Cancel booking</h2>
              <p className="mt-1 text-[#6B6661]">
                Nothing has been collected yet. The hold returns to the customer's wallet.
              </p>
              <input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Reason"
                className="input mt-3 w-full"
              />
              <button
                type="button"
                disabled={reason.trim().length < 3 || cancel.isPending}
                onClick={() => cancel.mutate()}
                className="btn btn-danger mt-3 w-full"
              >
                Cancel this booking
              </button>
              {error && <p className="mt-2 text-[#C13B73]">{error}</p>}
            </section>
          )}
        </aside>
      </div>
    </div>
  );
}
