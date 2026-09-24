import { eq } from "drizzle-orm";
import type { DbExecutor } from "./client.js";
import {
  allocationWallets,
  packageTypes,
  rateCards,
  serviceLevels,
  settings,
} from "./schema/index.js";

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
    "company.tax_profile": {
      legalName: "Delicate Courier (Pty) Ltd",
      tradingName: "Delicate Courier",
      // PLACEHOLDERS: replace with the real CIPC and SARS numbers before issuing a document.
      registrationNumber: null,
      vatNumber: null,
      address: {
        formatted: "14 Camellia Avenue, Lynnwood Ridge, Pretoria, 0081, South Africa",
        line1: "14 Camellia Avenue",
        suburb: "Lynnwood Ridge",
        city: "Pretoria",
        postalCode: "0081",
        country: "ZA",
        location: { lat: -25.7642, lng: 28.2917 },
        placeId: null,
      },
      email: "accounts@delicatecourier.co.za",
      phone: "0800 000 000",
      bank: { bankName: "", accountName: "", accountNumber: "", branchCode: "" },
    },
    "treasury.policy": {
      urgencyWindowDays: 10,
      urgencyMaxMultiplierBps: 25_000,
      reserveGateBps: 8_000,
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
  /**
   * Starter treasury wallets. PLACEHOLDER amounts — replace with the real monthly bills and
   * debit-order dates in the admin console; nothing here moves money on its own.
   */
  allocationWallets: [
    {
      slug: "premises",
      name: "Premises rent",
      category: "operating_expense",
      priority: 1,
      vendor: "Landlord",
      obligationAmountCents: 950_000,
      dueDay: 1,
    },
    {
      slug: "vehicle-finance",
      name: "Vehicle finance",
      category: "operating_expense",
      priority: 2,
      vendor: "Bank",
      obligationAmountCents: 1_240_000,
      dueDay: 3,
    },
    {
      slug: "insurance",
      name: "Fleet & goods-in-transit insurance",
      category: "operating_expense",
      priority: 3,
      vendor: "Insurer",
      obligationAmountCents: 680_000,
      dueDay: 7,
    },
    {
      slug: "salaries",
      name: "Salaries & wages",
      category: "operating_expense",
      priority: 4,
      vendor: "Payroll",
      obligationAmountCents: 4_500_000,
      dueDay: 25,
    },
    {
      slug: "telecoms",
      name: "Connectivity & software",
      category: "operating_expense",
      priority: 5,
      vendor: "Various",
      obligationAmountCents: 320_000,
      dueDay: 15,
    },
    {
      slug: "accounting",
      name: "Accounting & compliance",
      category: "operating_expense",
      priority: 6,
      vendor: "Accountants",
      obligationAmountCents: 450_000,
      dueDay: 20,
    },
    {
      slug: "tax",
      name: "Tax reserve (provisional + VAT)",
      category: "reserve",
      priority: 1,
      monthlyTargetCents: 1_500_000,
    },
    {
      slug: "maintenance",
      name: "Vehicle maintenance & tyres",
      category: "reserve",
      priority: 2,
      monthlyTargetCents: 600_000,
    },
    {
      slug: "emergency",
      name: "Emergency buffer",
      category: "reserve",
      priority: 3,
      monthlyTargetCents: 1_000_000,
    },
    {
      slug: "growth",
      name: "Growth fund (next vehicle)",
      category: "capital",
      priority: 1,
      monthlyTargetCents: 800_000,
    },
    {
      slug: "retained",
      name: "Retained earnings",
      category: "capital",
      priority: 99,
      isRetainedEarnings: true,
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
  for (const w of CATALOG_SEED.allocationWallets) {
    await tx
      .insert(allocationWallets)
      .values(w)
      .onConflictDoNothing({ target: allocationWallets.slug });
  }
}
