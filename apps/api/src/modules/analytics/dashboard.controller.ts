import { Controller, Get } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import { IsoDate, PERIOD_KEYS, type PeriodKey } from "@delicate/contracts";
import { ActiveAccountId, RequireAccount } from "../../auth/decorators.js";
import { Query } from "../../common/zod.js";
import { DashboardService } from "./dashboard.service.js";
import { MoneyTimelineService } from "./money-timeline.service.js";

const DashboardQuery = z.object({
  period: z.enum(PERIOD_KEYS).default("last28"),
  from: IsoDate.optional(),
  to: IsoDate.optional(),
});

/**
 * One call behind the customer's home screen.
 *
 * Deliberately one rather than the six it composes: the dashboard is the first thing loaded
 * after signing in, and six round trips on a phone over mobile data is the difference between
 * "it is already there" and "it is still loading".
 */
@ApiTags("dashboard")
@ApiBearerAuth()
@Controller("v1/account/dashboard")
@RequireAccount()
export class DashboardController {
  constructor(
    private readonly svc: DashboardService,
    private readonly timeline: MoneyTimelineService,
  ) {}

  @Get()
  get(
    @ActiveAccountId() accountId: string,
    @Query(DashboardQuery) q: { period: PeriodKey; from?: string; to?: string },
  ) {
    return this.svc.forAccount(accountId, q.period, q.from, q.to);
  }

  /** Every time money moved, in date order: the account's own financial statement. */
  @Get("money")
  money(
    @ActiveAccountId() accountId: string,
    @Query(DashboardQuery) q: { period: PeriodKey; from?: string; to?: string },
  ) {
    return this.timeline.forAccount(accountId, q.period, q.from, q.to);
  }
}
