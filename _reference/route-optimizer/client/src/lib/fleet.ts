import type { Driver } from "@shared/schema";

const FLEET_SETTINGS_KEY = "delicate-courier-fleet-settings";

export const DRIVER_COLORS = [
  "#059669", "#2563eb", "#d97706", "#7c3aed",
  "#dc2626", "#0891b2", "#16a34a", "#ea580c",
  "#9333ea", "#0f766e", "#b45309", "#1d4ed8",
];

export interface FleetSettings {
  fuelPrice: number;
  cityFactor: number;
  drivers: DriverProfile[];
}

export interface DriverProfile {
  id: string;
  name: string;
  color: string;
  icon: string;
  vehicle: string;
  plate: string;
  type: string;
  fuelPer100: number;
  depotLat: number;
  depotLng: number;
  depot: string;
  shiftStart: string;
  shiftEnd: string;
  odometer: number;
  active: boolean;
  phone?: string;
}

const DEFAULT_FUEL_PRICE = 20.10;
const DEFAULT_CITY_FACTOR = 1.30;

const DEFAULT_PROFILES: DriverProfile[] = [
  {
    id: "vinny", name: "Vinny", color: "#059669", icon: "V",
    vehicle: "2025 Hyundai Grand i10 Panel Van Auto", plate: "DC-VIN-GP",
    type: "VAN", fuelPer100: 5.7,
    depotLat: -25.5227, depotLng: 28.1107,
    depot: "Soshanguve Block H", shiftStart: "06:00", shiftEnd: "18:00",
    odometer: 0, active: true,
  },
  {
    id: "ashley", name: "Ashley", color: "#2563eb", icon: "A",
    vehicle: "2025 Hyundai Grand i10 Panel Van Auto", plate: "DC-ASH-GP",
    type: "VAN", fuelPer100: 5.7,
    depotLat: -25.6825, depotLng: 28.2925,
    depot: "Zambezi Heights", shiftStart: "06:00", shiftEnd: "18:00",
    odometer: 0, active: true,
  },
  {
    id: "refiloe", name: "Refiloe", color: "#d97706", icon: "R",
    vehicle: "2025 Toyota Vitz 1.0 XR AMT", plate: "DC-REF-GP",
    type: "CAR", fuelPer100: 4.2,
    depotLat: -25.6825, depotLng: 28.2925,
    depot: "Zambezi Heights", shiftStart: "06:00", shiftEnd: "18:00",
    odometer: 0, active: true,
  },
];

export function fuelCostPerKm(claimedLper100: number, fuelPrice: number, cityFactor: number): number {
  return Math.round((claimedLper100 * cityFactor / 100) * fuelPrice * 100) / 100;
}

export function loadFleetSettings(): FleetSettings {
  try {
    const raw = localStorage.getItem(FLEET_SETTINGS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as FleetSettings;
      const storedDrivers: DriverProfile[] = parsed.drivers || [];
      const storedIds = new Set(storedDrivers.map((d) => d.id));

      const mergedStored = storedDrivers.map((d) => {
        const def = DEFAULT_PROFILES.find((dp) => dp.id === d.id);
        return def ? { ...def, ...d } : d;
      });

      const missingDefaults = DEFAULT_PROFILES.filter((dp) => !storedIds.has(dp.id));

      return {
        fuelPrice: parsed.fuelPrice ?? DEFAULT_FUEL_PRICE,
        cityFactor: parsed.cityFactor ?? DEFAULT_CITY_FACTOR,
        drivers: [...mergedStored, ...missingDefaults],
      };
    }
  } catch { /* ignore */ }
  return {
    fuelPrice: DEFAULT_FUEL_PRICE,
    cityFactor: DEFAULT_CITY_FACTOR,
    drivers: [...DEFAULT_PROFILES],
  };
}

export function saveFleetSettings(settings: FleetSettings): void {
  try {
    localStorage.setItem(FLEET_SETTINGS_KEY, JSON.stringify(settings));
  } catch { /* ignore */ }
}

export function createBlankDriver(existingDrivers: DriverProfile[]): DriverProfile {
  const usedColors = new Set(existingDrivers.map((d) => d.color));
  const color = DRIVER_COLORS.find((c) => !usedColors.has(c)) || DRIVER_COLORS[existingDrivers.length % DRIVER_COLORS.length];
  const id = "driver_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
  return {
    id,
    name: "New Driver",
    color,
    icon: "N",
    vehicle: "Vehicle",
    plate: "PLATE-GP",
    type: "VAN",
    fuelPer100: 6.0,
    depotLat: -25.6825,
    depotLng: 28.2925,
    depot: "Zambezi Heights",
    shiftStart: "06:00",
    shiftEnd: "18:00",
    odometer: 0,
    active: true,
  };
}

function profileToDriver(p: DriverProfile, settings: FleetSettings): Driver {
  return {
    id: p.id,
    name: p.name,
    color: p.color,
    icon: p.icon,
    vehicle: p.vehicle,
    plate: p.plate,
    type: p.type,
    maxParcels: 9999,
    maxKg: 9999,
    fuelPer100: p.fuelPer100,
    costPerKm: fuelCostPerKm(p.fuelPer100, settings.fuelPrice, settings.cityFactor),
    depotLat: p.depotLat,
    depotLng: p.depotLng,
    depot: p.depot,
    shift: [p.shiftStart, p.shiftEnd] as [string, string],
  };
}

export function settingsToFleet(settings: FleetSettings): Driver[] {
  return settings.drivers.map((p) => profileToDriver(p, settings));
}

export function settingsToActiveFleet(settings: FleetSettings): Driver[] {
  return settings.drivers.filter((p) => p.active !== false).map((p) => profileToDriver(p, settings));
}

let _settings = loadFleetSettings();

export function getFleetSettings(): FleetSettings {
  return _settings;
}

export function updateFleetSettings(settings: FleetSettings): void {
  _settings = settings;
  saveFleetSettings(settings);
}

export function getFleet(): Driver[] {
  return settingsToFleet(_settings);
}

export function getFuelPrice(): number {
  return _settings.fuelPrice;
}

export function getCityFactor(): number {
  return _settings.cityFactor;
}

export const FLEET: Driver[] = settingsToFleet(_settings);
export const FUEL_PRICE = _settings.fuelPrice;
export const CITY_FACTOR = _settings.cityFactor;

export function getDriverMap(): Record<string, string> {
  const map: Record<string, string> = {};
  _settings.drivers.forEach((d) => { map[d.name.toLowerCase()] = d.id; });
  return map;
}

export const DRIVER_MAP: Record<string, string> = {};
FLEET.forEach((d) => { DRIVER_MAP[d.name.toLowerCase()] = d.id; });


export const VEHICLE_VITZ_IDS = ["refiloe"];
export const VEHICLE_I10_IDS = ["vinny", "ashley", "clifford"];

export const VITZ_RULES = {
  no3TierCakes: true,
  maxPlatterConsignments: 3,
  maxParcels: 6,
};

export const I10_RULES = {
  maxLargePlattersFlat: 7,
  maxLargePlattersStacked: 21,
  maxBoxes: 10,
  sweOnlyI10: true,
};
