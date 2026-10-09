import { Controller, Delete, Get, HttpCode, Inject, Patch, Post } from "@nestjs/common";
import { ApiBearerAuth, ApiHeader, ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import {
  AccountRole,
  AddMemberRequest,
  CreateAccountRequest,
  CredentialAction,
  UpdateAccountRequest,
  UpdateOrganizationRequest,
  UpdateProfileRequest,
  Uuid,
} from "@delicate/contracts";
import {
  AccountRoles,
  ActiveAccountId,
  CurrentPrincipal,
  PlatformRoles,
  RequireAccount,
} from "../../auth/decorators.js";
import { isStaff, requireUser, type Principal } from "../../auth/principal.js";
import { Body, Params, Query } from "../../common/zod.js";
import { IdentityService } from "./identity.service.js";
import { ENV, type Env } from "../../config/env.js";

const MeQuery = z.object({ actingAs: Uuid.optional() });
type MeQuery = z.infer<typeof MeQuery>;

@ApiTags("identity")
@ApiBearerAuth()
@Controller("v1")
export class IdentityController {
  constructor(private readonly identity: IdentityService) {}

  @Get("me")
  me(@CurrentPrincipal() p: Principal, @Query(MeQuery) q: MeQuery) {
    /*
      Two ways to be told which account the caller is working inside, because the portal
      cannot use the header here. Sending `X-Account-Id` makes the guard resolve it, and a
      stale id in someone's browser would then 403 the one request that tells the page who
      they are -- locking them out of the app with no way back. So the portal names the
      account as a query parameter instead, and the only thing it can buy you is the name of
      an account you are already allowed to reach into.
    */
    const named = p.account?.impersonating
      ? p.account.id
      : isStaff(p)
        ? (q.actingAs ?? null)
        : null;
    return this.identity.me(requireUser(p), named);
  }

  @Patch("me")
  updateMe(
    @CurrentPrincipal() p: Principal,
    @Body(UpdateProfileRequest) body: UpdateProfileRequest,
  ) {
    return this.identity.updateProfile(requireUser(p).id, body);
  }

  @Post("accounts")
  createAccount(
    @CurrentPrincipal() p: Principal,
    @Body(CreateAccountRequest) body: CreateAccountRequest,
  ) {
    return this.identity.createAccount(requireUser(p), body);
  }
}

const MemberParams = z.object({ userId: Uuid });
const ChangeRoleBody = z.object({ role: AccountRole });

/**
 * Everything under /v1/account acts on the ACTIVE account (X-Account-Id header). This is what
 * makes account switching in the portal a pure client-side concern.
 */
@ApiTags("identity")
@ApiBearerAuth()
@ApiHeader({ name: "X-Account-Id", required: true })
@Controller("v1/account")
export class ActiveAccountController {
  constructor(private readonly identity: IdentityService) {}

  @Get()
  @RequireAccount()
  get(@ActiveAccountId() accountId: string) {
    return this.identity.getAccount(accountId);
  }

  @Get("members")
  @RequireAccount()
  members(@ActiveAccountId() accountId: string) {
    return this.identity.listMembers(accountId);
  }

  @Post("members")
  @AccountRoles("customer_owner")
  addMember(@ActiveAccountId() accountId: string, @Body(AddMemberRequest) body: AddMemberRequest) {
    return this.identity.addMember(accountId, body);
  }

  @Patch("members/:userId")
  @AccountRoles("customer_owner")
  changeRole(
    @ActiveAccountId() accountId: string,
    @Params(MemberParams) params: z.infer<typeof MemberParams>,
    @Body(ChangeRoleBody) body: z.infer<typeof ChangeRoleBody>,
  ) {
    return this.identity.changeMemberRole(accountId, params.userId, body.role);
  }

  @Delete("members/:userId")
  @HttpCode(204)
  @AccountRoles("customer_owner")
  async removeMember(
    @ActiveAccountId() accountId: string,
    @Params(MemberParams) params: z.infer<typeof MemberParams>,
  ) {
    await this.identity.removeMember(accountId, params.userId);
  }
}

const AccountParams = z.object({ id: Uuid });
const AccountMemberParams = z.object({ id: Uuid, userId: Uuid });

/**
 * One customer's account, as the people who run the business see it.
 *
 * The customer's own `/v1/account` routes act on whichever account they are in; these name
 * the account in the path, because ops are looking at somebody else's and the account they
 * happen to be "in" has nothing to do with it.
 */
@ApiTags("admin")
@ApiBearerAuth()
@Controller("v1/admin/accounts")
@PlatformRoles("super_admin", "finance", "dispatcher")
export class AdminAccountsController {
  constructor(
    private readonly identity: IdentityService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  @Get(":id")
  detail(@Params(AccountParams) p: z.infer<typeof AccountParams>) {
    return this.identity.adminDetail(p.id);
  }

  @Patch(":id")
  @PlatformRoles("super_admin")
  update(
    @Params(AccountParams) p: z.infer<typeof AccountParams>,
    @Body(UpdateAccountRequest) body: UpdateAccountRequest,
  ) {
    return this.identity.updateAccount(p.id, body);
  }

  @Patch(":id/organization")
  @PlatformRoles("super_admin")
  updateOrganization(
    @Params(AccountParams) p: z.infer<typeof AccountParams>,
    @Body(UpdateOrganizationRequest) body: UpdateOrganizationRequest,
  ) {
    return this.identity.updateOrganization(p.id, body);
  }

  @Get(":id/members")
  members(@Params(AccountParams) p: z.infer<typeof AccountParams>) {
    return this.identity.listMembers(p.id);
  }

  /** Give somebody access to a customer's account. Super admin only: it is their account. */
  @Post(":id/members")
  @PlatformRoles("super_admin")
  addMember(
    @Params(AccountParams) p: z.infer<typeof AccountParams>,
    @Body(AddMemberRequest) body: AddMemberRequest,
  ) {
    return this.identity.addMember(p.id, body);
  }

  @Patch(":id/members/:userId")
  @PlatformRoles("super_admin")
  changeRole(
    @Params(AccountMemberParams) p: z.infer<typeof AccountMemberParams>,
    @Body(ChangeRoleBody) body: z.infer<typeof ChangeRoleBody>,
  ) {
    return this.identity.changeMemberRole(p.id, p.userId, body.role);
  }

  /**
   * Somebody's sign-in: a reset link, a corrected address, a door closed, or a password set
   * by hand for a customer who cannot receive email.
   *
   * Super admin only. Setting a password means staff can sign in as that customer and
   * nothing would look unusual afterwards, which is exactly why it is one role, one audit
   * row, and never the password itself in the record.
   */
  @Post(":id/members/:userId/credentials")
  @PlatformRoles("super_admin")
  credentials(
    @Params(AccountMemberParams) p: z.infer<typeof AccountMemberParams>,
    @Body(CredentialAction) body: CredentialAction,
  ) {
    return this.identity.credentialAction(
      p.userId,
      body,
      `${this.env.WEB_PUBLIC_URL.replace(/\/$/, "")}/auth/callback?next=/auth/reset`,
    );
  }

  @Delete(":id/members/:userId")
  @HttpCode(204)
  @PlatformRoles("super_admin")
  async removeMember(@Params(AccountMemberParams) p: z.infer<typeof AccountMemberParams>) {
    await this.identity.removeMember(p.id, p.userId);
  }
}
