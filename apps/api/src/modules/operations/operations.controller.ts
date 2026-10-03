import { Controller, Delete, Get, Post, Put, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import {
  AbandonTripRequest,
  AddStopsRequest,
  ApplyDayPlanRequest,
  AssignToDayRequest,
  BoardQuery,
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
import { BoardService } from "./board.service.js";
import { PlanService } from "./plan.service.js";
import { LiveService } from "./live.service.js";

const IdParam = z.object({ id: Uuid });
const StopParam = z.object({ id: Uuid });

/**
 * The board itself: one screen that runs the day.
 *
 * A read model assembled per request. Polled rather than pushed — a dispatcher refreshing a
 * board is not worth a socket layer the engine does not otherwise have.
 */
@ApiTags("admin")
@ApiBearerAuth()
@Controller("v1/admin/dispatch/board")
@PlatformRoles("super_admin", "dispatcher")
export class AdminBoardController {
  constructor(private readonly board: BoardService) {}

  @Get()
  get(@Query(BoardQuery) q: BoardQuery) {
    return this.board.board(q.date);
  }

  /** Who should take this, and why. The reason is the point; a bare name gets ignored. */
  @Get("recommendations/:id")
  recommendations(@Params(IdParam) p: { id: string }) {
    return this.board.recommendations(p.id);
  }

  /**
   * Put a shipment on a driver's day in one move, making the trip if they have none yet. This
   * is what the board's drag-onto-a-driver does, and it saves a dispatcher the two-step of
   * creating a trip before they can use it.
   */
  @Post("assign")
  assign(@Body(AssignToDayRequest) body: AssignToDayRequest) {
    return this.board
      .assignToDay(body.shipmentId, body.driverId, body.date ?? undefined)
      .then((tripId) => ({ tripId }));
  }
}

/**
 * "You have 23 shipments and 3 drivers — recommend the allocation."
 *
 * A proposal and nothing more: reading it changes nothing, and applying it is a second call
 * that leaves the trips unreleased so a dispatcher still signs off each day.
 */
/**
 * The day as it is going, rather than as it was planned.
 *
 * Polled, and derived fresh each time: an ETA is only true for as long as the van is where it
 * was when we asked, so none of this is stored.
 */
@ApiTags("admin")
@ApiBearerAuth()
@Controller("v1/admin/dispatch/live")
@PlatformRoles("super_admin", "dispatcher")
export class AdminLiveController {
  constructor(private readonly live: LiveService) {}

  @Get()
  get(@Query(BoardQuery) q: BoardQuery) {
    return this.live.live(q.date);
  }
}

@ApiTags("admin")
@ApiBearerAuth()
@Controller("v1/admin/dispatch/plan")
@PlatformRoles("super_admin", "dispatcher")
export class AdminPlanController {
  constructor(private readonly plans: PlanService) {}

  @Get()
  plan(@Query(BoardQuery) q: BoardQuery) {
    return this.plans.plan(q.date);
  }

  @Post("apply")
  apply(@Body(ApplyDayPlanRequest) body: ApplyDayPlanRequest) {
    return this.plans.apply(body.date, body.driverIds);
  }
}

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
