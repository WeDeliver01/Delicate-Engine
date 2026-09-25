import { z } from "zod";
import { Cents } from "../money.js";
import { Uuid } from "./common.js";
import { LatLng, Address } from "./geo.js";
import { Contact } from "./quotes.js";
import { QuoteParcel } from "../pricing.js";
import { IsoDate } from "./slots.js";
import { ShipmentStatus } from "./bookings.js";

/**
 * Dispatch: the assignment of shipments to drivers, the driver's view of the day, and the
 * evidence a driver captures. Money is never computed here — it is emitted as events and
 * settled by the ledger module.
 */

export const AssignmentSource = z.enum(["auto", "dispatcher"]);

export const Assignment = z.object({
  id: Uuid,
  shipmentId: Uuid,
  driverId: Uuid,
  source: AssignmentSource,
  /** Forecast km for depot→collection→drop at assignment time. */
  plannedKm: z.number().nonnegative(),
  active: z.boolean(),
  createdAt: z.string().datetime(),
});
export type Assignment = z.infer<typeof Assignment>;

export const AssignRequest = z.object({ driverId: Uuid, note: z.string().max(200).optional() });

/** A stop on a driver's day: one collection (per booking) or one drop (per shipment). */
export const DriverStop = z.object({
  kind: z.enum(["collection", "drop"]),
  bookingId: Uuid,
  bookingReference: z.string(),
  /** Present for drops; null for a collection stop. */
  shipmentId: Uuid.nullable(),
  waybill: z.string().nullable(),
  status: ShipmentStatus.nullable(),
  address: Address,
  contact: Contact.nullable(),
  instructions: z.string().nullable(),
  parcels: z.array(QuoteParcel),
  slotDate: IsoDate.nullable(),
  slotWindowKey: z.string().nullable(),
  serviceLevelCode: z.string(),
  /** Shipments that belong to this booking (for a collection stop, what to pick up). */
  shipments: z.array(z.object({ shipmentId: Uuid, waybill: z.string(), status: ShipmentStatus })),
});
export type DriverStop = z.infer<typeof DriverStop>;

export const DriverDay = z.object({
  date: IsoDate,
  shift: z
    .object({
      id: Uuid,
      status: z.enum(["scheduled", "open", "closed"]),
      startedAt: z.string().datetime().nullable(),
    })
    .nullable(),
  stops: z.array(DriverStop),
  /** What the ordering saved, when there were enough placed stops to order. */
  route: z
    .object({ totalKm: z.number(), originalKm: z.number(), savedKm: z.number() })
    .nullable()
    .default(null),
});
export type DriverDay = z.infer<typeof DriverDay>;

export const CollectRequest = z.object({
  bookingId: Uuid,
  location: LatLng.nullable().default(null),
  note: z.string().max(300).nullable().default(null),
});

export const DeliverRequest = z.object({
  shipmentId: Uuid,
  location: LatLng.nullable().default(null),
  receivedBy: z.string().min(1).max(120),
  /** Signature and/or photo as data URLs (≤ 2 MB each). At least one is required. */
  signatureDataUrl: z.string().max(3_000_000).nullable().default(null),
  photoDataUrl: z.string().max(3_000_000).nullable().default(null),
  note: z.string().max(300).nullable().default(null),
  /** Actual km driven for this drop as measured by the app, when available. */
  actualKm: z.number().nonnegative().nullable().default(null),
});
export type DeliverRequest = z.infer<typeof DeliverRequest>;

export const FailRequest = z.object({
  shipmentId: Uuid,
  reason: z.enum(["recipient_unavailable", "wrong_address", "refused", "damaged", "other"]),
  note: z.string().max(300).nullable().default(null),
  location: LatLng.nullable().default(null),
  photoDataUrl: z.string().max(3_000_000).nullable().default(null),
});
export type FailRequest = z.infer<typeof FailRequest>;

export const ProofOfDelivery = z.object({
  shipmentId: Uuid,
  receivedBy: z.string(),
  hasSignature: z.boolean(),
  hasPhoto: z.boolean(),
  location: LatLng.nullable(),
  note: z.string().nullable(),
  capturedAt: z.string().datetime(),
});
export type ProofOfDelivery = z.infer<typeof ProofOfDelivery>;

/** Money per shipment once delivered. Internal (admin) view. */
export const Settlement = z.object({
  shipmentId: Uuid,
  bookingId: Uuid,
  driverId: Uuid.nullable(),
  revenueCents: Cents,
  vatCents: Cents,
  fuelCostCents: Cents,
  driverEarningCents: Cents,
  marginCents: Cents,
  plannedKm: z.number(),
  actualKm: z.number(),
  journalId: Uuid,
  settledAt: z.string().datetime(),
});
export type Settlement = z.infer<typeof Settlement>;
