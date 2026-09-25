import { Module } from "@nestjs/common";
import { GeoModule } from "../../infra/geo/geo.module.js";
import { AddressBookController } from "./address-book.controller.js";
import { AddressBookService } from "./address-book.service.js";

/** Saved addresses and bulk import. Needs geocoding so an imported address can be priced. */
@Module({
  imports: [GeoModule],
  controllers: [AddressBookController],
  providers: [AddressBookService],
  exports: [AddressBookService],
})
export class AddressBookModule {}
