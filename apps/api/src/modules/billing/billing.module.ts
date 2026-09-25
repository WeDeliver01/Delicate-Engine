import { Module, type OnModuleInit } from "@nestjs/common";
import { PinoLogger } from "nestjs-pino";
import { WalletModule } from "../wallet/wallet.module.js";
import { NotificationModule } from "../notifications/notification.module.js";
import { EventHandlerRegistry } from "../../worker/event-handlers.js";
import { AccountBillingController, AdminBillingController } from "./billing.controller.js";
import { InvoiceService } from "./invoice.service.js";
import { NotificationService } from "../notifications/notification.service.js";
import { DbService } from "../../infra/db.module.js";
import { formatCents } from "@delicate/contracts";

/**
 * Billing documents. Invoicing sits behind the outbox like treasury: a document must never be
 * able to fail a delivery, and a redelivered `booking.charged` is harmless because the invoice
 * is keyed on the booking.
 */
@Module({
  imports: [WalletModule, NotificationModule],
  controllers: [AccountBillingController, AdminBillingController],
  providers: [InvoiceService],
  exports: [InvoiceService],
})
export class BillingModule implements OnModuleInit {
  constructor(
    private readonly registry: EventHandlerRegistry,
    private readonly invoices: InvoiceService,
    private readonly notifications: NotificationService,
    private readonly dbs: DbService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(BillingModule.name);
  }

  onModuleInit(): void {
    this.registry.register("booking.charged", async (e) => {
      const invoice = await this.invoices.issueForBooking(e.payload.bookingId);
      this.logger.info(
        { bookingId: e.payload.bookingId, number: invoice?.number ?? null },
        invoice ? "invoice issued" : "postpaid account; billed monthly",
      );
      if (!invoice) return;
      // Separate transaction from issuing: if this fails the outbox retries the handler, and
      // `issueForBooking` returns the existing invoice, so the message is enqueued exactly once.
      await this.dbs.transaction((tx) =>
        this.notifications.enqueue(tx, {
          kind: "invoice.issued",
          audience: "customer",
          to: invoice.billTo.email,
          accountId: invoice.accountId,
          dedupeKey: `invoice:${invoice.id}:issued`,
          payload: {
            customerName: invoice.billTo.legalName ?? invoice.billTo.accountName,
            documentTitle: invoice.kind === "tax_invoice" ? "Tax invoice" : "Invoice",
            number: invoice.number,
            total: formatCents(invoice.totalCents),
            dueLine: invoice.dueAt
              ? `Payment is due by ${new Date(invoice.dueAt).toLocaleDateString("en-ZA")}.`
              : "It has already been paid from your wallet — nothing further is needed.",
            portalUrl: `${process.env["WEB_PUBLIC_URL"] ?? "http://localhost:3000"}/portal/invoices`,
          },
        }),
      );
    });
  }
}
