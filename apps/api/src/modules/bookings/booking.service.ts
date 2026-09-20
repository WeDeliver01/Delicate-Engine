import { Injectable } from "@nestjs/common";
import { and, asc, desc, eq, inArray, lt, sql } from "drizzle-orm";
import {
  SHIPMENT_TRANSITIONS,
  type Booking,
  type BookingStatus,
  type CreateBookingRequest,
  type Quote,
  type QuoteRequest,
  type Shipment,
  type ShipmentStatus,
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
    const serviceLevel = await this.catalog.serviceLevelByCode(quote.serviceLevelCode);
    if (serviceLevel.requiresSlot && !input.slot) {
      throw AppError.validation([
        { path: ["slot"], message: `${serviceLevel.name} deliveries need a delivery slot` },
      ]);
    }
    if (new Date(quote.expiresAt).getTime() < Date.now()) {
      await this.recordRejection(
        accountId,
        quote,
        idempotencyKey,
        "rejected_quote_expired",
        "quote expired",
      );
      throw AppError.conflict("quote_expired", "this quote has expired; please re-quote");
    }

    try {
      const bookingId = await this.dbs.transaction(async (tx) => {
        await this.quotes.markBooked(tx, quote.id); // row lock + single use
        const slot = serviceLevel.requiresSlot ? input.slot! : null;
        if (slot) await this.scheduling.reserve(tx, slot);

        const reference = await this.nextReference(tx, "BK");
        const hold = await this.wallet.placeHold(tx, {
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
            status: "confirmed",
            serviceLevelCode: quote.serviceLevelCode,
            slotDate: slot?.date ?? null,
            slotWindowKey: slot?.windowKey ?? null,
            collection: req.collection,
            options: req.options,
            breakdown: quote.breakdown,
            totalCents: quote.breakdown.totalCents,
            holdId: hold.id,
            idempotencyKey,
            createdByUserId: requestContext.get()?.userId ?? null,
          })
          .returning();

        const created: { shipmentId: string; waybill: string }[] = [];
        for (const [i, drop] of req.drops.entries()) {
          const waybill = await this.nextWaybill(tx);
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
              recipient: drop.recipient,
              deliveryAddress: drop.address,
              instructions: drop.instructions,
              parcels: drop.parcels,
            })
            .returning();
          await tx
            .insert(shipmentEvents)
            .values({
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
        await tx
          .insert(shipmentEvents)
          .values({
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
      await tx
        .insert(shipmentEvents)
        .values({
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
  private async rollUpBooking(tx: DbExecutor, bookingId: string): Promise<void> {
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
    const row = await this.dbs.db.query.shipments.findFirst({
      where: eq(shipments.waybill, waybill.trim().toUpperCase()),
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

  /** Waybill: DC-YYMMDD-NNNNN, gap-free per local day. Row-locked counter. */
  async nextWaybill(tx: DbExecutor): Promise<string> {
    const day = await this.localDay();
    const n = await this.bump(tx, `WB:${day}`);
    return `DC-${day}-${String(n).padStart(5, "0")}`;
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
    status: r.status,
    serviceLevelCode: r.serviceLevelCode,
    slotDate: r.slotDate,
    slotWindowKey: r.slotWindowKey,
    collection: r.collection as Booking["collection"],
    options: r.options as Booking["options"],
    breakdown: r.breakdown as Booking["breakdown"],
    totalCents: r.totalCents,
    holdId: r.holdId,
    rejectionReason: r.rejectionReason,
    createdAt: r.createdAt.toISOString(),
    cancelledAt: r.cancelledAt?.toISOString() ?? null,
    shipments: ships,
  };
}
