"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Driver } from "@delicate/contracts";
import { api, ApiRequestError } from "@/lib/api";

/**
 * Who has this parcel, changed where it is read.
 *
 * Reassigning used to mean leaving the list, opening the dispatch board, finding the same
 * shipment and assigning it there — four screens to answer "put this on Kenneth instead",
 * which is a thing somebody says out loud while looking at the list. So it is a dropdown in
 * the row.
 *
 * Only for staff who may change it; everybody else sees the name. The engine refuses either
 * way, but a control that looks live and then refuses is worse than no control.
 */
export function DriverCell({
  shipmentId,
  driver,
  canAssign,
}: {
  shipmentId: string;
  driver: { id: string; name: string | null } | null;
  canAssign: boolean;
}) {
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  // Only once the list is on screen, and shared by every row in it.
  const drivers = useQuery({
    queryKey: ["admin", "fleet", "drivers"],
    queryFn: () => api<Driver[]>("/v1/admin/fleet/drivers"),
    enabled: canAssign,
    staleTime: 5 * 60_000,
  });

  const assign = useMutation({
    mutationFn: (driverId: string) =>
      driverId
        ? api(`/v1/admin/dispatch/shipments/${shipmentId}/assign`, {
            method: "POST",
            json: { driverId },
          })
        : api(`/v1/admin/dispatch/shipments/${shipmentId}/unassign`, {
            method: "POST",
            json: { reason: "unassigned from the shipment list" },
          }),
    onSuccess: () => {
      setError(null);
      void qc.invalidateQueries({ queryKey: ["admin"] });
    },
    onError: (e) => setError(e instanceof ApiRequestError ? e.message : String(e)),
  });

  if (!canAssign) {
    return <span className="whitespace-nowrap text-[#6B6661]">{driver?.name ?? "—"}</span>;
  }

  const options = (drivers.data ?? []).filter((d) => d.status === "active" || d.id === driver?.id);

  return (
    <span className="block">
      <select
        value={driver?.id ?? ""}
        disabled={assign.isPending}
        aria-label="Driver"
        onChange={(e) => assign.mutate(e.target.value)}
        // Stops the click from opening the shipment the row links to.
        onClick={(e) => e.stopPropagation()}
        className="input w-36 px-2 py-1 text-xs disabled:opacity-50"
      >
        <option value="">Unassigned</option>
        {options.map((d) => (
          <option key={d.id} value={d.id}>
            {d.fullName}
            {d.isMain ? " ★" : ""}
          </option>
        ))}
      </select>
      {error && <span className="mt-1 block max-w-36 text-xs text-[#C13B73]">{error}</span>}
    </span>
  );
}
