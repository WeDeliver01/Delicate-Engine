import { Module } from "@nestjs/common";
import { TreasuryModule } from "../treasury/treasury.module.js";
import { AdminPaymentsController } from "./payments.controller.js";
import { PaymentsService } from "./payments.service.js";
import { PayCentralAdapter } from "./paycentral.adapter.js";

/** Money leaving the business. Depends on treasury so a vendor bill draws its wallet down. */
@Module({
  imports: [TreasuryModule],
  controllers: [AdminPaymentsController],
  providers: [PaymentsService, PayCentralAdapter],
  exports: [PaymentsService],
})
export class PaymentsModule {}
