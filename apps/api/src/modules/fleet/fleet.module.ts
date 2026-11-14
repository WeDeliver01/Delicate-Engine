import { Module, type OnModuleInit } from "@nestjs/common";
import { PinoLogger } from "nestjs-pino";
import { eq } from "drizzle-orm";
import { SHIPMENT_STATUS_LABELS } from "@delicate/contracts";
import { shipments } from "@delicate/db";
import { BookingModule } from "../bookings/booking.module.js";
import { WalletModule } from "../wallet/wallet.module.js";
import { NotificationModule } from "../notifications/notification.module.js";
import { FleetService } from "./fleet.service.js";
import { DriverNotifyService } from "./driver-notify.service.js";
import { DriverPushService } from "./driver-push.service.js";
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
    DriverPushService,
  ],
  exports: [FleetService, AssignmentService, SettlementService, DispatchService, DriverPushService],
})
export class FleetModule implements OnModuleInit {
  constructor(
    private readonly registry: EventHandlerRegistry,
    private readonly assignment: AssignmentService,
    private readonly settlement: SettlementService,
    private readonly wallet: WalletService,
    private readonly push: DriverPushService,
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

    /*
      Wake the driver's phone when their day changes.

      The app polls, and polling is what makes the list right; the push is what makes the
      driver look at it. Each of these is best effort: a push that does not arrive costs a
      glance at the screen, and a push that arrives twice (the outbox is at-least-once) costs
      a second buzz. Neither is worth a dedupe table. Nothing here moves money.
    */
    this.registry.register("shipment.assigned", async (e) => {
      const where = await this.whereTo(e.payload.shipmentId);
      await this.push.notify(e.payload.driverId, {
        title: "New job",
        body: `${e.payload.waybill}${where ? ` · ${where}` : ""}`,
        data: { kind: "assigned", shipmentId: e.payload.shipmentId },
      });
      if (e.payload.previousDriverId && e.payload.previousDriverId !== e.payload.driverId) {
        await this.push.notify(e.payload.previousDriverId, {
          title: "Job moved",
          body: `${e.payload.waybill} has been given to another driver.`,
          data: { kind: "unassigned", shipmentId: e.payload.shipmentId },
        });
      }
    });

    this.registry.register("shipment.unassigned", async (e) => {
      await this.push.notify(e.payload.driverId, {
        title: "Job removed",
        body: `${e.payload.waybill} is no longer on your list.`,
        data: { kind: "unassigned", shipmentId: e.payload.shipmentId },
      });
    });

    // A correction the customer made after the driver was assigned: the address they read at
    // the depot may be the wrong one now.
    this.registry.register("shipment.change_decided", async (e) => {
      if (!e.payload.approved) return;
      const a = await this.assignment.activeAssignment(e.payload.shipmentId);
      if (!a) return;
      await this.push.notify(a.driverId, {
        title: "Details changed",
        body: `${e.payload.waybill}: ${e.payload.kind.replace(/_/g, " ")} updated. Check before you set off.`,
        data: { kind: "changed", shipmentId: e.payload.shipmentId },
      });
    });

    // Cancelled under the driver: the job leaves their list, and they should hear why rather
    // than wonder where it went.
    this.registry.register("shipment.status_changed", async (e) => {
      if (e.payload.to !== "cancelled" && e.payload.to !== "returned_to_sender") return;
      const a = await this.assignment.activeAssignment(e.payload.shipmentId);
      if (!a) return;
      await this.push.notify(a.driverId, {
        title: SHIPMENT_STATUS_LABELS[e.payload.to],
        body: `${e.payload.waybill} has been ${e.payload.to === "cancelled" ? "cancelled" : "returned to the sender"}. It is off your list.`,
        data: { kind: "unassigned", shipmentId: e.payload.shipmentId },
      });
    });
  }

  /** "to Hatfield", for the one line a lock screen shows. */
  private async whereTo(shipmentId: string): Promise<string | null> {
    const s = await this.dbs.db.query.shipments.findFirst({ where: eq(shipments.id, shipmentId) });
    const address = s?.deliveryAddress as { suburb?: string | null; city?: string | null } | null;
    const place = address?.suburb ?? address?.city ?? null;
    const when = s?.slotDate ? ` · ${s.slotDate}` : "";
    return place ? `to ${place}${when}` : when || null;
  }
}
