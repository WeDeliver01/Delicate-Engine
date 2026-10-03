import {
  bigint,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { createdAt, id, timestamps } from "./_shared.js";
import { accounts, users } from "./identity.js";
import { quotes } from "./catalog.js";
import { walletHolds } from "./wallet.js";
import { serviceClients } from "./service-access.js";

export const bookingStatusEnum = pgEnum("booking_status", [
  "confirmed",
  "in_progress",
  "completed",
  "cancelled",
  "rejected_insufficient_funds",
  "rejected_slot_unavailable",
  "rejected_quote_expired",
]);

export const shipmentStatusEnum = pgEnum("shipment_status", [
  "booked",
  "assigned",
  "collected",
  "in_transit",
  "delivered",
  "failed",
  "cancelled",
]);

/**
 * The commercial unit: one quote, one hold, one collection, N shipments. Rejected attempts
 * are kept as rows (without hold/slot) so ops can see demand that could not be served.
 */
export const bookings = pgTable(
  "bookings",
  {
    id: id(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "restrict" }),
    quoteId: uuid("quote_id")
      .notNull()
      .references(() => quotes.id, { onDelete: "restrict" }),
    reference: text("reference").notNull(),
    /**
     * The customer's own identifier for this job — their order number, their patient ref,
     * whatever they file it under. Ours means nothing to them when they are trying to find
     * a delivery in their own system, so theirs is searchable alongside it.
     */
    customerReference: text("customer_reference"),
    status: bookingStatusEnum("status").notNull(),
    serviceLevelCode: text("service_level_code").notNull(),
    slotDate: date("slot_date", { mode: "string" }),
    slotWindowKey: text("slot_window_key"),
    collection: jsonb("collection").notNull(),
    /** Minutes past midnight, local. Set only when a timed window was sold. */
    collectionWindowStartMinute: integer("collection_window_start_minute"),
    collectionWindowEndMinute: integer("collection_window_end_minute"),
    options: jsonb("options").notNull(),
    breakdown: jsonb("breakdown").notNull(),
    totalCents: bigint("total_cents", { mode: "number" }).notNull(),
    holdId: uuid("hold_id").references(() => walletHolds.id, { onDelete: "restrict" }),
    idempotencyKey: text("idempotency_key").notNull(),
    rejectionReason: text("rejection_reason"),
    createdByUserId: uuid("created_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    /**
     * Set when another system booked this on the account's behalf. Null for portal bookings.
     * Reconciliation during a migration needs to know which side placed a job without
     * inferring it from reference formats.
     */
    createdByServiceClientId: uuid("created_by_service_client_id").references(
      () => serviceClients.id,
      { onDelete: "set null" },
    ),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true, mode: "date" }),
    completedAt: timestamp("completed_at", { withTimezone: true, mode: "date" }),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("bookings_reference_uq").on(t.reference),
    uniqueIndex("bookings_idem_uq").on(t.accountId, t.idempotencyKey),
    index("bookings_account_idx").on(t.accountId, t.createdAt),
    index("bookings_slot_idx").on(t.slotDate, t.slotWindowKey),
    index("bookings_status_idx").on(t.status, t.createdAt),
    index("bookings_customer_ref_idx").on(t.accountId, t.customerReference),
  ],
);

export const shipments = pgTable(
  "shipments",
  {
    id: id(),
    bookingId: uuid("booking_id")
      .notNull()
      .references(() => bookings.id, { onDelete: "restrict" }),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "restrict" }),
    waybill: text("waybill").notNull(),
    sequence: integer("sequence").notNull(),
    status: shipmentStatusEnum("status").notNull().default("booked"),
    serviceLevelCode: text("service_level_code").notNull(),
    slotDate: date("slot_date", { mode: "string" }),
    slotWindowKey: text("slot_window_key"),
    deliveryWindowStartMinute: integer("delivery_window_start_minute"),
    deliveryWindowEndMinute: integer("delivery_window_end_minute"),
    recipient: jsonb("recipient").notNull(),
    deliveryAddress: jsonb("delivery_address").notNull(),
    instructions: text("instructions"),
    parcels: jsonb("parcels").notNull(),
    deliveredAt: timestamp("delivered_at", { withTimezone: true, mode: "date" }),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("shipments_waybill_uq").on(t.waybill),
    index("shipments_booking_idx").on(t.bookingId),
    index("shipments_account_idx").on(t.accountId, t.createdAt),
    index("shipments_status_idx").on(t.status, t.slotDate),
  ],
);

/** Immutable status history; the source of truth for the public tracking timeline. */
export const shipmentEvents = pgTable(
  "shipment_events",
  {
    id: id(),
    shipmentId: uuid("shipment_id")
      .notNull()
      .references(() => shipments.id, { onDelete: "restrict" }),
    status: shipmentStatusEnum("status").notNull(),
    note: text("note"),
    actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
    metadata: jsonb("metadata"),
    occurredAt: timestamp("occurred_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    createdAt: createdAt(),
  },
  (t) => [index("shipment_events_shipment_idx").on(t.shipmentId, t.occurredAt)],
);

/** Per-day waybill sequence, locked per row so numbers are gap-free and unique. */
export const waybillCounters = pgTable("waybill_counters", {
  day: text("day").primaryKey(), // YYMMDD
  next: integer("next").notNull().default(1),
});
