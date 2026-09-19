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
