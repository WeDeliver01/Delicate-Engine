import {
  bigint,
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  customType,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createdAt, id, timestamps } from "./_shared.js";
import { users } from "./identity.js";

const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => "bytea" });

export const driverStatusEnum = pgEnum("driver_status", ["active", "inactive"]);
export const fuelTypeEnum = pgEnum("fuel_type", ["petrol", "diesel", "electric"]);
export const shiftStatusEnum = pgEnum("shift_status", ["scheduled", "open", "closed"]);

export const vehicles = pgTable(
  "vehicles",
  {
    id: id(),
    registration: text("registration").notNull(),
    make: text("make"),
    model: text("model"),
    fuelType: fuelTypeEnum("fuel_type").notNull().default("petrol"),
    litresPer100Km: numeric("litres_per_100km", { precision: 5, scale: 2 }),
    /** What this vehicle may carry. See `VehicleConstraints` in contracts. */
    constraints: jsonb("constraints"),
    active: boolean("active").notNull().default(true),
    ...timestamps(),
  },
  (t) => [uniqueIndex("vehicles_registration_uq").on(t.registration)],
);

export const drivers = pgTable(
  "drivers",
  {
    id: id(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    email: text("email").notNull(),
    fullName: text("full_name").notNull(),
    phone: text("phone").notNull(),
    status: driverStatusEnum("status").notNull().default("active"),
    vehicleId: uuid("vehicle_id").references(() => vehicles.id, { onDelete: "set null" }),
    fuelCardRef: text("fuel_card_ref"),
    dailyStopCapacity: integer("daily_stop_capacity").notNull().default(25),
    homeBase: jsonb("home_base"),
    /**
     * The driver everything goes to unless somebody says otherwise.
     *
     * A small fleet does not want a scoring function choosing for it: one person is out all
     * day doing the work and the dispatcher moves a stop off them when there is a reason to.
     * At most one at a time, which the index below enforces rather than trusting the code.
     */
    isMain: boolean("is_main").notNull().default(false),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("drivers_email_uq").on(t.email),
    uniqueIndex("drivers_user_uq").on(t.userId),
    uniqueIndex("drivers_main_uq")
      .on(t.isMain)
      .where(sql`${t.isMain} = true`),
  ],
);

export const shifts = pgTable(
  "shifts",
  {
    id: id(),
    driverId: uuid("driver_id")
      .notNull()
      .references(() => drivers.id, { onDelete: "restrict" }),
    date: date("date", { mode: "string" }).notNull(),
    status: shiftStatusEnum("status").notNull().default("scheduled"),
    vehicleId: uuid("vehicle_id").references(() => vehicles.id, { onDelete: "set null" }),
    startedAt: timestamp("started_at", { withTimezone: true, mode: "date" }),
    endedAt: timestamp("ended_at", { withTimezone: true, mode: "date" }),
    startOdometerKm: numeric("start_odometer_km", { precision: 10, scale: 1 }),
    endOdometerKm: numeric("end_odometer_km", { precision: 10, scale: 1 }),
    startFuelPct: integer("start_fuel_pct"),
    endFuelPct: integer("end_fuel_pct"),
    startLocation: jsonb("start_location"),
    endLocation: jsonb("end_location"),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("shifts_driver_date_uq").on(t.driverId, t.date),
    index("shifts_date_idx").on(t.date, t.status),
  ],
);

/** Latest known position per driver (upserted) — the assignment engine reads this. */
export const driverPositions = pgTable("driver_positions", {
  driverId: uuid("driver_id")
    .primaryKey()
    .references(() => drivers.id, { onDelete: "cascade" }),
  location: jsonb("location").notNull(),
  accuracyM: numeric("accuracy_m", { precision: 8, scale: 1 }),
  speedKmh: numeric("speed_kmh", { precision: 6, scale: 1 }),
  recordedAt: timestamp("recorded_at", { withTimezone: true, mode: "date" }).notNull(),
  ...timestamps(),
});

/** Sampled trail (one row per ping) used for actual-distance measurement and audit. */
export const driverLocationHistory = pgTable(
  "driver_location_history",
  {
    id: id(),
    driverId: uuid("driver_id")
      .notNull()
      .references(() => drivers.id, { onDelete: "cascade" }),
    shiftId: uuid("shift_id").references(() => shifts.id, { onDelete: "set null" }),
    location: jsonb("location").notNull(),
    accuracyM: numeric("accuracy_m", { precision: 8, scale: 1 }),
    speedKmh: numeric("speed_kmh", { precision: 6, scale: 1 }),
    recordedAt: timestamp("recorded_at", { withTimezone: true, mode: "date" }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("driver_location_history_idx").on(t.driverId, t.recordedAt)],
);

export const fuelLogs = pgTable(
  "fuel_logs",
  {
    id: id(),
    driverId: uuid("driver_id")
      .notNull()
      .references(() => drivers.id, { onDelete: "restrict" }),
    shiftId: uuid("shift_id").references(() => shifts.id, { onDelete: "set null" }),
    litres: numeric("litres", { precision: 7, scale: 2 }).notNull(),
    amountCents: bigint("amount_cents", { mode: "number" }).notNull(),
    odometerKm: numeric("odometer_km", { precision: 10, scale: 1 }),
    station: text("station"),
    receiptFileId: uuid("receipt_file_id"),
    createdAt: createdAt(),
  },
  (t) => [index("fuel_logs_driver_idx").on(t.driverId, t.createdAt)],
);

/** Small binary evidence (POD photos, signatures, receipts). ≤ 2 MB each, enforced in code. */
export const files = pgTable("files", {
  id: id(),
  kind: text("kind").notNull(), // pod_photo | pod_signature | fuel_receipt | fail_photo
  mime: text("mime").notNull(),
  bytes: bytea("bytes").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  uploadedByUserId: uuid("uploaded_by_user_id").references(() => users.id, {
    onDelete: "set null",
  }),
  createdAt: createdAt(),
});
