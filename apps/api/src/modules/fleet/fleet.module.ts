import { Module, type OnModuleInit } from "@nestjs/common";
import { PinoLogger } from "nestjs-pino";
import { BookingModule } from "../bookings/booking.module.js";
import { WalletModule } from "../wallet/wallet.module.js";
import { NotificationModule } from "../notifications/notification.module.js";
import { FleetService } from "./fleet.service.js";
import { DriverNotifyService } from "./driver-notify.service.js";
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
import { DbService } from "../../infra/db.module.js";
import { WalletService } from "../wallet/wallet.service.js";

/** Fleet + dispatch + settlement live together: they share the driver/assignment model. */
@Module({
  imports: [BookingModule, WalletModule, NotificationModule],
  controllers: [
    DriverController,
    FilesController,
    AdminFleetController,
    AdminDispatchController,
    AdminLedgerController,
  ],
  providers: [
    FleetService,
    DriverGuard,
    AssignmentService,
    SettlementService,
    DispatchService,
    DriverNotifyService,
  ],
  exports: [FleetService, AssignmentService, SettlementService, DispatchService],
})
export class FleetModule implements OnModuleInit {
  constructor(
    private readonly registry: EventHandlerRegistry,
    private readonly assignment: AssignmentService,
    private readonly settlement: SettlementService,
    private readonly wallet: WalletService,
    private readonly dbs: DbService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(FleetModule.name);
  }

  onModuleInit(): void {
    // Auto-assign every shipment of a confirmed booking. Idempotent: an already-assigned
    // shipment is left alone, so redelivery of the event is harmless.
    /*
      Move the money the moment the booking is paid for.

      Separate from auto-assign on purpose: a booking five months out has no driver to assign
      and that must not stop the cash it brought in from being recognised and earmarked today.
      Idempotent -- `presettle` returns the existing row rather than posting twice.
    */
    this.registry.register("booking.confirmed", async (e) => {
      await this.dbs.transaction(async (tx) => {
        for (const s of e.payload.shipments) {
          await this.settlement.presettle(tx, { shipmentId: s.shipmentId });
        }
      });
      this.logger.info(
        { bookingId: e.payload.bookingId, drops: e.payload.shipments.length },
        "pre-settled at booking",
      );
    });

    /*
      A cancelled shipment gives its money back.

      Recognising revenue at booking means a cancellation has to undo the journals and return
      the cash, or the books keep income for a van that never left. Idempotent: `reverse` is a
      no-op once a shipment has been reversed or delivered.
    */
    this.registry.register("shipment.status_changed", async (e) => {
      if (e.payload.to !== "cancelled") return;
      await this.dbs.transaction(async (tx) => {
        const before = await this.settlement.forShipment(e.payload.shipmentId);
        if (!before || before.settledAt || before.reversedAt) return;
        await this.settlement.reverse(tx, e.payload.shipmentId, e.payload.note ?? "cancelled");
        const refund = before.revenueCents + before.vatCents;
        if (refund > 0) {
          await this.wallet.adjust(e.payload.accountId, refund, `Cancelled ${e.payload.waybill}`);
        }
      });
    });

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
