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
        <h1 className="panel-head section-title">Drivers</h1>
        <table className="w-full text-left text-sm">
          <thead className="label-mini">
            <tr>
              <th className="px-5 py-2">Driver</th>
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
            <li key={x.id} className="flex justify-between px-5 py-2">
              <span className="font-mono">{x.registration}</span>
              <span className="text-[#6B6661]">
                {[x.make, x.model].filter(Boolean).join(" ")} · {x.fuelType}
                {x.litresPer100Km ? ` · ${x.litresPer100Km} L/100km` : ""}
              </span>
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
