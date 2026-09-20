import { eq } from "drizzle-orm";
import type { DbExecutor } from "./client.js";
import { packageTypes, rateCards, serviceLevels, settings } from "./schema/index.js";

/**
 * Catalog defaults. PLACEHOLDER NUMBERS: taken from the reference quote formula so the engine
 * prices realistically from day one; every value is admin-editable and should be replaced with
 * the real rate card. Safe to re-run: existing rows are left untouched (admins own them).
 */
export const CATALOG_SEED = {
  settings: {
    "company.depot_address": {
      formatted: "14 Camellia Avenue, Lynnwood Ridge, Pretoria, 0081, South Africa",
      line1: "14 Camellia Avenue",
      suburb: "Lynnwood Ridge",
      city: "Pretoria",
      postalCode: "0081",
      country: "ZA",
      location: { lat: -25.7642, lng: 28.2917 },
      placeId: null,
    },
    "company.vat_registered": true,
    "company.vat_bps": 1_500,
    "company.timezone": "Africa/Johannesburg",
    "booking.same_day_cutoff_minutes": 10 * 60,
    "scheduling.policy": {
      operatingDays: [1, 2, 3, 4, 5, 6],
      windows: [
        {
          key: "morning",
          label: "Morning · 08:00 – 12:00",
          startMinutes: 8 * 60,
          endMinutes: 12 * 60,
          capacity: null,
        },
        {
          key: "afternoon",
          label: "Afternoon · 12:00 – 16:00",
          startMinutes: 12 * 60,
          endMinutes: 16 * 60,
          capacity: null,
        },
      ],
      defaultCapacity: 12,
      minLeadDays: 1,
      cutoffMinutesBefore: 120,
      horizonDays: 14,
    },
    // PLACEHOLDERS until the real fleet economics are supplied.
    "settlement.rules": {
      driverEarningPerDropCents: 4_500,
      driverEarningPerKmCents: 0,
      fuelCostPerKmCents: 120,
      chargeFailedAttempts: true,
    },
  },
  rateCard: {
    name: "Default",
    isDefault: true,
    costPerKmCents: 170,
    marginBps: 5_500,
    fuelSurchargeBps: 450,
    minFeeCents: 15_000,
    extraDropFeeCents: 4_500,
    liabilityCoverBps: 250,
    liabilityCoverMinCents: 2_500,
    earlyCollectionFeeCents: 6_000,
    signatureFeeCents: 1_500,
    weddingVenueFeeCents: 12_000,
    roadFactorBps: 13_000,
  },
  serviceLevels: [
    {
      code: "standard",
      name: "Standard",
      description:
        "Book at least one day in advance. Arrives the same day within your selected time slot.",
      multiplierBps: 10_000,
      surchargeCents: 0,
      requiresSlot: true,
      sameDayCutoffMinutes: 10 * 60,
      sortOrder: 1,
    },
    {
      code: "on_demand",
      name: "On-demand",
      description: "We dispatch a driver immediately and reach the destination within 90 minutes.",
      multiplierBps: 15_000,
      surchargeCents: 5_000,
      requiresSlot: false,
      sameDayCutoffMinutes: null,
      sortOrder: 2,
    },
  ],
  packageTypes: [
    {
      code: "cake_single",
      name: "Single-tier cake",
      category: "cake",
      maxWeightKg: 8,
      surchargeCents: 0,
      sortOrder: 1,
    },
    {
      code: "cake_tiered",
      name: "Tiered cake",
      category: "cake",
      maxWeightKg: 20,
      surchargeCents: 3_000,
      sortOrder: 2,
    },
    {
      code: "cupcakes",
      name: "Cupcakes / pastries box",
      category: "cupcakes",
      maxWeightKg: 6,
      surchargeCents: 0,
      sortOrder: 3,
    },
    {
      code: "flowers",
      name: "Flowers",
      category: "flowers",
      maxWeightKg: 10,
      surchargeCents: 0,
      sortOrder: 4,
    },
    {
      code: "meals",
      name: "Prepared food",
      category: "food",
      maxWeightKg: 15,
      surchargeCents: 0,
      sortOrder: 5,
    },
    {
      code: "gift",
      name: "Gift / hamper",
      category: "gift",
      maxWeightKg: 15,
      surchargeCents: 0,
      sortOrder: 6,
    },
    {
      code: "other",
      name: "Other delicate parcel",
      category: "other",
      maxWeightKg: 25,
      surchargeCents: 0,
      sortOrder: 9,
    },
  ],
} as const;

export async function seedCatalog(tx: DbExecutor): Promise<void> {
  for (const [key, value] of Object.entries(CATALOG_SEED.settings)) {
    await tx.insert(settings).values({ key, value }).onConflictDoNothing();
  }

  const existingDefault = await tx.query.rateCards.findFirst({
    where: eq(rateCards.isDefault, true),
  });
  if (!existingDefault) {
    await tx.insert(rateCards).values(CATALOG_SEED.rateCard).onConflictDoNothing();
  }

  for (const sl of CATALOG_SEED.serviceLevels) {
    await tx.insert(serviceLevels).values(sl).onConflictDoNothing({ target: serviceLevels.code });
  }
  for (const pt of CATALOG_SEED.packageTypes) {
    await tx
      .insert(packageTypes)
      .values({ ...pt, maxWeightKg: String(pt.maxWeightKg) })
      .onConflictDoNothing({ target: packageTypes.code });
  }
}
