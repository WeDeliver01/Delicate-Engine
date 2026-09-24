import {
  bigint,
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
import { accounts } from "./identity.js";
import { bookings, shipments } from "./bookings.js";

/**
 * Invoices and credit notes. An issued document is immutable: corrections are credit notes,
 * never edits, because a customer may already have claimed the VAT on the original.
 *
 * Supplier and recipient details are snapshotted onto the row at issue, so reprinting a 2026
 * invoice in 2029 shows the VAT number and address that were true in 2026.
 */

export const documentKindEnum = pgEnum("document_kind", ["tax_invoice", "invoice", "credit_note"]);
export const invoiceStatusEnum = pgEnum("invoice_status", ["draft", "issued", "paid", "void"]);

export const invoices = pgTable(
  "invoices",
  {
    id: id(),
    number: text("number").notNull(),
    kind: documentKindEnum("kind").notNull(),
    status: invoiceStatusEnum("status").notNull().default("draft"),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "restrict" }),
    bookingId: uuid("booking_id").references(() => bookings.id, { onDelete: "restrict" }),
    period: text("period"),
    issuedAt: timestamp("issued_at", { withTimezone: true, mode: "date" }),
    dueAt: timestamp("due_at", { withTimezone: true, mode: "date" }),
    netCents: bigint("net_cents", { mode: "number" }).notNull(),
    vatCents: bigint("vat_cents", { mode: "number" }).notNull(),
    totalCents: bigint("total_cents", { mode: "number" }).notNull(),
    /** Total less anything settled against it. Prepaid invoices are born at zero. */
    outstandingCents: bigint("outstanding_cents", { mode: "number" }).notNull().default(0),
    supplier: jsonb("supplier").notNull(),
    billTo: jsonb("bill_to").notNull(),
    creditsInvoiceId: uuid("credits_invoice_id"),
    creditedByInvoiceId: uuid("credited_by_invoice_id"),
    note: text("note"),
    journalId: uuid("journal_id"),
    idempotencyKey: text("idempotency_key").notNull(),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("invoices_number_uq").on(t.number),
    uniqueIndex("invoices_idem_uq").on(t.idempotencyKey),
    index("invoices_account_idx").on(t.accountId, t.issuedAt),
    index("invoices_status_idx").on(t.status, t.dueAt),
    index("invoices_period_idx").on(t.period),
  ],
);

export const invoiceLines = pgTable(
  "invoice_lines",
  {
    id: id(),
    invoiceId: uuid("invoice_id")
      .notNull()
      .references(() => invoices.id, { onDelete: "cascade" }),
    sequence: integer("sequence").notNull(),
    description: text("description").notNull(),
    waybill: text("waybill"),
    shipmentId: uuid("shipment_id").references(() => shipments.id, { onDelete: "set null" }),
    quantity: integer("quantity").notNull().default(1),
    unitAmountCents: bigint("unit_amount_cents", { mode: "number" }).notNull(),
    netCents: bigint("net_cents", { mode: "number" }).notNull(),
    vatBps: integer("vat_bps").notNull(),
    vatCents: bigint("vat_cents", { mode: "number" }).notNull(),
    grossCents: bigint("gross_cents", { mode: "number" }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("invoice_lines_invoice_idx").on(t.invoiceId, t.sequence)],
);

/** Payments received against postpaid invoices. Append-only, like every other money log. */
export const invoicePayments = pgTable(
  "invoice_payments",
  {
    id: id(),
    invoiceId: uuid("invoice_id")
      .notNull()
      .references(() => invoices.id, { onDelete: "restrict" }),
    amountCents: bigint("amount_cents", { mode: "number" }).notNull(),
    reference: text("reference").notNull(),
    journalId: uuid("journal_id"),
    paidAt: timestamp("paid_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    idempotencyKey: text("idempotency_key").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("invoice_payments_idem_uq").on(t.idempotencyKey),
    index("invoice_payments_invoice_idx").on(t.invoiceId),
  ],
);

/** Document numbering per month and kind (INV-2609-0001, CN-2609-0001). */
export const invoiceCounters = pgTable("invoice_counters", {
  scope: text("scope").primaryKey(),
  next: bigint("next", { mode: "number" }).notNull().default(1),
  createdAt: createdAt(),
});
