import { Module, type OnModuleInit } from "@nestjs/common";
import { EventHandlerRegistry } from "../../worker/event-handlers.js";
import { ServiceAccessService } from "./service-access.service.js";
import { WebhookSender } from "./webhook-sender.service.js";
import {
  AdminAccountExternalRefsController,
  AdminServiceClientsController,
  AdminWebhookSubscriptionsController,
} from "./service-access.controller.js";

/**
 * How another system gets in, which accounts it may act for, and how it is told what happened.
 *
 * Issuing is a super_admin action; the verifier that checks a credential on each request lives
 * in `auth/`, because the guard needs it before any module has run.
 */
@Module({
  controllers: [
    AdminServiceClientsController,
    AdminAccountExternalRefsController,
    AdminWebhookSubscriptionsController,
  ],
  providers: [ServiceAccessService, WebhookSender],
  exports: [ServiceAccessService, WebhookSender],
})
export class ServiceAccessModule implements OnModuleInit {
  constructor(
    private readonly registry: EventHandlerRegistry,
    private readonly sender: WebhookSender,
  ) {}

  onModuleInit(): void {
    /**
     * A shipment moved, and whoever booked it is told.
     *
     * This is the half that closes the loop. A merchant's system books a delivery and then has
     * no way of learning that it happened — the parcel is collected, delivered and signed for
     * while their order sits where it was. Their customer finds out before they do.
     *
     * Throwing on a partial failure is deliberate: the outbox dispatcher brings the message
     * back with backoff, and a receiver that already succeeded discards the repeat by delivery
     * id. Duplicate deliveries are the price of never silently dropping one, and that is the
     * right way round for something a merchant's order status depends on.
     */
    this.registry.register("shipment.status_changed", async (e) => {
      const { delivered, failed } = await this.sender.deliver({
        type: "shipment.status_changed",
        occurredAt: new Date(e.occurredAt),
        accountId: e.payload.accountId,
        data: {
          shipmentId: e.payload.shipmentId,
          bookingId: e.payload.bookingId,
          waybill: e.payload.waybill,
          from: e.payload.from,
          to: e.payload.to,
          note: e.payload.note,
        },
      });
      if (failed > 0) {
        throw new Error(
          `${failed} webhook subscription(s) failed for shipment.status_changed ` +
            `(${delivered} delivered); the dispatcher will try again`,
        );
      }
    });
  }
}
