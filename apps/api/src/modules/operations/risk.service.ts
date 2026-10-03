import { Injectable } from "@nestjs/common";
import { and, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { PinoLogger } from "nestjs-pino";
import { operatingToday, type ShipmentStatus } from "@delicate/contracts";
import { assignments, bookings, outboxMessages, shipments, tripStops, trips } from "@delicate/db";
import { DbService } from "../../infra/db.module.js";
import { SettingsService } from "../../infra/settings.service.js";
import { OutboxService } from "../../infra/outbox.service.js";
import { Clock } from "../../infra/clock.js";
import { LiveService } from "./live.service.js";

const LIVE: ShipmentStatus[] = ["booked", "assigned", "collected", "in_transit"];

/**
 * Notice a promise about to be broken, before the customer phones to tell us.
 *
 * A sweep rather than a trigger, because "late" is a fact about the clock and nothing happens
 * in the system at the moment it becomes true. Run from the worker on a slow loop.
 *
 * It emits at most one event per shipment per window. A dispatcher who gets the same alert
 * every thirty seconds stops reading alerts, so the outbox dedupe key carries the window being
 * missed: a stop whose window a dispatcher then moves can raise a fresh one, and an unchanged
 * one stays quiet.
 */
@Injectable()
export class RiskService {
  constructor(
    private readonly dbs: DbService,
    private readonly settings: SettingsService,
    private readonly outbox: OutboxService,
    private readonly clock: Clock,
    private readonly live: LiveService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(RiskService.name);
  }

  /** Returns how many new risks it raised, so the worker can back off when there are none. */
  async sweep(): Promise<number> {
    const today = operatingToday(this.clock.now());
    const nowMinute = await this.nowMinute();

    /**
     * Anything still owed whose window has closed.
     *
     * The promise lives on the shipment, so that is where this reads it from, and the trip stop
     * is a refinement rather than the source: a dispatcher may have narrowed or pinned the
     * window, and that is the one the driver is working to. Reading only the trip stop would
     * have missed the case that matters most — a shipment assigned to someone but never put on
     * a day, which is precisely when ops has forgotten about it.
     */
    const missed = await this.dbs.db
      .select({
        shipmentId: shipments.id,
        waybill: shipments.waybill,
        bookingId: shipments.bookingId,
        accountId: shipments.accountId,
        soldEndMinute: shipments.deliveryWindowEndMinute,
        stopEndMinute: tripStops.windowEndMinute,
        stopStatus: tripStops.status,
        tripId: trips.id,
        tripStatus: trips.status,
        driverId: assignments.driverId,
      })
      .from(shipments)
      .leftJoin(
        assignments,
        and(eq(assignments.shipmentId, shipments.id), eq(assignments.active, true)),
      )
      .leftJoin(tripStops, and(eq(tripStops.shipmentId, shipments.id), eq(tripStops.kind, "drop")))
      .leftJoin(trips, and(eq(trips.id, tripStops.tripId), sql`${trips.status} <> 'abandoned'`))
      .where(
        and(
          inArray(shipments.status, LIVE),
          or(eq(shipments.slotDate, today), isNull(shipments.slotDate)),
          // There must be a promise to be late against. A shipment on a plain half-day slot is
          // covered by the overdue signal the shipment list already has, not by this.
          or(
            sql`${shipments.deliveryWindowEndMinute} is not null`,
            sql`${tripStops.windowEndMinute} is not null`,
          ),
        ),
      );

    // Today's work that nobody has picked up. Not late yet, but it will be.
    const orphaned = await this.dbs.db
      .select({
        shipmentId: shipments.id,
        waybill: shipments.waybill,
        bookingId: shipments.bookingId,
        accountId: shipments.accountId,
        windowEndMinute: shipments.deliveryWindowEndMinute,
      })
      .from(shipments)
      .innerJoin(bookings, eq(bookings.id, shipments.bookingId))
      .leftJoin(
        assignments,
        and(eq(assignments.shipmentId, shipments.id), eq(assignments.active, true)),
      )
      .where(
        and(
          eq(shipments.status, "booked"),
          isNull(assignments.id),
          or(eq(shipments.slotDate, today), isNull(shipments.slotDate)),
          // Only once the window is actually within reach; before that it is simply work to do.
          or(
            and(
              sql`${shipments.deliveryWindowStartMinute} is not null`,
              lt(shipments.deliveryWindowStartMinute, nowMinute + 60),
            ),
            sql`${shipments.deliveryWindowStartMinute} is null and ${nowMinute} > 780`,
          ),
        ),
      );

    /**
     * Decide what is genuinely new before emitting anything.
     *
     * `OutboxService.emit` throws on a repeated dedupe key, and rightly so: for ordinary
     * callers a second emission of the same fact is an idempotency bug worth hearing about.
     * A sweep is the exception — it runs every minute and most of what it finds it has already
     * reported — so it asks first rather than catching an error it expects.
     */
    /**
     * Stops the driver will not reach in time, projected from where the van actually is.
     *
     * This is the half worth having. The query above tells a dispatcher a window has closed,
     * which they will shortly hear from the customer anyway; this tells them at eleven that the
     * two o'clock will not be made, while there is still something to be done about it.
     */
    const predicted: {
      shipmentId: string;
      waybill: string;
      bookingId: string;
      accountId: string;
      tripId: string | null;
      driverId: string;
      windowEndMinute: number;
      lateMinutes: number;
    }[] = [];
    const liveNow = await this.live.live(today);
    for (const driver of liveNow.drivers) {
      if (driver.activity !== "working") continue;
      for (const stop of driver.stops) {
        // Only a stop whose window is still open: once it has closed the sweep above owns it,
        // and two events about one parcel is how a dispatcher learns to ignore both.
        if (!stop.willMissWindow || stop.window.endMinute == null) continue;
        if (stop.window.endMinute < nowMinute) continue;
        // Collections have no shipment of their own, and a parcel already delivered or failed
        // is nobody's risk.
        if (!stop.shipmentId || !stop.accountId || !stop.waybill) continue;
        if (!stop.status || !LIVE.includes(stop.status)) continue;
        predicted.push({
          shipmentId: stop.shipmentId,
          waybill: stop.waybill,
          bookingId: stop.bookingId,
          accountId: stop.accountId,
          tripId: driver.tripId,
          driverId: driver.driverId,
          windowEndMinute: stop.window.endMinute,
          lateMinutes: stop.lateMinutes,
        });
      }
    }

    const candidates = [
      ...missed
        // The window the driver is actually working to: a dispatcher's narrowing wins over what
        // was sold, because that is the one on the trip sheet in the van.
        .map((row) => ({ row, endMinute: row.stopEndMinute ?? row.soldEndMinute }))
        .filter(({ row, endMinute }) => {
          if (endMinute == null || endMinute >= nowMinute) return false;
          // A stop already done or skipped is not at risk; the shipment status will say so.
          return row.stopStatus == null || ["pending", "arrived"].includes(row.stopStatus);
        })
        .map(({ row, endMinute }) => ({
          key: `at_risk:${row.shipmentId}:${endMinute}`,
          payload: {
            shipmentId: row.shipmentId,
            bookingId: row.bookingId,
            accountId: row.accountId,
            waybill: row.waybill,
            tripId: row.tripId,
            driverId: row.driverId,
            reason: "window_passed" as const,
            minutes: nowMinute - endMinute!,
            windowEndMinute: endMinute,
          },
        })),
      ...predicted.map((row) => ({
        key: `at_risk:${row.shipmentId}:eta:${row.windowEndMinute}`,
        payload: {
          shipmentId: row.shipmentId,
          bookingId: row.bookingId,
          accountId: row.accountId,
          waybill: row.waybill,
          tripId: row.tripId,
          driverId: row.driverId,
          reason: "eta_after_window" as const,
          minutes: row.lateMinutes,
          windowEndMinute: row.windowEndMinute,
        },
      })),
      ...orphaned.map((row) => ({
        key: `at_risk:${row.shipmentId}:unassigned:${today}`,
        payload: {
          shipmentId: row.shipmentId,
          bookingId: row.bookingId,
          accountId: row.accountId,
          waybill: row.waybill,
          tripId: null,
          driverId: null,
          reason: "unassigned_near_cutoff" as const,
          minutes: row.windowEndMinute == null ? 0 : row.windowEndMinute - nowMinute,
          windowEndMinute: row.windowEndMinute,
        },
      })),
    ];
    if (candidates.length === 0) return 0;

    const already = new Set(
      (
        await this.dbs.db
          .select({ dedupeKey: outboxMessages.dedupeKey })
          .from(outboxMessages)
          .where(
            inArray(
              outboxMessages.dedupeKey,
              candidates.map((c) => c.key),
            ),
          )
      ).map((r) => r.dedupeKey),
    );
    const fresh = candidates.filter((c) => !already.has(c.key));
    if (fresh.length === 0) return 0;

    let raised = 0;
    await this.dbs.transaction(async (tx) => {
      for (const candidate of fresh) {
        await this.outbox.emit(tx, "shipment.at_risk", candidate.payload, {
          dedupeKey: candidate.key,
        });
        raised++;
      }
    });

    if (raised > 0) this.logger.warn({ raised, today }, "shipments at risk");
    return raised;
  }

  private async nowMinute(): Promise<number> {
    const tz = await this.settings.get("company.timezone");
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: tz,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(this.clock.now());
    const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? "0");
    return get("hour") * 60 + get("minute");
  }
}
