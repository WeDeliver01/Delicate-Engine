import { Module, type OnModuleInit } from "@nestjs/common";
import { PinoLogger } from "nestjs-pino";
import { FleetModule } from "../fleet/fleet.module.js";
import { DriverGuard } from "../fleet/driver.guard.js";
import { SchedulingModule } from "../scheduling/scheduling.module.js";
import { EventHandlerRegistry } from "../../worker/event-handlers.js";
import { TripPlanRegistry } from "../../infra/trip-plan.registry.js";
import { TripService } from "./trip.service.js";
import { BoardService } from "./board.service.js";
import {
  AdminBoardController,
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
    AdminTripController,
    AdminTripStopController,
    DriverTripController,
  ],
  providers: [TripService, BoardService, DriverGuard],
  exports: [TripService, BoardService],
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
