"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Shipment, TripSheet, TripStop } from "@delicate/contracts";
import { api, ApiRequestError } from "@/lib/api";
import { dateTime, minutesToClock } from "@/lib/money";
import { Chip, Empty, Panel } from "@/components/ui";

const STOP_TONE = {
  pending: "outline",
  arrived: "info",
  done: "good",
  skipped: "bad",
} as const;

/**
 * The trip sheet: the paper a driver works from, and the screen a dispatcher orders the day on.
 *
 * Reordering is by move-up/move-down rather than drag. A dispatcher is often doing this on a
 * laptop trackpad at 6am with one hand on a phone, and the keyboard path has to work anyway.
 * The whole sheet prints, because a van with a flat battery still has to do the round.
 */
export default function TripSheetPage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [editing, setEditing] = useState<TripStop | null>(null);
  const onError = (e: unknown) => setError(e instanceof ApiRequestError ? e.message : String(e));
  const refresh = () => {
    setError(null);
    void qc.invalidateQueries({ queryKey: ["admin", "trip", id] });
    void qc.invalidateQueries({ queryKey: ["admin", "trips"] });
    void qc.invalidateQueries({ queryKey: ["admin", "unassigned"] });
  };

  const trip = useQuery({
    queryKey: ["admin", "trip", id],
    queryFn: () => api<TripSheet>(`/v1/admin/dispatch/trips/${id}`),
    refetchInterval: 20_000,
  });
  const unassigned = useQuery({
    queryKey: ["admin", "unassigned"],
    queryFn: () => api<Shipment[]>("/v1/admin/dispatch/unassigned"),
    enabled: picking,
  });

  const act = useMutation({
    mutationFn: ({
      path,
      body,
      method = "POST",
    }: {
      path: string;
      body?: unknown;
      method?: string;
    }) => api(`/v1/admin/dispatch/${path}`, { method, json: body ?? {} }),
    onSuccess: refresh,
    onError,
  });

  const t = trip.data;
  const stops = useMemo(() => [...(t?.stops ?? [])].sort((a, b) => a.sequence - b.sequence), [t]);
  const open = t?.status === "planned" || t?.status === "released" || t?.status === "started";

  /** Swap a stop with its neighbour and send the whole new order. */
  const move = (index: number, delta: number) => {
    const next = [...stops];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target]!, next[index]!];
    act.mutate({
      path: `trips/${id}/sequence`,
      method: "PUT",
      body: { stopIds: next.map((s) => s.id) },
    });
  };

  if (trip.isLoading) return <p className="text-sm text-muted">Loading trip…</p>;
  if (!t) return <Empty>That trip does not exist.</Empty>;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4 print:hidden">
        <div>
          <p className="eyebrow mb-2">
            <Link href="/admin/trips" className="link-quiet">
              ← Trips
            </Link>
          </p>
          <h1 className="page-title">{t.reference}</h1>
          <p className="lede mt-2">
            {t.driverName} · {t.vehicleRegistration ?? "no vehicle"} · {t.date}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Chip tone={t.status === "started" ? "good" : t.status === "abandoned" ? "bad" : "info"}>
            {t.status}
          </Chip>
          <button type="button" onClick={() => window.print()} className="btn btn-secondary btn-sm">
            Print
          </button>
          {open && (
            <button
              type="button"
              onClick={() => setPicking((p) => !p)}
              className="btn btn-secondary btn-sm"
            >
              {picking ? "Done adding" : "Add stops"}
            </button>
          )}
          {open && (
            <button
              type="button"
              onClick={() =>
                act.mutate({
                  path: `trips/${id}/sequence/auto${t.sequenceSource === "dispatcher" ? "?force=true" : ""}`,
                })
              }
              className="btn btn-secondary btn-sm"
              title={
                t.sequenceSource === "dispatcher"
                  ? "You ordered this day by hand. This will replace your order."
                  : "Suggest an order from the depot and back"
              }
            >
              {t.sequenceSource === "dispatcher" ? "Re-suggest order" : "Suggest order"}
            </button>
          )}
          {t.status === "planned" && (
            <button
              type="button"
              onClick={() => act.mutate({ path: `trips/${id}/release` })}
              className="btn btn-primary btn-sm"
            >
              Release to driver
            </button>
          )}
          {t.status === "started" && (
            <button
              type="button"
              onClick={() => act.mutate({ path: `trips/${id}/complete` })}
              className="btn btn-primary btn-sm"
            >
              Complete
            </button>
          )}
          {open && (
            <button
              type="button"
              onClick={() => {
                const reason = window.prompt("Why is this trip being abandoned?");
                if (reason) act.mutate({ path: `trips/${id}/abandon`, body: { reason } });
              }}
              className="btn btn-danger btn-sm"
            >
              Abandon
            </button>
          )}
        </div>
      </div>

      {error && <p className="alert-error print:hidden">{error}</p>}

      {/* The printed sheet starts here. */}
      <section className="panel p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="label-mini">Trip</div>
            <div className="figure text-lg">{t.reference}</div>
            <div className="mt-1 text-sm">
              {t.driverName} · {t.vehicleRegistration ?? "—"}
            </div>
            <div className="text-xs text-muted">{t.date}</div>
          </div>
          <div className="grid grid-cols-4 gap-5 text-center">
            <Figure label="Stops" value={String(t.progress.total)} />
            <Figure label="Done" value={`${t.progress.done}/${t.progress.total}`} />
            <Figure label="Km" value={t.plannedKm.toFixed(1)} />
            <Figure
              label="Hours"
              value={t.plannedMinutes ? (t.plannedMinutes / 60).toFixed(1) : "—"}
            />
          </div>
        </div>
        {t.route && t.route.savedKm > 0 && (
          <p className="panel-note">
            Ordering this day saved {t.route.savedKm.toFixed(1)} km against the order the bookings
            arrived in ({t.route.originalKm.toFixed(1)} km → {t.route.totalKm.toFixed(1)} km).
          </p>
        )}
      </section>

      <Panel
        title="Stops"
        description={
          t.sequenceSource === "dispatcher"
            ? "Ordered by you. The optimiser will not overrule it."
            : "Suggested order. Move anything and it becomes yours."
        }
      >
        {stops.length === 0 ? (
          <Empty>
            Nothing on this trip yet. Use <strong>Add stops</strong> to put today&apos;s shipments
            on it — a delivery brings its collection with it.
          </Empty>
        ) : (
          <ol className="divide-y divide-[#F0EDE9]">
            {stops.map((s, i) => (
              <li key={s.id} className="flex gap-4 px-5 py-3">
                <div className="w-8 shrink-0 pt-0.5 text-center">
                  <div className="figure text-sm">{s.sequence}</div>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Chip tone={s.kind === "collection" ? "warn" : "neutral"}>
                      {s.kind === "collection" ? "Collect" : "Deliver"}
                    </Chip>
                    <Chip tone={STOP_TONE[s.status]}>{s.status}</Chip>
                    <span className="text-sm font-medium">{s.waybill ?? s.bookingReference}</span>
                    {s.window.source !== "slot" && (
                      <Chip tone="info">
                        {s.window.source === "pinned" ? "pinned" : "narrowed"}
                      </Chip>
                    )}
                  </div>
                  <div className="mt-1 text-sm">{s.address.formatted}</div>
                  <div className="text-xs text-muted">
                    {s.contact ? `${s.contact.name} · ${s.contact.phone}` : "no contact"}
                    {s.parcels.length > 0 &&
                      ` · ${s.parcels.reduce((n, p) => n + p.quantity, 0)} parcel(s)`}
                  </div>
                  {s.instructions && (
                    <div className="mt-1 text-xs text-[#8A5A12]">{s.instructions}</div>
                  )}
                  {s.arrivedAt && (
                    <div className="mt-1 text-xs text-[#1B7F4B]">
                      arrived {dateTime(s.arrivedAt)}
                    </div>
                  )}
                </div>
                <div className="w-28 shrink-0 text-right text-sm">
                  <div className="figure">
                    {s.plannedArrivalMinute == null ? "—" : minutesToClock(s.plannedArrivalMinute)}
                  </div>
                  <div className="text-xs text-muted">
                    {s.window.startMinute == null || s.window.endMinute == null
                      ? "any time"
                      : `${minutesToClock(s.window.startMinute)}–${minutesToClock(s.window.endMinute)}`}
                  </div>
                  {s.legKm != null && (
                    <div className="text-xs text-muted">{s.legKm.toFixed(1)} km</div>
                  )}
                </div>
                {open && (
                  <div className="flex w-20 shrink-0 flex-col items-end gap-1 print:hidden">
                    <div className="flex gap-1">
                      <button
                        type="button"
                        onClick={() => move(i, -1)}
                        disabled={i === 0 || act.isPending}
                        className="chip chip-outline"
                        aria-label={`Move ${s.sequence} earlier`}
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        onClick={() => move(i, 1)}
                        disabled={i === stops.length - 1 || act.isPending}
                        className="chip chip-outline"
                        aria-label={`Move ${s.sequence} later`}
                      >
                        ↓
                      </button>
                    </div>
                    <button
                      type="button"
                      onClick={() => setEditing(s)}
                      className="link-quiet text-xs"
                    >
                      window
                    </button>
                    {s.status === "pending" && (
                      <button
                        type="button"
                        onClick={() =>
                          act.mutate({
                            path: `trips/${id}/stops`,
                            method: "DELETE",
                            body: { stopIds: [s.id], reason: "removed by dispatcher" },
                          })
                        }
                        className="link-quiet text-xs text-[#C13B73]"
                      >
                        remove
                      </button>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ol>
        )}
      </Panel>

      {picking && (
        <Panel
          title="Unassigned shipments"
          description="Adding a delivery brings its booking's collection with it."
          className="print:hidden"
        >
          {(unassigned.data ?? []).length === 0 ? (
            <Empty>Nothing is waiting for a driver.</Empty>
          ) : (
            <table className="w-full text-left text-sm">
              <thead className="label-mini">
                <tr>
                  <th className="px-5 py-2">Waybill</th>
                  <th className="px-5 py-2">To</th>
                  <th className="px-5 py-2">Service</th>
                  <th className="px-5 py-2">Slot</th>
                  <th className="px-5 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-[#F0EDE9]">
                {(unassigned.data ?? []).map((s) => (
                  <tr key={s.id}>
                    <td className="px-5 py-2 font-medium">{s.waybill}</td>
                    <td className="px-5 py-2">
                      {s.deliveryAddress.suburb ?? s.deliveryAddress.formatted}
                    </td>
                    <td className="px-5 py-2">{s.serviceLevelCode}</td>
                    <td className="px-5 py-2">
                      {s.slotDate ? `${s.slotDate} ${s.slotWindowKey ?? ""}` : "on demand"}
                    </td>
                    <td className="px-5 py-2 text-right">
                      <button
                        type="button"
                        onClick={() =>
                          act.mutate({
                            path: `trips/${id}/stops`,
                            body: { shipmentIds: [s.id], resequence: true },
                          })
                        }
                        disabled={act.isPending}
                        className="btn btn-secondary btn-sm"
                      >
                        Add
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>
      )}

      {editing && (
        <WindowDialog
          stop={editing}
          onClose={() => setEditing(null)}
          onSave={(body) => {
            act.mutate({ path: `stops/${editing.id}/window`, method: "PUT", body });
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="label-mini">{label}</div>
      <div className="figure mt-1 text-base">{value}</div>
    </div>
  );
}

/**
 * Narrow the window a driver works to, or pin the stop to an exact minute.
 *
 * Both ends are typed as clock times because that is what a dispatcher reads off a phone call;
 * minutes past midnight is the engine's business, not theirs.
 */
function WindowDialog({
  stop,
  onClose,
  onSave,
}: {
  stop: TripStop;
  onClose: () => void;
  onSave: (body: {
    startMinute: number | null;
    endMinute: number | null;
    pinnedMinute: number | null;
  }) => void;
}) {
  const [start, setStart] = useState(
    stop.window.startMinute == null ? "" : minutesToClock(stop.window.startMinute),
  );
  const [end, setEnd] = useState(
    stop.window.endMinute == null ? "" : minutesToClock(stop.window.endMinute),
  );
  const [pin, setPin] = useState("");

  const toMinutes = (clock: string): number | null => {
    const m = /^(\d{1,2}):(\d{2})$/.exec(clock.trim());
    if (!m) return null;
    const minutes = Number(m[1]) * 60 + Number(m[2]);
    return minutes >= 0 && minutes <= 1440 ? minutes : null;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4 print:hidden">
      <div className="panel w-full max-w-md p-5">
        <h2 className="section-title">Window for stop {stop.sequence}</h2>
        <p className="mt-1 text-xs text-muted">
          {stop.address.formatted}
          {stop.window.source === "slot" && " · currently the slot the customer bought"}
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="field-label">From</span>
            <input
              value={start}
              onChange={(e) => setStart(e.target.value)}
              placeholder="09:00"
              className="input"
            />
          </label>
          <label className="block">
            <span className="field-label">To</span>
            <input
              value={end}
              onChange={(e) => setEnd(e.target.value)}
              placeholder="10:00"
              className="input"
            />
          </label>
        </div>
        <label className="mt-3 block">
          <span className="field-label">Or pin to an exact time</span>
          <input
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            placeholder="09:30"
            className="input"
          />
          <span className="field-hint">
            A pin is a hard anchor: the ordering will not move this stop off it.
          </span>
        </label>
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="btn btn-secondary btn-sm">
            Cancel
          </button>
          <button
            type="button"
            onClick={() =>
              onSave({
                startMinute: toMinutes(start),
                endMinute: toMinutes(end),
                pinnedMinute: toMinutes(pin),
              })
            }
            className="btn btn-primary btn-sm"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
