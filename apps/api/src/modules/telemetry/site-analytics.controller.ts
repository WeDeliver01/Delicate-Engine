import { Controller, Get } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import { IsoDate } from "@delicate/contracts";
import { PlatformRoles } from "../../auth/decorators.js";
import { Query } from "../../common/zod.js";
import { SiteAnalyticsService } from "./site-analytics.service.js";

const Range = z.object({ from: IsoDate.optional(), to: IsoDate.optional() });

/** Traffic and product-event reporting, ours instead of a third party's. */
@ApiTags("admin")
@ApiBearerAuth()
@Controller("v1/admin/site-analytics")
@PlatformRoles("super_admin", "finance", "dispatcher")
export class SiteAnalyticsController {
  constructor(private readonly analytics: SiteAnalyticsService) {}

  @Get("overview")
  overview(@Query(Range) q: { from?: string; to?: string }) {
    return this.analytics.overview(q.from, q.to);
  }

  @Get("daily")
  daily(@Query(Range) q: { from?: string; to?: string }) {
    return this.analytics.daily(q.from, q.to);
  }

  @Get("top-pages")
  topPages(@Query(Range) q: { from?: string; to?: string }) {
    return this.analytics.topPages(q.from, q.to);
  }

  @Get("referrers")
  referrers(@Query(Range) q: { from?: string; to?: string }) {
    return this.analytics.referrers(q.from, q.to);
  }

  @Get("devices")
  devices(@Query(Range) q: { from?: string; to?: string }) {
    return this.analytics.devices(q.from, q.to);
  }

  @Get("events")
  events(@Query(Range) q: { from?: string; to?: string }) {
    return this.analytics.customEvents(q.from, q.to);
  }
}
