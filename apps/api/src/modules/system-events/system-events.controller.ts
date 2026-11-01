import { Controller, Get } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import { ListSystemEventsQuery, Uuid } from "@delicate/contracts";
import { PlatformRoles } from "../../auth/decorators.js";
import { Params, Query } from "../../common/zod.js";
import { AppError } from "../../common/errors.js";
import { SystemEventsService } from "./system-events.service.js";

const IdParam = z.object({ id: Uuid });
const StatsQuery = z.object({ hours: z.coerce.number().int().min(1).max(720).default(24) });

/**
 * The operational feed.
 *
 * `super_admin` only to start, as Phase 8 specified. The rows carry redacted webhook payloads
 * and the insides of failed requests, which is a wider blast radius than a dispatcher needs;
 * widening it is a decision to take once it is clear which categories they actually read.
 */
@ApiTags("system-events")
@ApiBearerAuth()
@Controller("v1/admin/system-events")
@PlatformRoles("super_admin")
export class SystemEventsController {
  constructor(private readonly events: SystemEventsService) {}

  @Get()
  list(@Query(ListSystemEventsQuery) query: ListSystemEventsQuery) {
    return this.events.list(query);
  }

  /** The header: counts by level and whichever categories exist in the window. */
  @Get("stats")
  stats(@Query(StatsQuery) query: z.infer<typeof StatsQuery>) {
    return this.events.stats(query.hours);
  }

  @Get(":id")
  async get(@Params(IdParam) params: z.infer<typeof IdParam>) {
    const event = await this.events.get(params.id);
    if (!event) throw AppError.notFound("system event");
    return event;
  }
}
