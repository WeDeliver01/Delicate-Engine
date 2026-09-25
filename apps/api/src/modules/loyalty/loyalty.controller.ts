import { Controller, Get, Put } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { LoyaltyProgram } from "@delicate/contracts";
import {
  AccountRoles,
  ActiveAccountId,
  PlatformRoles,
  RequireAccount,
} from "../../auth/decorators.js";
import { Body } from "../../common/zod.js";
import { LoyaltyService } from "./loyalty.service.js";

/** What a customer has earned, and what the next tier needs. */
@ApiTags("account")
@ApiBearerAuth()
@Controller("v1/account/loyalty")
@RequireAccount()
@AccountRoles("customer_owner", "customer_staff")
export class AccountLoyaltyController {
  constructor(private readonly loyalty: LoyaltyService) {}

  @Get()
  status(@ActiveAccountId() accountId: string) {
    return this.loyalty.status(accountId);
  }
}

/** The programme is a business decision, so it is set here rather than in code. */
@ApiTags("admin")
@ApiBearerAuth()
@Controller("v1/admin/loyalty")
@PlatformRoles("super_admin", "finance")
export class AdminLoyaltyController {
  constructor(private readonly loyalty: LoyaltyService) {}

  @Get("program")
  program() {
    return this.loyalty.program();
  }

  @Put("program")
  @PlatformRoles("super_admin")
  setProgram(@Body(LoyaltyProgram) body: LoyaltyProgram) {
    return this.loyalty.setProgram(body);
  }

  /** What loyalty has actually cost. */
  @Get("cost")
  cost() {
    return this.loyalty.costSummary();
  }
}
