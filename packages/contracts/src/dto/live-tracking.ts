import { z } from "zod";
import { LatLng } from "./geo.js";
import { ShipmentStatus } from "./bookings.js";

/**
 * The link a recipient is sent so they can watch their parcel arrive.
 *
 * It is reached by a token rather than by the waybill. Waybills are `DC-YYMMDD-NNNNN`,
 * sequential per local day, so anything keyed on one can be enumerated by counting — and the
 * thing behind this link is a driver's live position, which is their whole shift and every
 * other customer's parcel, not just this one. The public waybill lookup leaks a status and a
 * suburb to someone who guesses; this would leak a person's movements.
 *
 * So the token is 128 bits of randomness, it is issued per shipment, and it answers nothing
 * until the parcel is actually out for delivery. 128 bits rather than 256 because the link
 * rides in an SMS: every character is billed, and the shorter token is still more entropy than
 * a uuid, against a surface that is rate-limited and stops being interesting within the hour.
 */

export const TRACKING_TOKEN_PREFIX = "trk_";

/** `trk_` then 16 random bytes base64url-encoded: 22 characters, no padding. */
export const TrackingToken = z.string().regex(/^trk_[A-Za-z0-9_-]{22}$/, "not a tracking token");
export type TrackingToken = z.infer<typeof TrackingToken>;

export const PublicTrackingState = z.enum(["pending", "live", "delivered", "closed"]);
export type PublicTrackingState = z.infer<typeof PublicTrackingState>;

export const PublicLiveTracking = z.object({
  waybill: z.string(),
  status: ShipmentStatus,
  /** The status in the words a recipient reads, not the code. */
  statusLabel: z.string(),
  /**
   * Coarser than the status, and what the page actually branches on: whether there is a van to
   * draw, a delivery to confirm, or only a line of text to show.
   */
  state: PublicTrackingState,
  message: z.string(),
  /**
   * First name only, and no phone number. The recipient is told who is coming so they know who
   * is at the gate; a driver's mobile number is theirs, and this page can be forwarded.
   */
  driverFirstName: z.string().nullable(),
  position: LatLng.extend({ recordedAt: z.string(), stale: z.boolean() }).nullable(),
  destination: LatLng.nullable(),
  /** Suburb and city, as the public waybill lookup already shows. Never the street address. */
  destinationPlace: z.object({
    suburb: z.string().nullable(),
    city: z.string().nullable(),
  }),
  distanceKm: z.number().nullable(),
  etaMinutes: z.number().int().nullable(),
  stopsAway: z.number().int().nullable(),
  deliveredAt: z.string().nullable(),
  /**
   * Who signed and when. The driver's note is left out on purpose: it is written for the
   * office, and the public timeline withholds notes for the same reason.
   */
  proofOfDelivery: z.object({ receivedBy: z.string(), capturedAt: z.string() }).nullable(),
});
export type PublicLiveTracking = z.infer<typeof PublicLiveTracking>;
