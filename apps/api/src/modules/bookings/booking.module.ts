import { Module } from "@nestjs/common";
import { CatalogModule } from "../catalog/catalog.module.js";
import { WalletModule } from "../wallet/wallet.module.js";
import { SchedulingModule } from "../scheduling/scheduling.module.js";
import { BookingService } from "./booking.service.js";
import { ShipmentQueryService } from "./shipment-query.service.js";
import { ChangeRequestService } from "./change-request.service.js";
import { SavedFilterService } from "./saved-filter.service.js";
import { LiveTrackingService } from "./live-tracking.service.js";
import { WaybillService } from "./waybill.service.js";
import { ServiceBookingService } from "./service-booking.service.js";
import {
  AdminBookingsController,
  BookingsController,
  TrackingController,
} from "./booking.controller.js";
import { ServiceBookingsController } from "./service-booking.controller.js";
import {
  AccountShipmentsController,
  AdminChangeDecisionController,
  AdminShipmentsController,
} from "./shipment.controller.js";

@Module({
  imports: [CatalogModule, WalletModule, SchedulingModule],
  controllers: [
    BookingsController,
    TrackingController,
    AdminBookingsController,
    AccountShipmentsController,
    AdminShipmentsController,
    AdminChangeDecisionController,
    ServiceBookingsController,
  ],
  providers: [
    BookingService,
    ShipmentQueryService,
    ChangeRequestService,
    SavedFilterService,
    LiveTrackingService,
    WaybillService,
    ServiceBookingService,
  ],
  exports: [
    BookingService,
    ShipmentQueryService,
    ChangeRequestService,
    LiveTrackingService,
    WaybillService,
  ],
})
export class BookingModule {}
