import { Injectable } from "@nestjs/common";
import {
  and,
  asc,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  or,
  sql,
} from "drizzle-orm";
import {
  resolvePeriod,
  operatingToday,
  rangeToInstants,
  type DateRange,
  type ShipmentFilterQuery,
  type ShipmentStatus,
} from "@delicate/contracts";
import {
  assignments,
  bookings,
  drivers,
  proofsOfDelivery,
  shipmentChangeRequests,
  shipments,
  users,
} from "@delicate/db";
import { DbService } from "../../infra/db.module.js";
import { Clock } from "../../infra/clock.js";
import { toShipment } from "./booking.service.js";

/**
 * Reading shipments: the filtered list behind both the portal and the console, and the counts
 * behind the dashboards.
 *
 * Kept apart from BookingService, which is about *changing* things and has to be careful about
 * transactions and invariants. Nothing here writes, so it is free to be a pile of query
 * building without that weighing on the part of the codebase that moves money.
 */
@Injectable()
export class ShipmentQueryService {
  constructor(
    private readonly dbs: DbService,
    private readonly clock: Clock,
  ) {}

  /** The date range a query asks for, or null when it asks for all of time. */
  private rangeOf(q: ShipmentFilterQuery): DateRange | null {
    if (!q.period && !q.from && !q.to) return null;
    return resolvePeriod(q.period ?? "custom", {
      now: this.clock.now(),
      from: q.from ?? null,
      to: q.to ?? null,
    });
  }

  /**
   * Everything a filter narrows by, as one SQL condition.
   *
   * Some filters are columns on `shipments` and some are the existence of a row somewhere
   * else. The second kind are written as EXISTS subqueries rather than joins, because a join
   * to a table that may hold several matching rows silently multiplies the result — a shipment
   * with two change requests appearing twice in the list is the kind of bug that is noticed
   * late and blamed on the data.
   */
  private conditions(accountId: string | null, q: ShipmentFilterQuery) {
    const range = this.rangeOf(q);
    const parts = [
      accountId ? eq(shipments.accountId, accountId) : undefined,
      q.accountId ? eq(shipments.accountId, q.accountId) : undefined,
      q.status?.length ? inArray(shipments.status, q.status) : undefined,
      q.serviceLevelCode ? eq(shipments.serviceLevelCode, q.serviceLevelCode) : undefined,
    ];

    if (range) parts.push(this.dateCondition(q.dateType, range));

    if (q.search) {
      // One box across the identifiers a person is likely to be holding. Recipient name,
      // phone and address live inside jsonb, so they are compared as text.
      const like = `%${q.search}%`;
      parts.push(
        or(
          ilike(shipments.waybill, like),
          sql`${shipments.recipient}->>'name' ILIKE ${like}`,
          sql`${shipments.recipient}->>'phone' ILIKE ${like}`,
          sql`${shipments.deliveryAddress}->>'formatted' ILIKE ${like}`,
          sql`EXISTS (SELECT 1 FROM ${bookings} b
                      WHERE b.id = ${shipments.bookingId}
                        AND (b.reference ILIKE ${like} OR b.customer_reference ILIKE ${like}))`,
        ),
      );
    }

    if (q.driverId) {
      parts.push(
        sql`EXISTS (SELECT 1 FROM ${assignments} a
                    WHERE a.shipment_id = ${shipments.id}
                      AND a.driver_id = ${q.driverId} AND a.active = true)`,
      );
    }

    for (const flag of q.flags ?? []) {
      switch (flag) {
        case "has_pod":
          parts.push(
            sql`EXISTS (SELECT 1 FROM ${proofsOfDelivery} p WHERE p.shipment_id = ${shipments.id})`,
          );
          break;
        case "missing_pod":
          // Only meaningful once delivered: a booked shipment has no POD and that is correct.
          parts.push(
            and(
              eq(shipments.status, "delivered"),
              sql`NOT EXISTS (SELECT 1 FROM ${proofsOfDelivery} p WHERE p.shipment_id = ${shipments.id})`,
            ),
          );
          break;
        case "pending_change":
          parts.push(
            sql`EXISTS (SELECT 1 FROM ${shipmentChangeRequests} c
                        WHERE c.shipment_id = ${shipments.id} AND c.status = 'pending')`,
          );
          break;
        case "address_changed":
          parts.push(
            sql`EXISTS (SELECT 1 FROM ${shipmentChangeRequests} c
                        WHERE c.shipment_id = ${shipments.id}
                          AND c.kind = 'delivery_address'
                          AND c.status IN ('approved', 'auto_applied'))`,
          );
          break;
        case "rescheduled":
          parts.push(
            sql`EXISTS (SELECT 1 FROM ${shipmentChangeRequests} c
                        WHERE c.shipment_id = ${shipments.id}
                          AND c.kind = 'reschedule'
                          AND c.status IN ('approved', 'auto_applied'))`,
          );
          break;
        case "has_declared_value":
          parts.push(sql`(${shipments.parcels})::text ILIKE '%declaredValueCents%'`);
          break;
        case "unassigned":
          parts.push(
            and(
              inArray(shipments.status, ["booked"] as ShipmentStatus[]),
              sql`NOT EXISTS (SELECT 1 FROM ${assignments} a
                              WHERE a.shipment_id = ${shipments.id} AND a.active = true)`,
            ),
          );
          break;
        case "late":
          // Scheduled for a day already past and still not finished. Deliberately a whole-day
          // comparison: within the day it is not late, it is just not done yet.
          parts.push(
            and(
              lt(shipments.slotDate, operatingToday(this.clock.now())),
              inArray(shipments.status, [
                "booked",
                "assigned",
                "collected",
                "in_transit",
              ] as ShipmentStatus[]),
            ),
          );
          break;
      }
    }

    return and(...parts.filter(Boolean));
  }

  /** Which date column a period applies to. */
  private dateCondition(dateType: ShipmentFilterQuery["dateType"], range: DateRange) {
    if (dateType === "slot") {
      // slot_date is already a calendar date in the operating timezone, so it compares directly.
      return and(gte(shipments.slotDate, range.from), lte(shipments.slotDate, range.to));
    }
    const { from, toExclusive } = rangeToInstants(range);
    if (dateType === "created")
      return and(gte(shipments.createdAt, from), lt(shipments.createdAt, toExclusive));
    if (dateType === "delivered")
      return and(gte(shipments.deliveredAt, from), lt(shipments.deliveredAt, toExclusive));
    // "Collected on" is not a column — it is when the shipment entered `collected`, which only
    // the event history knows.
    return sql`EXISTS (SELECT 1 FROM shipment_events e
                       WHERE e.shipment_id = ${shipments.id}
                         AND e.status = 'collected'
                         AND e.occurred_at >= ${from} AND e.occurred_at < ${toExclusive})`;
  }

  private ordering(sort: ShipmentFilterQuery["sort"]) {
    switch (sort) {
      case "oldest":
        return [asc(shipments.createdAt)];
      // A null slot date is an unscheduled job; it sorts last either way rather than jumping
      // to the top of an ascending list.
      case "slot_asc":
        return [sql`${shipments.slotDate} ASC NULLS LAST`, asc(shipments.sequence)];
      case "slot_desc":
        return [sql`${shipments.slotDate} DESC NULLS LAST`, asc(shipments.sequence)];
      default:
        return [desc(shipments.createdAt)];
    }
  }

  /**
   * The filtered list, with the extras the table shows: driver, whether a POD exists, whether
   * a change is waiting. Gathered in three queries rather than one join so that no shipment
   * can be duplicated by a one-to-many, and so the row count stays exactly the page size.
   */
  async list(accountId: string | null, q: ShipmentFilterQuery) {
    const where = this.conditions(accountId, q);
    const cursorDate = q.cursor ? new Date(q.cursor) : null;

    const rows = await this.dbs.db
      .select()
      .from(shipments)
      .where(and(where, cursorDate ? lt(shipments.createdAt, cursorDate) : undefined))
      .orderBy(...this.ordering(q.sort))
      .limit(q.limit + 1);

    const page = rows.slice(0, q.limit);
    const ids = page.map((r) => r.id);
    const [assigned, pods, pending] = await Promise.all([
      ids.length
        ? this.dbs.db
            .select({
              shipmentId: assignments.shipmentId,
              driverId: drivers.id,
              driverName: users.fullName,
            })
            .from(assignments)
            .innerJoin(drivers, eq(drivers.id, assignments.driverId))
            .leftJoin(users, eq(users.id, drivers.userId))
            .where(and(inArray(assignments.shipmentId, ids), eq(assignments.active, true)))
        : [],
      ids.length
        ? this.dbs.db
            .select({ shipmentId: proofsOfDelivery.shipmentId })
            .from(proofsOfDelivery)
            .where(inArray(proofsOfDelivery.shipmentId, ids))
        : [],
      ids.length
        ? this.dbs.db
            .select({ shipmentId: shipmentChangeRequests.shipmentId })
            .from(shipmentChangeRequests)
            .where(
              and(
                inArray(shipmentChangeRequests.shipmentId, ids),
                eq(shipmentChangeRequests.status, "pending"),
              ),
            )
        : [],
    ]);

    const driverBy = new Map(assigned.map((a) => [a.shipmentId, a]));
    const hasPod = new Set(pods.map((p) => p.shipmentId));
    const hasPending = new Set(pending.map((p) => p.shipmentId));
    const today = operatingToday(this.clock.now());

    const items = page.map((r) => ({
      ...toShipment(r),
      driver: driverBy.get(r.id)
        ? { id: driverBy.get(r.id)!.driverId, name: driverBy.get(r.id)!.driverName }
        : null,
      hasPod: hasPod.has(r.id),
      hasPendingChange: hasPending.has(r.id),
      isLate:
        !!r.slotDate &&
        r.slotDate < today &&
        ["booked", "assigned", "collected", "in_transit"].includes(r.status),
    }));

    return {
      items,
      nextCursor:
        rows.length > q.limit && page.length
          ? page[page.length - 1]!.createdAt.toISOString()
          : null,
    };
  }

  /** How many shipments sit in each status for a filter, for the tabs above the table. */
  async statusCounts(accountId: string | null, q: ShipmentFilterQuery) {
    // The status filter itself is dropped, otherwise every tab but the selected one reads zero.
    const { status: _ignored, ...rest } = q;
    const rows = await this.dbs.db
      .select({ status: shipments.status, count: sql<number>`count(*)::int` })
      .from(shipments)
      .where(this.conditions(accountId, rest as ShipmentFilterQuery))
      .groupBy(shipments.status);
    return Object.fromEntries(rows.map((r) => [r.status, r.count])) as Partial<
      Record<ShipmentStatus, number>
    >;
  }
}
