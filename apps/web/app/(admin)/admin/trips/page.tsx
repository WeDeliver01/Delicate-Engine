"use client";

import Link from "next/link";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Driver, Shift, Trip } from "@delicate/contracts";
import { api, ApiRequestError } from "@/lib/api";
import { Chip, Empty, PageHeader, Panel, Stat } from "@/components/ui";

const STATUS_TONE = {
  planned: "neutral",
  released: "info",
  started: "good",
  completed: "outline",
  abandoned: "bad",
} as const;

/**
 * The day's trips.
 *
 * A trip is one driver, one date, one ordered list of stops. This page is where a dispatcher
 * builds tomorrow before it happens; the board (/admin/dispatch) is where they watch today.
 */
export default function AdminTripsPage() {
  const qc = useQueryClient();
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [error, setError] = useState<string | null>(null);
  const onError = (e: unknown) => setError(e instanceof ApiRequestError ? e.message : String(e));

  const trips = useQuery({
    queryKey: ["admin", "trips", date],
    queryFn: () => api<Trip[]>(`/v1/admin/dispatch/trips?date=${date}`),
    refetchInterval: 30_000,
  });
  const drivers = useQuery({
    queryKey: ["admin", "fleet", "drivers"],
    queryFn: () => api<Driver[]>("/v1/admin/fleet/drivers"),
  });
  const shifts = useQuery({
    queryKey: ["admin", "fleet", "shifts", date],
    queryFn: () => api<Shift[]>(`/v1/admin/fleet/shifts?dateFrom=${date}&dateTo=${date}`),
  });

  const create = useMutation({
    mutationFn: (driverId: string) =>
      api<Trip>("/v1/admin/dispatch/trips", { method: "POST", json: { driverId, date } }),
    onSuccess: () => {
      setError(null);
      void qc.invalidateQueries({ queryKey: ["admin", "trips"] });
    },
    onError,
  });

  const rows = trips.data ?? [];
  const shiftBy = new Map(shifts.data?.map((s) => [s.driverId, s]));
  // A driver with no live trip for this date is one a dispatcher can still build a day for.
  const withoutTrip = (drivers.data ?? []).filter(
    (d) =>
      d.status === "active" && !rows.some((t) => t.driverId === d.id && t.status !== "abandoned"),
  );
  const stops = rows.reduce((n, t) => n + t.progress.total, 0);
  const done = rows.reduce((n, t) => n + t.progress.done, 0);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Command Center"
        title="Trips"
        lede="One driver, one day, in the order you decided. Build it here; watch it on the board."
        actions={
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="input"
            aria-label="Trip date"
          />
        }
      />

      {error && <p className="alert-error">{error}</p>}

      <div className="grid gap-3 sm:grid-cols-4">
        <Stat label="Trips" value={rows.length} />
        <Stat label="Stops" value={stops} />
        <Stat
          label="Completed"
          value={stops === 0 ? "—" : `${done}/${stops}`}
          tone={stops > 0 && done === stops ? "good" : undefined}
        />
        <Stat
          label="Planned km"
          value={rows.reduce((n, t) => n + t.plannedKm, 0).toFixed(1)}
          hint="depot out and back"
        />
      </div>

      <Panel title="The day" description={`${rows.length} trip${rows.length === 1 ? "" : "s"}`}>
        {rows.length === 0 ? (
          <Empty>
            No trips for this date yet. Start one for a driver below, then add stops to it.
          </Empty>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="label-mini">
              <tr>
                <th className="px-5 py-2">Trip</th>
                <th className="px-5 py-2">Driver</th>
                <th className="px-5 py-2">Vehicle</th>
                <th className="px-5 py-2">Stops</th>
                <th className="px-5 py-2">Planned</th>
                <th className="px-5 py-2">Order</th>
                <th className="px-5 py-2">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#F0EDE9]">
              {rows.map((t) => (
                <tr key={t.id}>
                  <td className="px-5 py-2">
                    <Link href={`/admin/trips/${t.id}`} className="link-quiet font-medium">
                      {t.reference}
                    </Link>
                  </td>
                  <td className="px-5 py-2">
                    {t.driverName}
                    <div className="text-xs text-muted">
                      {shiftBy.get(t.driverId)?.status ?? "no shift"}
                    </div>
                  </td>
                  <td className="px-5 py-2">{t.vehicleRegistration ?? "—"}</td>
                  <td className="px-5 py-2">
                    {t.progress.done}/{t.progress.total}
                    {t.progress.skipped > 0 && (
                      <span className="text-xs text-[#C13B73]">
                        {" "}
                        · {t.progress.skipped} skipped
                      </span>
                    )}
                  </td>
                  <td className="px-5 py-2">
                    {t.plannedKm.toFixed(1)} km
                    {t.route && t.route.savedKm > 0 && (
                      <div className="text-xs text-[#1B7F4B]">
                        saved {t.route.savedKm.toFixed(1)} km
                      </div>
                    )}
                  </td>
                  <td className="px-5 py-2">
                    <Chip tone={t.sequenceSource === "dispatcher" ? "info" : "outline"}>
                      {t.sequenceSource === "dispatcher" ? "yours" : "suggested"}
                    </Chip>
                  </td>
                  <td className="px-5 py-2">
                    <Chip tone={STATUS_TONE[t.status]}>{t.status}</Chip>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>

      <Panel
        title="Start a trip"
        description="A driver can hold one live trip per day. Give them a day, then fill it."
      >
        <div className="panel-body flex flex-wrap gap-2">
          {withoutTrip.length === 0 ? (
            <p className="text-sm text-muted">
              Every active driver already has a trip on this date.
            </p>
          ) : (
            withoutTrip.map((d) => (
              <button
                key={d.id}
                type="button"
                onClick={() => create.mutate(d.id)}
                disabled={create.isPending}
                className="btn btn-secondary btn-sm"
              >
                {d.fullName}
                {!shiftBy.get(d.id) && <span className="ml-1 text-xs text-muted">(no shift)</span>}
              </button>
            ))
          )}
        </div>
      </Panel>
    </div>
  );
}
