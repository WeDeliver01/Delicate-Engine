"use client";

import Link from "next/link";
import type { Shipment } from "@delicate/contracts";
import { StatusBadge } from "@/components/booking/status-badge";

export interface ShipmentRow extends Shipment {
  /** The order this parcel belongs to, so the booking is reachable without its own menu. */
  bookingReference?: string;
  /** What the customer filed it under, shown in preference to ours when they set one. */
  customerReference?: string | null;
  driver: { id: string; name: string | null } | null;
  hasPod: boolean;
  hasPendingChange: boolean;
  isLate: boolean;
}

/**
 * The shipment list.
 *
 * One row is one parcel's whole story at a glance: where it is going, who has it, what state
 * it is in and whether anything about it needs a person. The flags on the right are the
 * difference between a list you scan and a list you have to open every row of.
 */
export function ShipmentTable({
  rows,
  loading,
  hrefBase,
  showAccount,
  emptyMessage = "Nothing matches these filters.",
}: {
  rows: ShipmentRow[];
  loading?: boolean;
  hrefBase: string;
  showAccount?: boolean;
  emptyMessage?: string;
}) {
  if (loading) {
    return (
      <div className="panel">
        <p className="table-empty">Loading…</p>
      </div>
    );
  }
  if (!rows.length) {
    return (
      <div className="panel">
        <p className="table-empty">{emptyMessage}</p>
      </div>
    );
  }

  return (
    <div className="panel overflow-x-auto">
      <table className="table-base">
        <thead>
          <tr>
            <th>Waybill</th>
            <th>Scheduled</th>
            <th>Recipient</th>
            <th>Delivery to</th>
            <th>Driver</th>
            <th>Status</th>
            <th className="text-right">Flags</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((s) => (
            <tr key={s.id} className="transition-colors hover:bg-[#FAFAF9]">
              <td>
                <Link href={`${hrefBase}/${s.id}`} className="font-mono hover:underline">
                  {s.waybill}
                </Link>
                {s.bookingReference && (
                  <Link
                    href={`/portal/bookings/${s.bookingId}`}
                    className="mt-0.5 block truncate text-xs text-muted hover:text-ink hover:underline"
                    title="The order this delivery belongs to"
                  >
                    {s.customerReference ?? s.bookingReference}
                  </Link>
                )}
              </td>
              <td className="whitespace-nowrap">
                {s.slotDate ? (
                  <>
                    <span className={s.isLate ? "text-[#C13B73]" : undefined}>{s.slotDate}</span>
                    {s.slotWindowKey && (
                      <span className="block text-xs text-muted">{s.slotWindowKey}</span>
                    )}
                  </>
                ) : (
                  <span className="text-muted">—</span>
                )}
              </td>
              <td>
                <span className="block">{s.recipient.name}</span>
                {s.recipient.phone && (
                  <span className="block text-xs text-muted">{s.recipient.phone}</span>
                )}
              </td>
              <td className="max-w-64">
                <span className="block truncate" title={s.deliveryAddress.formatted}>
                  {s.deliveryAddress.suburb ?? s.deliveryAddress.formatted}
                </span>
                {s.deliveryAddress.suburb && (
                  <span
                    className="block truncate text-xs text-muted"
                    title={s.deliveryAddress.formatted}
                  >
                    {s.deliveryAddress.formatted}
                  </span>
                )}
              </td>
              <td className="whitespace-nowrap text-[#6B6661]">{s.driver?.name ?? "—"}</td>
              <td>
                <StatusBadge status={s.status} />
              </td>
              <td className="text-right">
                <div className="inline-flex flex-wrap justify-end gap-1">
                  {s.isLate && <span className="chip chip-bad">Late</span>}
                  {s.hasPendingChange && <span className="chip chip-warn">Change pending</span>}
                  {s.hasPod && <span className="chip chip-good">POD</span>}
                  {s.status === "delivered" && !s.hasPod && (
                    <span className="chip chip-warn">No POD</span>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
