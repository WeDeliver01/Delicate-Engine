import { Module, type OnModuleInit } from "@nestjs/common";
import { PinoLogger } from "nestjs-pino";
import { eq } from "drizzle-orm";
import { formatCents } from "@delicate/contracts";
import { accounts, drivers, shipments, type DbExecutor } from "@delicate/db";
import { ENV, type Env } from "../../config/env.js";
import { DbService } from "../../infra/db.module.js";
import { EventHandlerRegistry } from "../../worker/event-handlers.js";
import { NotificationService } from "./notification.service.js";
import { NotificationDispatcher } from "./notification.dispatcher.js";
import {
  AccountNotificationController,
  AdminNotificationController,
} from "./notification.controller.js";
import { NOTIFICATION_TRANSPORTS } from "./transports/transport.js";
import { EmailTransport } from "./transports/email.transport.js";
import { SmsTransport, WhatsAppTransport } from "./transports/sms.transport.js";

/**
 * Telling people what happened. Every handler enqueues inside its own transaction, so a message
 * cannot exist for something that rolled back, and cannot be lost because the mail host happened
 * to be down when the event arrived — the worker sends it later.
 */
@Module({
  controllers: [AccountNotificationController, AdminNotificationController],
  providers: [
    NotificationService,
    NotificationDispatcher,
    {
      provide: NOTIFICATION_TRANSPORTS,
      useFactory: (env: Env) => [
        new EmailTransport(env),
        new SmsTransport(),
        new WhatsAppTransport(),
      ],
      inject: [ENV],
    },
  ],
  exports: [NotificationService, NotificationDispatcher],
})
export class NotificationModule implements OnModuleInit {
  constructor(
    private readonly registry: EventHandlerRegistry,
    private readonly notifications: NotificationService,
    private readonly dbs: DbService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(NotificationModule.name);
  }

  async onModuleInit(): Promise<void> {
    await this.notifications.seedTemplates();

    this.registry.register("booking.confirmed", async (e) => {
      await this.dbs.transaction(async (tx) => {
        const account = await this.account(tx, e.payload.accountId);
        await this.notifications.enqueue(tx, {
          kind: "booking.confirmed",
          audience: "customer",
          to: account.email,
          accountId: e.payload.accountId,
          dedupeKey: `booking:${e.payload.bookingId}:confirmed`,
          payload: {
            customerName: account.name,
            reference: e.payload.reference,
            dropCount: `${e.payload.shipments.length} drop${e.payload.shipments.length === 1 ? "" : "s"}`,
            slot: e.payload.slotDate
              ? `${e.payload.slotDate} ${e.payload.slotWindowKey ?? ""}`.trim()
              : "today",
            waybills: e.payload.shipments.map((s) => s.waybill).join("\n"),
            total: formatCents(e.payload.totalCents),
            trackUrl: `${this.webUrl()}/portal/bookings/${e.payload.bookingId}`,
          },
        });
      });
    });

    this.registry.register("booking.rejected", async (e) => {
      await this.dbs.transaction(async (tx) => {
        const account = await this.account(tx, e.payload.accountId);
        await this.notifications.enqueue(tx, {
          kind: "booking.rejected",
          audience: "customer",
          to: account.email,
          accountId: e.payload.accountId,
          dedupeKey: `booking:${e.payload.bookingId}:rejected`,
          payload: {
            customerName: account.name,
            reason: humanise(e.payload.reason),
            nextStep:
              e.payload.reason === "insufficient_funds"
                ? "Top up your wallet and try again."
                : "Please try another slot, or get in touch and we will help.",
          },
        });
      });
    });

    this.registry.register("collection.completed", async (e) => {
      await this.dbs.transaction(async (tx) => {
        const driverName = await this.driverName(tx, e.payload.driverId);
        for (const shipmentId of e.payload.shipmentIds) {
          const ctx = await this.shipmentContext(tx, shipmentId);
          if (!ctx) continue;
          await this.notifications.enqueue(tx, {
            kind: "shipment.collected",
            audience: "customer",
            to: ctx.accountEmail,
            accountId: ctx.accountId,
            shipmentId,
            dedupeKey: `shipment:${shipmentId}:collected`,
            payload: { ...ctx.payload, driverName },
          });
          // The person waiting for a cake is the one who most needs to know it is coming.
          await this.notifications.enqueue(tx, {
            kind: "shipment.out_for_delivery",
            audience: "recipient",
            to: ctx.recipientPhone,
            accountId: ctx.accountId,
            shipmentId,
            dedupeKey: `shipment:${shipmentId}:out_for_delivery`,
            payload: { ...ctx.payload, driverName },
          });
        }
      });
    });

    this.registry.register("delivery.completed", async (e) => {
      await this.dbs.transaction(async (tx) => {
        const ctx = await this.shipmentContext(tx, e.payload.shipmentId);
        if (!ctx) return;
        const payload = {
          ...ctx.payload,
          receivedBy: e.payload.receivedBy,
          deliveredAt: new Date(e.occurredAt).toLocaleString("en-ZA"),
        };
        await this.notifications.enqueue(tx, {
          kind: "shipment.delivered",
          audience: "customer",
          to: ctx.accountEmail,
          accountId: ctx.accountId,
          shipmentId: e.payload.shipmentId,
          dedupeKey: `shipment:${e.payload.shipmentId}:delivered`,
          payload,
        });
        await this.notifications.enqueue(tx, {
          kind: "shipment.delivered",
          audience: "recipient",
          to: ctx.recipientPhone,
          accountId: ctx.accountId,
          shipmentId: e.payload.shipmentId,
          dedupeKey: `shipment:${e.payload.shipmentId}:delivered-recipient`,
          payload,
        });
      });
    });

    this.registry.register("delivery.failed", async (e) => {
      await this.dbs.transaction(async (tx) => {
        const ctx = await this.shipmentContext(tx, e.payload.shipmentId);
        if (!ctx) return;
        await this.notifications.enqueue(tx, {
          kind: "shipment.failed",
          audience: "customer",
          to: ctx.accountEmail,
          accountId: ctx.accountId,
          shipmentId: e.payload.shipmentId,
          dedupeKey: `shipment:${e.payload.shipmentId}:failed`,
          payload: {
            ...ctx.payload,
            reason: humanise(e.payload.reason),
            nextStep: "We will be in touch to arrange another attempt.",
          },
        });
      });
    });

    this.registry.register("wallet.topup_confirmed", async (e) => {
      await this.dbs.transaction(async (tx) => {
        const account = await this.account(tx, e.payload.accountId);
        await this.notifications.enqueue(tx, {
          kind: "wallet.topped_up",
          audience: "customer",
          to: account.email,
          accountId: e.payload.accountId,
          dedupeKey: `topup:${e.payload.topUpId}:confirmed`,
          payload: {
            customerName: account.name,
            amount: formatCents(e.payload.amountCents),
            balance: formatCents(e.payload.balanceAfterCents),
          },
        });

        // Warn while there is still time to do something about it.
        const prefs = await this.notifications.preferencesFor(tx, e.payload.accountId);
        if (e.payload.balanceAfterCents < prefs.lowBalanceCents) {
          await this.notifications.enqueue(tx, {
            kind: "wallet.low_balance",
            audience: "customer",
            to: account.email,
            accountId: e.payload.accountId,
            dedupeKey: `wallet:${e.payload.accountId}:low:${e.payload.topUpId}`,
            payload: {
              customerName: account.name,
              balance: formatCents(e.payload.balanceAfterCents),
              portalUrl: `${this.webUrl()}/portal/wallet`,
            },
          });
        }
      });
    });

    this.logger.info("notification handlers registered");
  }

  private async account(tx: DbExecutor, accountId: string) {
    const row = await tx.query.accounts.findFirst({ where: eq(accounts.id, accountId) });
    return { name: row?.name ?? "there", email: row?.billingEmail ?? null };
  }

  private async driverName(tx: DbExecutor, driverId: string): Promise<string> {
    const row = await tx.query.drivers.findFirst({ where: eq(drivers.id, driverId) });
    return row?.fullName ?? "Your driver";
  }

  /** Everything a shipment template needs, or null if the shipment has gone. */
  private async shipmentContext(tx: DbExecutor, shipmentId: string) {
    const shipment = await tx.query.shipments.findFirst({ where: eq(shipments.id, shipmentId) });
    if (!shipment) return null;
    const account = await this.account(tx, shipment.accountId);
    const address = shipment.deliveryAddress as { suburb?: string | null; city?: string | null };
    const recipient = shipment.recipient as { name?: string; phone?: string };
    return {
      accountId: shipment.accountId,
      accountEmail: account.email,
      recipientPhone: recipient.phone ?? null,
      payload: {
        customerName: account.name,
        recipientName: recipient.name ?? "there",
        waybill: shipment.waybill,
        destination: address.suburb ?? address.city ?? "the destination",
        trackUrl: `${this.webUrl()}/track?waybill=${shipment.waybill}`,
      },
    };
  }

  private webUrl(): string {
    return process.env["WEB_PUBLIC_URL"] ?? "http://localhost:3000";
  }
}

/** Turn an internal reason code into something a customer can read. */
function humanise(reason: string): string {
  return reason.replace(/_/g, " ");
}
