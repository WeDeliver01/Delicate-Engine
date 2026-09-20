import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  index,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { createdAt, id } from "./_shared.js";
import { accounts } from "./identity.js";
import { bookings, shipments } from "./bookings.js";
import { drivers, files, shifts } from "./fleet.js";

export const assignmentSourceEnum = pgEnum("assignment_source", ["auto", "dispatcher"]);

/**
 * Who delivers what. History is kept: a reassignment deactivates the old row and inserts a new
 * one; at most one row per shipment is active.
 */
export const assignments = pgTable(
  "assignments",
  {
    id: id(),
    shipmentId: uuid("shipment_id")
      .notNull()
      .references(() => shipments.id, { onDelete: "restrict" }),
    driverId: uuid("driver_id")
      .notNull()
      .references(() => drivers.id, { onDelete: "restrict" }),
    source: assignmentSourceEnum("source").notNull(),
    plannedKm: numeric("planned_km", { precision: 8, scale: 2 }).notNull(),
    active: boolean("active").notNull().default(true),
    note: text("note"),
    endedReason: text("ended_reason"),
    endedAt: timestamp("ended_at", { withTimezone: true, mode: "date" }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("assignments_active_uq")
      .on(t.shipmentId)
      .where(sql`${t.active} = true`),
    index("assignments_driver_idx").on(t.driverId, t.active),
  ],
);

/** Forecast at assignment time. Mutable in the sense that a reassignment writes a new row. */
export const settlementForecasts = pgTable(
  "settlement_forecasts",
  {
    id: id(),
    shipmentId: uuid("shipment_id")
      .notNull()
      .references(() => shipments.id, { onDelete: "restrict" }),
    assignmentId: uuid("assignment_id")
      .notNull()
      .references(() => assignments.id, { onDelete: "restrict" }),
    plannedKm: numeric("planned_km", { precision: 8, scale: 2 }).notNull(),
    revenueCents: bigint("revenue_cents", { mode: "number" }).notNull(),
    fuelCostCents: bigint("fuel_cost_cents", { mode: "number" }).notNull(),
    driverEarningCents: bigint("driver_earning_cents", { mode: "number" }).notNull(),
    marginCents: bigint("margin_cents", { mode: "number" }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("settlement_forecasts_shipment_idx").on(t.shipmentId)],
);

export const proofsOfDelivery = pgTable("proofs_of_delivery", {
  shipmentId: uuid("shipment_id")
    .primaryKey()
    .references(() => shipments.id, { onDelete: "restrict" }),
  driverId: uuid("driver_id")
    .notNull()
    .references(() => drivers.id, { onDelete: "restrict" }),
  receivedBy: text("received_by").notNull(),
  signatureFileId: uuid("signature_file_id").references(() => files.id, { onDelete: "set null" }),
  photoFileId: uuid("photo_file_id").references(() => files.id, { onDelete: "set null" }),
  location: jsonb("location"),
  note: text("note"),
  capturedAt: timestamp("captured_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
});

/** Per-shipment money once delivered. One row, ever; corrections are reversal journals. */
export const settlements = pgTable(
  "settlements",
  {
    shipmentId: uuid("shipment_id")
      .primaryKey()
      .references(() => shipments.id, { onDelete: "restrict" }),
    bookingId: uuid("booking_id")
      .notNull()
      .references(() => bookings.id, { onDelete: "restrict" }),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "restrict" }),
    driverId: uuid("driver_id").references(() => drivers.id, { onDelete: "restrict" }),
    shiftId: uuid("shift_id").references(() => shifts.id, { onDelete: "set null" }),
    revenueCents: bigint("revenue_cents", { mode: "number" }).notNull(),
    vatCents: bigint("vat_cents", { mode: "number" }).notNull(),
    fuelCostCents: bigint("fuel_cost_cents", { mode: "number" }).notNull(),
    driverEarningCents: bigint("driver_earning_cents", { mode: "number" }).notNull(),
    marginCents: bigint("margin_cents", { mode: "number" }).notNull(),
    plannedKm: numeric("planned_km", { precision: 8, scale: 2 }).notNull(),
    actualKm: numeric("actual_km", { precision: 8, scale: 2 }).notNull(),
    journalId: uuid("journal_id").notNull(),
    rulesSnapshot: jsonb("rules_snapshot").notNull(),
    settledAt: timestamp("settled_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    index("settlements_driver_idx").on(t.driverId, t.settledAt),
    index("settlements_account_idx").on(t.accountId, t.settledAt),
  ],
);

export const journalKindEnum = pgEnum("journal_kind", [
  "topup",
  "settlement",
  "reversal",
  "adjustment",
  "cashback",
  "payout",
  "fuel_load",
]);
export const ownerTypeEnum = pgEnum("owner_type", ["company", "account", "driver"]);

/** Double-entry ledger. A journal commits only when its lines sum to zero (checked in code). */
export const journals = pgTable(
  "journals",
  {
    id: id(),
    kind: journalKindEnum("kind").notNull(),
    refType: text("ref_type"),
    refId: text("ref_id"),
    description: text("description").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("journals_idem_uq").on(t.idempotencyKey),
    index("journals_ref_idx").on(t.refType, t.refId),
  ],
);

export const journalLines = pgTable(
  "journal_lines",
  {
    id: id(),
    journalId: uuid("journal_id")
      .notNull()
      .references(() => journals.id, { onDelete: "restrict" }),
    account: text("account").notNull(),
    ownerType: ownerTypeEnum("owner_type").notNull(),
    ownerId: uuid("owner_id"),
    amountCents: bigint("amount_cents", { mode: "number" }).notNull(),
    memo: text("memo"),
    createdAt: createdAt(),
  },
  (t) => [
    index("journal_lines_account_idx").on(t.account, t.ownerType, t.ownerId),
    index("journal_lines_journal_idx").on(t.journalId),
  ],
);
