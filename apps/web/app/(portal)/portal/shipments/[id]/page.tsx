"use client";

import Link from "next/link";
import { use, useState } from "react";
import dynamic from "next/dynamic";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CHANGE_REQUEST_KIND_LABELS,
  type ChangeRequest,
  type ChangeRequestKind,
  type Shipment,
  type ShipmentStatus,
} from "@delicate/contracts";
import { api } from "@/lib/api";
import { StatusBadge } from "@/components/booking/status-badge";
import { ChangeRequestForm } from "@/components/shipments/change-request-form";

// The map pulls in Leaflet, which needs `window`; keeping it out of the server bundle also
// keeps it off the critical path for a page that is useful before the map has drawn.
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

export default function ShipmentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const qc = useQueryClient();
  const [changing, setChanging] = useState<ChangeRequestKind | null>(null);

  const shipment = useQuery({
    queryKey: ["shipment", id],
    queryFn: () => api<Shipment>(`/v1/account/shipments/${id}`),
  });

  const live = useQuery({
    queryKey: ["shipment", id, "tracking"],
    queryFn: () => api<LiveTracking>(`/v1/account/shipments/${id}/tracking`),
    // Poll only while something is actually moving. Polling a delivered shipment every twenty
    // seconds would be a lot of requests to be told the same thing.
    refetchInterval: (q) => (q.state.data?.status === "live" ? 20_000 : false),
  });

  const timeline = useQuery({
    queryKey: ["shipment", id, "timeline"],
    queryFn: () =>
      api<{
        items: { id: string; status: ShipmentStatus; note: string | null; occurredAt: string }[];
      }>(`/v1/account/shipments/${id}/timeline`),
  });

  const changes = useQuery({
    queryKey: ["shipment", id, "changes"],
    queryFn: () => api<{ items: ChangeRequest[] }>(`/v1/account/shipments/${id}/changes`),
  });

  const withdraw = useMutation({
    mutationFn: (changeId: string) =>
      api(`/v1/account/changes/${changeId}/withdraw`, { method: "POST" }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["shipment", id] }),
  });

  const s = shipment.data;
  const t = live.data;

  if (shipment.isLoading) return <p className="lede">Loading…</p>;
  if (shipment.error) return <p className="alert-error">{(shipment.error as Error).message}</p>;
  if (!s) return null;

  const open = !["delivered", "failed", "cancelled"].includes(s.status);
  const points = [
    ...(t?.position
      ? [{ ...t.position, kind: "driver" as const, label: t.driver?.name ?? "Your driver" }]
      : []),
    ...(t?.destination
      ? [{ ...t.destination, kind: "destination" as const, label: s.deliveryAddress.formatted }]
      : []),
  ];

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/portal/shipments" className="link-quiet text-xs">
            ← All shipments
          </Link>
          <h1 className="page-title mt-1 font-mono">{s.waybill}</h1>
          <p className="lede mt-1">
            {s.recipient.name} · {s.deliveryAddress.formatted}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge status={s.status} />
          <a
            href={`/portal/shipments/${id}/waybill`}
            className="btn btn-secondary btn-sm"
            target="_blank"
            rel="noreferrer"
          >
            Waybill
          </a>
        </div>
      </header>

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          {/* ── Live tracking ───────────────────────────────────────────── */}
          <section className="panel">
            <div className="panel-head">
              <div>
                <h2 className="section-title">Tracking</h2>
                <p className="lede">{t?.message ?? "…"}</p>
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
                    label="Stops before you"
                    value={t.stopsAway != null ? String(t.stopsAway) : "—"}
                    hint={t.stopsAway === 0 ? "you are next" : "on this driver's run"}
                  />
                </div>

                {points.length > 0 && <TrackingMap points={points} />}

                {t.driver?.name && (
                  <p className="text-sm text-[#6B6661]">
                    Your driver is <span className="font-medium text-ink">{t.driver.name}</span>
                    {t.driver.phone && (
                      <>
                        {" · "}
                        <a href={`tel:${t.driver.phone}`} className="link-accent">
                          {t.driver.phone}
                        </a>
                      </>
                    )}
                  </p>
                )}
              </div>
            )}

            {t?.status === "delivered" && t.proofOfDelivery && (
              <div className="panel-body">
                <div className="alert-success">
                  Received by <strong>{t.proofOfDelivery.receivedBy}</strong> on{" "}
                  {new Date(t.proofOfDelivery.capturedAt).toLocaleString("en-ZA")}
                  {t.proofOfDelivery.note && <> · {t.proofOfDelivery.note}</>}
                </div>
              </div>
            )}
          </section>

          {/* ── Timeline ────────────────────────────────────────────────── */}
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
                      <p className="text-xs text-muted">
                        {new Date(e.occurredAt).toLocaleString("en-ZA")}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>

        {/* ── Changing it ──────────────────────────────────────────────── */}
        <div className="space-y-5">
          <section className="panel">
            <div className="panel-head">
              <h2 className="section-title">Change something</h2>
            </div>
            {!open ? (
              <p className="panel-body text-sm text-muted">
                This shipment is {s.status} and can no longer be changed.
              </p>
            ) : changing ? (
              <div className="panel-body">
                <ChangeRequestForm
                  shipment={s}
                  kind={changing}
                  onDone={() => {
                    setChanging(null);
                    void qc.invalidateQueries({ queryKey: ["shipment", id] });
                  }}
                  onCancel={() => setChanging(null)}
                />
              </div>
            ) : (
              <div className="panel-body space-y-1.5">
                {(Object.keys(CHANGE_REQUEST_KIND_LABELS) as ChangeRequestKind[]).map((k) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setChanging(k)}
                    className="flex w-full items-center justify-between rounded-xl border border-line px-3 py-2 text-left text-sm transition-colors hover:border-ink hover:bg-[#FAFAF9]"
                  >
                    <span>{CHANGE_REQUEST_KIND_LABELS[k]}</span>
                    <span className="material-symbols-outlined text-[18px] text-muted">
                      chevron_right
                    </span>
                  </button>
                ))}
                <p className="pt-2 text-xs text-muted">
                  Contact details and instructions update straight away. An address or a new date
                  needs our team to confirm it first.
                </p>
              </div>
            )}
          </section>

          {!!changes.data?.items.length && (
            <section className="panel">
              <div className="panel-head">
                <h2 className="section-title">Changes</h2>
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
                    {c.heldBecause && c.status === "pending" && (
                      <p className="mt-1 text-xs text-muted">Waiting because {c.heldBecause}.</p>
                    )}
                    {c.decisionNote && (
                      <p className="mt-1 text-xs text-muted">Our note: {c.decisionNote}</p>
                    )}
                    <p className="mt-1 text-xs text-muted">
                      {new Date(c.createdAt).toLocaleString("en-ZA")}
                    </p>
                    {c.status === "pending" && (
                      <button
                        type="button"
                        onClick={() => withdraw.mutate(c.id)}
                        className="link-quiet mt-1 text-xs"
                      >
                        Withdraw
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="panel">
            <div className="panel-head">
              <h2 className="section-title">Details</h2>
            </div>
            <dl className="panel-body space-y-2 text-sm">
              <Row label="Scheduled">{s.slotDate ?? "—"}</Row>
              <Row label="Window">{s.slotWindowKey ?? "—"}</Row>
              <Row label="Service">{s.serviceLevelCode}</Row>
              <Row label="Recipient">{s.recipient.name}</Row>
              <Row label="Phone">{s.recipient.phone}</Row>
              <Row label="Instructions">{s.instructions ?? "—"}</Row>
              <Row label="Parcels">{s.parcels.length}</Row>
            </dl>
          </section>
        </div>
      </div>
    </div>
  );
}

function Fact({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div>
      <p className="label-mini">{label}</p>
      <p className="figure mt-0.5 text-xl font-semibold">{value}</p>
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
