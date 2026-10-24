import { Controller, Delete, Get, HttpCode, Post, Put } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import {
  AvailabilityQuery,
  BlackoutDate,
  IsoDate,
  SetSlotRequest,
  SlotPolicy,
  toPublicSlotAvailability,
  toPublicWindowBandAvailability,
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

  /**
   * What is bookable, as a customer is allowed to see it: health, never the count behind it.
   * Which windows even exist also depends on the service level asked about -- a Standard
   * booking is not offered an Express window and the reverse -- so the same parameter does
   * two jobs: it tells the engine whether this service dispatches immediately, and it
   * narrows the window list to the ones that service actually sells.
   */
  @Public()
  @Get("availability")
  async availability(@Query(AvailabilityQuery) q: AvailabilityQuery) {
    const [immediate, policy] = await Promise.all([
      q.serviceLevel
        ? this.catalog.serviceLevelByCode(q.serviceLevel).then((sl) => !sl.requiresSlot)
        : Promise.resolve(false),
      this.scheduling.policy(),
    ]);
    const slots = await this.scheduling.availability(q.dateFrom, q.dateTo, {
      immediate,
      serviceLevel: q.serviceLevel,
    });
    return slots.map((s) => toPublicSlotAvailability(s, policy.healthLimitedBelowBps));
  }

  /**
   * The narrow windows on offer for a date, band by band. Empty when timed windows are off,
   * so a booking form that asks is simply shown nothing rather than an error.
   */
  @Public()
  @Get("windows/:date")
  async windows(@Params(z.object({ date: IsoDate })) p: { date: string }) {
    const [bands, policy] = await Promise.all([
      this.scheduling.windowAvailability(p.date),
      this.scheduling.policy(),
    ]);
    return bands.map((b) => toPublicWindowBandAvailability(b, policy.healthLimitedBelowBps));
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
