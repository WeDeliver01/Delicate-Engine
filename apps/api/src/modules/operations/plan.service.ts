import { Injectable } from "@nestjs/common";
import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
import {
  type DayJob,
  type DayDriver,
  type DayPlan,
  type DayPlanDriver,
  type LatLng,
  type QuoteParcel,
  type ShipmentStatus,
  allocateDay,
  operatingToday,
} from "@delicate/contracts";
import {
  accounts,
  assignments,
  bookings,
  drivers,
  shifts,
  shipments,
  trips,
  vehicles,
} from "@delicate/db";
import { DbService } from "../../infra/db.module.js";
import { SettingsService } from "../../infra/settings.service.js";
import { Clock } from "../../infra/clock.js";
import { AppError } from "../../common/errors.js";
import { TripService } from "./trip.service.js";

const PLACEABLE: ShipmentStatus[] = ["booked", "assigned"];

/**
 * Plan a whole day at once.
 *
 * Everything the old planner knew about sharing work out, applied to the engine's own data:
 * drivers on shift, their vehicles' limits, the customers who insist on a particular one, and
 * the windows each drop is working to.
 *
 * It only ever proposes. A dispatcher reads the plan, and applying it is a second, explicit
 * call — which is the whole posture the brief asked for: the algorithm assists dispatch rather
 * than becoming the dispatcher.
 */
@Injectable()
export class PlanService {
  constructor(
    private readonly dbs: DbService,
    private readonly settings: SettingsService,
    private readonly clock: Clock,
    private readonly trips: TripService,
  ) {}

  async plan(date?: string): Promise<DayPlan> {
    const day = date ?? operatingToday(this.clock.now());
    const depot = (await this.settings.get("company.depot_address")).location;
    const policy = await this.settings.get("scheduling.policy");
    const startMinute = policy.windows[0]?.startMinutes ?? 420;
    const endMinute = policy.windows[policy.windows.length - 1]?.endMinutes ?? 1020;

    const fleetRows = await this.dbs.db
      .select({
        d: drivers,
        registration: vehicles.registration,
        constraints: vehicles.constraints,
        shiftStatus: shifts.status,
        tripId: trips.id,
        tripReference: trips.reference,
      })
      .from(drivers)
      .innerJoin(shifts, and(eq(shifts.driverId, drivers.id), eq(shifts.date, day)))
      .leftJoin(vehicles, eq(vehicles.id, drivers.vehicleId))
      .leftJoin(
        trips,
        and(
          eq(trips.driverId, drivers.id),
          eq(trips.date, day),
          inArray(trips.status, ["planned", "released", "started"]),
        ),
      )
      .where(and(eq(drivers.status, "active"), inArray(shifts.status, ["scheduled", "open"])));

    const work = await this.dbs.db
      .select({
        s: shipments,
        b: bookings,
        requiresVehicleClass: accounts.requiresVehicleClass,
        assignedTo: assignments.driverId,
      })
      .from(shipments)
      .innerJoin(bookings, eq(bookings.id, shipments.bookingId))
      .innerJoin(accounts, eq(accounts.id, shipments.accountId))
      .leftJoin(
        assignments,
        and(eq(assignments.shipmentId, shipments.id), eq(assignments.active, true)),
      )
      .where(
        and(
          inArray(shipments.status, PLACEABLE),
          or(
            eq(shipments.slotDate, day),
            and(isNull(shipments.slotDate), sql`${day} = ${operatingToday(this.clock.now())}`),
          ),
        ),
      );

    const unplaced: DayPlan["unplaced"] = [];
    const jobs: DayJob[] = [];
    for (const row of work) {
      const collection = addressLocation(row.b.collection);
      const delivery = addressLocation(row.s.deliveryAddress);
      // An address nobody could place cannot be planned around. Said out loud rather than
      // quietly left out of the day.
      if (!collection || !delivery) {
        unplaced.push({
          shipmentId: row.s.id,
          waybill: row.s.waybill,
          reason: !collection
            ? "the collection address has no coordinates"
            : "the delivery address has no coordinates",
        });
        continue;
      }
      const parcels = row.s.parcels as (QuoteParcel & { packageTypeCode?: string })[];
      const pieces = parcels.reduce((n, p) => n + (p.quantity ?? 1), 0);
      jobs.push({
        id: row.s.id,
        pieces,
        packageTypeCodes: [
          ...new Set(parcels.map((p) => p.packageTypeCode).filter((c): c is string => !!c)),
        ],
        requiresVehicleClass: row.requiresVehicleClass,
        collection: {
          id: `c:${row.b.id}`,
          kind: "collection",
          location: collection,
          pieces,
          earliestMinute: windowStart(policy, row.b.slotWindowKey),
          latestMinute: windowEnd(policy, row.b.slotWindowKey),
        },
        drop: {
          id: `d:${row.s.id}`,
          kind: "drop",
          location: delivery,
          afterStopId: `c:${row.b.id}`,
          pieces,
          earliestMinute: windowStart(policy, row.s.slotWindowKey),
          latestMinute: windowEnd(policy, row.s.slotWindowKey),
          alreadyOnBoard: false,
        },
      });
    }

    const fleet: DayDriver[] = fleetRows.map((r) => ({
      id: r.d.id,
      depot: (r.d.homeBase as LatLng | null) ?? depot,
      shiftStartMinute: startMinute,
      shiftEndMinute: endMinute,
      stopCapacity: r.d.dailyStopCapacity,
      // Until a per-vehicle rate is configured, every driver costs the same per km, so this
      // term orders by distance and nothing else — which is what it is for.
      costPerKmCents: 250,
      vehicle: r.constraints as DayDriver["vehicle"],
    }));

    if (fleet.length === 0) {
      return {
        date: day,
        unplaced: [
          ...unplaced,
          ...jobs.map((j) => ({
            shipmentId: j.id,
            waybill: work.find((w) => w.s.id === j.id)!.s.waybill,
            reason: "no driver has a shift on this date",
          })),
        ],
        drivers: [],
        totalKm: 0,
        lateMinutes: 0,
        overtimeMinutes: 0,
        warnings: ["Nobody is on shift. Schedule a driver before planning the day."],
      };
    }

    // Work a dispatcher has already placed by hand stays where they put it.
    const pinned: Record<string, string> = {};
    for (const row of work) {
      if (row.assignedTo && fleet.some((f) => f.id === row.assignedTo)) {
        pinned[row.s.id] = row.assignedTo;
      }
    }

    const result = allocateDay({
      drivers: fleet,
      jobs,
      pinned,
      // Stable, so the same morning always proposes the same plan. A suggestion that changes
      // every time you look at it is noise, not advice.
      seed: hash(`${day}:${jobs.length}:${fleet.length}`),
    });

    const waybillBy = new Map(work.map((w) => [w.s.id, w.s.waybill]));
    const planned: DayPlanDriver[] = fleetRows.map((r) => {
      const mine = result.perDriver[r.d.id];
      const jobIds = mine?.jobIds ?? [];
      return {
        driverId: r.d.id,
        name: r.d.fullName,
        vehicleRegistration: r.registration ?? null,
        tripId: r.tripId ?? null,
        tripReference: r.tripReference ?? null,
        shipmentIds: jobIds,
        waybills: jobIds.map((id) => waybillBy.get(id) ?? id),
        stopCount: mine?.sequence.stops.length ?? 0,
        plannedKm: mine?.sequence.totalKm ?? 0,
        plannedMinutes: mine?.sequence.totalMinutes ?? 0,
        finishMinute: Math.min(1440, mine?.sequence.finishMinute ?? startMinute),
        overtimeMinutes: mine?.sequence.overtimeMinutes ?? 0,
        lateStopCount: mine?.sequence.lateStops.length ?? 0,
      };
    });

    const warnings = result.score.constraintBreaches.map((b) =>
      b.jobId ? `${waybillBy.get(b.jobId) ?? b.jobId}: ${b.detail}` : `A driver's load ${b.detail}`,
    );
    if (result.score.capBreaches > 0) {
      warnings.push(`${result.score.capBreaches} stop(s) over a driver's daily capacity.`);
    }

    return {
      date: day,
      unplaced,
      drivers: planned,
      totalKm: Math.round(planned.reduce((n, d) => n + d.plannedKm, 0) * 100) / 100,
      lateMinutes: result.score.lateMinutes,
      overtimeMinutes: result.score.overtimeMinutes,
      warnings,
    };
  }

  /**
   * Turn a plan into trips. Makes each driver's trip if they have none, then puts their share
   * on it — leaving the trips in `planned`, so a dispatcher still reads the sheet and releases
   * it themselves.
   */
  async apply(date: string, driverIds?: string[]): Promise<DayPlan> {
    const plan = await this.plan(date);
    const wanted = driverIds?.length
      ? plan.drivers.filter((d) => driverIds.includes(d.driverId))
      : plan.drivers;
    if (wanted.length === 0) {
      throw AppError.conflict("nothing_to_apply", "the plan puts no work on those drivers");
    }

    for (const d of wanted) {
      if (d.shipmentIds.length === 0) continue;
      const existing = await this.dbs.db.query.trips.findFirst({
        where: and(
          eq(trips.driverId, d.driverId),
          eq(trips.date, date),
          inArray(trips.status, ["planned", "released", "started"]),
        ),
      });
      const trip =
        existing ?? (await this.trips.create({ driverId: d.driverId, date, vehicleId: null }));
      await this.trips.addStops(trip.id, { shipmentIds: d.shipmentIds, resequence: true });
    }
    return this.plan(date);
  }
}

function addressLocation(address: unknown): LatLng | null {
  const target = (address as { address?: { location?: LatLng }; location?: LatLng } | null) ?? null;
  const loc = target?.address?.location ?? target?.location;
  return loc && typeof loc.lat === "number" && typeof loc.lng === "number" ? loc : null;
}

function windowStart(
  policy: { windows: { key: string; startMinutes: number }[] },
  key: string | null,
): number | null {
  return policy.windows.find((w) => w.key === key)?.startMinutes ?? null;
}

function windowEnd(
  policy: { windows: { key: string; endMinutes: number }[] },
  key: string | null,
): number | null {
  return policy.windows.find((w) => w.key === key)?.endMinutes ?? null;
}

/** Stable seed from the day, so the plan is repeatable without storing anything. */
function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
