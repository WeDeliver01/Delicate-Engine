import { Injectable } from "@nestjs/common";
import { PinoLogger } from "nestjs-pino";
import type {
  Booking,
  Quote,
  QuoteRequest,
  ServiceBookingRequest,
  ServiceBookingResponse,
} from "@delicate/contracts";
import { AppError } from "../../common/errors.js";
import { Clock } from "../../infra/clock.js";
import { QuoteService } from "../catalog/quote.service.js";
import { BookingService } from "./booking.service.js";

/**
 * Booking in one call, for a system rather than a person.
 *
 * The portal quotes, shows the customer a price, and books that quote. A checkout has already
 * done the showing, so it sends the whole job at once. This still produces a real persisted
 * quote — the price stays explainable and the booking is backed by the same evidence a human
 * booking is — it just does both halves inside one request.
 *
 * The caller may also send the quote it showed its customer, to be charged that price. Either
 * way the hard part is not the two calls — it is that the caller retries. The job behind this
 * endpoint retries for about a day, and a quote is single-use and expires in one, so almost
 * every retry meets a quote that is gone. The two ways it can be gone mean opposite things:
 *
 *   - consumed  → a booking for it exists. That is success, arriving late. Return it.
 *   - expired   → nothing was booked and the price may have moved. Price it again.
 *
 * Ahead of both sits the caller's idempotency key, which is what actually makes a retry safe:
 * it belongs to the caller's order rather than to any quote, so it survives re-pricing, and
 * the unique index on (account, key) is what stops two attempts becoming two bookings.
 */
@Injectable()
export class ServiceBookingService {
  constructor(
    private readonly quotes: QuoteService,
    private readonly bookings: BookingService,
    private readonly clock: Clock,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(ServiceBookingService.name);
  }

  async book(accountId: string, input: ServiceBookingRequest): Promise<ServiceBookingResponse> {
    // Before anything else, and before a routing call we would pay for and discard: has this
    // order already been booked? A day of retries makes this the common path, not the edge.
    const already = await this.bookings.findByIdempotencyKey(accountId, input.idempotencyKey);
    if (already) {
      const quote = await this.quotes.get(already.quoteId, accountId);
      return { booking: already, quote, replayed: true };
    }

    const request = toQuoteRequest(accountId, input);
    let quote = await this.priceable(accountId, request, input);
    this.assertWithinLimit(quote, input.maxTotalCents);

    try {
      const booking = await this.create(accountId, quote, input);
      return { booking, quote, replayed: false };
    } catch (err) {
      if (!(err instanceof AppError)) throw err;

      // Consumed between our two calls: another attempt of this same order won the race.
      // Its booking is the answer to this request.
      if (err.code === "quote_used") {
        const existing = await this.resolveConsumed(accountId, quote, input);
        if (existing) return { booking: existing, quote, replayed: true };
      }

      // Expired between pricing and booking — only possible if the two were far apart, but
      // a retry a day later is exactly that. Price it again and book the new one.
      if (err.code === "quote_expired" || err.code === "quote_used") {
        this.logger.info(
          { accountId, code: err.code, idempotencyKey: input.idempotencyKey },
          "re-quoting a service booking",
        );
        quote = await this.quotes.create(accountId, request);
        this.assertWithinLimit(quote, input.maxTotalCents);
        const booking = await this.create(accountId, quote, input);
        return { booking, quote, replayed: false };
      }

      throw err;
    }
  }

  /**
   * The quote this booking will be made against.
   *
   * A caller that priced the job at checkout sends that quote, so the customer is charged what
   * they were shown. Hours later it may have lapsed, and re-pricing here — rather than letting
   * the booking refuse it — keeps a `rejected_quote_expired` row out of the record of demand we
   * turned away, because we did not turn it away.
   *
   * A quote that has been *consumed* is deliberately passed through untouched. It means a
   * booking for it already exists, and finding that booking is a better answer than making a
   * second one; `book` resolves it from the `quote_used` that follows.
   */
  private async priceable(
    accountId: string,
    request: QuoteRequest,
    input: ServiceBookingRequest,
  ): Promise<Quote> {
    if (!input.quoteId) return this.quotes.create(accountId, request);

    const supplied = await this.quotes.get(input.quoteId, accountId);
    const lapsed = new Date(supplied.expiresAt).getTime() < this.clock.now().getTime();
    if (!lapsed || supplied.status !== "priced") return supplied;

    this.logger.info(
      { accountId, quoteId: supplied.id, idempotencyKey: input.idempotencyKey },
      "re-pricing a service booking whose quote has expired",
    );
    return this.quotes.create(accountId, request);
  }

  private create(accountId: string, quote: Quote, input: ServiceBookingRequest): Promise<Booking> {
    return this.bookings.create(accountId, {
      quoteId: quote.id,
      ...(input.slot ? { slot: input.slot } : {}),
      idempotencyKey: input.idempotencyKey,
      ...(input.customerReference ? { customerReference: input.customerReference } : {}),
    });
  }

  /**
   * Who consumed the quote. Normally the concurrent attempt that beat us, found by the key
   * we both used; falling back to the quote itself covers a booking made some other way.
   */
  private async resolveConsumed(
    accountId: string,
    quote: Quote,
    input: ServiceBookingRequest,
  ): Promise<Booking | null> {
    return (
      (await this.bookings.findByIdempotencyKey(accountId, input.idempotencyKey)) ??
      (await this.bookings.findByQuoteId(accountId, quote.id))
    );
  }

  /**
   * A checkout showed the customer a number. If ours has since moved above what the caller
   * said it could accept, refusing is the kind thing to do: a booking nobody agreed the price
   * of becomes an argument on an invoice weeks later.
   */
  private assertWithinLimit(quote: Quote, maxTotalCents: number | undefined): void {
    if (maxTotalCents === undefined) return;
    if (quote.breakdown.totalCents > maxTotalCents) {
      throw AppError.conflict("price_above_limit", "the price is higher than the caller allows", {
        quotedTotalCents: quote.breakdown.totalCents,
        maxTotalCents,
      });
    }
  }
}

function toQuoteRequest(accountId: string, input: ServiceBookingRequest): QuoteRequest {
  return {
    serviceLevelCode: input.serviceLevelCode,
    collection: input.collection,
    drops: input.drops,
    options: input.options,
    accountId,
    // The date the job is for, when the caller named one, so date-conditional pricing has
    // something to look at. Absent, every date prices the same — which is today's behaviour.
    ...(input.slot ? { deliveryDate: input.slot.date } : {}),
  };
}
