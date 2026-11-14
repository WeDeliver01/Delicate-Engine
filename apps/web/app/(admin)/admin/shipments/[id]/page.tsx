"use client";

import Link from "next/link";
import { use } from "react";
import dynamic from "next/dynamic";
import { useQuery } from "@tanstack/react-query";
import {
  CHANGE_REQUEST_KIND_LABELS,
  SHIPMENT_TERMINAL,
  type Address,
  type Booking,
  type CatalogResponse,
  type ChangeRequest,
  type Contact,
  type QuoteParcel,
  type Shipment,
  type ShipmentStatus,
  type TimedWindow,
} from "@delicate/contracts";
import { api } from "@/lib/api";
import { dateTime, minutesToClock, rands } from "@/lib/money";
import { StatusBadge } from "@/components/booking/status-badge";
import { DriverCell } from "@/components/shipments/driver-cell";
import type { ShipmentRow } from "@/components/shipments/shipment-table";
import { useMe } from "@/components/use-me";

// Leaflet needs `window`; keeping it out of the server bundle also keeps it off the critical
// path for a page whose point is the text, not the map.
const TrackingMap = dynamic(
  () => import("@/components/shipments/tracking-map").then((m) => m.TrackingMap),
  { ssr: false, loading: () => <div className="h-72 animate-pulse rounded-xl bg-[#F3F1ED]" /> },
);

interface LiveTracking {
  status: "not_live" | "live" | "delivered";
  message: string;
  driver: { name: string | null; phone: string | null } | null;
  position: { lat: number; lng: number; recordedAt: string; stale: boolean } | null;
  destination: { lat: number; lng: number } | null;
  distanceKm: number | null;
  etaMinutes: number | null;
  stopsAway: number | null;
  deliveredAt: string | null;
  proofOfDelivery: { receivedBy: string; capturedAt: string; note: string | null } | null;
}

/**
 * One shipment, everything the office needs to act on it, on one screen.
 *
 * The console used to link every waybill to a page that did not exist. Dispatch could see a
 * row in a table and nothing else: no recipient's number, no collection address, no
 * instructions, no parcels. Those are precisely the things a phone call about a delivery is
 * about, so they are all here, above the fold, with nothing to expand.
 *
 * Collection details live on the booking rather than the drop, so the booking is fetched too.
 * The driver and the account come from the search index, which is the one place that already
 * joins them.
 */
export default function AdminShipmentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const me = useMe();
  const role = me.data?.user.platformRole;
  const canAssign = role === "super_admin" || role === "dispatcher";

  const shipment = useQuery({
    queryKey: ["admin", "shipment", id],
    queryFn: () => api<Shipment>(`/v1/admin/shipments/${id}`),
  });
  const s = shipment.data;

  const booking = useQuery({
    queryKey: ["admin", "booking", s?.bookingId],
    queryFn: () => api<Booking>(`/v1/admin/bookings/${s!.bookingId}`),
    enabled: !!s,
  });

  // The list row for this one shipment: driver, account, and the flags the table shows.
  const row = useQuery({
    queryKey: ["admin", "shipment", id, "row"],
    queryFn: async () => {
      const res = await api<{ items: ShipmentRow[] }>(
        `/v1/admin/shipment-search?search=${encodeURIComponent(s!.waybill)}&limit=20`,
      );
      return res.items.find((r) => r.id === id) ?? null;
    },
    enabled: !!s,
  });

  const catalog = useQuery({
    queryKey: ["catalog"],
    queryFn: () => api<CatalogResponse>("/v1/public/catalog", { account: null }),
    staleTime: 5 * 60_000,
  });

  const live = useQuery({
    queryKey: ["admin", "shipment", id, "tracking"],
    queryFn: () => api<LiveTracking>(`/v1/admin/shipments/${id}/tracking`),
    refetchInterval: (q) => (q.state.data?.status === "live" ? 20_000 : false),
  });

  const timeline = useQuery({
    queryKey: ["admin", "shipment", id, "timeline"],
    queryFn: () =>
      api<{
        items: { id: string; status: ShipmentStatus; note: string | null; occurredAt: string }[];
      }>(`/v1/admin/shipments/${id}/timeline`),
  });

  const changes = useQuery({
    queryKey: ["admin", "shipment", id, "changes"],
    queryFn: () => api<{ items: ChangeRequest[] }>(`/v1/admin/shipments/${id}/changes`),
  });

  if (shipment.isLoading) return <p className="lede">Loading…</p>;
  if (shipment.error) return <p className="alert-error">{(shipment.error as Error).message}</p>;
  if (!s) return null;

  const b = booking.data;
  const r = row.data;
  const t = live.data;
  const siblings = b?.shipments.filter((x) => x.id !== s.id) ?? [];
  const finished = SHIPMENT_TERMINAL.includes(s.status);
  const packageName = (parcel: QuoteParcel) =>
    catalog.data?.packageTypes.find((p) => p.id === parcel.packageTypeId)?.name ?? "Parcel";
  const parcelCount = s.parcels.reduce((n, p) => n + p.quantity, 0);
  const totalKg = s.parcels.reduce((n, p) => n + (p.weightKg ?? 0) * p.quantity, 0);
  const points = [
    ...(t?.position
      ? [{ ...t.position, kind: "driver" as const, label: t.driver?.name ?? "Driver" }]
      : []),
    ...(t?.destination
      ? [{ ...t.destination, kind: "destination" as const, label: s.deliveryAddress.formatted }]
      : []),
  ];

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Link href="/admin/shipments" className="link-quiet text-xs">
            ← All shipments
          </Link>
          <h1 className="page-title mt-1 font-mono">{s.waybill}</h1>
          <p className="lede mt-1">
            {r?.accountCode && (
              <Link
                href={`/admin/accounts/${s.accountId}`}
                className="font-mono text-xs font-semibold text-[#E84A8A] hover:underline"
              >
                {r.accountCode}
              </Link>
            )}
            {r?.accountName && <> {r.accountName}</>}
            {b && (
              <>
                {" · "}
                <Link href={`/admin/bookings/${b.id}`} className="hover:underline">
                  {b.customerReference ?? b.reference}
                </Link>
                {b.shipments.length > 1 && (
                  <>
                    {" · drop "}
                    {s.sequence} of {b.shipments.length}
                  </>
                )}
              </>
            )}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={s.status} />
          {r?.isLate && <span className="chip chip-bad">Late</span>}
          {r?.hasPendingChange && <span className="chip chip-warn">Change pending</span>}
          {r?.hasPod && <span className="chip chip-good">POD</span>}
          {s.status === "delivered" && r && !r.hasPod && (
            <span className="chip chip-warn">No POD</span>
          )}
          <a
            href={`/admin/shipments/${id}/waybill`}
            className="btn btn-secondary btn-sm"
            target="_blank"
            rel="noreferrer"
          >
            Waybill
          </a>
          {b && (
            <Link href={`/admin/bookings/${b.id}`} className="btn btn-secondary btn-sm">
              Open booking
            </Link>
          )}
        </div>
      </header>

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          {/* ── Delivery ─────────────────────────────────────────────── */}
          <section className="panel">
            <div className="panel-head">
              <div>
                <h2 className="section-title">Delivery</h2>
                <p className="mt-0.5 text-xs text-muted">
                  Who is receiving it, where, and when they asked for it.
                </p>
              </div>
            </div>
            <div className="panel-body space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <ContactBlock label="Recipient" contact={s.recipient} />
                <AddressBlock label="Deliver to" address={s.deliveryAddress} />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <Fact
                  label="Requested delivery"
                  value={whenLabel(s.slotDate, s.slotWindowKey, s.deliveryWindow)}
                  hint={serviceHint(s.serviceLevelCode, s.slotDate)}
                />
                {s.deliveredAt && <Fact label="Delivered" value={dateTime(s.deliveredAt)} />}
              </div>
              <Instructions label="Delivery instructions" text={s.instructions} />
            </div>
          </section>

          {/* ── Collection ───────────────────────────────────────────── */}
          <section className="panel">
            <div className="panel-head">
              <div>
                <h2 className="section-title">Collection</h2>
                <p className="mt-0.5 text-xs text-muted">
                  Where the driver picks it up. Shared by every drop on the booking.
                </p>
              </div>
            </div>
            {booking.isLoading ? (
              <p className="table-empty">Loading…</p>
            ) : !b ? (
              <p className="table-empty">The booking could not be loaded.</p>
            ) : (
              <div className="panel-body space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <ContactBlock label="Contact at collection" contact={b.collection.contact} />
                  <AddressBlock label="Collect from" address={b.collection.address} />
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Fact
                    label="Requested collection"
                    value={whenLabel(b.slotDate, b.slotWindowKey, b.collectionWindow)}
                    hint={serviceHint(b.serviceLevelCode, b.slotDate)}
                  />
                </div>
                <Instructions label="Collection instructions" text={b.collection.instructions} />
              </div>
            )}
          </section>

          {/* ── Parcels ──────────────────────────────────────────────── */}
          <section className="panel">
            <div className="panel-head">
              <div>
                <h2 className="section-title">Parcels</h2>
                <p className="mt-0.5 text-xs text-muted">
                  {parcelCount} {parcelCount === 1 ? "item" : "items"}
                  {totalKg > 0 && ` · ${Math.round(totalKg * 10) / 10} kg declared`}
                </p>
              </div>
            </div>
            {s.parcels.length === 0 ? (
              <p className="table-empty">No parcels were listed on this shipment.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="table-base">
                  <thead>
                    <tr>
                      <th className="w-16">Qty</th>
                      <th>Type</th>
                      <th>Description</th>
                      <th className="text-right">Weight</th>
                    </tr>
                  </thead>
                  <tbody>
                    {s.parcels.map((p, i) => (
                      <tr key={i}>
                        <td className="font-mono">{p.quantity}×</td>
                        <td>{packageName(p)}</td>
                        <td className={p.description ? undefined : "text-muted"}>
                          {p.description ?? "—"}
                        </td>
                        <td className="text-right font-mono">
                          {p.weightKg != null ? `${p.weightKg} kg` : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* ── Live tracking ────────────────────────────────────────── */}
          <section className="panel">
            <div className="panel-head">
              <div>
                <h2 className="section-title">Tracking</h2>
                <p className="lede">
                  {live.error
                    ? `Tracking could not be loaded: ${(live.error as Error).message}`
                    : (t?.message ?? "…")}
                </p>
              </div>
              {t?.status === "live" && !t.position?.stale && (
                <span className="chip chip-good">
                  <span className="relative flex h-1.5 w-1.5">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#1B7F4B] opacity-75" />
                    <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-[#1B7F4B]" />
                  </span>
                  Live
                </span>
              )}
            </div>

            {t?.status === "live" && (
              <div className="panel-body space-y-4">
                <div className="grid gap-3 sm:grid-cols-3">
                  <Fact
                    label="Arriving in"
                    value={t.etaMinutes != null ? `~${t.etaMinutes} min` : "—"}
                    hint={t.position?.stale ? "waiting for a fresh position" : undefined}
                  />
                  <Fact
                    label="Distance"
                    value={t.distanceKm != null ? `${t.distanceKm} km` : "—"}
                    hint="by road from the driver"
                  />
                  <Fact
                    label="Stops before this one"
                    value={t.stopsAway != null ? String(t.stopsAway) : "—"}
                    hint={t.stopsAway === 0 ? "this is next" : "on the driver's run"}
                  />
                </div>
                {points.length > 0 && <TrackingMap points={points} />}
                {t.position && (
                  <p className="text-xs text-muted">
                    Position recorded {dateTime(t.position.recordedAt)}
                  </p>
                )}
              </div>
            )}

            {t?.status === "delivered" && (
              <div className="panel-body">
                {t.proofOfDelivery ? (
                  <div className="alert-success">
                    Received by <strong>{t.proofOfDelivery.receivedBy}</strong> on{" "}
                    {dateTime(t.proofOfDelivery.capturedAt)}
                    {t.proofOfDelivery.note && <> · {t.proofOfDelivery.note}</>}
                  </div>
                ) : (
                  <p className="text-sm text-muted">
                    Marked delivered{t.deliveredAt && ` on ${dateTime(t.deliveredAt)}`}, but no
                    proof of delivery was captured.
                  </p>
                )}
              </div>
            )}
          </section>

          {/* ── History ──────────────────────────────────────────────── */}
          <section className="panel">
            <div className="panel-head">
              <h2 className="section-title">History</h2>
            </div>
            {!timeline.data?.items.length ? (
              <p className="table-empty">No updates yet.</p>
            ) : (
              <ol className="divide-y divide-[#F0EDE9]">
                {timeline.data.items.map((e) => (
                  <li key={e.id} className="flex items-start gap-3 px-5 py-3 sm:px-6">
                    <StatusBadge status={e.status} />
                    <div className="min-w-0 flex-1">
                      {e.note && <p className="text-sm">{e.note}</p>}
                      <p className="text-xs text-muted">{dateTime(e.occurredAt)}</p>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>

        {/* ── Side column ─────────────────────────────────────────────── */}
        <aside className="space-y-5">
          <section className="panel">
            <div className="panel-head">
              <h2 className="section-title">Driver</h2>
            </div>
            <div className="panel-body text-sm">
              {row.isLoading ? (
                <p className="text-muted">Loading…</p>
              ) : (
                // An assignment ends with the journey, so a finished parcel has no driver to
                // show or to change: offering the picker there would look like a live control.
                <DriverCell
                  shipmentId={s.id}
                  driver={r?.driver ?? null}
                  canAssign={canAssign && !finished}
                />
              )}
              {t?.driver?.phone && (
                <p className="mt-2 text-[#6B6661]">
                  <a href={`tel:${t.driver.phone}`} className="link-accent">
                    {t.driver.phone}
                  </a>
                </p>
              )}
              {!r?.driver && !row.isLoading && (
                <p className="mt-2 text-xs text-muted">
                  {finished ? (
                    "No driver is assigned any more: the assignment ended with the journey."
                  ) : (
                    <>
                      Nobody has this parcel yet.{" "}
                      <Link href="/admin/dispatch" className="link-quiet">
                        Dispatch board
                      </Link>
                    </>
                  )}
                </p>
              )}
            </div>
          </section>

          <section className="panel">
            <div className="panel-head">
              <h2 className="section-title">Details</h2>
            </div>
            <dl className="panel-body space-y-2 text-sm">
              <Row label="Service">{s.serviceLevelCode.replace(/_/g, " ")}</Row>
              <Row label="Account">
                {r?.accountName ? (
                  <Link href={`/admin/accounts/${s.accountId}`} className="hover:underline">
                    {r.accountName}
                  </Link>
                ) : (
                  "—"
                )}
              </Row>
              <Row label="Booking">
                {b ? (
                  <Link href={`/admin/bookings/${b.id}`} className="font-mono hover:underline">
                    {b.reference}
                  </Link>
                ) : (
                  "—"
                )}
              </Row>
              {b?.customerReference && <Row label="Customer reference">{b.customerReference}</Row>}
              {b && <Row label="Booking total">{rands(b.totalCents)}</Row>}
              <Row label="Booked">{dateTime(s.createdAt)}</Row>
              {s.deliveredAt && <Row label="Delivered">{dateTime(s.deliveredAt)}</Row>}
            </dl>
          </section>

          {siblings.length > 0 && (
            <section className="panel">
              <div className="panel-head">
                <h2 className="section-title">Other drops on this booking</h2>
              </div>
              <ul className="divide-y divide-[#F0EDE9] text-sm">
                {siblings.map((x) => (
                  <li key={x.id} className="px-5 py-3 sm:px-6">
                    <div className="flex items-center justify-between gap-2">
                      <Link
                        href={`/admin/shipments/${x.id}`}
                        className="font-mono font-semibold hover:underline"
                      >
                        {x.waybill}
                      </Link>
                      <StatusBadge status={x.status} />
                    </div>
                    <p className="mt-1 truncate text-xs text-muted">
                      {x.recipient.name} · {x.deliveryAddress.formatted}
                    </p>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {!!changes.data?.items.length && (
            <section className="panel">
              <div className="panel-head">
                <h2 className="section-title">Change requests</h2>
                <Link href="/admin/changes" className="link-quiet text-xs">
                  Queue
                </Link>
              </div>
              <ul className="divide-y divide-[#F0EDE9]">
                {changes.data.items.map((c) => (
                  <li key={c.id} className="px-5 py-3 sm:px-6">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium">
                        {CHANGE_REQUEST_KIND_LABELS[c.kind]}
                      </span>
                      <ChangeStatus status={c.status} />
                    </div>
                    {c.reason && <p className="mt-1 text-xs text-[#6B6661]">{c.reason}</p>}
                    {c.heldBecause && c.status === "pending" && (
                      <p className="mt-1 text-xs text-muted">Held because {c.heldBecause}.</p>
                    )}
                    {c.decisionNote && (
                      <p className="mt-1 text-xs text-muted">Decision: {c.decisionNote}</p>
                    )}
                    <p className="mt-1 text-xs text-muted">{dateTime(c.createdAt)}</p>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </aside>
      </div>
    </div>
  );
}

/**
 * The requested time in one line: the day, the slot it was booked into, and the narrower
 * window if one was sold. "—" rather than a blank when nothing was scheduled, so the eye
 * still lands on something.
 */
function whenLabel(
  slotDate: string | null,
  slotWindowKey: string | null,
  window: TimedWindow | null | undefined,
): string {
  if (!slotDate) return "Not scheduled";
  const parts = [slotDate];
  if (slotWindowKey) parts.push(slotWindowKey);
  if (window)
    parts.push(`${minutesToClock(window.startMinute)}–${minutesToClock(window.endMinute)}`);
  return parts.join(" · ");
}

function serviceHint(serviceLevelCode: string, slotDate: string | null): string | undefined {
  if (slotDate) return undefined;
  return serviceLevelCode === "on_demand" ? "on demand: as soon as a driver is free" : undefined;
}

function ContactBlock({ label, contact }: { label: string; contact: Contact | null }) {
  return (
    <div>
      <p className="label-mini">{label}</p>
      {!contact ? (
        <p className="mt-1 text-sm text-muted">No contact given.</p>
      ) : (
        <div className="mt-1 space-y-0.5 text-sm">
          <p className="font-medium">{contact.name}</p>
          <p>
            <a href={`tel:${contact.phone}`} className="link-accent">
              {contact.phone}
            </a>
          </p>
          {contact.altPhone && (
            <p>
              <a href={`tel:${contact.altPhone}`} className="link-accent">
                {contact.altPhone}
              </a>
              <span className="text-xs text-muted"> alternative</span>
            </p>
          )}
          {contact.email && (
            <p>
              <a href={`mailto:${contact.email}`} className="link-accent">
                {contact.email}
              </a>
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function AddressBlock({ label, address }: { label: string; address: Address }) {
  const detail = [address.suburb, address.city, address.postalCode].filter(Boolean).join(", ");
  const { lat, lng } = address.location;
  return (
    <div>
      <p className="label-mini">{label}</p>
      <p className="mt-1 text-sm">{address.formatted}</p>
      {detail && detail !== address.formatted && <p className="text-xs text-muted">{detail}</p>}
      <a
        href={`https://www.google.com/maps/search/?api=1&query=${lat},${lng}`}
        target="_blank"
        rel="noreferrer"
        className="link-quiet mt-1 inline-block text-xs"
      >
        Open in Maps
      </a>
    </div>
  );
}

function Instructions({ label, text }: { label: string; text: string | null }) {
  return (
    <div>
      <p className="label-mini">{label}</p>
      {text ? (
        <p className="mt-1 whitespace-pre-line rounded-xl border border-[#F3E2A7] bg-[#FBF1D6] px-3 py-2 text-sm text-[#5A4206]">
          {text}
        </p>
      ) : (
        <p className="mt-1 text-sm text-muted">None given.</p>
      )}
    </div>
  );
}

function Fact({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div>
      <p className="label-mini">{label}</p>
      <p className="mt-0.5 text-base font-semibold">{value}</p>
      {hint && <p className="text-xs text-muted">{hint}</p>}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-muted">{label}</dt>
      <dd className="text-right">{children}</dd>
    </div>
  );
}

function ChangeStatus({ status }: { status: ChangeRequest["status"] }) {
  const map: Record<ChangeRequest["status"], [string, string]> = {
    pending: ["chip-warn", "Awaiting approval"],
    approved: ["chip-good", "Approved"],
    auto_applied: ["chip-good", "Applied"],
    rejected: ["chip-bad", "Declined"],
    withdrawn: ["chip-neutral", "Withdrawn"],
  };
  const [cls, label] = map[status];
  return <span className={`chip ${cls}`}>{label}</span>;
}
