import { useState } from "react";
import { Save, Trash2, Pencil, UserPlus, Power, MapPin, Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import AddressAutocomplete, { type PlaceResult } from "@/components/address-autocomplete";
import { useToast } from "@/hooks/use-toast";
import { useDispatchExtras } from "@/hooks/use-dispatch-data";
import { DRIVER_COLORS, fuelCostPerKm, createBlankDriver, type DriverProfile, type FleetSettings } from "@/lib/fleet";
import { PanelHeader } from "./profile-panel";
import { TestPushButton } from "@/components/dispatch/test-push-button";

export function DriversPanel() {
  const { fleetSettings, setFleetSettings, log, toggleDriverActive, onDriverRemoved } = useDispatchExtras();
  const { toast } = useToast();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<DriverProfile | null>(null);

  function startEdit(id: string) {
    const dp = fleetSettings.drivers.find((d) => d.id === id);
    if (dp) { setDraft({ ...dp }); setEditingId(id); }
  }
  function cancel() { setEditingId(null); setDraft(null); }
  function update<K extends keyof DriverProfile>(field: K, value: DriverProfile[K]) {
    if (!draft) return;
    setDraft({ ...draft, [field]: value });
  }
  function save() {
    if (!draft || !editingId) return;
    const updated: FleetSettings = { ...fleetSettings, drivers: fleetSettings.drivers.map((d) => d.id === editingId ? { ...draft } : d) };
    setFleetSettings(updated);
    log(`Updated profile for ${draft.name}`, "SYS");
    toast({ title: "Driver updated", description: `${draft.name}'s profile saved` });
    cancel();
  }
  function add() {
    const newDriver = createBlankDriver(fleetSettings.drivers);
    const updated: FleetSettings = { ...fleetSettings, drivers: [...fleetSettings.drivers, newDriver] };
    setFleetSettings(updated);
    setDraft({ ...newDriver });
    setEditingId(newDriver.id);
    log(`Added new driver: ${newDriver.name}`, "SYS");
    toast({ title: "Driver added", description: `${newDriver.name} created — fill in profile details below` });
  }
  function remove(id: string) {
    if (fleetSettings.drivers.length <= 1) {
      toast({ title: "Cannot remove last driver", variant: "destructive" });
      return;
    }
    const driver = fleetSettings.drivers.find((d) => d.id === id);
    const updated: FleetSettings = { ...fleetSettings, drivers: fleetSettings.drivers.filter((d) => d.id !== id) };
    setFleetSettings(updated);
    if (editingId === id) cancel();
    onDriverRemoved?.(id, updated);
    log(`Removed driver: ${driver?.name ?? id}`, "SYS");
    toast({ title: "Driver removed" });
  }

  return (
    <div className="space-y-6" data-testid="v7-settings-drivers">
      <PanelHeader
        title="Drivers"
        subtitle={`Profiles, vehicles and fuel economy for the ${fleetSettings.drivers.length}-driver fleet.`}
        action={
          <Button variant="primary" size="sm" onClick={add} data-testid="v7-button-add-driver">
            <UserPlus className="size-3.5" /> Add driver
          </Button>
        }
      />

      <div className="space-y-4">
        {fleetSettings.drivers.map((dp) => {
          const isEditing = editingId === dp.id;
          const d = isEditing && draft ? draft : dp;
          const computedCostPerKm = fuelCostPerKm(d.fuelPer100, fleetSettings.fuelPrice, fleetSettings.cityFactor);
          return (
            <div
              key={dp.id}
              className={`relative rounded-[var(--v7-radius-lg,12px)] border border-hairline bg-surface-raised p-5 ${dp.active === false ? "opacity-80" : ""}`}
              data-testid={`v7-driver-card-${dp.id}`}
            >
              <button
                className={`absolute top-4 right-4 grid size-7 place-items-center rounded-full transition-colors ${dp.active !== false ? "bg-success/15 text-success hover:bg-success/25" : "bg-danger/15 text-danger hover:bg-danger/25"}`}
                onClick={() => toggleDriverActive(dp.id)}
                data-testid={`v7-driver-toggle-${dp.id}`}
                aria-label={dp.active !== false ? "Set offline" : "Set online"}
              >
                <Power className="size-3.5" />
              </button>

              <div className="flex items-center gap-4 mb-4">
                <div className="grid size-10 place-items-center rounded-full text-[13px] font-bold text-white" style={{ backgroundColor: dp.active !== false ? d.color : "hsl(var(--v7-text-quiet))" }}>
                  {d.icon}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="text-[15px] font-medium text-text-primary truncate">{d.name}</p>
                    <Badge variant="secondary" className="text-[10px]">
                      {dp.active !== false ? "ONLINE" : "OFFLINE"}
                    </Badge>
                  </div>
                  <p className="text-[12px] text-text-secondary">{d.vehicle} · {d.plate}</p>
                </div>
                <div className="flex items-center gap-1 mr-10">
                  {!isEditing ? (
                    <>
                      {dp.active !== false && (
                        <TestPushButton driverName={dp.name} testIdSuffix={dp.id} />
                      )}
                      <Button variant="ghost" size="sm" onClick={() => startEdit(dp.id)} data-testid={`v7-driver-edit-${dp.id}`}>
                        <Pencil className="size-3.5" /> Edit
                      </Button>
                      <Button variant="ghost" size="sm" className="text-danger" onClick={() => remove(dp.id)} data-testid={`v7-driver-remove-${dp.id}`}>
                        <Trash2 className="size-3.5" />
                      </Button>
                    </>
                  ) : (
                    <>
                      <Button variant="ghost" size="sm" onClick={cancel}>Cancel</Button>
                      <Button variant="primary" size="sm" onClick={save} data-testid={`v7-driver-save-${dp.id}`}>
                        <Save className="size-3.5" /> Save
                      </Button>
                    </>
                  )}
                </div>
              </div>

              {isEditing ? (
                <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                  <Input label="Name" value={d.name} onChange={(e) => update("name", e.target.value)} data-testid={`v7-driver-name-${dp.id}`} />
                  <Input label="Vehicle" value={d.vehicle} onChange={(e) => update("vehicle", e.target.value)} data-testid={`v7-driver-vehicle-${dp.id}`} />
                  <Input label="Plate" value={d.plate} onChange={(e) => update("plate", e.target.value)} data-testid={`v7-driver-plate-${dp.id}`} />
                  <Input label="Type" value={d.type} onChange={(e) => update("type", e.target.value)} data-testid={`v7-driver-type-${dp.id}`} />
                  <Input label="Fuel (L/100km)" type="number" step="0.1" min="0" value={String(d.fuelPer100)} onChange={(e) => update("fuelPer100", parseFloat(e.target.value) || 0)} className="font-mono" data-testid={`v7-driver-fuel-${dp.id}`} />
                  <div>
                    <p className="text-[10px] uppercase tracking-[0.18em] text-text-quiet mb-1">Cost/km (auto)</p>
                    <p className="text-[14px] font-mono tabular-nums text-text-primary py-2">R{computedCostPerKm}</p>
                  </div>
                  <div className="sm:col-span-2 lg:col-span-3">
                    <p className="text-[10px] uppercase tracking-[0.18em] text-text-quiet mb-2 flex items-center gap-1">
                      <MapPin className="size-3" /> Depot address
                    </p>
                    <AddressAutocomplete
                      value={d.depot}
                      onChange={(v) => update("depot", v)}
                      onSelect={(place: PlaceResult) => {
                        update("depot", place.address);
                        update("depotLat", place.lat);
                        update("depotLng", place.lng);
                      }}
                      placeholder="Search for depot address..."
                      data-testid={`v7-driver-depot-${dp.id}`}
                    />
                  </div>
                  <div className="sm:col-span-2 lg:col-span-3">
                    <p className="text-[10px] uppercase tracking-[0.18em] text-text-quiet mb-2">Colour</p>
                    <div className="flex flex-wrap gap-2">
                      {DRIVER_COLORS.map((c) => (
                        <button
                          key={c}
                          type="button"
                          onClick={() => update("color", c)}
                          className={`size-6 rounded-full border-2 transition-all ${d.color === c ? "border-text-primary scale-110" : "border-transparent hover:opacity-80"}`}
                          style={{ backgroundColor: c }}
                          aria-label={`Choose colour ${c}`}
                        />
                      ))}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 text-[13px]">
                  <FieldRow label="Type" value={d.type} />
                  <FieldRow label="Fuel" value={`${d.fuelPer100} L/100km`} />
                  <FieldRow label="Cost/km" value={`R${computedCostPerKm}`} />
                  <FieldRow label="Depot" value={d.depot} className="lg:col-span-4 sm:col-span-2" />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function FieldRow({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div className={className}>
      <p className="text-[10px] uppercase tracking-[0.18em] text-text-quiet">{label}</p>
      <p className="text-text-primary truncate">{value || "—"}</p>
    </div>
  );
}

export function FleetConfigPanel() {
  const { fleetSettings } = useDispatchExtras();
  const active = fleetSettings.drivers.filter((d) => d.active !== false).length;
  return (
    <div className="space-y-6" data-testid="v7-settings-fleet">
      <PanelHeader
        title="Fleet configuration"
        subtitle="High-level shape of the fleet feeding the optimiser."
      />
      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Drivers" value={String(fleetSettings.drivers.length)} />
        <Stat label="Active" value={String(active)} />
        <Stat label="Offline" value={String(fleetSettings.drivers.length - active)} />
        <Stat label="Fuel price" value={`R${fleetSettings.fuelPrice.toFixed(2)}/L`} />
        <Stat label="City factor" value={`${fleetSettings.cityFactor}x`} />
        <Stat label="Avg cost/km" value={avgCostPerKm(fleetSettings)} />
      </div>
      <p className="text-[12px] text-text-secondary">
        Driver-level configuration lives under <span className="text-text-primary">Drivers</span>.
        Cost knobs live under <span className="text-text-primary">Cost parameters</span>.
      </p>
    </div>
  );
}

function avgCostPerKm(s: FleetSettings): string {
  if (!s.drivers.length) return "—";
  const total = s.drivers.reduce((acc, d) => acc + Number(fuelCostPerKm(d.fuelPer100, s.fuelPrice, s.cityFactor)), 0);
  return `R${(total / s.drivers.length).toFixed(2)}`;
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[var(--v7-radius-md,8px)] border border-hairline bg-surface-raised px-4 py-3">
      <p className="text-[10px] uppercase tracking-[0.18em] text-text-quiet">{label}</p>
      <p className="mt-1 font-display text-[22px] text-text-primary">{value}</p>
    </div>
  );
}

export function DepotsPanel() {
  const { fleetSettings } = useDispatchExtras();
  const drivers = fleetSettings.drivers;
  return (
    <div className="space-y-6" data-testid="v7-settings-depots">
      <PanelHeader
        title="Depots"
        subtitle="Each driver starts and ends their day at their assigned depot."
      />
      <div className="space-y-2">
        {drivers.map((d) => (
          <div
            key={d.id}
            className="flex items-start gap-4 rounded-[var(--v7-radius-md,8px)] border border-hairline bg-surface-raised px-4 py-3"
            data-testid={`v7-depot-${d.id}`}
          >
            <div className="grid size-9 place-items-center rounded-full text-[12px] font-semibold text-white" style={{ backgroundColor: d.color }}>
              {d.icon}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[14px] font-medium text-text-primary">{d.name}</p>
              <p className="text-[12px] text-text-secondary truncate flex items-center gap-1">
                <MapPin className="size-3" />
                {d.depot || "No depot set"}
              </p>
              {d.depotLat != null && d.depotLng != null && (
                <p className="mt-0.5 text-[10px] font-mono text-text-quiet">
                  {Number(d.depotLat).toFixed(4)}, {Number(d.depotLng).toFixed(4)}
                </p>
              )}
            </div>
          </div>
        ))}
        {!drivers.length && (
          <p className="text-text-secondary text-sm flex items-center gap-2">
            <Loader2 className="size-3.5 animate-spin" /> Loading drivers…
          </p>
        )}
      </div>
      <p className="text-[12px] text-text-secondary">
        Edit depot addresses under <span className="text-text-primary">Drivers</span>.
      </p>
    </div>
  );
}
