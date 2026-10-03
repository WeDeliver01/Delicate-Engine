import { Controller, Delete, Get, Post, Put, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import {
  AbandonTripRequest,
  AddStopsRequest,
  ArriveRequest,
  CreateTripRequest,
  RemoveStopsRequest,
  ResequenceRequest,
  SetStopWindowRequest,
  TripQuery,
  Uuid,
  type Driver,
} from "@delicate/contracts";
import { PlatformRoles } from "../../auth/decorators.js";
import { Body, Params, Query } from "../../common/zod.js";
import { CurrentDriver, DriverGuard } from "../fleet/driver.guard.js";
import { TripService } from "./trip.service.js";

const IdParam = z.object({ id: Uuid });
const StopParam = z.object({ id: Uuid });

/**
 * The dispatcher's side of the Command Center: building a day, ordering it, handing it over.
 *
 * Every write here changes who does what and in which order, which is why each one is audited.
 * None of them moves money.
 */
@ApiTags("admin")
@ApiBearerAuth()
@Controller("v1/admin/dispatch/trips")
@PlatformRoles("super_admin", "dispatcher")
export class AdminTripController {
  constructor(private readonly trips: TripService) {}

  @Get()
  list(@Query(TripQuery) q: TripQuery) {
    return this.trips.list(q);
  }

  @Post()
  create(@Body(CreateTripRequest) body: CreateTripRequest) {
    return this.trips.create(body);
  }

  @Get(":id")
  sheet(@Params(IdParam) p: { id: string }) {
    return this.trips.sheet(p.id);
  }

  @Post(":id/stops")
  addStops(@Params(IdParam) p: { id: string }, @Body(AddStopsRequest) body: AddStopsRequest) {
    return this.trips.addStops(p.id, body);
  }

  @Delete(":id/stops")
  removeStops(
    @Params(IdParam) p: { id: string },
    @Body(RemoveStopsRequest) body: RemoveStopsRequest,
  ) {
    return this.trips.removeStops(p.id, body.stopIds, body.reason);
  }

  /** A dispatcher's hand-ordering. Beats the optimiser, and the trip records that it did. */
  @Put(":id/sequence")
  resequence(@Params(IdParam) p: { id: string }, @Body(ResequenceRequest) body: ResequenceRequest) {
    return this.trips.resequence(p.id, body.stopIds);
  }

  /** Ask for a proposed order. Refuses to overwrite a dispatcher's unless `force` is set. */
  @Post(":id/sequence/auto")
  autoSequence(
    @Params(IdParam) p: { id: string },
    @Query(z.object({ force: z.coerce.boolean().default(false) })) q: { force: boolean },
  ) {
    return this.trips.autoSequence(p.id, q.force);
  }

  @Post(":id/release")
  release(@Params(IdParam) p: { id: string }) {
    return this.trips.release(p.id);
  }

  @Post(":id/complete")
  complete(@Params(IdParam) p: { id: string }) {
    return this.trips.complete(p.id);
  }

  @Post(":id/abandon")
  abandon(@Params(IdParam) p: { id: string }, @Body(AbandonTripRequest) body: AbandonTripRequest) {
    return this.trips.abandon(p.id, body.reason);
  }
}

@ApiTags("admin")
@ApiBearerAuth()
@Controller("v1/admin/dispatch/stops")
@PlatformRoles("super_admin", "dispatcher")
export class AdminTripStopController {
  constructor(private readonly trips: TripService) {}

  /** Narrow or pin the window the driver works to, keeping what was sold visible. */
  @Put(":id/window")
  setWindow(
    @Params(StopParam) p: { id: string },
    @Body(SetStopWindowRequest) body: SetStopWindowRequest,
  ) {
    return this.trips.setStopWindow(p.id, body);
  }
}

/**
 * The driver app's view of a trip. The day the dispatcher agreed to, in the order they agreed
 * to it — not one recomputed per request that can rearrange itself between two refreshes.
 */
@ApiTags("driver")
@ApiBearerAuth()
@Controller("v1/driver/trip")
@UseGuards(DriverGuard)
export class DriverTripController {
  constructor(private readonly trips: TripService) {}

  /**
   * Wrapped rather than returned bare: a `null` trip serialises to an empty body, which the app
   * cannot tell apart from a trip whose fields went missing. `{ trip: null }` says which it is.
   */
  @Get()
  async current(@CurrentDriver() driver: Driver) {
    return { trip: await this.trips.currentFor(driver) };
  }

  @Post("start")
  start(
    @CurrentDriver() driver: Driver,
    @Body(z.object({ tripId: Uuid })) body: { tripId: string },
  ) {
    return this.trips.start(body.tripId, driver);
  }

  /** "I am here." Distinct from collecting or delivering: this is what ETA accuracy is measured on. */
  @Post("arrive")
  arrive(@CurrentDriver() driver: Driver, @Body(ArriveRequest) body: ArriveRequest) {
    return this.trips.arrive(body.stopId, driver, body.location);
  }
}
