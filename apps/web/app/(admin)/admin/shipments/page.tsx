"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  SHIPMENT_TRANSITIONS,
  type Driver,
  type ProofOfDelivery,
  type Settlement,
  type Shipment,
  type ShipmentStatus,
} from "@delicate/contracts";
import { api, ApiRequestError } from "@/lib/api";
import { rands } from "@/lib/money";
import { StatusBadge } from "@/components/booking/status-badge";

interface Candidate {
  driverId: string;
  name: string;
  score: number;
  load: number;
  capacity: number;
  distanceKm: number;
}
interface SettlementView {
  settlement: Settlement | null;
  pod: ProofOfDelivery | null;
  assignment: { driverId: string; plannedKm: number; source: string } | null;
  files: { signatureFileId: string | null; photoFileId: string | null };
}

/** Dispatch board: assign, reassign, drive statuses, and see the money each drop produced. */
export default function AdminShipments() {
  const qc = useQueryClient();
  const [date, setDate] = useState("");
  const [status, setStatus] = useState<ShipmentStatus | "">("");
  const [open, setOpen] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const onError = (e: unknown) => setError(e instanceof ApiRequestError ? e.message : String(e));

  const q = new URLSearchParams({ limit: "100" });
  if (date) q.set("slotDate", date);
  if (status) q.set("status", status);
  const list = useQuery({
    queryKey: ["admin", "shipments", date, status],
    queryFn: () => api<{ items: Shipment[] }>(`/v1/admin/shipments?${q}`),
    refetchInterval: 15_000,
  });
  const drivers = useQuery({
    queryKey: ["admin", "fleet", "drivers"],
    queryFn: () => api<Driver[]>("/v1/admin/fleet/drivers"),
  });
  const unassigned = useQuery({
    queryKey: ["admin", "dispatch", "unassigned"],
    queryFn: () => api<Shipment[]>("/v1/admin/dispatch/unassigned"),
    refetchInterval: 15_000,
  });

  const invalidate = () => void qc.invalidateQueries({ queryKey: ["admin"] });
  const move = useMutation({
    mutationFn: ({ id, to }: { id: string; to: ShipmentStatus }) =>
      api(`/v1/admin/dispatch/shipments/${id}/status`, { method: "POST", json: { status: to } }),
    onSuccess: invalidate,
    onError,
  });
  const autoAssign = useMutation({
    mutationFn: (id: string) =>
      api(`/v1/admin/dispatch/shipments/${id}/auto-assign`, { method: "POST" }),
    onSuccess: invalidate,
    onError,
  });

  const unassignedIds = new Set(unassigned.data?.map((s) => s.id));

  return (
    <div className="space-y-4">
      {error && <p className="alert-error">{error}</p>}

      {unassigned.data && unassigned.data.length > 0 && (
        <section className="rounded-xl border border-[#F7A8CE] bg-[#FCEEF4] p-4 text-sm">
          <div className="flex items-center justify-between">
            <span className="font-semibold">
              {unassigned.data.length} shipment(s) have no driver
            </span>
            <button
              onClick={() => unassigned.data?.forEach((s) => autoAssign.mutate(s.id))}
              className="rounded-full bg-ink px-4 py-1.5 text-xs text-white hover:bg-brand-pink"
            >
              Auto-assign all
            </button>
          </div>
        </section>
      )}

      <section className="panel">
        <div className="panel-head">
          <h2 className="section-title">Shipments</h2>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="input px-2 py-1 text-sm"
          />
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as ShipmentStatus | "")}
            className="input px-2 py-1 text-sm"
          >
            <option value="">all statuses</option>
            {Object.keys(SHIPMENT_TRANSITIONS).map((s) => (
              <option key={s} value={s}>
                {s.replace("_", " ")}
              </option>
            ))}
          </select>
        </div>
        <table className="w-full text-left text-sm">
          <thead className="label-mini">
            <tr>
              <th className="px-5 py-2">Waybill</th>
              <th className="px-5 py-2">Slot</th>
              <th className="px-5 py-2">Deliver to</th>
              <th className="px-5 py-2">Driver</th>
              <th className="px-5 py-2">Status</th>
              <th className="px-5 py-2">Next</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#F0EDE9]">
            {list.data?.items.map((s) => (
              <>
                <tr key={s.id} className="align-top">
                  <td className="px-5 py-2">
                    <button
                      onClick={() => setOpen(open === s.id ? null : s.id)}
                      className="font-mono hover:underline"
                    >
                      {s.waybill}
                    </button>
                  </td>
                  <td className="px-5 py-2">
                    {s.slotDate ? `${s.slotDate} · ${s.slotWindowKey}` : "on-demand"}
                  </td>
                  <td className="px-5 py-2">
                    {s.deliveryAddress.suburb ?? s.deliveryAddress.city}
                    <div className="text-xs text-muted">
                      {s.recipient.name} · {s.recipient.phone}
                    </div>
                  </td>
                  <td className="px-5 py-2">
                    <AssignCell
                      shipment={s}
                      drivers={drivers.data ?? []}
                      unassigned={unassignedIds.has(s.id)}
                      onDone={invalidate}
                      onError={onError}
                    />
                  </td>
                  <td className="px-5 py-2">
                    <StatusBadge status={s.status} />
                  </td>
                  <td className="px-5 py-2">
                    <div className="flex flex-wrap gap-1">
                      {SHIPMENT_TRANSITIONS[s.status].map((to) => (
                        <button
                          key={to}
                          onClick={() => move.mutate({ id: s.id, to })}
                          className="chip chip-outline"
                        >
                          {to.replace("_", " ")}
                        </button>
                      ))}
                    </div>
                  </td>
                </tr>
                {open === s.id && (
                  <tr key={`${s.id}-detail`}>
                    <td colSpan={6} className="bg-[#FAFAF9] px-5 py-4">
                      <Detail shipmentId={s.id} />
                    </td>
                  </tr>
                )}
              </>
            ))}
            {list.data?.items.length === 0 && (
              <tr>
                <td colSpan={6} className="table-empty">
                  No shipments match.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}

function AssignCell({
  shipment,
  drivers,
  unassigned,
  onDone,
  onError,
}: {
  shipment: Shipment;
  drivers: Driver[];
  unassigned: boolean;
  onDone: () => void;
  onError: (e: unknown) => void;
}) {
  const [picking, setPicking] = useState(false);
  const candidates = useQuery({
    queryKey: ["admin", "dispatch", "candidates", shipment.id],
    queryFn: () => api<Candidate[]>(`/v1/admin/dispatch/shipments/${shipment.id}/candidates`),
    enabled: picking,
  });
  const settlementView = useQuery({
    queryKey: ["admin", "dispatch", "settlement", shipment.id],
    queryFn: () => api<SettlementView>(`/v1/admin/dispatch/shipments/${shipment.id}/settlement`),
  });
  const assign = useMutation({
    mutationFn: (driverId: string) =>
      api(`/v1/admin/dispatch/shipments/${shipment.id}/assign`, {
        method: "POST",
        json: { driverId },
      }),
    onSuccess: () => {
      setPicking(false);
      onDone();
    },
    onError,
  });

  const current = settlementView.data?.assignment;
  const driverName = current
    ? (drivers.find((d) => d.id === current.driverId)?.fullName ?? "assigned")
    : null;

  if (picking) {
    return (
      <div className="min-w-48 space-y-1">
        {candidates.data?.length === 0 && (
          <p className="text-xs text-muted">No driver on shift with capacity.</p>
        )}
        {candidates.data?.map((c) => (
          <button
            key={c.driverId}
            onClick={() => assign.mutate(c.driverId)}
            className="block w-full rounded border border-[#DAD6CF] px-2 py-1 text-left text-xs hover:border-[#0A0A0A]"
          >
            {c.name} · {c.distanceKm} km · {c.load}/{c.capacity}
          </button>
        ))}
        <button onClick={() => setPicking(false)} className="text-xs text-muted hover:underline">
          cancel
        </button>
      </div>
    );
  }
  return (
    <div>
      {driverName ? (
        <>
          <span>{driverName}</span>
          <div className="text-xs text-muted">
            {current!.source} · {current!.plannedKm} km planned
          </div>
        </>
      ) : (
        <span className={unassigned ? "text-[#C13B73]" : "text-[#86817A]"}>unassigned</span>
      )}
      {["booked", "assigned", "failed"].includes(shipment.status) && (
        <button
          onClick={() => setPicking(true)}
          className="mt-1 block text-xs text-brand-pink hover:underline"
        >
          {driverName ? "reassign" : "assign"}
        </button>
      )}
    </div>
  );
}

function Detail({ shipmentId }: { shipmentId: string }) {
  const v = useQuery({
    queryKey: ["admin", "dispatch", "settlement", shipmentId],
    queryFn: () => api<SettlementView>(`/v1/admin/dispatch/shipments/${shipmentId}/settlement`),
  });
  if (!v.data) return <p className="text-sm text-muted">Loading…</p>;
  const { settlement, pod, files } = v.data;
  return (
    <div className="grid gap-6 text-sm md:grid-cols-2">
      <div>
        <h3 className="section-title">Settlement</h3>
        {settlement ? (
          <dl className="mt-2 space-y-1">
            <Row k="Revenue (ex VAT)" v={rands(settlement.revenueCents)} />
            <Row k="VAT" v={rands(settlement.vatCents)} />
            <Row k="Fuel cost" v={rands(settlement.fuelCostCents)} />
            <Row k="Driver earning" v={rands(settlement.driverEarningCents)} />
            <Row k="Margin" v={rands(settlement.marginCents)} strong />
            <Row
              k="Distance"
              v={`${settlement.actualKm} km actual vs ${settlement.plannedKm} km planned`}
            />
          </dl>
        ) : (
          <p className="mt-2 text-muted">Not delivered yet.</p>
        )}
      </div>
      <div>
        <h3 className="section-title">Proof of delivery</h3>
        {pod ? (
          <div className="mt-2 space-y-2">
            <p>Received by {pod.receivedBy}</p>
            {pod.note && <p className="text-[#6B6661]">{pod.note}</p>}
            <div className="flex gap-2">
              {files.photoFileId && (
                <img
                  src={`/api/v1/admin/files/${files.photoFileId}`}
                  alt="Proof of delivery"
                  className="h-28 rounded-lg border border-line"
                />
              )}
              {files.signatureFileId && (
                <img
                  src={`/api/v1/admin/files/${files.signatureFileId}`}
                  alt="Signature"
                  className="h-28 panel"
                />
              )}
            </div>
          </div>
        ) : (
          <p className="mt-2 text-muted">None captured.</p>
        )}
      </div>
    </div>
  );
}

function Row({ k, v, strong }: { k: string; v: string; strong?: boolean }) {
  return (
    <div className="flex justify-between gap-6">
      <dt className="text-muted">{k}</dt>
      <dd className={`font-mono ${strong ? "font-bold" : ""}`}>{v}</dd>
    </div>
  );
}
