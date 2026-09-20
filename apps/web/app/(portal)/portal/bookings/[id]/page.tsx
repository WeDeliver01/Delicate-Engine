"use client";

import { use, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Booking } from "@delicate/contracts";
import { useMe } from "@/components/use-me";
import { api, ApiRequestError } from "@/lib/api";
import { dateTime } from "@/lib/money";
import { Breakdown } from "@/components/booking/breakdown";
import { StatusBadge } from "@/components/booking/status-badge";

export default function BookingDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const me = useMe();
  const qc = useQueryClient();
  const isNew = useSearchParams().get("new") === "1";
  const account = me.activeAccount;
  const key = ["account", account?.id, "bookings", id];
  const q = useQuery({
    queryKey: key,
    queryFn: () => api<Booking>(`/v1/account/bookings/${id}`),
    enabled: !!account,
  });
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const cancel = useMutation({
    mutationFn: () =>
      api<Booking>(`/v1/account/bookings/${id}/cancel`, { method: "POST", json: { reason } }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["account", account?.id] }),
    onError: (err) => setError(err instanceof ApiRequestError ? err.message : String(err)),
  });

  if (!account || !q.data) return null;
  const b = q.data;
  const cancellable =
    (b.status === "confirmed" || b.status === "in_progress") &&
    b.shipments.every((s) => ["booked", "assigned", "cancelled"].includes(s.status));

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="space-y-6 lg:col-span-2">
        {isNew && (
          <div className="rounded-xl border border-[#7C5CFF] bg-[#EFE9FF] p-5">
            <p className="font-semibold">Booking confirmed</p>
            <p className="mt-1 text-sm text-[#3A3631]">
              Your waybill numbers are below. Share them with your recipients so they can track
              their delivery.
            </p>
          </div>
        )}
        <section className="rounded-xl border border-[#ECEAE6] bg-white p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs text-[#86817A]">Booking</p>
              <h1 className="font-mono text-2xl font-bold">{b.reference}</h1>
              <p className="mt-1 text-sm text-[#6B6661]">
                {b.serviceLevelCode.replace("_", " ")}
                {b.slotDate && ` · ${b.slotDate} · ${b.slotWindowKey}`} · placed{" "}
                {dateTime(b.createdAt)}
              </p>
            </div>
            <StatusBadge status={b.status} />
          </div>
          <div className="mt-5 text-sm">
            <p className="text-[#86817A]">Collection</p>
            <p>{b.collection.address.formatted}</p>
            {b.collection.contact && (
              <p className="text-[#6B6661]">
                {b.collection.contact.name} · {b.collection.contact.phone}
              </p>
            )}
            {b.collection.instructions && (
              <p className="text-[#6B6661]">{b.collection.instructions}</p>
            )}
          </div>
        </section>

        <section className="rounded-xl border border-[#ECEAE6] bg-white">
          <h2 className="border-b border-[#ECEAE6] px-6 py-4 font-semibold">Shipments</h2>
          <ul className="divide-y divide-[#F0EDE9] text-sm">
            {b.shipments.map((s) => (
              <li key={s.id} className="px-6 py-4">
                <div className="flex items-center justify-between gap-4">
                  <Link
                    href={`/track?w=${s.waybill}`}
                    className="font-mono font-semibold hover:underline"
                  >
                    {s.waybill}
                  </Link>
                  <StatusBadge status={s.status} />
                </div>
                <p className="mt-1">{s.deliveryAddress.formatted}</p>
                <p className="text-[#6B6661]">
                  {s.recipient.name} · {s.recipient.phone}
                  {s.instructions && ` · ${s.instructions}`}
                </p>
                <p className="text-xs text-[#86817A]">
                  {s.parcels.map((p) => `${p.quantity} × ${p.description ?? "parcel"}`).join(", ")}
                </p>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <aside className="space-y-6">
        <section className="rounded-xl border border-[#ECEAE6] bg-white p-6">
          <h2 className="font-semibold">Price</h2>
          <div className="mt-3">
            <Breakdown b={b.breakdown} />
          </div>
        </section>
        {cancellable && (
          <section className="rounded-xl border border-[#ECEAE6] bg-white p-6 text-sm">
            <h2 className="font-semibold">Cancel booking</h2>
            <p className="mt-1 text-[#6B6661]">
              Free until we collect. The reserved amount returns to your wallet immediately.
            </p>
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Reason"
              className="mt-3 w-full rounded-xl border border-[#DAD6CF] p-3"
            />
            <button
              disabled={reason.trim().length < 3 || cancel.isPending}
              onClick={() => cancel.mutate()}
              className="mt-3 w-full rounded-2xl border border-red-300 py-2 font-medium text-red-700 hover:bg-red-50 disabled:opacity-40"
            >
              Cancel this booking
            </button>
            {error && <p className="mt-2 text-red-600">{error}</p>}
          </section>
        )}
      </aside>
    </div>
  );
}
