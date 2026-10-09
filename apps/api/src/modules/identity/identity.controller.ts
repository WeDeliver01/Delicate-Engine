import { Controller, Delete, Get, HttpCode, Patch, Post } from "@nestjs/common";
import { ApiBearerAuth, ApiHeader, ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import {
  AccountRole,
  AddMemberRequest,
  CreateAccountRequest,
  UpdateProfileRequest,
  Uuid,
} from "@delicate/contracts";
import {
  AccountRoles,
  ActiveAccountId,
  CurrentPrincipal,
  RequireAccount,
} from "../../auth/decorators.js";
import { isStaff, requireUser, type Principal } from "../../auth/principal.js";
import { Body, Params, Query } from "../../common/zod.js";
import { IdentityService } from "./identity.service.js";

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
