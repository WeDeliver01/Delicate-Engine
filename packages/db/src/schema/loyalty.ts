import { bigint, index, integer, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createdAt, id } from "./_shared.js";
import { accounts } from "./identity.js";
import { bookings } from "./bookings.js";

/**
 * Cashback awards. Append-only, one row per booking at most, which is what makes a redelivered
 * `booking.charged` unable to pay twice. The money itself lives in the wallet and the ledger;
 * this table is the explanation of why it is there.
 */
export const loyaltyAwards = pgTable(
  "loyalty_awards",
  {
    id: id(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "restrict" }),
    bookingId: uuid("booking_id").references(() => bookings.id, { onDelete: "restrict" }),
    reference: text("reference").notNull(),
    tierCode: text("tier_code").notNull(),
    cashbackBps: integer("cashback_bps").notNull(),
    eligibleCents: bigint("eligible_cents", { mode: "number" }).notNull(),
    amountCents: bigint("amount_cents", { mode: "number" }).notNull(),
    walletEntryId: uuid("wallet_entry_id"),
    journalId: uuid("journal_id"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("loyalty_awards_booking_uq").on(t.bookingId),
    index("loyalty_awards_account_idx").on(t.accountId, t.createdAt),
  ],
);
