import { z } from "zod";
import { Bps, Cents, NonNegativeCents } from "../money.js";
import { Uuid } from "./common.js";

/**
 * Paid membership.
 *
 * Not loyalty. Loyalty is earned from what a customer has already spent and pays cashback;
 * membership is bought up front and discounts the rate. Both can apply to the same delivery,
 * and keeping them apart is what makes a price explainable afterwards.
 */

export const MembershipStatus = z.enum(["active", "past_due", "cancelled", "expired"]);
export type MembershipStatus = z.infer<typeof MembershipStatus>;

export const MembershipCollection = z.enum(["wallet", "invoice", "manual"]);
export type MembershipCollection = z.infer<typeof MembershipCollection>;

export const MembershipPlan = z.object({
  id: Uuid,
  code: z.string().min(2).max(32),
  name: z.string().min(2).max(60),
  priceCents: NonNegativeCents,
  discountBps: Bps,
  suitedFromDeliveries: z.number().int().min(0),
  freeShipmentsPerPeriod: z.number().int().min(0),
  waivesHolidaySurcharge: z.boolean(),
  waivesAllSurcharges: z.boolean(),
  includesApiAccess: z.boolean(),
  prioritySupport: z.boolean(),
  dedicatedManager: z.boolean(),
  sortOrder: z.number().int(),
  active: z.boolean(),
});
export type MembershipPlan = z.infer<typeof MembershipPlan>;

export const UpsertMembershipPlanRequest = MembershipPlan.omit({ id: true }).partial({
  suitedFromDeliveries: true,
  freeShipmentsPerPeriod: true,
  waivesHolidaySurcharge: true,
  waivesAllSurcharges: true,
  includesApiAccess: true,
  prioritySupport: true,
  dedicatedManager: true,
  sortOrder: true,
  active: true,
});
export type UpsertMembershipPlanRequest = z.infer<typeof UpsertMembershipPlanRequest>;

/**
 * Named `Membership`, not `AccountMembership`: that name is already taken by the other kind
 * of membership entirely -- a person's role on an account. Two things called the same thing
 * in one codebase is how the wrong one gets imported.
 */
export const Membership = z.object({
  id: Uuid,
  accountId: Uuid,
  plan: MembershipPlan,
  status: MembershipStatus,
  collection: MembershipCollection,
  /** What this customer actually pays, which may be less than the plan now costs. */
  priceCents: NonNegativeCents,
  discountBps: Bps,
  startedAt: z.string().datetime(),
  currentPeriodStart: z.string().datetime(),
  currentPeriodEnd: z.string().datetime(),
  cancelAtPeriodEnd: z.boolean(),
  cancelledAt: z.string().datetime().nullable(),
  freeShipmentsUsed: z.number().int().min(0),
  /** Left this period. Null when the plan includes none. */
  freeShipmentsLeft: z.number().int().min(0).nullable(),
});
export type Membership = z.infer<typeof Membership>;

export const StartMembershipRequest = z.object({
  planCode: z.string().min(2).max(32),
  collection: MembershipCollection.default("wallet"),
});
export type StartMembershipRequest = z.infer<typeof StartMembershipRequest>;

export const MembershipCharge = z.object({
  id: Uuid,
  membershipId: Uuid,
  amountCents: Cents,
  collection: MembershipCollection,
  periodStart: z.string().datetime(),
  periodEnd: z.string().datetime(),
  status: z.string(),
  detail: z.string().nullable(),
  createdAt: z.string().datetime(),
});
export type MembershipCharge = z.infer<typeof MembershipCharge>;
