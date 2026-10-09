import { Inject, Injectable } from "@nestjs/common";
import { and, asc, desc, eq } from "drizzle-orm";
import {
  haversineKm,
  SHIPMENT_STATUS_LABELS,
  type LatLng,
  type PublicLiveTracking,
  type PublicTrackingState,
  type ShipmentStatus,
} from "@delicate/contracts";
import {
  assignments,
  drivers,
  driverPositions,
  proofsOfDelivery,
  shipmentEvents,
  shipments,
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
        // From the driver record, which always has a name, rather than the linked user row,
        // which has one only once that person has signed in.
        driverName: drivers.fullName,
        driverPhone: drivers.phone,
      })
      .from(shipments)
      .leftJoin(
        assignments,
        and(eq(assignments.shipmentId, shipments.id), eq(assignments.active, true)),
      )
      .leftJoin(drivers, eq(drivers.id, assignments.driverId))
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
   * The same view, for the person waiting at the door.
   *
   * Reached by a token, so it is narrower than the account's view in two ways: the driver's
   * phone number is withheld (a link in an SMS gets forwarded, and the number is theirs), and
   * the destination is a suburb rather than a street — the recipient knows their own address,
   * and whoever the link was forwarded to does not need it.
   */
  async publicView(shipmentId: string): Promise<PublicLiveTracking> {
    const [row] = await this.dbs.db
      .select({
        waybill: shipments.waybill,
        status: shipments.status,
        deliveryAddress: shipments.deliveryAddress,
      })
      .from(shipments)
      .where(eq(shipments.id, shipmentId));
    if (!row) throw AppError.notFound("shipment", { shipmentId });

    const live = await this.forShipment(shipmentId, null);
    const address = row.deliveryAddress as { suburb?: string | null; city?: string | null };

    return {
      waybill: row.waybill,
      status: row.status,
      statusLabel: SHIPMENT_STATUS_LABELS[row.status],
      state: publicState(row.status),
      message: live.message,
      driverFirstName: firstName(live.driver?.name ?? null),
      position: live.position,
      destination: live.destination,
      destinationPlace: { suburb: address.suburb ?? null, city: address.city ?? null },
      distanceKm: live.distanceKm,
      etaMinutes: live.etaMinutes,
      stopsAway: live.stopsAway,
      deliveredAt: live.deliveredAt,
      proofOfDelivery: live.proofOfDelivery
        ? {
            receivedBy: live.proofOfDelivery.receivedBy,
            capturedAt: live.proofOfDelivery.capturedAt,
          }
        : null,
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

  /**
   * The tracking timeline: every status this shipment has been through.
   *
   * `accountId` scopes it to the caller's own shipments. It used to be looked up by id alone,
   * which let any signed-in customer read any other customer's timeline by guessing nothing
   * harder than a uuid.
   */
  async timeline(shipmentId: string, accountId: string | null = null) {
    if (accountId) await this.assertOwned(shipmentId, accountId);
    const rows = await this.events(shipmentId);
    return {
      items: rows.map((e) => ({
        id: e.id,
        status: e.status,
        note: e.note,
        occurredAt: e.occurredAt.toISOString(),
      })),
    };
  }

  /**
   * The same history for the recipient's link, without the notes. A note is written for the
   * office — "gate code wrong, phoned the shop" — and the public waybill lookup withholds them
   * for the same reason.
   */
  async publicTimeline(shipmentId: string) {
    const rows = await this.events(shipmentId);
    return {
      items: rows.map((e) => ({
        status: e.status,
        label: SHIPMENT_STATUS_LABELS[e.status],
        occurredAt: e.occurredAt.toISOString(),
      })),
    };
  }

  private events(shipmentId: string) {
    return this.dbs.db
      .select()
      .from(shipmentEvents)
      .where(eq(shipmentEvents.shipmentId, shipmentId))
      .orderBy(desc(shipmentEvents.occurredAt));
  }

  private async assertOwned(shipmentId: string, accountId: string): Promise<void> {
    const [row] = await this.dbs.db
      .select({ accountId: shipments.accountId })
      .from(shipments)
      .where(eq(shipments.id, shipmentId));
    if (!row || row.accountId !== accountId) throw AppError.notFound("shipment", { shipmentId });
  }

  /**
   * An address only has coordinates once it has been geocoded; some never are.
   *
   * They live under `location`, which is where a stored `Address` keeps them. This read used
   * to look for `lat`/`lng` on the address itself and so always found nothing: no destination
   * pin, no distance, and no ETA on anybody's tracking view.
   */
  private coordsOf(address: unknown): LatLng | null {
    const at = (address as { location?: { lat?: number; lng?: number } } | null)?.location;
    return at && typeof at.lat === "number" && typeof at.lng === "number"
      ? { lat: at.lat, lng: at.lng }
      : null;
  }
}

/**
 * What the page has to render, as opposed to what the status is called. A failed attempt reads
 * as "pending" because the parcel is still coming; `returned_to_sender` and `cancelled` read as
 * "closed" because it is not, and a map with no van on it would leave someone waiting.
 */
function publicState(status: ShipmentStatus): PublicTrackingState {
  if (status === "delivered") return "delivered";
  if (status === "out_for_delivery") return "live";
  if (status === "returned_to_sender" || status === "cancelled") return "closed";
  return "pending";
}

/** "Thabo Mokoena" → "Thabo". Enough to recognise someone at the gate, and no more. */
function firstName(name: string | null): string | null {
  const first = name?.trim().split(/\s+/)[0];
  return first ? first : null;
}
