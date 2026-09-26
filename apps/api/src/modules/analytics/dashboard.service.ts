import { Injectable } from "@nestjs/common";
import { and, asc, count, desc, eq, gte, inArray, lt, sql } from "drizzle-orm";
import {
  operatingToday,
  previousPeriod,
  rangeToInstants,
  resolvePeriod,
  type DateRange,
  type PeriodKey,
} from "@delicate/contracts";
import { assignments, bookings, drivers, invoices, shipments, users } from "@delicate/db";
import { DbService } from "../../infra/db.module.js";
import { Clock } from "../../infra/clock.js";
import { WalletService } from "../wallet/wallet.service.js";

/** A number with the same number from the period before it, so it can be read as a direction. */
export interface Trend {
  value: number;
  previous: number;
}

/**
 * What the customer's dashboard shows.
 *
 * The rule this is built to: nobody opens this to browse. They open it to find out whether
 * today is going to be fine. So the first thing it answers is "what is happening today", and
 * everything else — the period totals, the spend — is context underneath that.
 */
@Injectable()
export class DashboardService {
  constructor(
    private readonly dbs: DbService,
    private readonly clock: Clock,
    private readonly wallet: WalletService,
  ) {}

  async forAccount(accountId: string, period: PeriodKey, from?: string, to?: string) {
    const now = this.clock.now();
    const today = operatingToday(now);
    const range = resolvePeriod(period, { now, from: from ?? null, to: to ?? null });

    const [todayBoard, live, totals, prior, spend, wallet, upcoming] = await Promise.all([
      this.dayBoard(accountId, today),
      this.liveShipments(accountId),
      this.periodTotals(accountId, range),
      this.periodTotals(accountId, previousPeriod(range)),
      this.periodSpend(accountId, range),
      this.walletSnapshot(accountId),
      this.nextDays(accountId, today),
    ]);

    return {
      today: { date: today, ...todayBoard },
      live,
      upcoming,
      range,
      shipments: trend(totals.shipments, prior.shipments),
      delivered: trend(totals.delivered, prior.delivered),
      failed: trend(totals.failed, prior.failed),
      onTimeRate: totals.delivered ? Math.round((totals.onTime / totals.delivered) * 100) : null,
      spend,
      wallet,
    };
  }

  /**
   * Today, broken into the four states a customer actually distinguishes: not started, on the
   * way, done, went wrong. The engine's seven statuses are more detail than the question
   * "is today going to be fine" needs.
   */
  private async dayBoard(accountId: string, day: string) {
    const rows = await this.dbs.db
      .select({ status: shipments.status, n: count() })
      .from(shipments)
      .where(and(eq(shipments.accountId, accountId), eq(shipments.slotDate, day)))
      .groupBy(shipments.status);

    const n = (...statuses: string[]) =>
      rows.filter((r) => statuses.includes(r.status)).reduce((sum, r) => sum + r.n, 0);

    return {
      total: rows.reduce((sum, r) => sum + r.n, 0),
      scheduled: n("booked", "assigned"),
      inFlight: n("collected", "in_transit"),
      delivered: n("delivered"),
      failed: n("failed"),
      cancelled: n("cancelled"),
    };
  }

  /**
   * Everything on the road right now, with its driver. Not restricted to today's slot date:
   * a shipment that slipped past midnight is still out there, and hiding it because the
   * calendar rolled over is exactly when someone needs to see it.
   */
  private async liveShipments(accountId: string) {
    const rows = await this.dbs.db
      .select({
        id: shipments.id,
        waybill: shipments.waybill,
        status: shipments.status,
        slotDate: shipments.slotDate,
        slotWindowKey: shipments.slotWindowKey,
        recipient: shipments.recipient,
        deliveryAddress: shipments.deliveryAddress,
        driverId: drivers.id,
        driverName: users.fullName,
      })
      .from(shipments)
      .leftJoin(
        assignments,
        and(eq(assignments.shipmentId, shipments.id), eq(assignments.active, true)),
      )
      .leftJoin(drivers, eq(drivers.id, assignments.driverId))
      .leftJoin(users, eq(users.id, drivers.userId))
      .where(
        and(
          eq(shipments.accountId, accountId),
          inArray(shipments.status, ["collected", "in_transit"]),
        ),
      )
      .orderBy(asc(shipments.slotDate), asc(shipments.sequence))
      .limit(25);

    return rows.map((r) => ({
      id: r.id,
      waybill: r.waybill,
      status: r.status,
      slotDate: r.slotDate,
      slotWindowKey: r.slotWindowKey,
      recipient: r.recipient as { name: string; phone: string | null },
      deliveryAddress: r.deliveryAddress as { formatted: string; suburb: string | null },
      driver: r.driverId ? { id: r.driverId, name: r.driverName } : null,
      // Only an out-for-delivery shipment has a driver position worth plotting; the rest
      // would put a van on a map that is nowhere near the parcel.
      trackable: r.status === "in_transit",
    }));
  }

  /** Counts over a period, by scheduled date, plus how many of the delivered ones made it on time. */
  private async periodTotals(accountId: string, range: DateRange) {
    const rows = await this.dbs.db
      .select({
        status: shipments.status,
        n: count(),
        // Delivered before the end of the day it was scheduled for. A same-day courier's
        // promise is the window, and the window never crosses midnight.
        onTime: sql<number>`count(*) FILTER (
          WHERE ${shipments.status} = 'delivered'
            AND ${shipments.deliveredAt} IS NOT NULL
            AND (${shipments.deliveredAt} AT TIME ZONE 'Africa/Johannesburg')::date
                <= ${shipments.slotDate}
        )::int`,
      })
      .from(shipments)
      .where(
        and(
          eq(shipments.accountId, accountId),
          gte(shipments.slotDate, range.from),
          sql`${shipments.slotDate} <= ${range.to}`,
        ),
      )
      .groupBy(shipments.status);

    const n = (...statuses: string[]) =>
      rows.filter((r) => statuses.includes(r.status)).reduce((sum, r) => sum + r.n, 0);

    return {
      shipments: rows.reduce((sum, r) => sum + r.n, 0),
      delivered: n("delivered"),
      failed: n("failed"),
      onTime: rows.reduce((sum, r) => sum + r.onTime, 0),
    };
  }

  /** What the period cost, from bookings placed in it. */
  private async periodSpend(accountId: string, range: DateRange) {
    const { from, toExclusive } = rangeToInstants(range);
    const [row] = await this.dbs.db
      .select({
        bookings: count(),
        totalCents: sql<number>`COALESCE(SUM(${bookings.totalCents}), 0)::bigint`,
      })
      .from(bookings)
      .where(
        and(
          eq(bookings.accountId, accountId),
          gte(bookings.createdAt, from),
          lt(bookings.createdAt, toExclusive),
          // Rejected bookings never cost anything, so counting them would overstate spend.
          inArray(bookings.status, ["confirmed", "in_progress", "completed", "cancelled"]),
        ),
      );
    return {
      bookings: row?.bookings ?? 0,
      totalCents: Number(row?.totalCents ?? 0),
    };
  }

  private async walletSnapshot(accountId: string) {
    // Through the wallet's own service rather than its tables: "available" is balance plus
    // credit limit less active holds, and that definition belongs to the module that owns it.
    const now = this.clock.now();
    const [summary, unpaid] = await Promise.all([
      this.wallet.summary(accountId),
      // One pass over the unpaid invoices: how many, how much, and how many are past due.
      // A FILTER clause rather than a second query, because the two answers come from the
      // same rows and reading them separately invites them to disagree.
      this.dbs.db
        .select({
          n: count(),
          cents: sql<number>`COALESCE(SUM(${invoices.outstandingCents}), 0)::bigint`,
          overdue: sql<number>`count(*) FILTER (WHERE ${invoices.dueAt} < ${now})::int`,
        })
        .from(invoices)
        .where(
          and(
            eq(invoices.accountId, accountId),
            eq(invoices.status, "issued"),
            sql`${invoices.outstandingCents} > 0`,
          ),
        ),
    ]);

    const [row] = unpaid;

    return {
      balanceCents: summary.balanceCents,
      creditLimitCents: summary.creditLimitCents,
      heldCents: summary.heldCents,
      availableCents: summary.availableCents,
      billingMode: summary.billingMode,
      outstandingInvoices: row?.n ?? 0,
      outstandingCents: Number(row?.cents ?? 0),
      overdueInvoices: row?.overdue ?? 0,
    };
  }

  /** The next few days with anything booked, so tomorrow is never a surprise. */
  private async nextDays(accountId: string, today: string) {
    const rows = await this.dbs.db
      .select({ slotDate: shipments.slotDate, n: count() })
      .from(shipments)
      .where(
        and(
          eq(shipments.accountId, accountId),
          sql`${shipments.slotDate} > ${today}`,
          inArray(shipments.status, ["booked", "assigned"]),
        ),
      )
      .groupBy(shipments.slotDate)
      .orderBy(asc(shipments.slotDate))
      .limit(7);
    return rows.map((r) => ({ date: r.slotDate!, count: r.n }));
  }
}

function trend(value: number, previous: number): Trend {
  return { value, previous };
}
