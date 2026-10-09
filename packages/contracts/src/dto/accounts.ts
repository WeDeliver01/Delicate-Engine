import { z } from "zod";
import { AccountRole, AccountStatus, AccountType, BillingMode, PlatformRole } from "../enums.js";
import { Uuid } from "./common.js";

export const UserProfile = z.object({
  id: Uuid,
  email: z.string().email(),
  fullName: z.string().nullable(),
  phone: z.string().nullable(),
  platformRole: PlatformRole.nullable(),
});
export type UserProfile = z.infer<typeof UserProfile>;

export const Organization = z.object({
  id: Uuid,
  name: z.string(),
  registrationNumber: z.string().nullable(),
  vatNumber: z.string().nullable(),
});
export type Organization = z.infer<typeof Organization>;

export const Account = z.object({
  id: Uuid,
  organizationId: Uuid.nullable(),
  name: z.string(),
  type: AccountType,
  billingMode: BillingMode,
  status: AccountStatus,
  createdAt: z.string().datetime(),
});
export type Account = z.infer<typeof Account>;

/** An account as seen by the current user, including their role on it. */
export const AccountMembership = Account.extend({ role: AccountRole });
export type AccountMembership = z.infer<typeof AccountMembership>;

export const CreateAccountRequest = z.object({
  name: z.string().min(2).max(120),
  type: AccountType,
  organization: z
    .object({
      id: Uuid.optional(),
      name: z.string().min(2).max(160).optional(),
      registrationNumber: z.string().max(40).optional(),
      vatNumber: z.string().max(20).optional(),
    })
    .optional(),
});
export type CreateAccountRequest = z.infer<typeof CreateAccountRequest>;

export const UpdateProfileRequest = z.object({
  fullName: z.string().min(1).max(120).optional(),
  phone: z.string().min(6).max(20).optional(),
});
export type UpdateProfileRequest = z.infer<typeof UpdateProfileRequest>;

export const MeResponse = z.object({
  user: UserProfile,
  accounts: z.array(AccountMembership),
  /**
   * Set when staff are working inside an account they do not belong to.
   *
   * The portal has to be able to say so on screen. Someone who forgets whose account they are
   * in books a real delivery against a real customer's wallet, and the only thing standing
   * between that and a refund is whether the page told them.
   */
  actingAs: z.object({ id: Uuid, name: z.string() }).nullable().default(null),
});
export type MeResponse = z.infer<typeof MeResponse>;

export const AddMemberRequest = z.object({
  email: z.string().email(),
  role: AccountRole,
});
export type AddMemberRequest = z.infer<typeof AddMemberRequest>;

export const Member = z.object({
  userId: Uuid,
  email: z.string().email(),
  fullName: z.string().nullable(),
  role: AccountRole,
  createdAt: z.string().datetime(),
});
export type Member = z.infer<typeof Member>;

/**
 * The house account walk-in work is booked under.
 *
 * Somebody phones, or arrives at the door, with a cake and an address. They have no account
 * and there is no time to make them one, but the delivery still has to belong somewhere: a
 * booking charges a wallet, and a wallet hangs off an account. So one account exists for all
 * of them, created by migration with this fixed id so that every environment has the same one.
 *
 * Who the delivery is actually for goes in the booking's customer reference. The alternative
 * -- an account per walk-in -- leaves a trail of single-use accounts nobody ever closes.
 */
export const WALK_IN_ACCOUNT_ID = "00000000-0000-4000-8000-000000000001";

/**
 * Everything the console needs about one account on one screen.
 *
 * Deliberately more than the customer's own view carries: the billing address an invoice is
 * addressed to, the organisation behind it, who can sign in, and the vehicle rule that
 * governs whose van the work may go on. Ops answering the phone should not have to open four
 * pages to answer one question.
 */
export const AdminAccountDetail = z.object({
  account: Account,
  billingEmail: z.string().nullable(),
  billingAddress: z.unknown().nullable(),
  /** This customer's work only goes on a vehicle of this class. Null is any. */
  requiresVehicleClass: z.string().nullable(),
  organization: Organization.nullable(),
  members: z.array(Member),
});
export type AdminAccountDetail = z.infer<typeof AdminAccountDetail>;

/** What a super admin may change about an account. Everything here is audited. */
export const UpdateAccountRequest = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  type: AccountType.optional(),
  status: AccountStatus.optional(),
  billingEmail: z.string().email().nullable().optional(),
  requiresVehicleClass: z.string().trim().max(40).nullable().optional(),
});
export type UpdateAccountRequest = z.infer<typeof UpdateAccountRequest>;

export const UpdateOrganizationRequest = z.object({
  name: z.string().trim().min(2).max(160).optional(),
  registrationNumber: z.string().trim().max(40).nullable().optional(),
  vatNumber: z.string().trim().max(20).nullable().optional(),
});
export type UpdateOrganizationRequest = z.infer<typeof UpdateOrganizationRequest>;
