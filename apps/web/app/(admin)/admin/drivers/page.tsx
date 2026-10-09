"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Driver, DriverPosition, FuelLog, Shift, Vehicle } from "@delicate/contracts";
import { api, ApiRequestError } from "@/lib/api";
import { dateTime, rands } from "@/lib/money";

/** Fleet desk: drivers, vehicles, today's shifts, live positions and fuel logs. */
export default function AdminDrivers() {
  const qc = useQueryClient();
  const drivers = useQuery({
    queryKey: ["admin", "fleet", "drivers"],
    queryFn: () => api<Driver[]>("/v1/admin/fleet/drivers"),
  });
  const vehicles = useQuery({
    queryKey: ["admin", "fleet", "vehicles"],
    queryFn: () => api<Vehicle[]>("/v1/admin/fleet/vehicles"),
  });
  const positions = useQuery({
    queryKey: ["admin", "fleet", "positions"],
    queryFn: () => api<DriverPosition[]>("/v1/admin/fleet/positions"),
    refetchInterval: 30_000,
  });
  const today = new Date().toISOString().slice(0, 10);
  const shifts = useQuery({
    queryKey: ["admin", "fleet", "shifts", today],
    queryFn: () => api<Shift[]>(`/v1/admin/fleet/shifts?dateFrom=${today}&dateTo=${today}`),
    refetchInterval: 30_000,
  });
  const fuel = useQuery({
    queryKey: ["admin", "fleet", "fuel"],
    queryFn: () => api<FuelLog[]>("/v1/admin/fleet/fuel-logs"),
  });
  const [error, setError] = useState<string | null>(null);
  const onError = (e: unknown) => setError(e instanceof ApiRequestError ? e.message : String(e));
  const invalidate = () => void qc.invalidateQueries({ queryKey: ["admin", "fleet"] });

  const addDriver = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api("/v1/admin/fleet/drivers", { method: "POST", json: body }),
    onSuccess: invalidate,
    onError,
  });
  const addVehicle = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api("/v1/admin/fleet/vehicles", { method: "POST", json: body }),
    onSuccess: invalidate,
    onError,
  });
  /** Who new work goes to. Null means nobody, and the engine goes back to choosing. */
  const setMain = useMutation({
    mutationFn: (driverId: string | null) =>
      api("/v1/admin/fleet/drivers/main", { method: "PUT", json: { driverId } }),
    onSuccess: invalidate,
    onError,
  });
  const schedule = useMutation({
    mutationFn: (driverId: string) =>
      api("/v1/admin/fleet/shifts", { method: "POST", json: { driverId, date: today } }),
    onSuccess: invalidate,
    onError,
  });

  const [d, setD] = useState({
    fullName: "",
    email: "",
    phone: "",
    vehicleId: "",
    dailyStopCapacity: "25",
  });
  const [limits, setLimits] = useState<Vehicle | null>(null);
  const saveLimits = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) =>
      api(`/v1/admin/fleet/vehicles/${id}`, { method: "PUT", json: body }),
    onSuccess: invalidate,
    onError,
  });

  const [v, setV] = useState({
    registration: "",
    make: "",
    model: "",
    fuelType: "petrol",
    litresPer100Km: "",
  });
  const shiftBy = new Map(shifts.data?.map((s) => [s.driverId, s]));
  const posBy = new Map(positions.data?.map((p) => [p.driverId, p]));

  return (
    <div className="space-y-6">
      {error && <p className="alert-error">{error}</p>}

      <section className="panel">
        <div className="panel-head flex flex-wrap items-center justify-between gap-2">
          <h1 className="section-title">Drivers</h1>
          {drivers.data?.some((d) => d.isMain) && (
            <button
              type="button"
              onClick={() => setMain.mutate(null)}
              className="link-quiet text-xs"
            >
              Nobody takes new work by default
            </button>
          )}
        </div>
        <p className="px-5 pb-2 text-xs text-muted">
          Every new shipment is assigned to the main driver, and anyone can be moved off it from the
          shipment list. With nobody set, the engine picks the nearest driver with room.
        </p>
        <table className="w-full text-left text-sm">
          <thead className="label-mini">
            <tr>
              <th className="px-5 py-2">Driver</th>
              <th className="px-5 py-2">Main</th>
              <th className="px-5 py-2">Contact</th>
              <th className="px-5 py-2">Vehicle</th>
              <th className="px-5 py-2">Capacity</th>
              <th className="px-5 py-2">Today</th>
              <th className="px-5 py-2">Last seen</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#F0EDE9]">
            {drivers.data?.map((dr) => {
              const shift = shiftBy.get(dr.id);
              const pos = posBy.get(dr.id);
              return (
                <tr key={dr.id}>
                  <td className="px-5 py-2">
                    {dr.fullName}
                    <div className="text-xs text-muted">
                      {dr.userId ? "app linked" : "not signed in yet"}
                    </div>
                  </td>
                  {/* New work goes to whoever is ticked here. One at a time, so ticking
                      somebody else unticks the current one. */}
                  <td className="px-5 py-2">
                    <label className="flex cursor-pointer items-center gap-2 text-xs">
                      <input
                        type="radio"
                        name="main-driver"
                        checked={dr.isMain}
                        disabled={dr.status !== "active" || setMain.isPending}
                        onChange={() => setMain.mutate(dr.id)}
                        className="accent-[#E84A8A]"
                      />
                      {dr.isMain ? "takes new work" : ""}
                    </label>
                  </td>
                  <td className="px-5 py-2">
                    {dr.phone}
                    <div className="text-xs text-muted">{dr.email}</div>
                  </td>
                  <td className="px-5 py-2">
                    {vehicles.data?.find((x) => x.id === dr.vehicleId)?.registration ?? "—"}
                  </td>
                  <td className="px-5 py-2">{dr.dailyStopCapacity}</td>
                  <td className="px-5 py-2">
                    {shift ? (
                      <span
                        className={shift.status === "open" ? "text-[#1B7F4B]" : "text-[#86817A]"}
                      >
                        {shift.status}
                      </span>
                    ) : (
                      <button onClick={() => schedule.mutate(dr.id)} className="chip chip-outline">
                        schedule
                      </button>
                    )}
                  </td>
                  <td className="px-5 py-2 text-xs text-muted">
                    {pos
                      ? `${pos.location.lat.toFixed(3)}, ${pos.location.lng.toFixed(3)} · ${dateTime(pos.recordedAt)}`
                      : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            addDriver.mutate({
              ...d,
              vehicleId: d.vehicleId || null,
              dailyStopCapacity: Number(d.dailyStopCapacity),
            });
            setD({ fullName: "", email: "", phone: "", vehicleId: "", dailyStopCapacity: "25" });
          }}
          className="flex flex-wrap items-end gap-2 border-t border-line p-4 text-sm"
        >
          <Field
            label="Full name"
            value={d.fullName}
            onChange={(x) => setD({ ...d, fullName: x })}
            required
          />
          <Field
            label="Email (their login)"
            value={d.email}
            onChange={(x) => setD({ ...d, email: x })}
            required
            type="email"
          />
          <Field
            label="Phone"
            value={d.phone}
            onChange={(x) => setD({ ...d, phone: x })}
            required
          />
          <label className="text-xs text-[#6B6661]">
            Vehicle
            <select
              value={d.vehicleId}
              onChange={(e) => setD({ ...d, vehicleId: e.target.value })}
              className="mt-1 block input px-2 py-1.5"
            >
              <option value="">none</option>
              {vehicles.data?.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.registration}
                </option>
              ))}
            </select>
          </label>
          <Field
            label="Stops/day"
            value={d.dailyStopCapacity}
            onChange={(x) => setD({ ...d, dailyStopCapacity: x })}
            type="number"
          />
          <button className="btn btn-primary btn-sm">Add driver</button>
        </form>
      </section>

      <section className="panel">
        <h2 className="panel-head section-title">Vehicles</h2>
        <ul className="divide-y divide-[#F0EDE9] text-sm">
          {vehicles.data?.map((x) => (
            <li key={x.id} className="px-5 py-2">
              <div className="flex justify-between">
                <span className="font-mono">{x.registration}</span>
                <span className="text-[#6B6661]">
                  {[x.make, x.model].filter(Boolean).join(" ")} · {x.fuelType}
                  {x.litresPer100Km ? ` · ${x.litresPer100Km} L/100km` : ""}
                </span>
              </div>
              <div className="mt-1 flex items-center justify-between gap-3">
                <span className="text-xs text-[#6B6661]">{describeLoad(x.constraints)}</span>
                <button
                  type="button"
                  onClick={() => setLimits(x)}
                  className="link-quiet text-xs shrink-0"
                >
                  what it carries
                </button>
              </div>
            </li>
          ))}
        </ul>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            addVehicle.mutate({
              ...v,
              make: v.make || null,
              model: v.model || null,
              litresPer100Km: v.litresPer100Km ? Number(v.litresPer100Km) : null,
            });
            setV({ registration: "", make: "", model: "", fuelType: "petrol", litresPer100Km: "" });
          }}
          className="flex flex-wrap items-end gap-2 border-t border-line p-4 text-sm"
        >
          <Field
            label="Registration"
            value={v.registration}
            onChange={(x) => setV({ ...v, registration: x })}
            required
          />
          <Field label="Make" value={v.make} onChange={(x) => setV({ ...v, make: x })} />
          <Field label="Model" value={v.model} onChange={(x) => setV({ ...v, model: x })} />
          <label className="text-xs text-[#6B6661]">
            Fuel
            <select
              value={v.fuelType}
              onChange={(e) => setV({ ...v, fuelType: e.target.value })}
              className="mt-1 block input px-2 py-1.5"
            >
              <option value="petrol">petrol</option>
              <option value="diesel">diesel</option>
              <option value="electric">electric</option>
            </select>
          </label>
          <Field
            label="L/100km"
            value={v.litresPer100Km}
            onChange={(x) => setV({ ...v, litresPer100Km: x })}
            type="number"
          />
          <button className="btn btn-primary btn-sm">Add vehicle</button>
        </form>
      </section>

      {limits && (
        <LoadLimits
          vehicle={limits}
          onClose={() => setLimits(null)}
          onSave={(constraints) => {
            saveLimits.mutate({
              id: limits.id,
              body: {
                registration: limits.registration,
                make: limits.make,
                model: limits.model,
                fuelType: limits.fuelType,
                litresPer100Km: limits.litresPer100Km,
                constraints,
              },
            });
            setLimits(null);
          }}
        />
      )}

      <section className="panel p-5 text-sm">
        <h2 className="section-title">Recent fuel logs</h2>
        <ul className="mt-3 divide-y divide-[#F0EDE9]">
          {fuel.data?.slice(0, 15).map((f) => (
            <li key={f.id} className="flex justify-between py-2">
              <span>
                {drivers.data?.find((x) => x.id === f.driverId)?.fullName ?? f.driverId.slice(0, 8)}{" "}
                · {f.litres} L{f.station ? ` · ${f.station}` : ""}
              </span>
              <span className="font-mono">
                {rands(f.amountCents)}
                {f.hasReceipt ? " 📎" : ""}
              </span>
            </li>
          ))}
          {fuel.data?.length === 0 && (
            <li className="py-4 text-center text-muted">No fuel logged yet.</li>
          )}
        </ul>
      </section>
    </div>
  );
}

function Field(props: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  required?: boolean;
}) {
  return (
    <label className="text-xs text-[#6B6661]">
      {props.label}
      <input
        type={props.type ?? "text"}
        value={props.value}
        required={props.required}
        onChange={(e) => props.onChange(e.target.value)}
        className="mt-1 block input px-2 py-1.5 text-sm"
      />
    </label>
  );
}

/** What a vehicle carries, in a line someone can read at a glance. */
function describeLoad(c: Vehicle["constraints"]): string {
  if (!c) return "no limits recorded — it will be offered anything";
  const bits: string[] = [];
  if (c.class) bits.push(c.class);
  if (c.maxParcels) bits.push(`up to ${c.maxParcels} parcels`);
  for (const [code, cap] of Object.entries(c.maxByPackageType ?? {})) {
    bits.push(`max ${cap} × ${code}`);
  }
  if (c.excludedPackageTypes?.length) bits.push(`never ${c.excludedPackageTypes.join(", ")}`);
  return bits.length > 0 ? bits.join(" · ") : "no limits recorded";
}

/**
 * What a vehicle may carry.
 *
 * These rules are real — a three-tier cake does not travel in a hatchback — and the planner
 * this replaces had them compiled in against specific registrations, where nobody but a
 * developer could change them and a sold car left a lie behind.
 */
function LoadLimits({
  vehicle,
  onClose,
  onSave,
}: {
  vehicle: Vehicle;
  onClose: () => void;
  onSave: (c: NonNullable<Vehicle["constraints"]>) => void;
}) {
  const current = vehicle.constraints;
  const [cls, setCls] = useState(current?.class ?? "");
  const [maxParcels, setMaxParcels] = useState(
    current?.maxParcels == null ? "" : String(current.maxParcels),
  );
  const [excluded, setExcluded] = useState((current?.excludedPackageTypes ?? []).join(", "));
  const [caps, setCaps] = useState(
    Object.entries(current?.maxByPackageType ?? {})
      .map(([code, n]) => `${code}:${n}`)
      .join(", "),
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
      <div className="panel w-full max-w-md p-5">
        <h2 className="section-title">
          What <span className="font-mono">{vehicle.registration}</span> carries
        </h2>
        <p className="mt-1 text-xs text-muted">
          The day planner respects these. Leave a field empty for no limit.
        </p>
        <div className="mt-4 space-y-3 text-sm">
          <label className="block">
            <span className="field-label">Class</span>
            <input
              value={cls}
              onChange={(e) => setCls(e.target.value)}
              placeholder="cargo"
              className="input"
            />
            <span className="field-hint">
              A customer can insist on a class. Matched exactly, so keep the spelling consistent.
            </span>
          </label>
          <label className="block">
            <span className="field-label">Most parcels in a load</span>
            <input
              type="number"
              value={maxParcels}
              onChange={(e) => setMaxParcels(e.target.value)}
              className="input"
            />
          </label>
          <label className="block">
            <span className="field-label">Never carries</span>
            <input
              value={excluded}
              onChange={(e) => setExcluded(e.target.value)}
              placeholder="cake_3_tier, fragile_art"
              className="input"
            />
            <span className="field-hint">Package type codes, comma separated.</span>
          </label>
          <label className="block">
            <span className="field-label">Per-type ceilings</span>
            <input
              value={caps}
              onChange={(e) => setCaps(e.target.value)}
              placeholder="platter:3"
              className="input"
            />
            <span className="field-hint">
              Counted across the whole load, as <code>code:number</code>.
            </span>
          </label>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="btn btn-secondary btn-sm">
            Cancel
          </button>
          <button
            type="button"
            onClick={() =>
              onSave({
                class: cls.trim() || null,
                maxParcels: maxParcels ? Number(maxParcels) : null,
                excludedPackageTypes: excluded
                  .split(",")
                  .map((s) => s.trim())
                  .filter(Boolean),
                maxByPackageType: Object.fromEntries(
                  caps
                    .split(",")
                    .map((pair) => pair.split(":").map((s) => s.trim()))
                    .filter((parts) => parts.length === 2 && parts[0] && Number(parts[1]) >= 0)
                    .map(([code, n]) => [code as string, Number(n)]),
                ),
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
