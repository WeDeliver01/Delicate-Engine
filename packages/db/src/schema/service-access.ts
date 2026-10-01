import { relations } from "drizzle-orm";
import {
  index,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { id, timestamps } from "./_shared.js";
import { accounts, users } from "./identity.js";

/**
 * Service access: machine callers.
 *
 * A human arrives with a Supabase JWT and a membership. Another system has neither, so it
 * authenticates with a credential issued here and names the account it is acting for. Two
 * things keep that safe: the secret is only ever stored as a hash, and a credential can act
 * only for accounts explicitly granted to it.
 */

export const serviceClientStatusEnum = pgEnum("service_client_status", ["active", "revoked"]);

export const serviceClients = pgTable(
  "service_clients",
  {
    id: id(),
    name: text("name").notNull(),
    /** Stable identifier for logs and audit rows, e.g. "courier-api". */
    slug: text("slug").notNull(),
    /** Public half of the credential; travels in the clear, useless on its own. */
    keyId: text("key_id").notNull(),
    /** SHA-256 of the secret. The secret itself is shown once, at issue, and never stored. */
    secretHash: text("secret_hash").notNull(),
    /** Last four characters of the secret, so two credentials can be told apart. */
    secretHint: text("secret_hint").notNull(),
    status: serviceClientStatusEnum("status").notNull().default("active"),
    scopes: text("scopes").array().notNull().default([]),
    /** Advisory only: a busy credential that stops being used is worth noticing. */
    lastUsedAt: timestamp("last_used_at", { withTimezone: true, mode: "date" }),
    revokedAt: timestamp("revoked_at", { withTimezone: true, mode: "date" }),
    createdByUserId: uuid("created_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("service_clients_key_id_uq").on(t.keyId),
    uniqueIndex("service_clients_slug_uq").on(t.slug),
  ],
);

/** Which accounts a credential may act for. No row, no access. */
export const serviceClientAccounts = pgTable(
  "service_client_accounts",
  {
    serviceClientId: uuid("service_client_id")
      .notNull()
      .references(() => serviceClients.id, { onDelete: "cascade" }),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.serviceClientId, t.accountId] }),
    index("service_client_accounts_account_idx").on(t.accountId),
  ],
);

/**
 * Another system's identifier for an account. The caller knows its own ids — a store, a shop,
 * a tenant — and resolves ours through this table rather than storing engine uuids. One row
 * per (system, externalId); an account may hold several.
 */
export const accountExternalRefs = pgTable(
  "account_external_refs",
  {
    id: id(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    system: text("system").notNull(),
    externalId: text("external_id").notNull(),
    note: text("note"),
    createdByUserId: uuid("created_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("account_external_refs_lookup_uq").on(t.system, t.externalId),
    index("account_external_refs_account_idx").on(t.accountId),
  ],
);

export const serviceClientsRelations = relations(serviceClients, ({ many }) => ({
  accounts: many(serviceClientAccounts),
}));

export const serviceClientAccountsRelations = relations(serviceClientAccounts, ({ one }) => ({
  serviceClient: one(serviceClients, {
    fields: [serviceClientAccounts.serviceClientId],
    references: [serviceClients.id],
  }),
  account: one(accounts, {
    fields: [serviceClientAccounts.accountId],
    references: [accounts.id],
  }),
}));

export const accountExternalRefsRelations = relations(accountExternalRefs, ({ one }) => ({
  account: one(accounts, {
    fields: [accountExternalRefs.accountId],
    references: [accounts.id],
  }),
}));
