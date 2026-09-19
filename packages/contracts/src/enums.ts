import { z } from "zod";

/**
 * Platform roles are held by staff on the whole platform (stored on the user).
 * Account roles are held per membership (user <-> account).
 */
export const PlatformRole = z.enum(["super_admin", "finance", "dispatcher", "driver"]);
export type PlatformRole = z.infer<typeof PlatformRole>;

export const AccountRole = z.enum(["customer_owner", "customer_staff"]);
export type AccountRole = z.infer<typeof AccountRole>;

export const Role = z.enum([...PlatformRole.options, ...AccountRole.options]);
export type Role = z.infer<typeof Role>;

/** Roles that grant access to the ops/finance console. */
export const STAFF_ROLES: readonly PlatformRole[] = ["super_admin", "finance", "dispatcher"];

export const AccountType = z.enum(["business", "individual"]);
export type AccountType = z.infer<typeof AccountType>;

export const AccountStatus = z.enum(["active", "suspended", "closed"]);
export type AccountStatus = z.infer<typeof AccountStatus>;

export const BillingMode = z.enum(["prepaid", "postpaid"]);
export type BillingMode = z.infer<typeof BillingMode>;

export const OutboxStatus = z.enum(["pending", "processing", "delivered", "failed", "dead"]);
export type OutboxStatus = z.infer<typeof OutboxStatus>;
