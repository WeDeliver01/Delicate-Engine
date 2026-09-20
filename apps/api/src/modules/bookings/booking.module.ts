import { Module } from "@nestjs/common";
import { CatalogModule } from "../catalog/catalog.module.js";
import { WalletModule } from "../wallet/wallet.module.js";
import { SchedulingModule } from "../scheduling/scheduling.module.js";
import { BookingService } from "./booking.service.js";
import {
  AdminBookingsController,
  BookingsController,
  TrackingController,
} from "./booking.controller.js";

@Module({
  imports: [CatalogModule, WalletModule, SchedulingModule],
  controllers: [BookingsController, TrackingController, AdminBookingsController],
  providers: [BookingService],
  exports: [BookingService],
})
export class BookingModule {}
