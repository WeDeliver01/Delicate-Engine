import { z } from "zod";
import { RateCard, UpsertRateCardRequest } from "./catalog.js";
import { Uuid } from "./common.js";

/**
 * Rates: the house rate cards, the groups of accounts priced by their own rules, and the
 * one-off cards written for a single customer.
 *
 * A rate card holds every lever (see `catalog.ts`); this file is about who each card applies
 * to. Three things can price a booking and they are tried in this order:
 *
 *   1. a card assigned to the account itself -- the deal signed with that one customer;
 *   2. the live card of the active rate group the account belongs to;
 *   3. the default platform card.
 *
 * An account is in at most one group, so step 2 has exactly one answer. Everything here is
 * super-admin only: these numbers are what the business charges.
 */

/** Which of the three answers above priced it. Returned so the console can show its working. */
export const RateSource = z.enum(["account", "group", "default"]);
export type RateSource = z.infer<typeof RateSource>;

/** An account in a group, named the way ops say it rather than by id. */
export const RateGroupMember = z.object({
  accountId: Uuid,
  accountName: z.string(),
  accountCode: z.string(),
  addedAt: z.string().datetime(),
});
export type RateGroupMember = z.infer<typeof RateGroupMember>;

export const RateGroup = z.object({
  id: Uuid,
  name: z.string().min(2).max(80),
  description: z.string().max(400).nullable(),
  /** Off means every member falls back to the default card. Reversible, and it is the brake. */
  active: z.boolean(),
  members: z.array(RateGroupMember),
  /** The rules in force for the group's members. Null until a draft is published. */
  liveRateCard: RateCard.nullable(),
  /** Prepared but not charging anybody yet, newest first. */
  draftRateCards: z.array(RateCard),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type RateGroup = z.infer<typeof RateGroup>;

export const UpsertRateGroupRequest = z.object({
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().max(400).nullable().default(null),
});
export type UpsertRateGroupRequest = z.infer<typeof UpsertRateGroupRequest>;

export const SetRateGroupActiveRequest = z.object({ active: z.boolean() });
export type SetRateGroupActiveRequest = z.infer<typeof SetRateGroupActiveRequest>;

export const RateGroupMembersRequest = z.object({
  accountIds: z.array(Uuid).min(1).max(200),
});
export type RateGroupMembersRequest = z.infer<typeof RateGroupMembersRequest>;

/**
 * The levers for a negotiated card. No `isDefault` -- only a platform card can be the default
 * -- and no `active`: a group's card goes live when somebody publishes it, and an account's
 * is live the moment it is assigned, which is the whole of that decision.
 */
export const RateRulesRequest = UpsertRateCardRequest.omit({
  isDefault: true,
  active: true,
}).extend({
  /** Left out, the engine names it after the group or the account it belongs to. */
  name: z.string().trim().min(2).max(80).optional(),
});
export type RateRulesRequest = z.infer<typeof RateRulesRequest>;

/** A card written for one account, with the customer it is assigned to. */
export const AccountRateAssignment = z.object({
  accountId: Uuid,
  accountName: z.string(),
  accountCode: z.string(),
  rateCard: RateCard,
  assignedAt: z.string().datetime(),
});
export type AccountRateAssignment = z.infer<typeof AccountRateAssignment>;

/** What an account is actually charged on today, and why. */
export const AccountRateResolution = z.object({
  accountId: Uuid,
  source: RateSource,
  rateCard: RateCard,
  /** Set when the group is what priced it. */
  groupId: Uuid.nullable(),
  groupName: z.string().nullable(),
});
export type AccountRateResolution = z.infer<typeof AccountRateResolution>;
