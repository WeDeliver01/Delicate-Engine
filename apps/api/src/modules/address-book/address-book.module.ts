import { Module, type OnModuleInit } from "@nestjs/common";
import { PinoLogger } from "nestjs-pino";
import { GeoModule } from "../../infra/geo/geo.module.js";
import { EventHandlerRegistry } from "../../worker/event-handlers.js";
import { AddressBookController } from "./address-book.controller.js";
import { AdminAddressBookController } from "./admin-address-book.controller.js";
import { AddressBookService } from "./address-book.service.js";

/**
 * Saved addresses and bulk import. Needs geocoding so an imported address can be priced.
 *
 * It also learns. A confirmed booking tells us where this account collects from, and the
 * booking form reads that back the next time -- which is the difference between an address
 * book that fills itself and the empty one every account had, because nothing ever wrote to
 * it unless somebody went and typed their own kitchen in by hand.
 *
 * Hung off `booking.confirmed` rather than done inside the booking: remembering an address is
 * a convenience, and a convenience must never be able to fail the booking it came from.
 */
@Module({
  imports: [GeoModule],
  controllers: [AddressBookController, AdminAddressBookController],
  providers: [AddressBookService],
  exports: [AddressBookService],
})
export class AddressBookModule implements OnModuleInit {
  constructor(
    private readonly registry: EventHandlerRegistry,
    private readonly addresses: AddressBookService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(AddressBookModule.name);
  }

  onModuleInit(): void {
    this.registry.register("booking.confirmed", async (e) => {
      await this.addresses.rememberFromBooking(e.payload.bookingId);
    });
  }
}
