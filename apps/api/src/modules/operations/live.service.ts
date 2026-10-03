import { Injectable } from "@nestjs/common";
import { and, asc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import {
  type Advisory,
  type LatLng,
  type LiveDriver,
  type LiveOperations,
  type LiveStop,
  type QuoteParcel,
  type RemainingStop,
  operatingToday,
  operationalAdvisories,
  projectArrivals,
  routeDeviation,
} from "@delicate/contracts";
import {
  assignments,
  bookings,
  driverPositions,
  drivers,
  shifts,
  shipments,
  tripStops,
  trips,
  vehicles,
} from "@delicate/db";
import { DbService } from "../../infra/db.module.js";
import { SettingsService } from "../../infra/settings.service.js";
import { Clock } from "../../infra/clock.js";
import { FleetService } from "../fleet/fleet.service.js";

/**
 * Live operations: the day as it is actually going.
 *
 * Everything is derived per request and stored nowhere, because an ETA is only true for as long
 * as the van is where it was when we asked. Writing one down would create a number that is
 * wrong within minutes and that somebody would eventually trust.
 */
@Injectable()
export class LiveService {
  constructor(
    private readonly dbs: DbService,
    private readonly settings: SettingsService,
    private readonly clock: Clock,
    private readonly fleet: FleetService,
  ) {}

  async live(date?: string): Promise<LiveOperations> {
    const day = date ?? operatingToday(this.clock.now());
    const nowMinute = await this.nowMinute();
    const depot = (await this.settings.get("company.depot_address")).location;
    const now = this.clock.now();

    const fleetRows = await this.dbs.db
      .select({
        d: drivers,
        registration: vehicles.registration,
        shiftStatus: shifts.status,
        shiftId: shifts.id,
        shiftStartedAt: shifts.startedAt,
        tripId: trips.id,
        tripReference: trips.reference,
        tripStatus: trips.status,
        plannedKm: trips.plannedKm,
        position: driverPositions.location,
        positionAt: driverPositions.recordedAt,
      })
      .from(drivers)
      .leftJoin(vehicles, eq(vehicles.id, drivers.vehicleId))
      .leftJoin(shifts, and(eq(shifts.driverId, drivers.id), eq(shifts.date, day)))
      .leftJoin(
        trips,
        and(
          eq(trips.driverId, drivers.id),
          eq(trips.date, day),
          sql`${trips.status} <> 'abandoned'`,
        ),
      )
      .leftJoin(driverPositions, eq(driverPositions.driverId, drivers.id))
      .where(eq(drivers.status, "active"));

    const tripIds = fleetRows.map((r) => r.tripId).filter((id): id is string => !!id);
    const stopRows = tripIds.length
      ? await this.dbs.db
          .select({
            stop: tripStops,
            collection: bookings.collection,
            deliveryAddress: shipments.deliveryAddress,
            waybill: shipments.waybill,
            parcels: shipments.parcels,
            accountId: shipments.accountId,
            status: shipments.status,
          })
          .from(tripStops)
          .innerJoin(bookings, eq(bookings.id, tripStops.bookingId))
          .leftJoin(shipments, eq(shipments.id, tripStops.shipmentId))
          .where(inArray(tripStops.tripId, tripIds))
          .orderBy(asc(tripStops.sequence))
      : [];

    const unassignedCount = await this.dbs.db.$count(
      shipments,
      and(
        eq(shipments.status, "booked"),
        or(eq(shipments.slotDate, day), isNull(shipments.slotDate)),
        sql`not exists (select 1 from ${assignments} a
                        where a.shipment_id = ${shipments.id} and a.active = true)`,
      ),
    );

    const live: LiveDriver[] = [];
    for (const row of fleetRows) {
      const mine = stopRows.filter((s) => s.stop.tripId === row.tripId);
      const done = mine.filter((s) => s.stop.status === "done").length;
      const skipped = mine.filter((s) => s.stop.status === "skipped").length;
      const outstanding = mine.filter(
        (s) => s.stop.status === "pending" || s.stop.status === "arrived",
      );
      const position = (row.position as LatLng | null) ?? null;
      const silentMinutes =
        row.positionAt == null
          ? null
          : Math.max(0, Math.round((now.getTime() - row.positionAt.getTime()) / 60_000));

      // Project from where they are, when we know. Without a position the plan is all we have,
      // and saying so (a null ETA) beats inventing one from the depot at 6am.
      const projected =
        position && outstanding.length > 0
          ? projectArrivals({
              at: position,
              nowMinute,
              stops: outstanding.map((s) => this.toRemaining(s)),
            })
          : [];
      const etaBy = new Map(projected.map((p) => [p.id, p]));

      const lastDone = [...mine]
        .filter((s) => s.stop.status === "done")
        .sort((a, b) => b.stop.sequence - a.stop.sequence)[0];
      const next = outstanding[0];
      const deviation = position
        ? routeDeviation({
            at: position,
            from: lastDone ? this.locationOf(lastDone) : depot,
            heading: next ? this.locationOf(next) : null,
          })
        : { offRouteKm: 0, remainingKm: 0, notable: false };

      live.push({
        driverId: row.d.id,
        name: row.d.fullName,
        vehicleRegistration: row.registration ?? null,
        tripId: row.tripId ?? null,
        tripReference: row.tripReference ?? null,
        activity: activityOf(row.shiftStatus ?? "none", row.tripStatus ?? null),
        location: position,
        silentMinutes,
        progress: row.tripId
          ? {
              total: mine.length,
              done,
              skipped,
              currentStopId:
                mine.find((s) => s.stop.status === "arrived")?.stop.id ?? next?.stop.id ?? null,
            }
          : null,
        offRouteKm: deviation.offRouteKm,
        remainingKm: deviation.remainingKm,
        // From the driver's own trail, not the plan: what the day cost is a fact, not a forecast.
        travelledKm:
          row.shiftStartedAt == null
            ? 0
            : ((await this.fleet.trailDistanceKm(row.d.id, row.shiftStartedAt, now)) ?? 0),
        plannedKm: Number(row.plannedKm ?? 0),
        stops: outstanding.map((s): LiveStop => {
          const eta = etaBy.get(s.stop.id);
          return {
            stopId: s.stop.id,
            shipmentId: s.stop.shipmentId,
            bookingId: s.stop.bookingId,
            accountId: s.accountId ?? null,
            status: s.status ?? null,
            kind: s.stop.kind,
            sequence: s.stop.sequence,
            waybill: s.waybill ?? null,
            address: this.shortAddress(s),
            location: this.locationOf(s),
            window: {
              startMinute: s.stop.windowStartMinute,
              endMinute: s.stop.windowEndMinute,
              source: s.stop.windowSource,
            },
            plannedArrivalMinute: s.stop.plannedArrivalMinute,
            etaMinute: eta?.etaMinute ?? null,
            varianceMinutes: eta?.varianceMinutes ?? null,
            lateMinutes: eta?.lateMinutes ?? 0,
            willMissWindow: eta?.willMissWindow ?? false,
          };
        }),
      });
    }

    return {
      date: day,
      nowMinute,
      depot,
      drivers: live,
      advisories: operationalAdvisories({
        nowMinute,
        unassignedCount,
        drivers: live.map((d) => {
          const legs = stopRows
            .filter((s) => s.stop.tripId === d.tripId && s.stop.legKm != null)
            .map((s) => Number(s.stop.legKm));
          const first = stopRows.find((s) => s.stop.tripId === d.tripId);
          // Kilometres that carry no parcel: out to the first stop and home from the last.
          const deadKm =
            first && d.plannedKm > 0
              ? (first.stop.legKm == null ? 0 : Number(first.stop.legKm)) * 2
              : 0;
          return {
            driverId: d.driverId,
            name: d.name,
            stopsTotal: d.progress?.total ?? 0,
            stopsDone: d.progress?.done ?? 0,
            silentMinutes: d.silentMinutes,
            longestLegKm: legs.length > 0 ? Math.max(...legs) : 0,
            deadKm,
            plannedKm: d.plannedKm,
            stopsBehind: d.stops.filter(
              (s) => s.window.endMinute != null && s.window.endMinute < nowMinute,
            ).length,
            willMissCount: d.stops.filter((s) => s.willMissWindow).length,
            offRouteKm: d.offRouteKm,
            capacity: fleetRows.find((r) => r.d.id === d.driverId)?.d.dailyStopCapacity ?? 0,
          };
        }),
      }) as Advisory[],
      unassignedCount,
    };
  }

  // ── internals ───────────────────────────────────────────────────────────────

  private toRemaining(row: StopRow): RemainingStop {
    const parcels = (row.parcels as QuoteParcel[] | null) ?? [];
    return {
      id: row.stop.id,
      kind: row.stop.kind,
      // Guarded by the caller, which only projects when every stop can be placed.
      location: this.locationOf(row) ?? { lat: 0, lng: 0 },
      pieces: parcels.reduce((n, p) => n + (p.quantity ?? 1), 0) || 1,
      windowStartMinute: row.stop.windowStartMinute,
      windowEndMinute: row.stop.windowEndMinute,
      plannedArrivalMinute: row.stop.plannedArrivalMinute,
    };
  }

  private locationOf(row: StopRow): LatLng | null {
    const value =
      row.stop.kind === "drop"
        ? row.deliveryAddress
        : (row.collection as { address?: unknown } | null)?.address;
    const loc = (value as { location?: LatLng } | null)?.location;
    return loc && typeof loc.lat === "number" ? loc : null;
  }

  private shortAddress(row: StopRow): string {
    const value = (
      row.stop.kind === "drop"
        ? row.deliveryAddress
        : (row.collection as { address?: unknown } | null)?.address
    ) as { suburb?: string | null; formatted?: string } | null;
    return value?.suburb ?? value?.formatted ?? "unknown";
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

interface StopRow {
  stop: typeof tripStops.$inferSelect;
  collection: unknown;
  deliveryAddress: unknown;
  waybill: string | null;
  parcels: unknown;
  accountId: string | null;
  status: (typeof shipments.$inferSelect)["status"] | null;
}

function activityOf(
  shift: "none" | "scheduled" | "open" | "closed",
  trip: string | null,
): LiveDriver["activity"] {
  if (trip === "completed") return "finished";
  if (trip === "started") return "working";
  if (trip === "released") return "ready";
  if (trip === "planned") return "planned";
  if (shift === "none") return "no_shift";
  return "available";
}
