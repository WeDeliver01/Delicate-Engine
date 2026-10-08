import { Inject, Injectable } from "@nestjs/common";
import { and, asc, desc, eq } from "drizzle-orm";
import { haversineKm, type LatLng } from "@delicate/contracts";
import {
  assignments,
  drivers,
  driverPositions,
  proofsOfDelivery,
  shipmentEvents,
  shipments,
  users,
} from "@delicate/db";
import { DbService } from "../../infra/db.module.js";
import { Clock } from "../../infra/clock.js";
import { AppError } from "../../common/errors.js";
import { GEO_PROVIDER, type GeoProvider } from "../../infra/geo/geo.provider.js";

/**
 * Where the parcel is, for the person waiting for it.
 *
 * Only ever answered for a shipment that is genuinely out for delivery. A driver's position is
 * their location for the whole shift, across every customer's parcels, so showing it against a
 * shipment still sitting in the van tomorrow morning would be telling the customer something
 * that is true about the driver and false about their delivery.
 */

/** Positions older than this are stale: the phone lost signal or the app was killed. */
const POSITION_FRESH_MS = 10 * 60_000;

/**
 * Average speed through Tshwane traffic, used when we have no routed ETA. Deliberately
 * pessimistic — an ETA that passes without the driver arriving is worse than one that beats
 * expectations, because the first makes someone phone us.
 */
const ASSUMED_KMH = 28;

export interface LiveTracking {
  status: "not_live" | "live" | "delivered";
  /** Why there is nothing to show, in words the customer can act on. */
  message: string;
  driver: { name: string | null; phone: string | null } | null;
  position: { lat: number; lng: number; recordedAt: string; stale: boolean } | null;
  destination: LatLng | null;
  distanceKm: number | null;
  etaMinutes: number | null;
  /** Deliveries ahead of this one on the same driver's run, if any. */
  stopsAway: number | null;
  deliveredAt: string | null;
  proofOfDelivery: { receivedBy: string; capturedAt: string; note: string | null } | null;
}

@Injectable()
export class LiveTrackingService {
  constructor(
    private readonly dbs: DbService,
    private readonly clock: Clock,
    @Inject(GEO_PROVIDER) private readonly geo: GeoProvider,
  ) {}

  async forShipment(shipmentId: string, accountId: string | null): Promise<LiveTracking> {
    const [row] = await this.dbs.db
      .select({
        id: shipments.id,
        status: shipments.status,
        deliveredAt: shipments.deliveredAt,
        deliveryAddress: shipments.deliveryAddress,
        slotDate: shipments.slotDate,
        accountId: shipments.accountId,
        driverId: drivers.id,
        driverName: users.fullName,
        driverPhone: drivers.phone,
      })
      .from(shipments)
      .leftJoin(
        assignments,
        and(eq(assignments.shipmentId, shipments.id), eq(assignments.active, true)),
      )
      .leftJoin(drivers, eq(drivers.id, assignments.driverId))
      .leftJoin(users, eq(users.id, drivers.userId))
      .where(eq(shipments.id, shipmentId));

    if (!row) throw AppError.notFound("shipment", { shipmentId });
    if (accountId && row.accountId !== accountId)
      throw AppError.notFound("shipment", { shipmentId });

    const base: LiveTracking = {
      status: "not_live",
      message: "",
      driver: null,
      position: null,
      destination: null,
      distanceKm: null,
      etaMinutes: null,
      stopsAway: null,
      deliveredAt: row.deliveredAt?.toISOString() ?? null,
      proofOfDelivery: null,
    };

    if (row.status === "delivered") {
      const [pod] = await this.dbs.db
        .select()
        .from(proofsOfDelivery)
        .where(eq(proofsOfDelivery.shipmentId, shipmentId));
      return {
        ...base,
        status: "delivered",
        message: "Delivered.",
        proofOfDelivery: pod
          ? {
              receivedBy: pod.receivedBy,
              capturedAt: pod.capturedAt.toISOString(),
              note: pod.note,
            }
          : null,
      };
    }

    // The status now says this rather than being inferred from `in_transit`, which covered
    // both "in the van somewhere" and "on its way to you". A driver marks a parcel out for
    // delivery when it is actually the one they are driving to, which is the only point at
    // which their position is about this delivery rather than about their whole round.
    if (row.status !== "out_for_delivery") {
      return {
        ...base,
        message:
          row.status === "collected" || row.status === "in_transit"
            ? "Collected and with us. Live tracking starts when it is out for delivery."
            : row.status === "on_hold"
              ? "On hold at the moment. We will be in touch, and tracking resumes when it is moving again."
              : "Live tracking starts when the driver sets off with your parcel.",
      };
    }

    const driver = row.driverId
      ? { name: row.driverName, phone: row.driverPhone as string | null }
      : null;

    if (!row.driverId) {
      return { ...base, message: "Out for delivery.", driver };
    }

    const [pos] = await this.dbs.db
      .select()
      .from(driverPositions)
      .where(eq(driverPositions.driverId, row.driverId));

    if (!pos) {
      return {
        ...base,
        status: "live",
        message: "Out for delivery. The driver's location is not available right now.",
        driver,
      };
    }

    const at = pos.location as LatLng;
    const dest = this.coordsOf(row.deliveryAddress);
    const ageMs = this.clock.now().getTime() - pos.recordedAt.getTime();
    const stale = ageMs > POSITION_FRESH_MS;

    let distanceKm: number | null = null;
    let etaMinutes: number | null = null;
    if (dest) {
      // The road distance when we can get it, straight-line otherwise. `routeLegsKm` already
      // falls back on its own, so this never fails the whole request over a map lookup.
      const [legKm] = await this.geo.routeLegsKm([at, dest]).catch(() => [haversineKm(at, dest)]);
      distanceKm = Math.round((legKm ?? 0) * 10) / 10;
      // No ETA on a stale position: it would be computed from where the driver was twenty
      // minutes ago and read as though it were now.
      if (!stale) etaMinutes = Math.max(1, Math.round((distanceKm / ASSUMED_KMH) * 60));
    }

    return {
      ...base,
      status: "live",
      message: stale
        ? "Out for delivery. We last heard from the driver a little while ago."
        : "Out for delivery.",
      driver,
      position: {
        lat: at.lat,
        lng: at.lng,
        recordedAt: pos.recordedAt.toISOString(),
        stale,
      },
      destination: dest,
      distanceKm,
      etaMinutes,
      stopsAway: await this.stopsAhead(row.driverId, shipmentId),
    };
  }

  /**
   * How many of this driver's other deliveries are still open and were sequenced before this
   * one. "Third stop away" is more use than a raw ETA when traffic makes the minutes a guess.
   */
  private async stopsAhead(driverId: string, shipmentId: string): Promise<number | null> {
    const rows = await this.dbs.db
      .select({ id: shipments.id, status: shipments.status, sequence: shipments.sequence })
      .from(assignments)
      .innerJoin(shipments, eq(shipments.id, assignments.shipmentId))
      .where(and(eq(assignments.driverId, driverId), eq(assignments.active, true)))
      .orderBy(asc(shipments.sequence));

    const index = rows.findIndex((r) => r.id === shipmentId);
    if (index < 0) return null;
    return rows.slice(0, index).filter((r) => r.status !== "delivered" && r.status !== "failed")
      .length;
  }

  /** The tracking timeline: every status this shipment has been through. */
  async timeline(shipmentId: string) {
    const rows = await this.dbs.db
      .select()
      .from(shipmentEvents)
      .where(eq(shipmentEvents.shipmentId, shipmentId))
      .orderBy(desc(shipmentEvents.occurredAt));
    return {
      items: rows.map((e) => ({
        id: e.id,
        status: e.status,
        note: e.note,
        occurredAt: e.occurredAt.toISOString(),
      })),
    };
  }

  /** An address only has coordinates once it has been geocoded; some never are. */
  private coordsOf(address: unknown): LatLng | null {
    const a = address as { lat?: number; lng?: number } | null;
    return a && typeof a.lat === "number" && typeof a.lng === "number"
      ? { lat: a.lat, lng: a.lng }
      : null;
  }
}
