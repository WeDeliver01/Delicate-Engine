"use client";

import Link from "next/link";
import type { Address, Shipment } from "@delicate/contracts";
import { DriverCell } from "./driver-cell";
import { StatusBadge } from "@/components/booking/status-badge";
import { dateTime } from "@/lib/money";

/**
 * The service level in the three letters ops uses on a waybill, rather than the slug.
 *
 * Unknown codes fall back to their own first three letters, so a service added in the admin
 * console shows something sensible here without this list having to be kept in step.
 */
const SERVICE_LABELS: Record<string, string> = {
  standard: "STD",
  express: "EXP",
  on_demand: "ODM",
  same_day: "SDX",
};

function serviceLabel(code: string): string {
  return SERVICE_LABELS[code] ?? code.replace(/[^a-zA-Z]/g, "").slice(0, 3);
}

export interface ShipmentRow extends Shipment {
  /** Where it is collected from. Null on older rows written before this was carried. */
  collectionAddress?: Address | null;
  accountName?: string;
  /** The short handle ops says on the phone, e.g. "HBB001". */
  accountCode?: string;
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
  canAssign = false,
}: {
  rows: ShipmentRow[];
  loading?: boolean;
  hrefBase: string;
  showAccount?: boolean;
  emptyMessage?: string;
  /** Staff who may move a parcel to another driver get a picker instead of a name. */
  canAssign?: boolean;
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
            {showAccount && <th>Account</th>}
            <th>Waybill no.</th>
            <th>Created</th>
            <th>Status</th>
            <th>Service</th>
            <th>Collection address</th>
            <th>Delivery address</th>
            <th>Scheduled</th>
            <th>Driver</th>
            <th className="text-right">Flags</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((s) => (
            <tr key={s.id} className="transition-colors hover:bg-[#FAFAF9]">
              {showAccount && (
                <td className="whitespace-nowrap">
                  <span className="block font-mono text-xs font-semibold text-[#E84A8A]">
                    {s.accountCode ?? "—"}
                  </span>
                  <span className="block truncate text-xs text-muted" title={s.accountName}>
                    {s.accountName ?? ""}
                  </span>
                </td>
              )}
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
              <td className="whitespace-nowrap text-[#6B6661]">{dateTime(s.createdAt)}</td>
              <td>
                <StatusBadge status={s.status} />
              </td>
              <td className="whitespace-nowrap uppercase text-[#6B6661]">
                {serviceLabel(s.serviceLevelCode)}
              </td>
              <td className="max-w-64">
                {s.collectionAddress ? (
                  <span className="block truncate" title={s.collectionAddress.formatted}>
                    {s.collectionAddress.formatted}
                  </span>
                ) : (
                  <span className="text-muted">—</span>
                )}
              </td>
              <td className="max-w-64">
                <span className="block truncate" title={s.deliveryAddress.formatted}>
                  {s.deliveryAddress.formatted}
                </span>
                {s.recipient.name && (
                  <span className="block truncate text-xs text-muted">{s.recipient.name}</span>
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
              <td className="whitespace-nowrap text-[#6B6661]">
                <DriverCell shipmentId={s.id} driver={s.driver} canAssign={canAssign} />
              </td>
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
