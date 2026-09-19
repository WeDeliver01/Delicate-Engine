import { relations } from "drizzle-orm";
import { index, pgEnum, pgTable, primaryKey, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { id, timestamps } from "./_shared.js";

/**
 * Identity & Accounts.
 *
 * `users` mirrors the Supabase Auth user (same UUID). Supabase owns credentials; we own the
 * profile, the platform role and every membership. A user belongs to any number of accounts
 * and switches between them freely; the active account is asserted per request.
 */

export const platformRoleEnum = pgEnum("platform_role", [
  "super_admin",
  "finance",
  "dispatcher",
  "driver",
]);

export const accountRoleEnum = pgEnum("account_role", ["customer_owner", "customer_staff"]);
export const accountTypeEnum = pgEnum("account_type", ["business", "individual"]);
export const accountStatusEnum = pgEnum("account_status", ["active", "suspended", "closed"]);
export const billingModeEnum = pgEnum("billing_mode", ["prepaid", "postpaid"]);

export const users = pgTable(
  "users",
  {
    /** Equals the Supabase auth.users id. Never generated here. */
    id: uuid("id").primaryKey(),
    email: text("email").notNull(),
    fullName: text("full_name"),
    phone: text("phone"),
    platformRole: platformRoleEnum("platform_role"),
    ...timestamps(),
  },
  (t) => [uniqueIndex("users_email_uq").on(t.email)],
);

export const organizations = pgTable("organizations", {
  id: id(),
  name: text("name").notNull(),
  registrationNumber: text("registration_number"),
  vatNumber: text("vat_number"),
  ...timestamps(),
});

/**
 * A billing account. Businesses may own several (one per branch, cost centre, brand…);
 * individuals have exactly one with `organizationId = null`. The wallet (Phase 1) hangs off
 * the account, so this is the unit every booking is charged to.
 */
export const accounts = pgTable(
  "accounts",
  {
    id: id(),
    organizationId: uuid("organization_id").references(() => organizations.id, {
      onDelete: "restrict",
    }),
    name: text("name").notNull(),
    type: accountTypeEnum("type").notNull(),
    billingMode: billingModeEnum("billing_mode").notNull().default("prepaid"),
    status: accountStatusEnum("status").notNull().default("active"),
    ...timestamps(),
  },
  (t) => [index("accounts_org_idx").on(t.organizationId)],
);

export const memberships = pgTable(
  "memberships",
  {
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: accountRoleEnum("role").notNull(),
    ...timestamps(),
  },
  (t) => [
    primaryKey({ columns: [t.accountId, t.userId] }),
    index("memberships_user_idx").on(t.userId),
  ],
);

export const usersRelations = relations(users, ({ many }) => ({
  memberships: many(memberships),
}));

export const organizationsRelations = relations(organizations, ({ many }) => ({
  accounts: many(accounts),
}));

export const accountsRelations = relations(accounts, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [accounts.organizationId],
    references: [organizations.id],
  }),
  memberships: many(memberships),
}));

export const membershipsRelations = relations(memberships, ({ one }) => ({
  account: one(accounts, { fields: [memberships.accountId], references: [accounts.id] }),
  user: one(users, { fields: [memberships.userId], references: [users.id] }),
}));
