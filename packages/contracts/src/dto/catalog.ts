import { z } from "zod";
import { Bps, NonNegativeCents } from "../money.js";
import { Uuid } from "./common.js";

/**
 * Catalog & Pricing. Everything here is admin-editable; the quote engine is a pure function
 * over a RateCard + ServiceLevel + PackageType set (see `pricing.ts`).
 */

export const ServiceLevel = z.object({
  id: Uuid,
  code: z.string().min(2).max(32), // e.g. "standard", "on_demand"
  name: z.string().min(2).max(80),
  description: z.string().max(400).nullable(),
  /** Price multiplier on the distance component, in basis points (10000 = x1.0). */
  multiplierBps: z.number().int().min(1).max(100_000),
  /** Flat surcharge added on top, in cents. */
  surchargeCents: NonNegativeCents,
  /** Needs a delivery slot (Standard) or dispatches immediately (On-demand). */
  requiresSlot: z.boolean(),
  /** Latest booking time for same-day service, minutes after midnight local time. */
  sameDayCutoffMinutes: z.number().int().min(0).max(1439).nullable(),
  sortOrder: z.number().int(),
  active: z.boolean(),
});
export type ServiceLevel = z.infer<typeof ServiceLevel>;

export const PackageType = z.object({
  id: Uuid,
  code: z.string().min(2).max(32),
  name: z.string().min(2).max(80),
  description: z.string().max(400).nullable(),
  category: z.string().max(40), // e.g. "cake", "cupcakes", "flowers", "gift", "food", "other"
  maxWeightKg: z.number().positive().nullable(),
  /** Handling surcharge per parcel, in cents. */
  surchargeCents: NonNegativeCents,
  sortOrder: z.number().int(),
  active: z.boolean(),
});
export type PackageType = z.infer<typeof PackageType>;

/** The pricing levers. Money in cents, percentages in basis points. */
export const RateCard = z.object({
  id: Uuid,
  name: z.string().min(2).max(80),
  isDefault: z.boolean(),
  active: z.boolean(),
  /** Operating cost per kilometre (fuel + wear), the COGS input. */
  costPerKmCents: NonNegativeCents,
  /** Gross margin target: price = cogs / (1 - margin). */
  marginBps: Bps,
  fuelSurchargeBps: Bps,
  minFeeCents: NonNegativeCents,
  /** Charged for every drop after the first on a multi-drop booking. */
  extraDropFeeCents: NonNegativeCents,
  /** Options: liability cover as % of declared value (bps) with a minimum; the rest flat. */
  liabilityCoverBps: Bps,
  liabilityCoverMinCents: NonNegativeCents,
  earlyCollectionFeeCents: NonNegativeCents,
  signatureFeeCents: NonNegativeCents,
  weddingVenueFeeCents: NonNegativeCents,
  /**
   * Date-conditional surcharges, charged on the distance component plus a flat amount, when
   * the delivery date qualifies. Zero everywhere until the business turns them on, which is
   * its own commercial decision and its own release — see `pricing.ts`.
   */
  weekendSurchargeBps: Bps,
  weekendSurchargeCents: NonNegativeCents,
  publicHolidaySurchargeBps: Bps,
  publicHolidaySurchargeCents: NonNegativeCents,
  /**
   * What a customer pays to be promised a narrow window rather than half a day. Charged on the
   * distance component plus a flat amount, like the dated surcharges, and zero until the
   * business prices it. Flat across widths: the policy sets how narrow a window may be, so
   * every one sold is worth about the same promise. Tiering by width can come later.
   */
  timedWindowSurchargeBps: Bps,
  timedWindowSurchargeCents: NonNegativeCents,
  /** Road-distance factor applied to straight-line km when no routing provider is available. */
  roadFactorBps: z.number().int().min(10_000).max(30_000),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type RateCard = z.infer<typeof RateCard>;

export const UpsertRateCardRequest = RateCard.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
}).partial({
  isDefault: true,
  active: true,
  roadFactorBps: true,
  weekendSurchargeBps: true,
  weekendSurchargeCents: true,
  publicHolidaySurchargeBps: true,
  publicHolidaySurchargeCents: true,
});
export type UpsertRateCardRequest = z.infer<typeof UpsertRateCardRequest>;

export const UpsertServiceLevelRequest = ServiceLevel.omit({ id: true }).partial({
  active: true,
  sortOrder: true,
  description: true,
  sameDayCutoffMinutes: true,
});
export type UpsertServiceLevelRequest = z.infer<typeof UpsertServiceLevelRequest>;

export const UpsertPackageTypeRequest = PackageType.omit({ id: true }).partial({
  active: true,
  sortOrder: true,
  description: true,
  maxWeightKg: true,
});
export type UpsertPackageTypeRequest = z.infer<typeof UpsertPackageTypeRequest>;

/**
 * How much one delivery may carry.
 *
 * A drop is one address and one driver arriving at it, so what fits is a question about a
 * vehicle, not about the software. The operator owns the answer -- it changes with the fleet
 * -- so it lives in settings rather than in a constant somebody has to deploy.
 */
export const BookingLimits = z.object({
  /** Parcels at one address, counting quantities. */
  maxParcelsPerDrop: z.number().int().min(1).max(200),
  /** Different kinds of parcel at one address, i.e. lines on the form. */
  maxParcelLinesPerDrop: z.number().int().min(1).max(20),
  /** Everything at one address, added up. Null when the only limit is per package type. */
  maxWeightKgPerDrop: z.number().positive().max(5_000).nullable(),
});
export type BookingLimits = z.infer<typeof BookingLimits>;

export const CatalogResponse = z.object({
  serviceLevels: z.array(ServiceLevel),
  packageTypes: z.array(PackageType),
  vatBps: Bps,
  currency: z.literal("ZAR"),
  /** Published with the catalog because the booking form has to enforce them as you type. */
  bookingLimits: BookingLimits,
});
export type CatalogResponse = z.infer<typeof CatalogResponse>;

/** A settings row: typed on read, stored as JSON. */
export const SettingKey = z.enum([
  "company.depot_address",
  "company.vat_registered",
  "company.vat_bps",
  "company.timezone",
  "booking.same_day_cutoff_minutes",
  "booking.limits",
  "scheduling.policy",
  "settlement.rules",
  "treasury.policy",
  "company.tax_profile",
  "company.waybill_terms",
  "notifications.admin_copy",
  "loyalty.program",
]);

/** How money splits per delivered shipment. Admin-editable; snapshotted into every settlement. */
export const SettlementRules = z.object({
  /** Driver earning per completed drop, in cents. */
  driverEarningPerDropCents: NonNegativeCents,
  /** Optional per-km component of driver earning. */
  driverEarningPerKmCents: NonNegativeCents,
  /** Fuel cost recognised per actual km, in cents (loaded to the driver fuel card). */
  fuelCostPerKmCents: NonNegativeCents,
  /** Whether a failed delivery attempt is charged to the customer and paid to the driver. */
  chargeFailedAttempts: z.boolean(),
});
export type SettlementRules = z.infer<typeof SettlementRules>;
export type SettingKey = z.infer<typeof SettingKey>;
