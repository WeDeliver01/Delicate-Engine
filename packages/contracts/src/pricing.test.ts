import { describe, expect, it } from "vitest";
import { haversineKm, priceQuote, type PricingInput, toCustomerBreakdown } from "./pricing.js";
import type { PackageType, RateCard, ServiceLevel } from "./dto/catalog.js";

const card: RateCard = {
  id: "00000000-0000-4000-8000-000000000001",
  name: "Default",
  isDefault: true,
  active: true,
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
  createdAt: "2026-09-20T00:00:00.000Z",
  updatedAt: "2026-09-20T00:00:00.000Z",
};

const standard: ServiceLevel = {
  id: "00000000-0000-4000-8000-000000000010",
  code: "standard",
  name: "Standard",
  description: null,
  multiplierBps: 10_000,
  surchargeCents: 0,
  requiresSlot: true,
  sameDayCutoffMinutes: 600,
  sortOrder: 1,
  active: true,
};

const onDemand: ServiceLevel = {
  ...standard,
  id: "00000000-0000-4000-8000-000000000011",
  code: "on_demand",
  name: "On-demand",
  multiplierBps: 15_000,
  surchargeCents: 5_000,
  requiresSlot: false,
};

const cake: PackageType = {
  id: "00000000-0000-4000-8000-000000000020",
  code: "cake",
  name: "Cake",
  description: null,
  category: "cake",
  maxWeightKg: 20,
  surchargeCents: 2_000,
  sortOrder: 1,
  active: true,
};

const base: PricingInput = {
  legsKm: [8.2, 12.5, 9.3],
  dropCount: 1,
  rateCard: card,
  serviceLevel: standard,
  parcels: [],
  options: {
    liabilityCover: false,
    declaredValueCents: 0,
    earlyCollection: false,
    signatureOnDelivery: false,
    weddingVenue: false,
  },
  vatBps: 1_500,
};

describe("priceQuote", () => {
  it("prices a 30 km standard loop from cogs and margin, lines summing to the total", () => {
    const q = priceQuote(base);
    expect(q.distanceKm).toBe(30);
    expect(q.cogsCents).toBe(5_100); // 30 × R1.70
    // base = 5100 / 0.45 = 11333; fuel 4.5% = 510
    expect(q.lines.map((l) => [l.code, l.amountCents])).toEqual([
      ["distance", 11_333],
      ["fuel", 510],
      ["min_fee", 15_000 - 11_843],
    ]);
    expect(q.minFeeApplied).toBe(true);
    expect(q.subtotalCents).toBe(15_000);
    expect(q.vatCents).toBe(2_250);
    expect(q.totalCents).toBe(17_250);
    expect(q.lines.reduce((s, l) => s + l.amountCents, 0)).toBe(q.subtotalCents);
  });

  it("applies service level multiplier and surcharge, extra drops, parcels and options", () => {
    const q = priceQuote({
      ...base,
      legsKm: [10, 20, 15, 25],
      dropCount: 2,
      serviceLevel: onDemand,
      parcels: [{ packageType: cake, quantity: 2 }],
      options: {
        liabilityCover: true,
        declaredValueCents: 200_000,
        earlyCollection: true,
        signatureOnDelivery: true,
        weddingVenue: false,
      },
    });
    // 70 km × 170 = 11900 cogs; /0.45 = 26444; ×1.5 = 39666; +5000 = 44666
    const byCode = Object.fromEntries(q.lines.map((l) => [l.code, l.amountCents]));
    expect(byCode["distance"]).toBe(44_666);
    expect(byCode["fuel"]).toBe(2_010);
    expect(byCode["extra_drops"]).toBe(4_500);
    expect(byCode["parcel:cake"]).toBe(4_000);
    expect(byCode["liability_cover"]).toBe(5_000); // 2.5% of R2000 > min R25
    expect(byCode["early_collection"]).toBe(6_000);
    expect(byCode["signature"]).toBe(1_500);
    expect(byCode["min_fee"]).toBeUndefined();
    expect(q.subtotalCents).toBe(67_676);
    expect(q.totalCents).toBe(67_676 + 10_151);
    expect(q.marginBps).toBeGreaterThan(5_500); // options lift realised margin above target
  });

  it("charges no VAT when not registered", () => {
    const q = priceQuote({ ...base, vatBps: 0 });
    expect(q.vatCents).toBe(0);
    expect(q.totalCents).toBe(q.subtotalCents);
  });

  it("uses the liability minimum for low declared values", () => {
    const q = priceQuote({
      ...base,
      options: { ...base.options, liabilityCover: true, declaredValueCents: 10_000 },
    });
    expect(q.lines.find((l) => l.code === "liability_cover")?.amountCents).toBe(2_500);
  });

  it("is deterministic", () => {
    expect(priceQuote(base)).toEqual(priceQuote(base));
  });

  it("rejects degenerate loops", () => {
    expect(() => priceQuote({ ...base, legsKm: [5] })).toThrow();
    expect(() => priceQuote({ ...base, dropCount: 0 })).toThrow();
  });
});

describe("haversineKm", () => {
  it("measures Pretoria CBD to Centurion at roughly 15 km", () => {
    const km = haversineKm({ lat: -25.7479, lng: 28.2293 }, { lat: -25.8603, lng: 28.1894 });
    expect(km).toBeGreaterThan(12);
    expect(km).toBeLessThan(15);
  });
});

describe("what a customer is allowed to see", () => {
  const full = {
    distanceKm: 23.4,
    legsKm: [8.1, 7.2, 8.1],
    cogsCents: 18_720,
    lines: [
      { code: "distance", label: "Standard · 23.4 km", amountCents: 24_000 },
      { code: "extra_drops", label: "1 extra drop", amountCents: 3_000 },
    ],
    subtotalCents: 27_000,
    vatBps: 1_500,
    vatCents: 4_050,
    totalCents: 31_050,
    minFeeApplied: false,
    marginBps: 3_000,
  };

  it("drops every number that explains how the price was reached", () => {
    // From a distance and a price, our cost per kilometre is one division away. That is the
    // rate logic, and it is the one thing a competitor would actually want.
    const shown = toCustomerBreakdown(full) as Record<string, unknown>;
    for (const secret of ["distanceKm", "legsKm", "cogsCents", "marginBps"]) {
      expect(shown[secret], secret).toBeUndefined();
    }
  });

  it("keeps what the customer is actually buying", () => {
    const shown = toCustomerBreakdown(full);
    expect(shown.totalCents).toBe(31_050);
    expect(shown.vatCents).toBe(4_050);
    expect(shown.lines.map((l) => l.code)).toEqual(["distance", "extra_drops"]);
  });

  it("strips a distance that an older quote baked into its label", () => {
    // Quotes priced before the label stopped carrying kilometres are still read back, and the
    // projection is the last thing between those rows and a browser.
    expect(toCustomerBreakdown(full).lines[0]!.label).toBe("Standard");
  });

  it("strips the distance however it was written", () => {
    for (const label of ["Standard · 23.4 km", "Standard 23,4km", "Standard - 8 KM"]) {
      const [line] = toCustomerBreakdown({
        ...full,
        lines: [{ code: "x", label, amountCents: 1 }],
      }).lines;
      expect(line!.label, label).toBe("Standard");
    }
  });

  it("leaves a label alone when it names no distance", () => {
    const [line] = toCustomerBreakdown({
      ...full,
      lines: [{ code: "liability_cover", label: "Liability cover", amountCents: 1 }],
    }).lines;
    expect(line!.label).toBe("Liability cover");
  });
});
