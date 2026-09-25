"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Booking, BookingStatus } from "@delicate/contracts";
import { api } from "@/lib/api";
import { dateTime, rands } from "@/lib/money";
import { StatusBadge } from "@/components/booking/status-badge";

const STATUSES: BookingStatus[] = [
  "confirmed",
  "in_progress",
  "completed",
  "cancelled",
  "rejected_insufficient_funds",
  "rejected_slot_unavailable",
  "rejected_quote_expired",
];

export default function AdminBookings() {
  const [status, setStatus] = useState<BookingStatus | "">("");
  const list = useQuery({
    queryKey: ["admin", "bookings", status],
    queryFn: () =>
      api<{ items: Booking[] }>(`/v1/admin/bookings?limit=100${status ? `&status=${status}` : ""}`),
    refetchInterval: 15_000,
  });
  return (
    <section className="panel">
      <div className="flex items-center gap-3 border-b border-line px-5 py-4">
        <h2 className="section-title">Bookings</h2>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as BookingStatus | "")}
          className="input px-2 py-1 text-sm"
        >
          <option value="">all statuses</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s.replace(/_/g, " ")}
            </option>
          ))}
        </select>
        <span className="text-xs text-muted">
          Rejected rows are demand we could not serve — watch them.
        </span>
      </div>
      <table className="w-full text-left text-sm">
        <thead className="label-mini">
          <tr>
            <th className="px-5 py-2">Reference</th>
            <th className="px-5 py-2">Placed</th>
            <th className="px-5 py-2">Service</th>
            <th className="px-5 py-2">Slot</th>
            <th className="px-5 py-2">Drops</th>
            <th className="px-5 py-2">Total</th>
            <th className="px-5 py-2">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[#F0EDE9]">
          {list.data?.items.map((b) => (
            <tr key={b.id}>
              <td className="px-5 py-2 font-mono">{b.reference}</td>
              <td className="px-5 py-2">{dateTime(b.createdAt)}</td>
              <td className="px-5 py-2">{b.serviceLevelCode.replace("_", " ")}</td>
              <td className="px-5 py-2">
                {b.slotDate ? `${b.slotDate} · ${b.slotWindowKey}` : "—"}
              </td>
              <td className="px-5 py-2">{b.shipments.map((s) => s.waybill).join(", ") || "—"}</td>
              <td className="px-5 py-2 font-mono">{rands(b.totalCents)}</td>
              <td className="px-5 py-2">
                <StatusBadge status={b.status} />
                {b.rejectionReason && <div className="text-xs text-muted">{b.rejectionReason}</div>}
              </td>
            </tr>
          ))}
          {list.data?.items.length === 0 && (
            <tr>
              <td colSpan={7} className="table-empty">
                No bookings.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </section>
  );
}
