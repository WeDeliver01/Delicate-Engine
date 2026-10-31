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
    "company.vat_registered": false,
    "company.vat_bps": 1_500,
    "company.timezone": "Africa/Johannesburg",
    "booking.same_day_cutoff_minutes": 10 * 60,
    // What one driver can take to one address. Operator-editable in the console.
    "booking.limits": {
      maxParcelsPerDrop: 20,
      maxParcelLinesPerDrop: 8,
      maxWeightKgPerDrop: 200,
    },
    /*
     * What a delivery actually costs: fuel, wear and the driver's time. Every quote is held
     * to this floor, whatever its rate card says -- see pricing.ts for the equations.
     *
     * Ships off, like the dated surcharges below: the three figures that make it bite --
     * fuel price, vehicle wear, driver cost -- are zero, so the floor computes to zero and
     * nothing changes until an operator enters real ones in Admin -> Pricing. Turning this
     * on moves prices, on a system already carrying real bookings, and that is the
     * operator's decision to make with real numbers in hand, not a side effect of this code
     * existing. The other four fields are filled in with the audit's own starting figures
     * (fuel consumption, effective speed, the two stop times) so the form is not empty the
     * first time someone opens it -- they do nothing on their own while the cost terms are
     * zero, and are worth checking against real tracking data before the floor goes live.
     */
    "pricing.cost_model": {
      /*
        Real figures, not zeros.

        Shipping zeros made `directCostCents` zero, which made the cost floor unreachable --
        the protection against selling below cost was present in the code and inert in every
        install that never filled this in. A wrong-but-plausible fuel price fails loudly in a
        quote; a zero fails silently forever.
      */
      fuelPriceCentsPerLitre: 3_100,
      fuelConsumptionL100km: 7.5,
      vehicleWearCentsPerKm: 75,
      driverCostCentsPerHour: 4_500,
      effectiveSpeedKmh: 35,
      collectionMinutes: 15,
      dropMinutes: 10,
      targetMarginBps: 5_500,
    },
    /*
     * Monday to Saturday, 07:00 to 17:00. Two service levels share this span and sell
     * different-width promises out of it -- Standard a 4-hour window, Express a 2-hour one --
     * so each window below names which service it belongs to, and each is its own capacity
     * row: a 4-hour promise and a 2-hour promise are not the same amount of room on the same
     * van, and letting them share a pool is how one oversells the other.
     *
     * The five Express bands are the atomic unit (07-09, 09-11, 11-13, 13-15, 15-17); the
     * four Standard windows are adjacent pairs of that same span, stepped by two hours, so
     * there is always a four-hour option starting near wherever the day is. On-demand draws
     * from the Express bands too -- same-day and urgent is closer in spirit to the narrow
     * pool than the wide, batching-friendly one, and it is safer than a third pool of its
     * own while the fleet is stretched.
     *
     * Capacity on every window is a placeholder -- conservative on purpose, because the
     * fleet it is meant to reflect is not at full strength right now. Set each one to what
     * the vehicles on the road can actually carry; this is the number of DIFFERENT customers'
     * collections a window can hold, not drops -- a batched run still counts once here.
     */
    "scheduling.policy": {
      operatingDays: [1, 2, 3, 4, 5, 6],
      windows: [
        {
          key: "std_morning",
          label: "Morning · 07:00 – 11:00",
          startMinutes: 7 * 60,
          endMinutes: 11 * 60,
          capacity: 6,
          serviceLevels: ["standard"],
        },
        {
          key: "std_late_morning",
          label: "Late morning · 09:00 – 13:00",
          startMinutes: 9 * 60,
          endMinutes: 13 * 60,
          capacity: 6,
          serviceLevels: ["standard"],
        },
        {
          key: "std_midday",
          label: "Midday · 11:00 – 15:00",
          startMinutes: 11 * 60,
          endMinutes: 15 * 60,
          capacity: 6,
          serviceLevels: ["standard"],
        },
        {
          key: "std_afternoon",
          label: "Afternoon · 13:00 – 17:00",
          startMinutes: 13 * 60,
          endMinutes: 17 * 60,
          capacity: 6,
          serviceLevels: ["standard"],
        },
        {
          key: "exp_super_early",
          label: "Super early · 07:00 – 09:00",
          startMinutes: 7 * 60,
          endMinutes: 9 * 60,
          capacity: 3,
          serviceLevels: ["express", "on_demand"],
        },
        {
          key: "exp_morning",
          label: "Morning · 09:00 – 11:00",
          startMinutes: 9 * 60,
          endMinutes: 11 * 60,
          capacity: 3,
          serviceLevels: ["express", "on_demand"],
        },
        {
          key: "exp_brunch",
          label: "Brunch · 11:00 – 13:00",
          startMinutes: 11 * 60,
          endMinutes: 13 * 60,
          capacity: 3,
          serviceLevels: ["express", "on_demand"],
        },
        {
          key: "exp_lunch",
          label: "Lunch · 13:00 – 15:00",
          startMinutes: 13 * 60,
          endMinutes: 15 * 60,
          capacity: 3,
          serviceLevels: ["express", "on_demand"],
        },
        {
          key: "exp_late_afternoon",
          label: "Late afternoon · 15:00 – 17:00",
          startMinutes: 15 * 60,
          endMinutes: 17 * 60,
          capacity: 3,
          serviceLevels: ["express", "on_demand"],
        },
      ],
      defaultCapacity: 4,
      minLeadDays: 1,
      cutoffMinutesBefore: 120,
      horizonDays: 180,
      healthLimitedBelowBps: 3_000,
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
    /**
     * Printed at the foot of every waybill. Deliberately short: small print nobody reads
     * protects nobody, and this has to survive being photographed on a doorstep. The operator
     * edits it in the console, and a signed waybill is evidence, so the wording is theirs.
     */
    "company.waybill_terms":
      "Goods are accepted for carriage subject to our standard terms and conditions of " +
      "carriage, available on request and at delicatecourier.co.za. The sender warrants that " +
      "the contents are correctly described and lawfully carried. Our liability is limited to " +
      "the declared value stated on this waybill where liability cover has been purchased, and " +
      "is otherwise limited in terms of our standard conditions. Signature below acknowledges " +
      "that the parcels listed were received in apparent good order and condition.",
    /**
     * Copying the office on everything is what was asked for, and it is still off here,
     * because the address is the part we cannot guess. A blind copy to a mailbox that does
     * not receive yet bounces every single outbound message, and a bounce rate like that
     * costs the sending domain its reputation — so the one setting that would help becomes
     * the reason none of the mail arrives.
     *
     * Turn it on in the console, with an address that can actually receive. Nothing is lost
     * in the meantime: every message is recorded and searchable there regardless.
     *
     * It is also a lot of mail. At a few hundred shipments a month with an email per status
     * change, this mailbox takes thousands nobody reads, and the ones that do need a human —
     * a failed booking, a new sign-up — get buried. Narrowing `kinds` is a click.
     */
    "notifications.admin_copy": {
      enabled: false,
      address: "admin@delicatecourier.co.za",
      kinds: "all",
    },
    /**
     * Starter cashback, switched OFF. The tiers are ready to go — 1% for everyone rising to 3%
     * for the customers who send the most, earned on the charge excluding VAT — but cashback is
     * a real cost and the rate is the owner's decision, so nothing pays out until someone turns
     * it on in the console.
     */
    "loyalty.program": {
      enabled: false,
      windowDays: 90,
      minAwardCents: 100,
      tiers: [
        { code: "bronze", name: "Bronze", minSpendCents: 0, cashbackBps: 100 },
        { code: "silver", name: "Silver", minSpendCents: 500_000, cashbackBps: 200 },
        { code: "gold", name: "Gold", minSpendCents: 2_000_000, cashbackBps: 300 },
      ],
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
    extraDropKmFactorBps: 6_000,
    liabilityCoverBps: 250,
    liabilityCoverMinCents: 2_500,
    orderValueFeeBps: 200,
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
        "Pre-scheduled. Book at least a day ahead and we collect and deliver inside a 4-hour window you choose.",
      multiplierBps: 10_000,
      surchargeCents: 0,
      requiresSlot: true,
      sameDayCutoffMinutes: 10 * 60,
      sortOrder: 1,
    },
    {
      code: "express",
      name: "Express",
      description:
        "Pre-scheduled, on a tighter promise. Book at least a day ahead and we collect and deliver inside a 2-hour window you choose.",
      // A narrower window is less room to batch it with other work, which is the actual cost
      // of selling it: a premium over Standard, short of what On-demand charges for no notice
      // at all.
      multiplierBps: 12_500,
      surchargeCents: 2_000,
      requiresSlot: true,
      sameDayCutoffMinutes: 10 * 60,
      sortOrder: 2,
    },
    {
      code: "on_demand",
      name: "On-demand",
      description:
        "Last minute. We collect and deliver today — a driver is dispatched as soon as you book.",
      multiplierBps: 15_000,
      surchargeCents: 5_000,
      requiresSlot: false,
      sameDayCutoffMinutes: null,
      sortOrder: 3,
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
