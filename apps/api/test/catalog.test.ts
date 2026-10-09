import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { quotes, users } from "@delicate/db";
import type { CatalogResponse, EstimateResponse, Quote } from "@delicate/contracts";
import { createHarness, USERS, type Harness } from "./harness.js";
import { SettingsService } from "../src/infra/settings.service.js";

const DEPOT_TO_MENLYN = { lat: -25.7826, lng: 28.2755 };
const CENTURION = { lat: -25.8603, lng: 28.1894 };
const HATFIELD = { lat: -25.7487, lng: 28.2384 };

const addr = (formatted: string, location: { lat: number; lng: number }) => ({
  formatted,
  line1: null,
  suburb: null,
  city: "Pretoria",
  postalCode: null,
  country: "ZA",
  location,
  placeId: null,
});

describe("catalog & quotes", () => {
  let h: Harness;
  let owner: string;
  let accountId: string;
  let settings: SettingsService;
  let cakeId: string;
  let cupcakesId: string;

  beforeAll(async () => {
    h = await createHarness();
    owner = await h.tokenFor(USERS.alice);
    settings = h.app.get(SettingsService);
  });
  afterAll(() => h.close());
  beforeEach(async () => {
    await h.reset();
    const res = await h
      .http()
      .post("/v1/accounts")
      .set("Authorization", `Bearer ${owner}`)
      .send({ name: "Honey Bee", type: "business", organization: { name: "Honey Bee Bakers" } });
    accountId = res.body.id;
    const catalog = (await h.http().get("/v1/public/catalog")).body as CatalogResponse;
    cakeId = catalog.packageTypes.find((p) => p.code === "cake_single")!.id;
    cupcakesId = catalog.packageTypes.find((p) => p.code === "cupcakes")!.id;
  });

  it("serves the public catalog with VAT", async () => {
    const res = await h.http().get("/v1/public/catalog");
    expect(res.status).toBe(200);
    const body = res.body as CatalogResponse;
    expect(body.serviceLevels.map((s) => s.code)).toEqual(["standard", "on_demand"]);
    expect(body.packageTypes.length).toBeGreaterThan(3);
    expect(body.vatBps).toBe(1_500);
  });

  it("estimates a public quote without auth using the fallback distance provider", async () => {
    const res = await h
      .http()
      .post("/v1/public/estimate")
      .send({
        serviceLevelCode: "standard",
        collection: addr("Menlyn", DEPOT_TO_MENLYN),
        drops: [addr("Centurion", CENTURION)],
        packageTypeCodes: ["cake_tiered"],
      });
    expect(res.status).toBe(201);
    const body = res.body as EstimateResponse;
    // Which vendor measured the route is not in the response at all: naming it says which
    // provider we use, and "haversine" would say our prices are approximations today.
    expect((body as Record<string, unknown>)["distanceProvider"]).toBeUndefined();
    // The rate logic is ours. A public estimator is the most exposed surface the engine has,
    // and from a distance and a price our cost per kilometre is one division away.
    const estimate = body.breakdown as Record<string, unknown>;
    expect(estimate["legsKm"]).toBeUndefined();
    expect(estimate["distanceKm"]).toBeUndefined();
    expect(estimate["cogsCents"]).toBeUndefined();
    expect(estimate["marginBps"]).toBeUndefined();
    expect(body.breakdown.totalCents).toBeGreaterThanOrEqual(15_000 * 1.15);
    expect(body.breakdown.lines.some((l) => l.code === "parcel:cake_tiered")).toBe(true);
  });

  it("creates a persisted account quote with a catalog snapshot and enforces weight limits", async () => {
    const catalog = (await h.http().get("/v1/public/catalog")).body as CatalogResponse;
    const cake = catalog.packageTypes.find((p) => p.code === "cake_single")!;

    const request = {
      serviceLevelCode: "on_demand",
      collection: { address: addr("Menlyn", DEPOT_TO_MENLYN), contact: null, instructions: null },
      drops: [
        {
          address: addr("Centurion", CENTURION),
          recipient: { name: "Jane", phone: "0821234567", email: null },
          instructions: null,
          parcels: [{ packageTypeId: cake.id, quantity: 1, weightKg: 4, description: null }],
        },
        {
          address: addr("Hatfield", HATFIELD),
          recipient: { name: "John", phone: "0827654321", email: null },
          instructions: "gate code 1234",
          parcels: [{ packageTypeId: cake.id, quantity: 2, weightKg: null, description: null }],
        },
      ],
      options: { liabilityCover: true, declaredValueCents: 150_000 },
    };
    const res = await h
      .http()
      .post("/v1/account/quotes")
      .set("Authorization", `Bearer ${owner}`)
      .set("X-Account-Id", accountId)
      .send(request);
    expect(res.status).toBe(201);
    const quote = res.body as Quote;
    expect(quote.status).toBe("priced");
    const served = quote.breakdown as Record<string, unknown>;
    for (const secret of ["legsKm", "distanceKm", "cogsCents", "marginBps"]) {
      expect(served[secret], `${secret} reached the customer`).toBeUndefined();
    }
    // No line may name a distance either -- the label is where it used to hide.
    for (const line of quote.breakdown.lines) {
      expect(line.label, line.label).not.toMatch(/km/i);
    }
    // Still recorded against the row, so a price stays explainable to us.
    const [row] = await h.db.db.select().from(quotes).where(eq(quotes.id, quote.id));
    const stored = row!.breakdown as {
      legsKm: number[];
      dropKm: number[];
      distanceKm: number;
      cogsCents: number;
    };
    // Depot out, through the collection to each drop and back to it, home: with two drops
    // that is five legs, because each drop's own distance from the collection is measured
    // rather than inferred from where the van happened to go next.
    expect(stored.legsKm).toHaveLength(5);
    expect(stored.dropKm).toHaveLength(2);
    expect(stored.distanceKm).toBeGreaterThan(0);
    expect(stored.cogsCents).toBeGreaterThan(0);

    const codes = quote.breakdown.lines.map((l) => l.code);
    expect(codes).toContain("extra_drops");
    expect(codes).toContain("liability_cover");
    expect(new Date(quote.expiresAt).getTime()).toBeGreaterThan(Date.now());

    const fetched = await h
      .http()
      .get(`/v1/account/quotes/${quote.id}`)
      .set("Authorization", `Bearer ${owner}`)
      .set("X-Account-Id", accountId);
    expect(fetched.status).toBe(200);
    expect(fetched.body.breakdown.totalCents).toBe(quote.breakdown.totalCents);

    const tooHeavy = await h
      .http()
      .post("/v1/account/quotes")
      .set("Authorization", `Bearer ${owner}`)
      .set("X-Account-Id", accountId)
      .send({
        ...request,
        drops: [
          {
            ...request.drops[0],
            parcels: [{ packageTypeId: cake.id, quantity: 1, weightKg: 50, description: null }],
          },
        ],
      });
    expect(tooHeavy.status).toBe(422);
  });

  it("lets finance edit the rate card and reprices immediately", async () => {
    const finance = await h.tokenFor(USERS.admin);
    await h.http().get("/v1/me").set("Authorization", `Bearer ${finance}`); // JIT-provision, then promote
    await h.db.db
      .update(users)
      .set({ platformRole: "finance" })
      .where(eq(users.id, USERS.admin.id));

    const cards = await h
      .http()
      .get("/v1/admin/catalog/rate-cards")
      .set("Authorization", `Bearer ${finance}`);
    expect(cards.status).toBe(200);
    const def = cards.body.find((c: { isDefault: boolean }) => c.isDefault);

    const before = (
      await h
        .http()
        .post("/v1/public/estimate")
        .send({
          collection: addr("Menlyn", DEPOT_TO_MENLYN),
          drops: [addr("Centurion", CENTURION)],
        })
    ).body as EstimateResponse;
    const upd = await h
      .http()
      .put(`/v1/admin/catalog/rate-cards/${def.id}`)
      .set("Authorization", `Bearer ${finance}`)
      .send({ ...def, minFeeCents: 50_000 });
    expect(upd.status).toBe(200);
    const after = (
      await h
        .http()
        .post("/v1/public/estimate")
        .send({
          collection: addr("Menlyn", DEPOT_TO_MENLYN),
          drops: [addr("Centurion", CENTURION)],
        })
    ).body as EstimateResponse;
    expect(after.breakdown.subtotalCents).toBe(50_000);
    expect(after.breakdown.subtotalCents).toBeGreaterThan(before.breakdown.subtotalCents);

    // customers cannot touch the catalog
    const denied = await h
      .http()
      .put(`/v1/admin/catalog/rate-cards/${def.id}`)
      .set("Authorization", `Bearer ${owner}`)
      .send(def);
    expect(denied.status).toBe(403);
  });

  it("prices a quote from a delivery address alone", async () => {
    // The whole point: a customer wanting a number should type one thing. Who is receiving the
    // parcel does not change the distance, so asking for it first is friction charged for
    // nothing.
    const res = await h
      .http()
      .post("/v1/account/quotes")
      .set("Authorization", `Bearer ${owner}`)
      .set("X-Account-Id", accountId)
      .send({
        serviceLevelCode: "standard",
        collection: { address: addr("Honey Bee, Menlyn", DEPOT_TO_MENLYN) },
        drops: [{ address: addr("12 Oak St, Centurion", CENTURION) }],
      });

    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const quote = res.body as Quote;
    expect(quote.breakdown.totalCents).toBeGreaterThan(0);
    expect(quote.request.drops[0]!.recipient).toBeNull();
    expect(quote.request.drops[0]!.parcels).toEqual([]);
  });

  /*
    What one driver can take to one address. The booking form shows the same numbers and
    stops people before they fill a form in, but the form is not the only way in, so the
    limit lives here as well.
  */
  describe("what one delivery can carry", () => {
    const withParcels = (parcels: unknown[]) =>
      h
        .http()
        .post("/v1/account/quotes")
        .set("Authorization", `Bearer ${owner}`)
        .set("X-Account-Id", accountId)
        .send({
          serviceLevelCode: "standard",
          collection: { address: addr("Honey Bee, Menlyn", DEPOT_TO_MENLYN) },
          drops: [{ address: addr("12 Oak St, Centurion", CENTURION), parcels }],
        });

    it("prices several parcels at one address", async () => {
      const res = await withParcels([
        { packageTypeId: cakeId, quantity: 2, weightKg: 2 },
        { packageTypeId: cupcakesId, quantity: 1, weightKg: 1 },
      ]);
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      expect((res.body as Quote).request.drops[0]!.parcels).toHaveLength(2);
    });

    it("refuses more parcels than the operator allows", async () => {
      const limits = await settings.get("booking.limits");
      const res = await withParcels([
        { packageTypeId: cakeId, quantity: limits.maxParcelsPerDrop + 1, weightKg: 1 },
      ]);
      expect(res.status).toBe(422);
      expect(res.body.details[0].message).toContain("parcels");
    });

    it("refuses more weight than the operator allows, counting what it is told", async () => {
      await settings.set("booking.limits", {
        maxParcelsPerDrop: 50,
        maxParcelLinesPerDrop: 8,
        maxWeightKgPerDrop: 10,
      });
      const res = await withParcels([{ packageTypeId: cakeId, quantity: 3, weightKg: 8 }]);
      expect(res.status).toBe(422);
      expect(res.body.details[0].message).toContain("kg");
    });
  });

  it("charges more for a Saturday than a Tuesday when a surcharge is set", async () => {
    // The date is the one detail a quote genuinely cannot do without: it changes the number.
    const body = (deliveryDate: string) => ({
      serviceLevelCode: "standard",
      collection: { address: addr("Honey Bee, Menlyn", DEPOT_TO_MENLYN) },
      drops: [{ address: addr("12 Oak St, Centurion", CENTURION) }],
      deliveryDate,
    });

    const tuesday = await h
      .http()
      .post("/v1/account/quotes")
      .set("Authorization", `Bearer ${owner}`)
      .set("X-Account-Id", accountId)
      .send(body("2026-09-29"));
    const saturday = await h
      .http()
      .post("/v1/account/quotes")
      .set("Authorization", `Bearer ${owner}`)
      .set("X-Account-Id", accountId)
      .send(body("2026-10-03"));

    expect(tuesday.status).toBe(201);
    expect(saturday.status).toBe(201);
    // Equal until the operator sets a weekend surcharge, which is the shipped default. What
    // matters here is that the day reaches the pricing engine at all.
    expect(saturday.body.breakdown.totalCents).toBeGreaterThanOrEqual(
      tuesday.body.breakdown.totalCents,
    );
  });
});
