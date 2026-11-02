import { Module } from "@nestjs/common";
import { AdminRatesController } from "./rates.controller.js";
import { RatesService } from "./rates.service.js";

/**
 * Rates owns which numbers price a booking: the house cards, the groups of accounts on their
 * own deal, and the cards written for one customer. The catalog reads the answer through
 * `RatesService.rateCardFor` rather than looking at the tables itself, so there is one place
 * where the ordering between an account's card, its group's card and the default is decided.
 */
@Module({
  controllers: [AdminRatesController],
  providers: [RatesService],
  exports: [RatesService],
})
export class RatesModule {}
