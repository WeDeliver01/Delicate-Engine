import { Module, type OnModuleInit } from "@nestjs/common";
import { PinoLogger } from "nestjs-pino";
import { BookingModule } from "../bookings/booking.module.js";
import { WalletModule } from "../wallet/wallet.module.js";
import { FleetService } from "./fleet.service.js";
import { DriverGuard } from "./driver.guard.js";
import { DriverController, FilesController } from "./driver.controller.js";
import {
  AdminDispatchController,
  AdminFleetController,
  AdminLedgerController,
} from "./admin-fleet.controller.js";
import { AssignmentService } from "../dispatch/assignment.service.js";
import { SettlementService } from "../dispatch/settlement.service.js";
import { DispatchService } from "../dispatch/dispatch.service.js";
import { EventHandlerRegistry } from "../../worker/event-handlers.js";

/** Fleet + dispatch + settlement live together: they share the driver/assignment model. */
@Module({
  imports: [BookingModule, WalletModule],
  controllers: [
    DriverController,
    FilesController,
    AdminFleetController,
    AdminDispatchController,
    AdminLedgerController,
  ],
  providers: [FleetService, DriverGuard, AssignmentService, SettlementService, DispatchService],
  exports: [FleetService, AssignmentService, SettlementService, DispatchService],
})
export class FleetModule implements OnModuleInit {
  constructor(
    private readonly registry: EventHandlerRegistry,
    private readonly assignment: AssignmentService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(FleetModule.name);
  }

  onModuleInit(): void {
    // Auto-assign every shipment of a confirmed booking. Idempotent: an already-assigned
    // shipment is left alone, so redelivery of the event is harmless.
    this.registry.register("booking.confirmed", async (e) => {
      for (const s of e.payload.shipments) {
        const a = await this.assignment.autoAssign(s.shipmentId);
        this.logger.info(
          { waybill: s.waybill, driverId: a?.driverId ?? null },
          a ? "auto-assigned" : "awaiting dispatcher",
        );
      }
    });
  }
}
