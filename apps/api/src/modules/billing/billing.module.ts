import { Module, type OnModuleInit } from "@nestjs/common";
import { PinoLogger } from "nestjs-pino";
import { WalletModule } from "../wallet/wallet.module.js";
import { EventHandlerRegistry } from "../../worker/event-handlers.js";
import { AccountBillingController, AdminBillingController } from "./billing.controller.js";
import { InvoiceService } from "./invoice.service.js";

/**
 * Billing documents. Invoicing sits behind the outbox like treasury: a document must never be
 * able to fail a delivery, and a redelivered `booking.charged` is harmless because the invoice
 * is keyed on the booking.
 */
@Module({
  imports: [WalletModule],
  controllers: [AccountBillingController, AdminBillingController],
  providers: [InvoiceService],
  exports: [InvoiceService],
})
export class BillingModule implements OnModuleInit {
  constructor(
    private readonly registry: EventHandlerRegistry,
    private readonly invoices: InvoiceService,
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
    });
  }
}
