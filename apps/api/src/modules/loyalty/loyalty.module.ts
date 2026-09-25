import { Module, type OnModuleInit } from "@nestjs/common";
import { PinoLogger } from "nestjs-pino";
import { WalletModule } from "../wallet/wallet.module.js";
import { EventHandlerRegistry } from "../../worker/event-handlers.js";
import { AccountLoyaltyController, AdminLoyaltyController } from "./loyalty.controller.js";
import { LoyaltyService } from "./loyalty.service.js";

/**
 * Cashback is earned on money actually taken, so it hangs off `booking.charged` rather than
 * `booking.confirmed` — rewarding a booking that is later cancelled would be a way to mint money.
 */
@Module({
  imports: [WalletModule],
  controllers: [AccountLoyaltyController, AdminLoyaltyController],
  providers: [LoyaltyService],
  exports: [LoyaltyService],
})
export class LoyaltyModule implements OnModuleInit {
  constructor(
    private readonly registry: EventHandlerRegistry,
    private readonly loyalty: LoyaltyService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(LoyaltyModule.name);
  }

  onModuleInit(): void {
    this.registry.register("booking.charged", async (e) => {
      const award = await this.loyalty.awardForBooking(e.payload.bookingId);
      if (award) {
        this.logger.info(
          { bookingId: e.payload.bookingId, tier: award.tierCode, amountCents: award.amountCents },
          "cashback awarded",
        );
      }
    });
  }
}
