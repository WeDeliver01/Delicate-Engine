import { z } from "zod";
import { Cents, NonNegativeCents } from "../money.js";
import { Uuid } from "./common.js";
import { LatLng } from "./geo.js";
import { IsoDate } from "./slots.js";

/**
 * Fleet: drivers, vehicles, shifts and live positions. A driver is a platform user with the
 * `driver` role linked to a `drivers` row; the link is made by email on first sign-in.
 */

export const DriverStatus = z.enum(["active", "inactive"]);
export type DriverStatus = z.infer<typeof DriverStatus>;

/**
 * What a vehicle may carry.
 *
 * The route planner this replaces knew these rules — a three-tier cake does not travel in a
 * hatchback — but held them as constants against specific vehicle ids, where only a developer
 * could change them and a sold car left a lie behind. They are data now, edited on the fleet
 * desk, and the allocator reads them.
 */
export const VehicleConstraints = z.object({
  /** Free-text class, e.g. "cargo". An account can insist on one. */
  class: z.string().trim().max(32).nullable().default(null),
  /** Most parcels this vehicle takes in a day's load. */
  maxParcels: z.number().int().min(1).max(500).nullable().default(null),
  /** Package type codes it must never carry. */
  excludedPackageTypes: z.array(z.string().trim().max(48)).max(50).default([]),
  /** Per-package-type ceilings across the whole load, e.g. three platters. */
  maxByPackageType: z.record(z.string().max(48), z.number().int().min(0).max(500)).default({}),
});
export type VehicleConstraints = z.infer<typeof VehicleConstraints>;

export const Vehicle = z.object({
  id: Uuid,
  registration: z.string().min(3).max(16),
  make: z.string().max(60).nullable(),
  model: z.string().max(60).nullable(),
  fuelType: z.enum(["petrol", "diesel", "electric"]),
  /** Fuel consumption in litres per 100 km, used for fuel-cost forecasts. */
  litresPer100Km: z.number().positive().max(50).nullable(),
  constraints: VehicleConstraints.nullable(),
  active: z.boolean(),
});
export type Vehicle = z.infer<typeof Vehicle>;

export const UpsertVehicleRequest = Vehicle.omit({ id: true }).partial({
  active: true,
  make: true,
  model: true,
  litresPer100Km: true,
  constraints: true,
});
export type UpsertVehicleRequest = z.infer<typeof UpsertVehicleRequest>;

export const Driver = z.object({
  id: Uuid,
  userId: Uuid.nullable(),
  email: z.string().email(),
  fullName: z.string().min(2).max(120),
  phone: z.string().min(6).max(24),
  status: DriverStatus,
  vehicleId: Uuid.nullable(),
  /** PayCentral fuel card identifier (Phase 3 loads go here). */
  fuelCardRef: z.string().max(64).nullable(),
  /** Max drops a driver takes per day; the assignment engine respects it. */
  dailyStopCapacity: z.number().int().min(1).max(200),
  /** Where the driver starts the day; defaults to the depot. */
  homeBase: LatLng.nullable(),
  createdAt: z.string().datetime(),
});
export type Driver = z.infer<typeof Driver>;

export const UpsertDriverRequest = Driver.omit({ id: true, userId: true, createdAt: true }).partial(
  {
    status: true,
    vehicleId: true,
    fuelCardRef: true,
    dailyStopCapacity: true,
    homeBase: true,
  },
);
export type UpsertDriverRequest = z.infer<typeof UpsertDriverRequest>;

export const ShiftStatus = z.enum(["scheduled", "open", "closed"]);
export type ShiftStatus = z.infer<typeof ShiftStatus>;

export const Shift = z.object({
  id: Uuid,
  driverId: Uuid,
  date: IsoDate,
  status: ShiftStatus,
  vehicleId: Uuid.nullable(),
  startedAt: z.string().datetime().nullable(),
  endedAt: z.string().datetime().nullable(),
  startOdometerKm: z.number().nonnegative().nullable(),
  endOdometerKm: z.number().nonnegative().nullable(),
  startFuelPct: z.number().int().min(0).max(100).nullable(),
  endFuelPct: z.number().int().min(0).max(100).nullable(),
});
export type Shift = z.infer<typeof Shift>;

export const ScheduleShiftRequest = z.object({
  driverId: Uuid,
  date: IsoDate,
  vehicleId: Uuid.nullable().optional(),
});

export const StartShiftRequest = z.object({
  odometerKm: z.number().nonnegative(),
  fuelPct: z.number().int().min(0).max(100).nullable().default(null),
  vehicleId: Uuid.nullable().optional(),
  location: LatLng.nullable().default(null),
});
export type StartShiftRequest = z.infer<typeof StartShiftRequest>;

export const EndShiftRequest = z.object({
  odometerKm: z.number().nonnegative(),
  fuelPct: z.number().int().min(0).max(100).nullable().default(null),
  location: LatLng.nullable().default(null),
});
export type EndShiftRequest = z.infer<typeof EndShiftRequest>;

export const LocationPing = z.object({
  location: LatLng,
  accuracyM: z.number().nonnegative().nullable().default(null),
  speedKmh: z.number().nonnegative().nullable().default(null),
  recordedAt: z.string().datetime(),
});
export type LocationPing = z.infer<typeof LocationPing>;

export const DriverPosition = z.object({
  driverId: Uuid,
  location: LatLng,
  recordedAt: z.string().datetime(),
  onShift: z.boolean(),
});
export type DriverPosition = z.infer<typeof DriverPosition>;

export const FuelLogRequest = z.object({
  litres: z.number().positive().max(200),
  amountCents: NonNegativeCents,
  odometerKm: z.number().nonnegative().nullable().default(null),
  station: z.string().max(120).nullable().default(null),
  /** Receipt photo as a data URL (image/jpeg|png, ≤ 2 MB). */
  receiptDataUrl: z.string().max(3_000_000).nullable().default(null),
});
export type FuelLogRequest = z.infer<typeof FuelLogRequest>;

export const FuelLog = z.object({
  id: Uuid,
  driverId: Uuid,
  shiftId: Uuid.nullable(),
  litres: z.number(),
  amountCents: Cents,
  odometerKm: z.number().nullable(),
  station: z.string().nullable(),
  hasReceipt: z.boolean(),
  createdAt: z.string().datetime(),
});
export type FuelLog = z.infer<typeof FuelLog>;
