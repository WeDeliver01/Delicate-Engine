import { Controller, Get, Post } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import {
  CancelBookingRequest,
  QuoteRequest,
  ServiceBookingRequest,
  Uuid,
} from "@delicate/contracts";
import { ActiveAccountId, Scopes } from "../../auth/decorators.js";
import { AppError } from "../../common/errors.js";
import { Body, Params, Query } from "../../common/zod.js";
import { QuoteService } from "../catalog/quote.service.js";
import { BookingService } from "./booking.service.js";
import { WaybillService } from "./waybill.service.js";
import { ServiceBookingService } from "./service-booking.service.js";

const IdParam = z.object({ id: Uuid });
const ReferenceQuery = z.object({ customerReference: z.string().trim().min(1).max(60) });

/**
 * The surface another system books through.
 *
 * Deliberately separate from `/v1/account/*` rather than bolted onto it. The two have
 * different callers, different failure modes and different guarantees — a person recovers
 * from an error by reading it, a job recovers by retrying — and putting a machine's needs
 * into endpoints a portal depends on is how both end up compromised.
 *
 * Every route names its scopes; a credential without them never reaches the handler. The
 * account comes from `X-Account-Id`, or `X-Account-Ref` carrying the caller's own id for it.
 *
 * A person's token is also accepted here, with the authority their membership already gives
 * them on that account — these endpoints are *for* machines, but refusing people would mean
 * the integration could not be exercised with a dev token.
 */
@ApiTags("service")
@ApiBearerAuth()
@Controller("v1/service")
export class ServiceBookingsController {
  constructor(
    private readonly adapter: ServiceBookingService,
    private readonly bookings: BookingService,
    private readonly quotes: QuoteService,
    private readonly waybills: WaybillService,
  ) {}

  /** Price without booking, for a checkout that wants to show a number. */
  @Post("quotes")
  @Scopes("quotes:write")
  quote(@ActiveAccountId() accountId: string, @Body(QuoteRequest) body: QuoteRequest) {
    return this.quotes.create(accountId, { ...body, accountId });
  }

  @Post("bookings")
  @Scopes("bookings:write")
  book(
    @ActiveAccountId() accountId: string,
    @Body(ServiceBookingRequest) body: ServiceBookingRequest,
  ) {
    return this.adapter.book(accountId, body);
  }

  /**
   * Find a booking by the caller's own reference.
   *
   * This is what closes the window between a successful booking and the caller recording it:
   * if that process died in between, it asks here rather than booking the order twice.
   */
  @Get("bookings/by-customer-reference")
  @Scopes("bookings:read")
  async byReference(
    @ActiveAccountId() accountId: string,
    @Query(ReferenceQuery) q: { customerReference: string },
  ) {
    const booking = await this.bookings.findByCustomerReference(accountId, q.customerReference);
    if (!booking) throw AppError.notFound("booking");
    return booking;
  }

  @Get("bookings/:id")
  @Scopes("bookings:read")
  get(@ActiveAccountId() accountId: string, @Params(IdParam) p: { id: string }) {
    return this.bookings.get(p.id, accountId);
  }

  @Post("bookings/:id/cancel")
  @Scopes("bookings:cancel")
  cancel(
    @ActiveAccountId() accountId: string,
    @Params(IdParam) p: { id: string },
    @Body(CancelBookingRequest) body: { reason: string },
  ) {
    return this.bookings.cancel(p.id, accountId, body.reason);
  }

  @Get("shipments/:id")
  @Scopes("shipments:read")
  shipment(@ActiveAccountId() accountId: string, @Params(IdParam) p: { id: string }) {
    return this.bookings.getShipment(p.id, accountId);
  }

  /**
   * The waybill, as data rather than a rendered page.
   *
   * The caller already prints labels its own way and for its own stock, so handing it the
   * fields and the waybill number is more useful than handing it our layout — and it does not
   * freeze our label design into somebody else's integration.
   */
  @Get("shipments/:id/waybill")
  @Scopes("labels:read")
  waybill(@ActiveAccountId() accountId: string, @Params(IdParam) p: { id: string }) {
    return this.waybills.forShipment(p.id, accountId);
  }
}
