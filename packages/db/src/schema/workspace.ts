import { index, jsonb, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { createdAt, id, timestamps } from "./_shared.js";
import { accounts, users } from "./identity.js";
import { shipments } from "./bookings.js";

/**
 * Things people set up for themselves while working: a search worth keeping, and a change
 * to a shipment that someone else has to agree to.
 */

/**
 * A named filter. Per user, not per account: "my problem jobs" is a personal working set, and
 * sharing everyone's by default would turn the saved list into another wall to scroll past.
 * `query` is the filter as the UI states it, kept loose on purpose so adding a filter does not
 * need a migration.
 */
export const savedFilters = pgTable(
  "saved_filters",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** Null for console filters, which are not scoped to one customer. */
    accountId: uuid("account_id").references(() => accounts.id, { onDelete: "cascade" }),
    scope: text("scope").notNull(),
    name: text("name").notNull(),
    query: jsonb("query").notNull(),
    ...timestamps(),
  },
  (t) => [index("saved_filters_owner_idx").on(t.userId, t.scope)],
);

/**
 * What a customer wants changed about a shipment already in flight.
 *
 * Some of these are free — a phone number nobody has dialled yet — and some cost money or
 * break the plan, like an address in another suburb once the van is loaded. Rather than
 * guessing per field at the call site, every request is recorded the same way and the engine
 * decides whether it can auto-apply; anything else waits for ops. The customer sees the same
 * thing either way: asked, then answered.
 */
export const changeRequestStatusEnum = pgEnum("change_request_status", [
  "pending",
  "approved",
  "rejected",
  "auto_applied",
  "withdrawn",
]);

/** What the customer wants to change. One row changes one aspect, so an approval is specific. */
export const changeRequestKindEnum = pgEnum("change_request_kind", [
  "recipient_contact",
  "delivery_address",
  "instructions",
  "reschedule",
]);

export const shipmentChangeRequests = pgTable(
  "shipment_change_requests",
  {
    id: id(),
    shipmentId: uuid("shipment_id")
      .notNull()
      .references(() => shipments.id, { onDelete: "restrict" }),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "restrict" }),
    kind: changeRequestKindEnum("kind").notNull(),
    status: changeRequestStatusEnum("status").notNull().default("pending"),
    /** The shape depends on `kind`; validated by the DTO before it is written. */
    requested: jsonb("requested").notNull(),
    /** What the fields held before, so an approval can be read and undone years later. */
    previous: jsonb("previous").notNull(),
    reason: text("reason"),
    /** Set when the engine decided this needs a human, saying which rule caught it. */
    heldBecause: text("held_because"),
    /** Filled by whoever ruled on it; null while pending or auto-applied. */
    decidedByUserId: uuid("decided_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    decidedAt: timestamp("decided_at", { withTimezone: true, mode: "date" }),
    decisionNote: text("decision_note"),
    requestedByUserId: uuid("requested_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: createdAt(),
  },
  (t) => [
    index("change_requests_shipment_idx").on(t.shipmentId, t.createdAt),
    index("change_requests_account_idx").on(t.accountId, t.createdAt),
    // The console's queue reads this: everything still waiting, oldest first.
    index("change_requests_queue_idx").on(t.status, t.createdAt),
  ],
);
