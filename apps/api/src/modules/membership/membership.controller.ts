import { Controller, Delete, Get, Post } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import { StartMembershipRequest, Uuid } from "@delicate/contracts";
import {
  AccountRoles,
  ActiveAccountId,
  PlatformRoles,
  Public,
  RequireAccount,
} from "../../auth/decorators.js";
import { Body, Params, Query } from "../../common/zod.js";
import { MembershipService } from "./membership.service.js";

const AccountParam = z.object({ id: Uuid });

/** The tiers on offer. Public: the marketing page prices itself from this. */
@ApiTags("membership")
@Controller("v1/public/membership")
export class PublicMembershipController {
  constructor(private readonly membership: MembershipService) {}

  @Public()
  @Get("plans")
  plans() {
    return this.membership.plans();
  }
}

/** A customer's own membership. */
@ApiTags("membership")
@ApiBearerAuth()
@Controller("v1/account/membership")
@RequireAccount()
export class AccountMembershipController {
  constructor(private readonly membership: MembershipService) {}

  @Get()
  async current(@ActiveAccountId() accountId: string) {
    return { membership: await this.membership.forAccount(accountId) };
  }

  @Get("history")
  history(@ActiveAccountId() accountId: string) {
    return this.membership.history(accountId);
  }

  /** Only an owner commits the account to a monthly fee; staff cannot. */
  @Post()
  @AccountRoles("customer_owner")
  start(
    @ActiveAccountId() accountId: string,
    @Body(StartMembershipRequest) body: StartMembershipRequest,
  ) {
    return this.membership.start(accountId, body);
  }

  /**
   * Stop renewing. Runs to the end of the period already paid for, because taking benefits
   * away mid-month from someone who has paid for the month is indefensible.
   */
  @Delete()
  @AccountRoles("customer_owner")
  async cancel(@ActiveAccountId() accountId: string) {
    return { membership: await this.membership.cancel(accountId, false) };
  }
}

/** Ops: who is on what, and putting somebody on a plan by hand. */
@ApiTags("admin")
@ApiBearerAuth()
@Controller("v1/admin")
@PlatformRoles("super_admin", "finance")
export class AdminMembershipController {
  constructor(private readonly membership: MembershipService) {}

  @Get("membership/plans")
  plans(
    @Query(z.object({ includeInactive: z.coerce.boolean().optional() }))
    q: {
      includeInactive?: boolean;
    },
  ) {
    return this.membership.plans(q.includeInactive ?? true);
  }

  /** Everyone on a plan, for the renewals board. */
  @Get("membership/subscriptions")
  subscriptions(
    @Query(z.object({ dueWithinDays: z.coerce.number().int().min(0).max(365).optional() }))
    q: {
      dueWithinDays?: number;
    },
  ) {
    return this.membership.list(q.dueWithinDays ?? null);
  }

  @Get("accounts/:id/membership")
  async forAccount(@Params(AccountParam) p: { id: string }) {
    return {
      membership: await this.membership.forAccount(p.id),
      history: await this.membership.history(p.id),
    };
  }

  @Post("accounts/:id/membership")
  @PlatformRoles("super_admin")
  start(
    @Params(AccountParam) p: { id: string },
    @Body(StartMembershipRequest) body: StartMembershipRequest,
  ) {
    return this.membership.start(p.id, body);
  }

  /** Ops cancelling on a customer's behalf may end it there and then. */
  @Delete("accounts/:id/membership")
  @PlatformRoles("super_admin")
  async cancel(
    @Params(AccountParam) p: { id: string },
    @Query(z.object({ immediate: z.coerce.boolean().optional() })) q: { immediate?: boolean },
  ) {
    return { membership: await this.membership.cancel(p.id, q.immediate ?? false) };
  }

  /** Charge a period by hand: the renewal that failed, or a plan collected outside the app. */
  @Post("accounts/:id/membership/renew")
  @PlatformRoles("super_admin")
  renew(@Params(AccountParam) p: { id: string }) {
    return this.membership.renewByAccount(p.id);
  }
}
