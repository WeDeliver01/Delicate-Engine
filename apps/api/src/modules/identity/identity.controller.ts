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
import type { Principal } from "../../auth/principal.js";
import { Body, Params } from "../../common/zod.js";
import { IdentityService } from "./identity.service.js";

@ApiTags("identity")
@ApiBearerAuth()
@Controller("v1")
export class IdentityController {
  constructor(private readonly identity: IdentityService) {}

  @Get("me")
  me(@CurrentPrincipal() p: Principal) {
    return this.identity.me(p.user);
  }

  @Patch("me")
  updateMe(
    @CurrentPrincipal() p: Principal,
    @Body(UpdateProfileRequest) body: UpdateProfileRequest,
  ) {
    return this.identity.updateProfile(p.user.id, body);
  }

  @Post("accounts")
  createAccount(
    @CurrentPrincipal() p: Principal,
    @Body(CreateAccountRequest) body: CreateAccountRequest,
  ) {
    return this.identity.createAccount(p.user, body);
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
