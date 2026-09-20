"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { BlackoutDate, SlotAvailability, SlotPolicy } from "@delicate/contracts";
import { api, ApiRequestError } from "@/lib/api";
import { minutesToClock } from "@/lib/money";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Dispatcher: the weekly policy, the next two weeks of slots, and blackout dates. */
export default function AdminCapacity() {
  const qc = useQueryClient();
  const policy = useQuery({
    queryKey: ["admin", "capacity", "policy"],
    queryFn: () => api<SlotPolicy>("/v1/admin/capacity/policy"),
  });
  const slots = useQuery({
    queryKey: ["admin", "capacity", "slots"],
    queryFn: () => api<SlotAvailability[]>("/v1/admin/capacity/slots"),
    refetchInterval: 15_000,
  });
  const blackouts = useQuery({
    queryKey: ["admin", "capacity", "blackouts"],
    queryFn: () => api<BlackoutDate[]>("/v1/admin/capacity/blackouts"),
  });
  const [error, setError] = useState<string | null>(null);
  const invalidate = () => void qc.invalidateQueries({ queryKey: ["admin", "capacity"] });
  const onError = (e: unknown) => setError(e instanceof ApiRequestError ? e.message : String(e));

  const setSlot = useMutation({
    mutationFn: (body: { date: string; windowKey: string; closed?: boolean; capacity?: number }) =>
      api("/v1/admin/capacity/slots/set", { method: "POST", json: body }),
    onSuccess: invalidate,
    onError,
  });
  const addBlackout = useMutation({
    mutationFn: (body: BlackoutDate) =>
      api("/v1/admin/capacity/blackouts", { method: "POST", json: body }),
    onSuccess: invalidate,
    onError,
  });
  const removeBlackout = useMutation({
    mutationFn: (date: string) => api(`/v1/admin/capacity/blackouts/${date}`, { method: "DELETE" }),
    onSuccess: invalidate,
    onError,
  });
  const [bo, setBo] = useState({ date: "", reason: "" });

  const days = [...new Set(slots.data?.map((s) => s.date) ?? [])];

  return (
    <div className="space-y-6">
      {error && (
        <p className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </p>
      )}
      {policy.data && <PolicyForm policy={policy.data} onSaved={invalidate} onError={onError} />}

      <section className="rounded-xl border border-[#ECEAE6] bg-white p-5">
        <h2 className="font-semibold">Next {days.length} operating days</h2>
        <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
          {days.map((d) => (
            <div key={d} className="rounded-xl border border-[#ECEAE6] p-3 text-sm">
              <p className="font-semibold">
                {new Date(`${d}T00:00:00`).toLocaleDateString("en-ZA", {
                  weekday: "long",
                  day: "numeric",
                  month: "short",
                })}
              </p>
              {slots.data
                ?.filter((s) => s.date === d)
                .map((s) => (
                  <div key={s.windowKey} className="mt-2 flex items-center justify-between gap-2">
                    <span>{s.label}</span>
                    <span className={`font-mono text-xs ${s.bookable ? "" : "text-[#C13B73]"}`}>
                      {s.booked}/{s.capacity}
                      {!s.bookable && ` · ${s.closedReason?.replace("_", " ")}`}
                    </span>
                    <div className="flex gap-1">
                      <button
                        onClick={() =>
                          setSlot.mutate({
                            date: d,
                            windowKey: s.windowKey,
                            closed: s.closedReason !== "closed",
                          })
                        }
                        className="rounded-full border border-[#DAD6CF] px-2 py-0.5 text-xs hover:border-[#0A0A0A]"
                      >
                        {s.closedReason === "closed" ? "open" : "close"}
                      </button>
                      <button
                        onClick={() => {
                          const v = prompt("Capacity for this slot", String(s.capacity));
                          if (v !== null)
                            setSlot.mutate({
                              date: d,
                              windowKey: s.windowKey,
                              capacity: Number(v),
                            });
                        }}
                        className="rounded-full border border-[#DAD6CF] px-2 py-0.5 text-xs hover:border-[#0A0A0A]"
                      >
                        cap
                      </button>
                    </div>
                  </div>
                ))}
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-xl border border-[#ECEAE6] bg-white p-5 text-sm">
        <h2 className="font-semibold">Blackout dates</h2>
        <ul className="mt-2 divide-y divide-[#F0EDE9]">
          {blackouts.data?.map((b) => (
            <li key={b.date} className="flex items-center justify-between py-2">
              <span>
                {b.date} <span className="text-[#86817A]">{b.reason}</span>
              </span>
              <button
                onClick={() => removeBlackout.mutate(b.date)}
                className="text-xs text-red-600 hover:underline"
              >
                remove
              </button>
            </li>
          ))}
        </ul>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            addBlackout.mutate({ date: bo.date, reason: bo.reason || null });
            setBo({ date: "", reason: "" });
          }}
          className="mt-3 flex gap-2"
        >
          <input
            type="date"
            required
            value={bo.date}
            onChange={(e) => setBo({ ...bo, date: e.target.value })}
            className="rounded-lg border border-[#DAD6CF] px-2 py-1"
          />
          <input
            value={bo.reason}
            onChange={(e) => setBo({ ...bo, reason: e.target.value })}
            placeholder="Reason"
            className="flex-1 rounded-lg border border-[#DAD6CF] px-2 py-1"
          />
          <button className="rounded-full bg-[#0A0A0A] px-3 py-1 text-xs text-white">Add</button>
        </form>
      </section>
    </div>
  );
}

function PolicyForm({
  policy,
  onSaved,
  onError,
}: {
  policy: SlotPolicy;
  onSaved: () => void;
  onError: (e: unknown) => void;
}) {
  const [p, setP] = useState(policy);
  useEffect(() => setP(policy), [policy]);
  const save = useMutation({
    mutationFn: () => api("/v1/admin/capacity/policy", { method: "PUT", json: p }),
    onSuccess: onSaved,
    onError,
  });
  const num = (k: "defaultCapacity" | "minLeadDays" | "cutoffMinutesBefore" | "horizonDays") => (
    <label className="block text-sm">
      <span className="text-[#6B6661]">
        {
          {
            defaultCapacity: "Default capacity per window",
            minLeadDays: "Minimum lead days",
            cutoffMinutesBefore: "Cut-off minutes before window",
            horizonDays: "Days offered ahead",
          }[k]
        }
      </span>
      <input
        type="number"
        value={p[k]}
        onChange={(e) => setP({ ...p, [k]: Number(e.target.value) })}
        className="mt-1 w-full rounded-lg border border-[#DAD6CF] px-2 py-1.5 font-mono"
      />
    </label>
  );
  return (
    <section className="rounded-xl border border-[#ECEAE6] bg-white p-5">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">Slot policy</h2>
        <button
          onClick={() => save.mutate()}
          className="rounded-full bg-[#0A0A0A] px-4 py-1.5 text-sm text-white hover:bg-[#E84A8A]"
        >
          Save policy
        </button>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {DAYS.map((d, i) => (
          <label
            key={d}
            className={`cursor-pointer rounded-full border px-3 py-1 text-sm ${p.operatingDays.includes(i) ? "border-[#0A0A0A] bg-[#0A0A0A] text-white" : "border-[#DAD6CF]"}`}
          >
            <input
              type="checkbox"
              className="sr-only"
              checked={p.operatingDays.includes(i)}
              onChange={(e) =>
                setP({
                  ...p,
                  operatingDays: e.target.checked
                    ? [...p.operatingDays, i].sort()
                    : p.operatingDays.filter((x) => x !== i),
                })
              }
            />
            {d}
          </label>
        ))}
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-4">
        {num("defaultCapacity")}
        {num("minLeadDays")}
        {num("cutoffMinutesBefore")}
        {num("horizonDays")}
      </div>
      <h3 className="mt-4 text-sm font-semibold">Windows</h3>
      {p.windows.map((w, i) => (
        <div key={i} className="mt-2 grid items-end gap-2 sm:grid-cols-5 text-sm">
          <label>
            <span className="text-xs text-[#6B6661]">Key</span>
            <input
              value={w.key}
              onChange={(e) =>
                setP({
                  ...p,
                  windows: p.windows.map((x, j) => (j === i ? { ...x, key: e.target.value } : x)),
                })
              }
              className="mt-1 w-full rounded-lg border border-[#DAD6CF] px-2 py-1 font-mono"
            />
          </label>
          <label>
            <span className="text-xs text-[#6B6661]">Label</span>
            <input
              value={w.label}
              onChange={(e) =>
                setP({
                  ...p,
                  windows: p.windows.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)),
                })
              }
              className="mt-1 w-full rounded-lg border border-[#DAD6CF] px-2 py-1"
            />
          </label>
          <label>
            <span className="text-xs text-[#6B6661]">Start</span>
            <input
              type="time"
              value={minutesToClock(w.startMinutes)}
              onChange={(e) =>
                setP({
                  ...p,
                  windows: p.windows.map((x, j) =>
                    j === i ? { ...x, startMinutes: toMinutes(e.target.value) } : x,
                  ),
                })
              }
              className="mt-1 w-full rounded-lg border border-[#DAD6CF] px-2 py-1"
            />
          </label>
          <label>
            <span className="text-xs text-[#6B6661]">End</span>
            <input
              type="time"
              value={minutesToClock(w.endMinutes)}
              onChange={(e) =>
                setP({
                  ...p,
                  windows: p.windows.map((x, j) =>
                    j === i ? { ...x, endMinutes: toMinutes(e.target.value) } : x,
                  ),
                })
              }
              className="mt-1 w-full rounded-lg border border-[#DAD6CF] px-2 py-1"
            />
          </label>
          <div className="flex gap-2">
            <label className="flex-1">
              <span className="text-xs text-[#6B6661]">Capacity</span>
              <input
                type="number"
                placeholder="default"
                value={w.capacity ?? ""}
                onChange={(e) =>
                  setP({
                    ...p,
                    windows: p.windows.map((x, j) =>
                      j === i
                        ? { ...x, capacity: e.target.value === "" ? null : Number(e.target.value) }
                        : x,
                    ),
                  })
                }
                className="mt-1 w-full rounded-lg border border-[#DAD6CF] px-2 py-1 font-mono"
              />
            </label>
            <button
              type="button"
              onClick={() => setP({ ...p, windows: p.windows.filter((_, j) => j !== i) })}
              className="mb-1 text-xs text-red-600"
            >
              ×
            </button>
          </div>
        </div>
      ))}
      <button
        type="button"
        onClick={() =>
          setP({
            ...p,
            windows: [
              ...p.windows,
              {
                key: "window",
                label: "New window",
                startMinutes: 9 * 60,
                endMinutes: 12 * 60,
                capacity: null,
              },
            ],
          })
        }
        className="mt-3 text-xs text-[#E84A8A]"
      >
        + Add window
      </button>
    </section>
  );
}

function toMinutes(clock: string): number {
  const [h, m] = clock.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}
