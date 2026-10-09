import { Injectable } from "@nestjs/common";
import { randomBytes } from "node:crypto";
import { and, asc, desc, eq, inArray, lt, sql } from "drizzle-orm";
import {
  SHIPMENT_TRANSITIONS,
  feasibleGapMinutes,
  type Booking,
  type BookingStatus,
  type CreateBookingRequest,
  type Quote,
  type QuoteRequest,
  toCustomerBreakdown,
  type Shipment,
  type ShipmentStatus,
  type TimedWindow,
  type TrackingView,
} from "@delicate/contracts";
import {
  bookings,
  shipmentEvents,
  shipments,
  waybillCounters,
  type DbExecutor,
} from "@delicate/db";
import { DbService } from "../../infra/db.module.js";
import { AuditService } from "../../infra/audit.service.js";
import { OutboxService } from "../../infra/outbox.service.js";
import { SettingsService } from "../../infra/settings.service.js";
import { Clock } from "../../infra/clock.js";
import { AppError } from "../../common/errors.js";
import { requestContext } from "../../common/request-context.js";
import { WalletService } from "../wallet/wallet.service.js";
import { QuoteService } from "../catalog/quote.service.js";
import { CatalogService } from "../catalog/catalog.service.js";
import { SchedulingService, toLocal } from "../scheduling/scheduling.service.js";

/**
 * Booking = the one transaction that turns a quote into money-backed work (invariant #4):
 *
 *   lock quote → (reserve slot) → place hold → insert booking + shipments + events
 *   → mark quote booked → audit → outbox events → COMMIT
 *
 * Any gate failure rolls everything back; the rejection is then recorded in its own
 * transaction so ops can see demand that was turned away.
 */
@Injectable()
export class BookingService {
  constructor(
    private readonly dbs: DbService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly settings: SettingsService,
    private readonly clock: Clock,
    private readonly wallet: WalletService,
    private readonly quotes: QuoteService,
    private readonly catalog: CatalogService,
    private readonly scheduling: SchedulingService,
  ) {}

  async create(accountId: string, input: CreateBookingRequest): Promise<Booking> {
    const idempotencyKey = input.idempotencyKey ?? `quote:${input.quoteId}`;

    // Replay of the same submit returns the original booking.
    const existing = await this.dbs.db.query.bookings.findFirst({
      where: and(eq(bookings.accountId, accountId), eq(bookings.idempotencyKey, idempotencyKey)),
    });
    if (existing) return this.get(existing.id, accountId);

    const quote = await this.quotes.get(input.quoteId, accountId);
    if (quote.status !== "priced")
      throw AppError.conflict("quote_used", "this quote has already been booked");
    // Before anything is reserved or held. A quote may have been priced on addresses alone, so
    // the recipients arrive with the booking -- and finding that out after taking a slot and
    // holding the customer's money means relying on a rollback to undo work that never needed
    // to start.
    const missing = (quote.request.drops as { recipient: unknown }[])
      .map((drop, i) => ((drop.recipient ?? input.drops?.[i]?.recipient) ? null : i + 1))
      .filter((n): n is number => n !== null);
    if (missing.length > 0) {
      throw AppError.validation(
        missing.map((n) => ({
          path: ["drops", n - 1, "recipient"],
          message: `drop ${n} needs a recipient name and contact number before it can be booked`,
        })),
      );
    }
    /*
      And somebody at the other end of the job. A quote is priced on addresses, so it may
      carry nobody at all; a collection is a driver arriving at a door, and a door needs a
      name to ask for and a number to ring when nobody answers it.
    */
    if (!(quote.request as QuoteRequest).collection.contact) {
      throw AppError.validation([
        {
          path: ["collection", "contact"],
          message: "the collection needs a contact name and number before it can be booked",
        },
      ]);
    }

    // Booking past what the wallet can cover is a commercial decision, so it is one person's
    // to make. Refused rather than ignored for anyone else: a flag that quietly does nothing
    // is how somebody believes an order went through on credit when it did not.
    const overdraw = input.allowNegativeBalance === true;
    if (overdraw && requestContext.get()?.platformRole !== "super_admin") {
      throw AppError.forbidden("only a super admin can book past the available balance");
    }

    const serviceLevel = await this.catalog.serviceLevelByCode(quote.serviceLevelCode);
    if (serviceLevel.requiresSlot && !input.slot) {
      throw AppError.validation([
        { path: ["slot"], message: `${serviceLevel.name} deliveries need a delivery slot` },
      ]);
    }
    /*
      A service that dispatches on the spot may still name a window, and the portal always
      does: the customer wants to know roughly when, and dispatch wants the job to count
      against the day's capacity like every other one. But it can only ever be today. A
      booking for next Tuesday at the on-demand price, with none of the notice the schedule
      is built on, is not a thing we sell.
    */
    if (!serviceLevel.requiresSlot && input.slot) {
      const today = (await this.scheduling.localNow()).date;
      if (input.slot.date !== today) {
        throw AppError.validation([
          {
            path: ["slot", "date"],
            message: `${serviceLevel.name} deliveries are collected today`,
          },
        ]);
      }
    }
    // From the injected clock, because the quote's expiry was stamped from it too. Two
    // sources of "now" in one comparison is how a freshly priced quote ends up rejected as
    // expired.
    if (new Date(quote.expiresAt).getTime() < this.clock.now().getTime()) {
      await this.recordRejection(
        accountId,
        quote,
        idempotencyKey,
        "rejected_quote_expired",
        "quote expired",
      );
      throw AppError.conflict("quote_expired", "this quote has expired; please re-quote");
    }

    /**
     * A window the customer did not pay for is one we never agreed to keep, so the booking must
     * ask for exactly what the quote was priced with. Comparing against the quote rather than
     * trusting the request is what stops a client buying a half-day slot and submitting an hour.
     */
    const quoted = (quote.request as QuoteRequest).timedWindow ?? null;
    const timedWindow = input.timedWindow ?? null;
    if (!sameWindows(quoted, timedWindow)) {
      throw AppError.conflict(
        "window_not_quoted",
        "this booking asks for a different window from the one it was priced with; please re-quote",
      );
    }

    /*
      Both ends pinned, and the clock says no.

      This refuses the impossible and nothing more. It does not promise that a parcel
      collected at eight arrives at nine, because the van is usually collecting three other
      jobs on the way -- that is what the slot the customer bought is for. What it stops is
      selling an eight o'clock collection with an eight-thirty delivery on a forty-minute
      drive, which no amount of good dispatching can honour, and which we would only find out
      about when somebody rang to ask where their cake was.

      The furthest drop binds: one pair of windows covers every drop on the booking.
    */
    if (timedWindow?.collection && timedWindow.delivery) {
      // The stored working, not the customer's copy: that one has the kilometres stripped
      // out on purpose, and this check is about the journey rather than the price.
      const breakdown = await this.quotes.fullBreakdown(quote.id, accountId);
      const km = Math.max(0, ...(breakdown.dropKm.length > 0 ? breakdown.dropKm : [0]));
      const pieces = (quote.request as QuoteRequest).drops.reduce(
        (n, drop) => n + drop.parcels.reduce((m, parcel) => m + parcel.quantity, 0),
        0,
      );
      const needed = feasibleGapMinutes({
        km,
        collectionPieces: pieces,
        dropPieces: Math.max(1, Math.ceil(pieces / (quote.request as QuoteRequest).drops.length)),
      });
      const offered = timedWindow.delivery.endMinute - timedWindow.collection.startMinute;
      if (offered < needed) {
        throw AppError.validation([
          {
            path: ["timedWindow"],
            message: `that drive needs about ${needed} minutes from collection to the door; this booking allows ${offered}`,
          },
        ]);
      }
    }

    try {
      const bookingId = await this.dbs.transaction(async (tx) => {
        await this.quotes.markBooked(tx, quote.id); // row lock + single use
        const slot = input.slot ?? null;
        // Lock order is fixed and must stay that way: quote, then slot, then the capacity bands
        // in ascending start minute, then the wallet. Two bookings racing for the last 09:00 and
        // 10:00 places would otherwise each hold one and wait for the other; one of them has to
        // lose cleanly instead of both hanging.
        if (slot)
          await this.scheduling.reserve(tx, slot, { immediate: !serviceLevel.requiresSlot });
        if (timedWindow?.collection || timedWindow?.delivery) {
          const windowDate = slot?.date ?? (await this.scheduling.localNow()).date;
          // Both windows in one call, so the bands are taken in a single ascending pass.
          await this.scheduling.reserveWindows(
            tx,
            windowDate,
            [timedWindow.collection, timedWindow.delivery].filter((w) => !!w),
          );
        }

        const reference = await this.nextReference(tx, "BK");
        const hold = await this.wallet.placeHold(tx, {
          allowOverdraw: overdraw,
          accountId,
          amountCents: quote.breakdown.totalCents,
          reference,
          idempotencyKey: `booking:${quote.id}`,
        });

        const req = quote.request as QuoteRequest;
        const [booking] = await tx
          .insert(bookings)
          .values({
            accountId,
            quoteId: quote.id,
            reference,
            customerReference: input.customerReference ?? null,
            status: "confirmed",
            serviceLevelCode: quote.serviceLevelCode,
            slotDate: slot?.date ?? null,
            slotWindowKey: slot?.windowKey ?? null,
            collection: req.collection,
            collectionWindowStartMinute: timedWindow?.collection?.startMinute ?? null,
            collectionWindowEndMinute: timedWindow?.collection?.endMinute ?? null,
            options: req.options,
            breakdown: quote.breakdown,
            totalCents: quote.breakdown.totalCents,
            holdId: hold.id,
            idempotencyKey,
            createdByUserId: requestContext.get()?.userId ?? null,
            createdByServiceClientId: requestContext.get()?.serviceClientId ?? null,
          })
          .returning();

        const created: { shipmentId: string; waybill: string }[] = [];
        /** Waybills handed out in this booking but not yet in the table. */
        const claimed = new Set<string>();
        for (const [i, drop] of req.drops.entries()) {
          // A quote needs only an address; a shipment needs somebody to hand the parcel to.
          // Whoever the quote named wins, and the booking fills the rest — this is the point
          // where a driver would otherwise arrive at a door with no name and no number.
          const recipient = drop.recipient ?? input.drops?.[i]?.recipient ?? null;
          if (!recipient) {
            throw new AppError(
              "recipient_required",
              `drop ${i + 1} has no recipient; a delivery needs a name and a contact number`,
              422,
              { dropIndex: i },
            );
          }
          const instructions = drop.instructions ?? input.drops?.[i]?.instructions ?? null;
          const waybill = await this.nextWaybill(tx, claimed);
          const [s] = await tx
            .insert(shipments)
            .values({
              bookingId: booking!.id,
              accountId,
              waybill,
              sequence: i + 1,
              serviceLevelCode: quote.serviceLevelCode,
              slotDate: slot?.date ?? null,
              slotWindowKey: slot?.windowKey ?? null,
              deliveryWindowStartMinute: timedWindow?.delivery?.startMinute ?? null,
              deliveryWindowEndMinute: timedWindow?.delivery?.endMinute ?? null,
              recipient,
              deliveryAddress: drop.address,
              instructions,
              parcels: drop.parcels,
            })
            .returning();
          await tx.insert(shipmentEvents).values({
            shipmentId: s!.id,
            status: "booked",
            note: null,
            actorUserId: requestContext.get()?.userId ?? null,
          });
          created.push({ shipmentId: s!.id, waybill });
        }

        await this.audit.record(tx, {
          action: "booking.create",
          entityType: "booking",
          entityId: booking!.id,
          after: { reference, totalCents: booking!.totalCents, shipments: created },
        });
        await this.outbox.emit(
          tx,
          "booking.confirmed",
          {
            bookingId: booking!.id,
            accountId,
            reference,
            serviceLevelCode: quote.serviceLevelCode,
            slotDate: slot?.date ?? null,
            slotWindowKey: slot?.windowKey ?? null,
            totalCents: booking!.totalCents,
            holdId: hold.id,
            shipments: created,
          },
          { dedupeKey: `booking:${booking!.id}:confirmed` },
        );
        return booking!.id;
      });
      return this.get(bookingId, accountId);
    } catch (err) {
      if (err instanceof AppError && err.code === "insufficient_funds") {
        await this.recordRejection(
          accountId,
          quote,
          idempotencyKey,
          "rejected_insufficient_funds",
          err.message,
          err.details,
        );
      } else if (err instanceof AppError && err.code === "slot_unavailable") {
        await this.recordRejection(
          accountId,
          quote,
          idempotencyKey,
          "rejected_slot_unavailable",
          err.message,
          err.details,
        );
      }
      throw err;
    }
  }

  private async recordRejection(
    accountId: string,
    quote: Quote,
    idempotencyKey: string,
    status: BookingStatus,
    reason: string,
    details?: unknown,
  ): Promise<void> {
    await this.dbs.transaction(async (tx) => {
      const req = quote.request as QuoteRequest;
      const [row] = await tx
        .insert(bookings)
        .values({
          accountId,
          quoteId: quote.id,
          reference: await this.nextReference(tx, "RJ"),
          status,
          serviceLevelCode: quote.serviceLevelCode,
          collection: req.collection,
          options: req.options,
          breakdown: quote.breakdown,
          totalCents: quote.breakdown.totalCents,
          idempotencyKey: `${idempotencyKey}:rejected:${Date.now()}`,
          rejectionReason: reason,
          createdByUserId: requestContext.get()?.userId ?? null,
        })
        .returning({ id: bookings.id });
      await this.outbox.emit(
        tx,
        "booking.rejected",
        {
          bookingId: row!.id,
          accountId,
          quoteId: quote.id,
          reason: status,
          totalCents: quote.breakdown.totalCents,
        },
        { dedupeKey: `booking:${row!.id}:rejected` },
      );
      void details;
    });
  }

  /** Customer cancellation: allowed while nothing has been collected. Releases hold and slot. */
  async cancel(bookingId: string, accountId: string | null, reason: string): Promise<Booking> {
    await this.dbs.transaction(async (tx) => {
      const [booking] = await tx
        .select()
        .from(bookings)
        .where(eq(bookings.id, bookingId))
        .for("update");
      if (!booking || (accountId && booking.accountId !== accountId))
        throw AppError.notFound("booking");
      if (booking.status === "cancelled") return;
      if (booking.status !== "confirmed" && booking.status !== "in_progress") {
        throw AppError.conflict("booking_not_cancellable", `booking is ${booking.status}`);
      }
      const rows = await tx.select().from(shipments).where(eq(shipments.bookingId, bookingId));
      const started = rows.some((s) => !["booked", "assigned", "cancelled"].includes(s.status));
      if (started)
        throw AppError.conflict(
          "booking_in_progress",
          "a shipment has already been collected; contact support",
        );

      for (const s of rows) {
        if (s.status === "cancelled") continue;
        await tx.update(shipments).set({ status: "cancelled" }).where(eq(shipments.id, s.id));
        await tx.insert(shipmentEvents).values({
          shipmentId: s.id,
          status: "cancelled",
          note: reason,
          actorUserId: requestContext.get()?.userId ?? null,
        });
        await this.outbox.emit(
          tx,
          "shipment.status_changed",
          {
            shipmentId: s.id,
            bookingId,
            accountId: booking.accountId,
            waybill: s.waybill,
            from: s.status,
            to: "cancelled",
            note: reason,
          },
          { dedupeKey: `shipment:${s.id}:cancelled` },
        );
      }
      let holdReleased = false;
      if (booking.holdId) {
        await this.wallet.releaseHold(tx, booking.holdId);
        holdReleased = true;
      }
      if (booking.slotDate && booking.slotWindowKey) {
        await this.scheduling.release(tx, {
          date: booking.slotDate,
          windowKey: booking.slotWindowKey,
        });
      }
      // Band capacity goes back too, or a cancelled 09:00 keeps blocking the next customer.
      // The delivery window is read off the shipments rather than the booking, because that is
      // where it was written.
      const windowDate = booking.slotDate ?? (await this.scheduling.localNow()).date;
      const held = [
        toWindow(booking.collectionWindowStartMinute, booking.collectionWindowEndMinute),
        toWindow(
          rows[0]?.deliveryWindowStartMinute ?? null,
          rows[0]?.deliveryWindowEndMinute ?? null,
        ),
      ].filter((w): w is TimedWindow => !!w);
      if (held.length > 0) await this.scheduling.releaseWindows(tx, windowDate, held);
      await tx
        .update(bookings)
        .set({ status: "cancelled", cancelledAt: new Date() })
        .where(eq(bookings.id, bookingId));
      await this.audit.record(tx, {
        action: "booking.cancel",
        entityType: "booking",
        entityId: bookingId,
        before: { status: booking.status },
        after: { status: "cancelled", reason },
      });
      await this.outbox.emit(
        tx,
        "booking.cancelled",
        {
          bookingId,
          accountId: booking.accountId,
          reference: booking.reference,
          reason,
          holdReleased,
        },
        { dedupeKey: `booking:${bookingId}:cancelled` },
      );
    });
    return this.get(bookingId, accountId);
  }

  /**
   * Manual status change (dispatcher). Phase 2 drives this from the driver app and settles
   * money on `delivered`; here it maintains the state machine, timeline and booking roll-up.
   */
  async updateShipmentStatus(
    shipmentId: string,
    to: ShipmentStatus,
    note: string | null,
  ): Promise<Shipment> {
    await this.dbs.transaction(async (tx) => {
      const [s] = await tx
        .select()
        .from(shipments)
        .where(eq(shipments.id, shipmentId))
        .for("update");
      if (!s) throw AppError.notFound("shipment");
      if (s.status === to) return;
      if (!SHIPMENT_TRANSITIONS[s.status].includes(to)) {
        throw AppError.conflict(
          "invalid_transition",
          `cannot move a shipment from ${s.status} to ${to}`,
          { allowed: SHIPMENT_TRANSITIONS[s.status] },
        );
      }
      await tx
        .update(shipments)
        .set({ status: to, deliveredAt: to === "delivered" ? new Date() : s.deliveredAt })
        .where(eq(shipments.id, shipmentId));
      await tx.insert(shipmentEvents).values({
        shipmentId,
        status: to,
        note,
        actorUserId: requestContext.get()?.userId ?? null,
      });
      await this.audit.record(tx, {
        action: "shipment.status",
        entityType: "shipment",
        entityId: shipmentId,
        before: { status: s.status },
        after: { status: to, note },
      });
      await this.outbox.emit(
        tx,
        "shipment.status_changed",
        {
          shipmentId,
          bookingId: s.bookingId,
          accountId: s.accountId,
          waybill: s.waybill,
          from: s.status,
          to,
          note,
        },
        { dedupeKey: `shipment:${shipmentId}:${to}:${Date.now()}` },
      );
      await this.rollUpBooking(tx, s.bookingId);
    });
    return this.getShipment(shipmentId, null);
  }

  /** Booking status follows its shipments: any collected → in_progress; all terminal → completed. */
  async rollUpBooking(tx: DbExecutor, bookingId: string): Promise<void> {
    const rows = await tx
      .select({ status: shipments.status })
      .from(shipments)
      .where(eq(shipments.bookingId, bookingId));
    const statuses = rows.map((r) => r.status);
    const live = statuses.filter((st) => st !== "cancelled");
    let next: BookingStatus | null = null;
    if (live.length > 0 && live.every((st) => st === "delivered" || st === "failed"))
      next = "completed";
    else if (statuses.some((st) => ["collected", "in_transit", "delivered", "failed"].includes(st)))
      next = "in_progress";
    if (next) {
      await tx
        .update(bookings)
        .set({ status: next, completedAt: next === "completed" ? new Date() : null })
        .where(
          and(eq(bookings.id, bookingId), inArray(bookings.status, ["confirmed", "in_progress"])),
        );
    }
  }

  // ── reads ───────────────────────────────────────────────────────────────────

  /**
   * The booking a previous attempt with this key already created, if there was one.
   *
   * `create` does this check too, but a caller that must quote before it can book needs the
   * answer *before* paying for a routing call it would only throw away.
   */
  async findByIdempotencyKey(accountId: string, key: string): Promise<Booking | null> {
    const row = await this.dbs.db.query.bookings.findFirst({
      where: and(eq(bookings.accountId, accountId), eq(bookings.idempotencyKey, key)),
    });
    return row ? this.get(row.id, accountId) : null;
  }

  /** The booking that consumed a quote, which is how `quote_used` becomes an answer. */
  async findByQuoteId(accountId: string, quoteId: string): Promise<Booking | null> {
    const row = await this.dbs.db.query.bookings.findFirst({
      where: and(
        eq(bookings.accountId, accountId),
        eq(bookings.quoteId, quoteId),
        inArray(bookings.status, ["confirmed", "in_progress", "completed", "cancelled"]),
      ),
    });
    return row ? this.get(row.id, accountId) : null;
  }

  /**
   * Find a booking by the caller's own reference, exactly.
   *
   * Exact match only, and scoped to the account: a lookup that is loose about this attaches
   * somebody else's delivery to an order and nothing downstream would notice.
   */
  async findByCustomerReference(accountId: string, reference: string): Promise<Booking | null> {
    const row = await this.dbs.db.query.bookings.findFirst({
      where: and(
        eq(bookings.accountId, accountId),
        eq(bookings.customerReference, reference),
        inArray(bookings.status, ["confirmed", "in_progress", "completed", "cancelled"]),
      ),
      orderBy: (b, { desc: d }) => [d(b.createdAt)],
    });
    return row ? this.get(row.id, accountId) : null;
  }

  async get(bookingId: string, accountId: string | null): Promise<Booking> {
    const row = await this.dbs.db.query.bookings.findFirst({ where: eq(bookings.id, bookingId) });
    if (!row || (accountId && row.accountId !== accountId)) throw AppError.notFound("booking");
    const ships = await this.dbs.db
      .select()
      .from(shipments)
      .where(eq(shipments.bookingId, bookingId))
      .orderBy(asc(shipments.sequence));
    return toBooking(
      row,
      ships.map((s) => toShipment(s)),
    );
  }

  async list(
    accountId: string | null,
    opts: { limit: number; cursor?: string; status?: BookingStatus },
  ) {
    const cursorDate = opts.cursor ? new Date(opts.cursor) : null;
    const rows = await this.dbs.db
      .select()
      .from(bookings)
      .where(
        and(
          accountId ? eq(bookings.accountId, accountId) : undefined,
          opts.status ? eq(bookings.status, opts.status) : undefined,
          cursorDate ? lt(bookings.createdAt, cursorDate) : undefined,
        ),
      )
      .orderBy(desc(bookings.createdAt))
      .limit(opts.limit + 1);
    const page = rows.slice(0, opts.limit);
    const ids = page.map((b) => b.id);
    const ships = ids.length
      ? await this.dbs.db
          .select()
          .from(shipments)
          .where(inArray(shipments.bookingId, ids))
          .orderBy(asc(shipments.sequence))
      : [];
    const items = page.map((b) =>
      toBooking(
        b,
        ships.filter((s) => s.bookingId === b.id).map((s) => toShipment(s)),
      ),
    );
    return {
      items,
      nextCursor: rows.length > opts.limit ? items[items.length - 1]!.createdAt : null,
    };
  }

  async getShipment(shipmentId: string, accountId: string | null): Promise<Shipment> {
    const row = await this.dbs.db.query.shipments.findFirst({
      where: eq(shipments.id, shipmentId),
    });
    if (!row || (accountId && row.accountId !== accountId)) throw AppError.notFound("shipment");
    const events = await this.dbs.db
      .select()
      .from(shipmentEvents)
      .where(eq(shipmentEvents.shipmentId, shipmentId))
      .orderBy(asc(shipmentEvents.occurredAt));
    return toShipment(row, events);
  }

  async listShipments(
    accountId: string | null,
    opts: { limit: number; cursor?: string; status?: ShipmentStatus; slotDate?: string },
  ) {
    const cursorDate = opts.cursor ? new Date(opts.cursor) : null;
    const rows = await this.dbs.db
      .select()
      .from(shipments)
      .where(
        and(
          accountId ? eq(shipments.accountId, accountId) : undefined,
          opts.status ? eq(shipments.status, opts.status) : undefined,
          opts.slotDate ? eq(shipments.slotDate, opts.slotDate) : undefined,
          cursorDate ? lt(shipments.createdAt, cursorDate) : undefined,
        ),
      )
      .orderBy(desc(shipments.createdAt))
      .limit(opts.limit + 1);
    const items = rows.slice(0, opts.limit).map((s) => toShipment(s));
    return {
      items,
      nextCursor: rows.length > opts.limit ? items[items.length - 1]!.createdAt : null,
    };
  }

  async track(waybill: string): Promise<TrackingView> {
    /*
      Forgiving about how it was typed, because it was read off a label or down a phone. Case
      and spacing first, and then the one substitution that trips people up: a waybill has no
      O or I in it, so a 0 or a 1 in a six-character code is somebody's hand, not the code.
      Tried second, never first, because the old day-numbered waybills are full of real zeros.
    */
    const typed = waybill.trim().toUpperCase();
    const candidates = [typed];
    const tidy = typed.replace(/[\s-]/g, "");
    if (tidy !== typed) candidates.push(tidy);
    if (/^[A-Z0-9]{6}$/.test(tidy)) candidates.push(tidy.replace(/0/g, "O").replace(/1/g, "I"));

    const row = await this.dbs.db.query.shipments.findFirst({
      where: inArray(shipments.waybill, candidates),
    });
    if (!row) throw AppError.notFound("shipment", { waybill });
    const [events, sl, policy] = await Promise.all([
      this.dbs.db
        .select()
        .from(shipmentEvents)
        .where(eq(shipmentEvents.shipmentId, row.id))
        .orderBy(asc(shipmentEvents.occurredAt)),
      this.catalog.serviceLevelByCode(row.serviceLevelCode).catch(() => null),
      this.settings.get("scheduling.policy"),
    ]);
    const addr = row.deliveryAddress as { suburb: string | null; city: string | null };
    const window = policy.windows.find((w) => w.key === row.slotWindowKey);
    return {
      waybill: row.waybill,
      status: row.status,
      serviceLevel: sl?.name ?? row.serviceLevelCode,
      slot: row.slotDate
        ? { date: row.slotDate, label: window?.label ?? row.slotWindowKey ?? "" }
        : null,
      destination: { suburb: addr.suburb ?? null, city: addr.city ?? null },
      deliveredAt: row.deliveredAt?.toISOString() ?? null,
      timeline: events.map((e) => ({ status: e.status, occurredAt: e.occurredAt.toISOString() })),
    };
  }

  // ── identifiers ─────────────────────────────────────────────────────────────

  /**
   * Waybill: six characters, random, e.g. W9RT4H.
   *
   * It used to count up per day -- DC-261009-00001 -- which is three facts nobody is owed:
   * what day we booked it, how many we had done by then, and, from two waybills a week
   * apart, roughly what we do in a week. A competitor reads that off an invoice. It is also
   * long enough that nobody reads it down a phone without losing their place.
   *
   * The alphabet is the one top-up references already use: no I, L, O, 0 or 1, because this
   * number is read aloud and copied by hand. A billion combinations, a unique index behind
   * it, and a few attempts: the only way past this is a clash eight times running, which
   * means something is wrong that a ninth attempt would not fix.
   */
  async nextWaybill(tx: DbExecutor, taken: Set<string> = new Set()): Promise<string> {
    for (let attempt = 0; attempt < 8; attempt++) {
      const candidate = randomWaybill();
      if (taken.has(candidate)) continue;
      const clash = await tx.query.shipments.findFirst({
        where: eq(shipments.waybill, candidate),
        columns: { id: true },
      });
      if (clash) continue;
      // Claimed for the rest of this booking: its drops are inserted one after another and
      // none of them is in the table yet to be found by the query above.
      taken.add(candidate);
      return candidate;
    }
    throw new AppError("waybill_unavailable", "could not allocate a waybill", 503);
  }

  private async nextReference(tx: DbExecutor, prefix: string): Promise<string> {
    const day = await this.localDay();
    const n = await this.bump(tx, `${prefix}:${day}`);
    return `${prefix}-${day}-${String(n).padStart(4, "0")}`;
  }

  private async bump(tx: DbExecutor, key: string): Promise<number> {
    await tx.insert(waybillCounters).values({ day: key }).onConflictDoNothing();
    const [row] = await tx
      .update(waybillCounters)
      .set({ next: sql`${waybillCounters.next} + 1` })
      .where(eq(waybillCounters.day, key))
      .returning({ next: waybillCounters.next });
    return row!.next - 1;
  }

  private async localDay(): Promise<string> {
    const tz = await this.settings.get("company.timezone");
    return toLocal(new Date(), tz).date.replace(/-/g, "").slice(2);
  }
}

/**
 * Six characters from an alphabet with nothing confusable in it.
 *
 * No I or L next to a 1, no O next to a 0, because the people reading this out are standing
 * at a door with a cake in one hand.
 */
function randomWaybill(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  // 256 divides by 32 exactly, so every character is equally likely.
  for (const b of randomBytes(6)) out += alphabet[b % alphabet.length];
  return out;
}

export function toShipment(
  r: typeof shipments.$inferSelect,
  events?: (typeof shipmentEvents.$inferSelect)[],
): Shipment {
  return {
    id: r.id,
    bookingId: r.bookingId,
    accountId: r.accountId,
    waybill: r.waybill,
    sequence: r.sequence,
    status: r.status,
    serviceLevelCode: r.serviceLevelCode,
    slotDate: r.slotDate,
    slotWindowKey: r.slotWindowKey,
    deliveryWindow: toWindow(r.deliveryWindowStartMinute, r.deliveryWindowEndMinute),
    recipient: r.recipient as Shipment["recipient"],
    deliveryAddress: r.deliveryAddress as Shipment["deliveryAddress"],
    instructions: r.instructions,
    parcels: r.parcels as Shipment["parcels"],
    deliveredAt: r.deliveredAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
    ...(events
      ? {
          events: events.map((e) => ({
            id: e.id,
            status: e.status,
            note: e.note,
            occurredAt: e.occurredAt.toISOString(),
          })),
        }
      : {}),
  };
}

export function toBooking(r: typeof bookings.$inferSelect, ships: Shipment[]): Booking {
  return {
    id: r.id,
    accountId: r.accountId,
    quoteId: r.quoteId,
    reference: r.reference,
    customerReference: r.customerReference,
    status: r.status,
    serviceLevelCode: r.serviceLevelCode,
    slotDate: r.slotDate,
    slotWindowKey: r.slotWindowKey,
    collection: r.collection as Booking["collection"],
    collectionWindow: toWindow(r.collectionWindowStartMinute, r.collectionWindowEndMinute),
    options: r.options as Booking["options"],
    // The stored row keeps the kilometres, the cost and the margin; the customer gets the
    // prices. Projected here so every booking response goes through it.
    breakdown: toCustomerBreakdown(r.breakdown as Parameters<typeof toCustomerBreakdown>[0]),
    totalCents: r.totalCents,
    holdId: r.holdId,
    rejectionReason: r.rejectionReason,
    createdAt: r.createdAt.toISOString(),
    cancelledAt: r.cancelledAt?.toISOString() ?? null,
    shipments: ships,
  };
}

/** Two nullable columns in, one window or nothing out. Half a window is not a promise. */
export function toWindow(startMinute: number | null, endMinute: number | null): TimedWindow | null {
  return startMinute == null || endMinute == null ? null : { startMinute, endMinute };
}

/**
 * Whether a booking asks for the same windows its quote was priced with.
 *
 * Both absent is a match: a booking with no window is what the engine did before windows
 * existed, and that path must stay exactly as it was.
 */
function sameWindows(
  a: { collection: TimedWindow | null; delivery: TimedWindow | null } | null,
  b: { collection: TimedWindow | null; delivery: TimedWindow | null } | null,
): boolean {
  const one = (x: TimedWindow | null | undefined, y: TimedWindow | null | undefined) =>
    (!x && !y) || (!!x && !!y && x.startMinute === y.startMinute && x.endMinute === y.endMinute);
  return one(a?.collection, b?.collection) && one(a?.delivery, b?.delivery);
}
