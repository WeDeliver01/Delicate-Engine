import { Controller, Get, HttpCode, Post, Res, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import type { Response } from "express";
import { z } from "zod";
import {
  CollectRequest,
  DeliverRequest,
  FailRequest,
  FuelLogRequest,
  LocationPing,
  OdometerReadingRequest,
  Uuid,
  type Driver,
} from "@delicate/contracts";
import { Body, Params } from "../../common/zod.js";
import { PlatformRoles } from "../../auth/decorators.js";
import { FleetService } from "./fleet.service.js";
import { CurrentDriver, DriverGuard } from "./driver.guard.js";
import { DispatchService } from "../dispatch/dispatch.service.js";
import { LedgerService } from "../ledger/ledger.service.js";

/** What the native driver app talks to. */
@ApiTags("driver")
@ApiBearerAuth()
@Controller("v1/driver")
@UseGuards(DriverGuard)
export class DriverController {
  constructor(
    private readonly fleet: FleetService,
    private readonly dispatch: DispatchService,
    private readonly ledger: LedgerService,
  ) {}

  @Get("me")
  async me(@CurrentDriver() d: Driver) {
    const [earnings, fuel] = await Promise.all([
      this.ledger.balance("DRIVER_EARNINGS_PAYABLE", "driver", d.id),
      this.ledger.balance("FUEL_PAYABLE", "driver", d.id),
    ]);
    // payables are credit-normal (negative); show what the driver is owed as positive numbers
    return { driver: d, owedEarningsCents: -earnings, owedFuelCents: -fuel };
  }

  @Get("day")
  day(@CurrentDriver() d: Driver) {
    return this.dispatch.day(d);
  }

  @Post("odometer")
  recordOdometer(
    @CurrentDriver() d: Driver,
    @Body(OdometerReadingRequest) body: OdometerReadingRequest,
  ) {
    return this.fleet.recordOdometer(d, body);
  }

  @Post("location")
  @HttpCode(202)
  async location(
    @CurrentDriver() d: Driver,
    @Body(z.object({ pings: z.array(LocationPing).min(1).max(200) }))
    body: { pings: z.infer<typeof LocationPing>[] },
  ) {
    await this.fleet.ping(d, body.pings);
    return { accepted: body.pings.length };
  }

  @Post("collect")
  collect(@CurrentDriver() d: Driver, @Body(CollectRequest) body: z.infer<typeof CollectRequest>) {
    return this.dispatch.collect(d, body.bookingId, body.location, body.note);
  }

  @Post("deliver")
  deliver(@CurrentDriver() d: Driver, @Body(DeliverRequest) body: DeliverRequest) {
    return this.dispatch.deliver(d, body);
  }

  @Post("fail")
  fail(@CurrentDriver() d: Driver, @Body(FailRequest) body: FailRequest) {
    return this.dispatch.fail(d, body);
  }

  @Post("fuel")
  fuel(@CurrentDriver() d: Driver, @Body(FuelLogRequest) body: FuelLogRequest) {
    return this.fleet.logFuel(d, body);
  }

  @Get("fuel")
  fuelLogs(@CurrentDriver() d: Driver) {
    return this.fleet.fuelLogs(d.id, 50);
  }
}

/** Evidence files (POD photos/signatures, receipts). Staff only. */
@ApiTags("admin")
@ApiBearerAuth()
@Controller("v1/admin/files")
@PlatformRoles("super_admin", "dispatcher", "finance")
export class FilesController {
  constructor(private readonly fleet: FleetService) {}

  @Get(":id")
  async file(@Params(z.object({ id: Uuid })) p: { id: string }, @Res() res: Response) {
    const f = await this.fleet.getFile(p.id);
    res.setHeader("content-type", f.mime);
    res.setHeader("cache-control", "private, max-age=3600");
    res.send(f.bytes);
  }
}
