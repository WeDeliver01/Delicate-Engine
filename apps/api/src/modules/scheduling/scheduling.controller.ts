import { Controller, Delete, Get, HttpCode, Post, Put } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import {
  AvailabilityQuery,
  BlackoutDate,
  IsoDate,
  SetSlotRequest,
  SlotPolicy,
} from "@delicate/contracts";
import { PlatformRoles, Public } from "../../auth/decorators.js";
import { Body, Params, Query } from "../../common/zod.js";
import { SchedulingService } from "./scheduling.service.js";
import { CatalogService } from "../catalog/catalog.service.js";

/** Availability is public so the booking form can show it before sign-in. */
@ApiTags("scheduling")
@Controller("v1/public/slots")
export class PublicSlotsController {
  constructor(
    private readonly scheduling: SchedulingService,
    private readonly catalog: CatalogService,
  ) {}

  @Public()
  @Get("availability")
  async availability(@Query(AvailabilityQuery) q: AvailabilityQuery) {
    // Resolved here rather than taken as a flag: whether a service dispatches immediately is
    // ours to know, and a client that could assert it would be offered slots the booking
    // would then refuse.
    const immediate = q.serviceLevel
      ? !(await this.catalog.serviceLevelByCode(q.serviceLevel)).requiresSlot
      : false;
    return this.scheduling.availability(q.dateFrom, q.dateTo, { immediate });
  }

  /**
   * The narrow windows on offer for a date, band by band. Empty when timed windows are off,
   * so a booking form that asks is simply shown nothing rather than an error.
   */
  @Public()
  @Get("windows/:date")
  windows(@Params(z.object({ date: IsoDate })) p: { date: string }) {
    return this.scheduling.windowAvailability(p.date);
  }
}

@ApiTags("admin")
@ApiBearerAuth()
@Controller("v1/admin/capacity")
@PlatformRoles("super_admin", "dispatcher")
export class AdminCapacityController {
  constructor(private readonly scheduling: SchedulingService) {}

  @Get("policy")
  policy() {
    return this.scheduling.policy();
  }

  @Put("policy")
  updatePolicy(@Body(SlotPolicy) body: SlotPolicy) {
    return this.scheduling.updatePolicy(body);
  }

  @Get("slots")
  slots(@Query(AvailabilityQuery) q: AvailabilityQuery) {
    return this.scheduling.availability(q.dateFrom, q.dateTo);
  }

  @Get("windows/:date")
  windowBands(@Params(z.object({ date: IsoDate })) p: { date: string }) {
    return this.scheduling.windowAvailability(p.date);
  }

  /** Close/reopen or override capacity for one slot. */
  @Post("slots/set")
  setSlot(@Body(SetSlotRequest) body: SetSlotRequest) {
    return this.scheduling.setSlot(body);
  }

  @Get("blackouts")
  blackouts() {
    return this.scheduling.listBlackouts();
  }

  @Post("blackouts")
  addBlackout(@Body(BlackoutDate) body: BlackoutDate) {
    return this.scheduling.addBlackout(body);
  }

  @Delete("blackouts/:date")
  @HttpCode(204)
  async removeBlackout(@Params(z.object({ date: IsoDate })) p: { date: string }) {
    await this.scheduling.removeBlackout(p.date);
  }
}
