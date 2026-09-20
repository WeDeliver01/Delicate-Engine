"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { SHIPMENT_TRANSITIONS, type Shipment, type ShipmentStatus } from "@delicate/contracts";
import { api, ApiRequestError } from "@/lib/api";
import { StatusBadge } from "@/components/booking/status-badge";

/**
 * Dispatch board (Phase 1): every shipment by slot date with the legal next statuses. Phase 2
 * replaces the manual buttons with driver-app events and assignment.
 */
export default function AdminShipments() {
  const qc = useQueryClient();
  const [date, setDate] = useState("");
  const [status, setStatus] = useState<ShipmentStatus | "">("");
  const [error, setError] = useState<string | null>(null);
  const q = new URLSearchParams({ limit: "100" });
  if (date) q.set("slotDate", date);
  if (status) q.set("status", status);
  const list = useQuery({
    queryKey: ["admin", "shipments", date, status],
    queryFn: () => api<{ items: Shipment[] }>(`/v1/admin/shipments?${q}`),
    refetchInterval: 10_000,
  });

  const move = useMutation({
    mutationFn: ({ id, to }: { id: string; to: ShipmentStatus }) =>
      api(`/v1/admin/shipments/${id}/status`, { method: "POST", json: { status: to } }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["admin"] }),
    onError: (e) => setError(e instanceof ApiRequestError ? e.message : String(e)),
  });

  return (
    <section className="rounded-xl border border-[#ECEAE6] bg-white">
      <div className="flex flex-wrap items-center gap-3 border-b border-[#ECEAE6] px-5 py-4">
        <h1 className="font-semibold">Shipments</h1>
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="rounded-lg border border-[#DAD6CF] px-2 py-1 text-sm"
        />
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as ShipmentStatus | "")}
          className="rounded-lg border border-[#DAD6CF] px-2 py-1 text-sm"
        >
          <option value="">all statuses</option>
          {Object.keys(SHIPMENT_TRANSITIONS).map((s) => (
            <option key={s} value={s}>
              {s.replace("_", " ")}
            </option>
          ))}
        </select>
        {error && <span className="text-sm text-red-600">{error}</span>}
      </div>
      <table className="w-full text-left text-sm">
        <thead className="text-xs uppercase text-[#86817A]">
          <tr>
            <th className="px-5 py-2">Waybill</th>
            <th className="px-5 py-2">Slot</th>
            <th className="px-5 py-2">Deliver to</th>
            <th className="px-5 py-2">Recipient</th>
            <th className="px-5 py-2">Status</th>
            <th className="px-5 py-2">Next</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[#F0EDE9]">
          {list.data?.items.map((s) => (
            <tr key={s.id} className="align-top">
              <td className="px-5 py-2 font-mono">{s.waybill}</td>
              <td className="px-5 py-2">
                {s.slotDate ? `${s.slotDate} · ${s.slotWindowKey}` : "on-demand"}
              </td>
              <td className="px-5 py-2">
                {s.deliveryAddress.formatted}
                {s.instructions && <div className="text-xs text-[#86817A]">{s.instructions}</div>}
              </td>
              <td className="px-5 py-2">
                {s.recipient.name}
                <div className="text-xs text-[#86817A]">{s.recipient.phone}</div>
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
                      className="rounded-full border border-[#DAD6CF] px-2 py-0.5 text-xs hover:border-[#0A0A0A]"
                    >
                      {to.replace("_", " ")}
                    </button>
                  ))}
                </div>
              </td>
            </tr>
          ))}
          {list.data?.items.length === 0 && (
            <tr>
              <td colSpan={6} className="px-5 py-8 text-center text-[#86817A]">
                No shipments match.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </section>
  );
}
