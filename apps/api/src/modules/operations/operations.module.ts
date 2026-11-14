import { Module, type OnModuleInit } from "@nestjs/common";
import { PinoLogger } from "nestjs-pino";
import { FleetModule } from "../fleet/fleet.module.js";
import { DriverGuard } from "../fleet/driver.guard.js";
import { SchedulingModule } from "../scheduling/scheduling.module.js";
import { EventHandlerRegistry } from "../../worker/event-handlers.js";
import { TripPlanRegistry } from "../../infra/trip-plan.registry.js";
import { TripService } from "./trip.service.js";
import { BoardService } from "./board.service.js";
import { PlanService } from "./plan.service.js";
import { LiveService } from "./live.service.js";
import { RiskService } from "./risk.service.js";
import { RiskDispatcher } from "./risk.dispatcher.js";
import {
  AdminBoardController,
  AdminLiveController,
  AdminPlanController,
  AdminTripController,
  AdminTripStopController,
  DriverTripController,
} from "./operations.controller.js";

/**
 * Operations: the dispatch layer.
 *
 * Trip stops close in reaction to what the driver actually did, delivered as events rather than
 * by dispatch calling into this module. Two reasons: it keeps the dependency one-way (operations
 * knows about fleet, not the reverse), and the driver's action and the money it settles stay in
 * one transaction with nothing operational wedged into it. The handlers are idempotent because
 * delivery is at-least-once.
 */
@Module({
  imports: [FleetModule, SchedulingModule],
  controllers: [
    AdminBoardController,
    AdminLiveController,
    AdminPlanController,
    AdminTripController,
    AdminTripStopController,
    DriverTripController,
  ],
  providers: [
    TripService,
    BoardService,
    PlanService,
    LiveService,
    RiskService,
    RiskDispatcher,
    DriverGuard,
  ],
  exports: [TripService, BoardService, PlanService, LiveService, RiskService, RiskDispatcher],
})
export class OperationsModule implements OnModuleInit {
  constructor(
    private readonly registry: EventHandlerRegistry,
    private readonly plans: TripPlanRegistry,
    private readonly trips: TripService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(OperationsModule.name);
  }

  onModuleInit(): void {
    // Dispatch asks for the driver's planned day through this rather than importing operations,
    // which would be a cycle: operations already needs fleet for drivers and shifts.
    this.plans.register((driverId, date) => this.trips.forDriver(driverId, date));

    /*
      An assigned shipment lands on its driver's day by itself.

      The board, the live map and the trip sheet all read `trip_stops`; a shipment assigned by
      the engine (auto-assign to the main driver, say) but placed on no trip was invisible to
      every one of them, and the driver app had to invent its own order for it. Now assignment
      is enough: the engine makes a trip for that driver and day if there is none, puts the stop
      on it and releases it. A trip a dispatcher is still drafting is respected — the stop joins
      the draft and waits for them to release it. Idempotent: a shipment already on one of this
      driver's live trips is left exactly where the dispatcher put it.
    */
    this.registry.register("shipment.assigned", async (e) => {
      const tripId = await this.trips.placeOnDay(e.payload.shipmentId, e.payload.driverId);
      this.logger.info(
        { waybill: e.payload.waybill, driverId: e.payload.driverId, tripId },
        tripId ? "placed on the driver's day" : "already placed",
      );
    });

    this.registry.register("shipment.unassigned", async (e) => {
      await this.trips.removeShipment(e.payload.shipmentId, e.payload.reason);
    });

    // Cancelled or sent back: the stop is not going to be driven to, and a pending stop on a
    // started trip would hold the trip open for ever.
    this.registry.register("shipment.status_changed", async (e) => {
      if (e.payload.to !== "cancelled" && e.payload.to !== "returned_to_sender") return;
      await this.trips.closeStopsForShipment(e.payload.shipmentId, "skipped");
    });

    this.registry.register("collection.completed", async (e) => {
      await this.trips.closeCollection(e.payload.bookingId, e.payload.driverId);
    });

    this.registry.register("delivery.completed", async (e) => {
      await this.trips.closeStopsForShipment(e.payload.shipmentId, "done");
    });

    // A failed drop closes its stop as skipped: the driver is not going back there today, and
    // the shipment's own status carries what went wrong.
    this.registry.register("delivery.failed", async (e) => {
      await this.trips.closeStopsForShipment(e.payload.shipmentId, "skipped");
    });
  }
}
