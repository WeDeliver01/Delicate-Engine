import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { id, timestamps } from "./_shared.js";
import { accounts } from "./identity.js";

/**
 * Saved addresses. Archived rather than deleted: a past booking's history should still be able
 * to say where it went and who signed for it, even after the customer tidies their list.
 */
export const savedAddresses = pgTable(
  "saved_addresses",
  {
    id: id(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    address: jsonb("address").notNull(),
    contact: jsonb("contact").notNull(),
    instructions: text("instructions"),
    isCollectionPoint: boolean("is_collection_point").notNull().default(false),
    isDefault: boolean("is_default").notNull().default(false),
    useCount: integer("use_count").notNull().default(0),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true, mode: "date" }),
    archived: boolean("archived").notNull().default(false),
    ...timestamps(),
  },
  (t) => [
    // One label per account among live entries; archiving frees the name for reuse.
    uniqueIndex("saved_addresses_label_uq")
      .on(t.accountId, t.label)
      .where(sql`${t.archived} = false`),
    uniqueIndex("saved_addresses_default_uq")
      .on(t.accountId)
      .where(sql`${t.isDefault} = true and ${t.archived} = false`),
    index("saved_addresses_account_idx").on(t.accountId, t.archived, t.useCount),
  ],
);
