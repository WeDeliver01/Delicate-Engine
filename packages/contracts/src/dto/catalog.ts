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

export const CatalogResponse = z.object({
  serviceLevels: z.array(ServiceLevel),
  packageTypes: z.array(PackageType),
  vatBps: Bps,
  currency: z.literal("ZAR"),
});
export type CatalogResponse = z.infer<typeof CatalogResponse>;

/** A settings row: typed on read, stored as JSON. */
export const SettingKey = z.enum([
  "company.depot_address",
  "company.vat_registered",
  "company.vat_bps",
  "company.timezone",
  "booking.same_day_cutoff_minutes",
  "scheduling.policy",
  "settlement.rules",
  "treasury.policy",
  "company.tax_profile",
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
