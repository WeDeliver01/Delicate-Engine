import { Controller, Get, Post } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import {
  BookingStatus,
  CancelBookingRequest,
  CreateBookingRequest,
  IsoDate,
  Pagination,
  ShipmentStatus,
  UpdateShipmentStatusRequest,
  Uuid,
} from "@delicate/contracts";
import { ActiveAccountId, PlatformRoles, Public, RequireAccount } from "../../auth/decorators.js";
import { Body, Params, Query } from "../../common/zod.js";
import { BookingService } from "./booking.service.js";

const IdParam = z.object({ id: Uuid });
const BookingListQuery = Pagination.extend({ status: BookingStatus.optional() });
const ShipmentListQuery = Pagination.extend({
  status: ShipmentStatus.optional(),
  slotDate: IsoDate.optional(),
});

@ApiTags("bookings")
@ApiBearerAuth()
@Controller("v1/account")
@RequireAccount()
export class BookingsController {
  constructor(private readonly svc: BookingService) {}

  @Post("bookings")
  create(
    @ActiveAccountId() accountId: string,
    @Body(CreateBookingRequest) body: CreateBookingRequest,
  ) {
    return this.svc.create(accountId, body);
  }

  @Get("bookings")
  list(
    @ActiveAccountId() accountId: string,
    @Query(BookingListQuery) q: z.infer<typeof BookingListQuery>,
  ) {
    return this.svc.list(accountId, q);
  }

  @Get("bookings/:id")
  get(@ActiveAccountId() accountId: string, @Params(IdParam) p: { id: string }) {
    return this.svc.get(p.id, accountId);
  }

  @Post("bookings/:id/cancel")
  cancel(
    @ActiveAccountId() accountId: string,
    @Params(IdParam) p: { id: string },
    @Body(CancelBookingRequest) body: { reason: string },
  ) {
    return this.svc.cancel(p.id, accountId, body.reason);
  }

  @Get("shipments")
  shipments(
    @ActiveAccountId() accountId: string,
    @Query(ShipmentListQuery) q: z.infer<typeof ShipmentListQuery>,
  ) {
    return this.svc.listShipments(accountId, q);
  }

  @Get("shipments/:id")
  shipment(@ActiveAccountId() accountId: string, @Params(IdParam) p: { id: string }) {
    return this.svc.getShipment(p.id, accountId);
  }
}

@ApiTags("tracking")
@Controller("v1/public/track")
export class TrackingController {
  constructor(private readonly svc: BookingService) {}

  @Public()
  @Get(":waybill")
  track(@Params(z.object({ waybill: z.string().min(6).max(40) })) p: { waybill: string }) {
    return this.svc.track(p.waybill);
  }
}

@ApiTags("admin")
@ApiBearerAuth()
@Controller("v1/admin")
@PlatformRoles("super_admin", "dispatcher", "finance")
export class AdminBookingsController {
  constructor(private readonly svc: BookingService) {}

  @Get("bookings")
  bookings(@Query(BookingListQuery) q: z.infer<typeof BookingListQuery>) {
    return this.svc.list(null, q);
  }

  @Get("bookings/:id")
  booking(@Params(IdParam) p: { id: string }) {
    return this.svc.get(p.id, null);
  }

  @Post("bookings/:id/cancel")
  @PlatformRoles("super_admin", "dispatcher")
  cancel(@Params(IdParam) p: { id: string }, @Body(CancelBookingRequest) body: { reason: string }) {
    return this.svc.cancel(p.id, null, body.reason);
  }

  @Get("shipments")
  shipments(@Query(ShipmentListQuery) q: z.infer<typeof ShipmentListQuery>) {
    return this.svc.listShipments(null, q);
  }

  @Get("shipments/:id")
  shipment(@Params(IdParam) p: { id: string }) {
    return this.svc.getShipment(p.id, null);
  }
}
