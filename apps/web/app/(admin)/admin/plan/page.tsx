"use client";

import Link from "next/link";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { DayPlan } from "@delicate/contracts";
import { api, ApiRequestError } from "@/lib/api";
import { minutesToClock } from "@/lib/money";
import { Empty, Notice, PageHeader, Panel, Stat } from "@/components/ui";

/**
 * Plan the day.
 *
 * "You have 23 shipments and 3 drivers — recommend the allocation." It is a proposal: looking
 * at it changes nothing, and applying it leaves every trip unreleased, so a dispatcher still
 * reads each sheet and hands it over themselves. The algorithm assists dispatch; it does not
 * become the dispatcher.
 */
export default function DayPlanPage() {
  const qc = useQueryClient();
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [error, setError] = useState<string | null>(null);
  const [applied, setApplied] = useState(false);

  const plan = useQuery({
    queryKey: ["admin", "plan", date],
    queryFn: () => api<DayPlan>(`/v1/admin/dispatch/plan?date=${date}`),
  });

  const apply = useMutation({
    mutationFn: (driverIds?: string[]) =>
      api<DayPlan>("/v1/admin/dispatch/plan/apply", {
        method: "POST",
        json: { date, driverIds },
      }),
    onSuccess: () => {
      setError(null);
      setApplied(true);
      void qc.invalidateQueries({ queryKey: ["admin", "plan"] });
      void qc.invalidateQueries({ queryKey: ["admin", "trips"] });
      void qc.invalidateQueries({ queryKey: ["admin", "board"] });
    },
    onError: (e) => setError(e instanceof ApiRequestError ? e.message : String(e)),
  });

  const p = plan.data;
  const placed = p?.drivers.reduce((n, d) => n + d.shipmentIds.length, 0) ?? 0;
  const working = p?.drivers.filter((d) => d.shipmentIds.length > 0).length ?? 0;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Command Center"
        title="Plan the day"
        lede="A proposal from who is on shift, what their vehicles take, and the windows each drop is working to. Nothing moves until you apply it."
        actions={
          <>
            <input
              type="date"
              value={date}
              onChange={(e) => {
                setDate(e.target.value);
                setApplied(false);
              }}
              className="input"
              aria-label="Plan date"
            />
            <button
              type="button"
              onClick={() => apply.mutate(undefined)}
              disabled={apply.isPending || placed === 0}
              className="btn btn-primary btn-sm"
            >
              {apply.isPending ? "Applying…" : "Apply to trips"}
            </button>
          </>
        }
      />

      {error && <p className="alert-error">{error}</p>}
      {applied && (
        <Notice tone="success">
          Applied. Each driver&apos;s trip is <strong>planned</strong>, not released — open it on{" "}
          <Link href="/admin/trips" className="link-quiet">
            Trips
          </Link>{" "}
          to check the order and hand it over.
        </Notice>
      )}

      {plan.isLoading && <p className="text-sm text-muted">Working out the day…</p>}

      {p && (
        <>
          <div className="grid gap-3 sm:grid-cols-4">
            <Stat label="Shipments placed" value={placed} />
            <Stat label="Drivers used" value={`${working}/${p.drivers.length}`} />
            <Stat label="Total km" value={p.totalKm.toFixed(1)} />
            <Stat
              label="Would miss"
              value={p.lateMinutes === 0 ? "nothing" : `${p.lateMinutes} min`}
              tone={p.lateMinutes === 0 ? "good" : "bad"}
            />
          </div>

          {p.warnings.length > 0 && (
            <Panel title="Rules this plan breaks" description="Named rather than quietly accepted.">
              <ul className="panel-body space-y-1">
                {p.warnings.map((w) => (
                  <li key={w} className="text-sm text-[#C13B73]">
                    {w}
                  </li>
                ))}
              </ul>
            </Panel>
          )}

          {p.unplaced.length > 0 && (
            <Panel
              title="Could not be placed"
              description="These need a person before the day runs."
            >
              <ul className="divide-y divide-[#F0EDE9]">
                {p.unplaced.map((u) => (
                  <li key={u.shipmentId} className="flex justify-between gap-3 px-5 py-2 text-sm">
                    <span className="font-mono">{u.waybill}</span>
                    <span className="text-muted">{u.reason}</span>
                  </li>
                ))}
              </ul>
            </Panel>
          )}

          <Panel title="Proposed days">
            {p.drivers.length === 0 ? (
              <Empty>
                Nobody is on shift for this date. Schedule a driver on the{" "}
                <Link href="/admin/drivers" className="link-quiet">
                  fleet desk
                </Link>{" "}
                first.
              </Empty>
            ) : (
              <table className="w-full text-left text-sm">
                <thead className="label-mini">
                  <tr>
                    <th className="px-5 py-2">Driver</th>
                    <th className="px-5 py-2">Vehicle</th>
                    <th className="px-5 py-2">Shipments</th>
                    <th className="px-5 py-2">Stops</th>
                    <th className="px-5 py-2">Km</th>
                    <th className="px-5 py-2">Finishes</th>
                    <th className="px-5 py-2">Risk</th>
                    <th className="px-5 py-2" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#F0EDE9]">
                  {p.drivers.map((d) => (
                    <tr key={d.driverId}>
                      <td className="px-5 py-2">
                        {d.name}
                        {d.tripReference && (
                          <div className="text-xs text-muted">
                            <Link href={`/admin/trips/${d.tripId}`} className="link-quiet">
                              {d.tripReference}
                            </Link>
                          </div>
                        )}
                      </td>
                      <td className="px-5 py-2">{d.vehicleRegistration ?? "—"}</td>
                      <td className="px-5 py-2">
                        {d.shipmentIds.length === 0 ? (
                          <span className="text-muted">nothing</span>
                        ) : (
                          <span className="font-mono text-xs">{d.waybills.join(", ")}</span>
                        )}
                      </td>
                      <td className="px-5 py-2">{d.stopCount}</td>
                      <td className="px-5 py-2">{d.plannedKm.toFixed(1)}</td>
                      <td className="px-5 py-2">{minutesToClock(d.finishMinute)}</td>
                      <td className="px-5 py-2">
                        {d.lateStopCount === 0 && d.overtimeMinutes === 0 ? (
                          <span className="text-[#1B7F4B]">clear</span>
                        ) : (
                          <span className="text-[#C13B73]">
                            {d.lateStopCount > 0 && `${d.lateStopCount} late`}
                            {d.lateStopCount > 0 && d.overtimeMinutes > 0 && " · "}
                            {d.overtimeMinutes > 0 && `${d.overtimeMinutes} min over`}
                          </span>
                        )}
                      </td>
                      <td className="px-5 py-2 text-right">
                        {d.shipmentIds.length > 0 && (
                          <button
                            type="button"
                            onClick={() => apply.mutate([d.driverId])}
                            disabled={apply.isPending}
                            className="btn btn-secondary btn-sm"
                          >
                            Apply
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Panel>
        </>
      )}
    </div>
  );
}
