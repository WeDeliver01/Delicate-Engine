import { z } from "zod";
import { Uuid } from "./common.js";
import { Address } from "./geo.js";
import { Contact } from "./quotes.js";
import { CompanyTaxProfile } from "./billing.js";
import { ShipmentStatus } from "./bookings.js";
import { QuoteParcel } from "../pricing.js";

/**
 * The waybill: the paper that travels with the parcel.
 *
 * Everything the document shows is assembled by the engine rather than the browser, so a
 * waybill printed now and one reprinted in two years say the same thing even if the page that
 * renders it has been redesigned twice. It doubles as the delivery note both parties sign, so
 * it carries the signature block whether or not a POD has been captured electronically.
 */
export const WaybillDocument = z.object({
  waybill: z.string(),
  shipmentId: Uuid,
  bookingReference: z.string(),
  customerReference: z.string().nullable(),
  status: ShipmentStatus,
  issuedAt: z.string(),

  carrier: CompanyTaxProfile,

  sender: z.object({
    accountName: z.string(),
    address: Address,
    contact: Contact.nullable(),
    instructions: z.string().nullable(),
  }),

  recipient: z.object({
    contact: Contact,
    address: Address,
    instructions: z.string().nullable(),
  }),

  service: z.object({
    code: z.string(),
    name: z.string(),
    slotDate: z.string().nullable(),
    slotWindow: z.string().nullable(),
  }),

  parcels: z.array(QuoteParcel),
  parcelCount: z.number().int(),
  /** Null unless the customer bought liability cover; printed so a claim has a stated basis. */
  declaredValueCents: z.number().int().nullable(),

  /** Present once delivered electronically; the signature block stays on the page regardless. */
  proofOfDelivery: z
    .object({
      receivedBy: z.string(),
      capturedAt: z.string(),
      note: z.string().nullable(),
    })
    .nullable(),

  /** Terms printed at the foot of the document, from settings so the operator owns the words. */
  terms: z.string(),
});
export type WaybillDocument = z.infer<typeof WaybillDocument>;
