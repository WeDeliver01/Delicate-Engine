import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { loyaltyAwards, users } from "@delicate/db";
import type {
  Booking,
  CatalogResponse,
  Driver,
  LoyaltyProgram,
  LoyaltyStatus,
  Quote,
  Settlement,
  WalletSummary,
} from "@delicate/contracts";
import { createHarness, USERS, type Harness } from "./harness.js";
import { WalletService } from "../src/modules/wallet/wallet.service.js";
import { LedgerService } from "../src/modules/ledger/ledger.service.js";
import { LoyaltyService, pickTier } from "../src/modules/loyalty/loyalty.service.js";
import { Clock } from "../src/infra/clock.js";

const MENLYN = { lat: -25.7826, lng: 28.2755 };
const CENTURION = { lat: -25.8603, lng: 28.1894 };
const addr = (formatted: string, location: { lat: number; lng: number }, suburb: string) => ({
  formatted,
  line1: null,
  suburb,
  city: "Pretoria",
  postalCode: null,
  country: "ZA",
  location,
  placeId: null,
});
const PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
const DRIVER_USER = {
  id: "10000000-0000-4000-8000-000000000025",
  email: "bongani@delicatecourier.local",
};

describe("loyalty", () => {
  let h: Harness;
  let wallet: WalletService;
  let ledger: LedgerService;
  let loyalty: LoyaltyService;
  let owner: string;
  let staff: string;
  let driverToken: string;
  let accountId: string;
  let cakeId: string;
  let driver: Driver;
  const TODAY = "2026-09-23";

  beforeAll(async () => {
    h = await createHarness();
    wallet = h.app.get(WalletService);
    ledger = h.app.get(LedgerService);
    loyalty = h.app.get(LoyaltyService);
    h.app.get(Clock).now = () => new Date("2026-09-23T07:00:00Z");
    owner = await h.tokenFor(USERS.alice);
    staff = await h.tokenFor(USERS.admin);
    driverToken = await h.tokenFor(DRIVER_USER);
  });
  afterAll(() => h.close());

  beforeEach(async () => {
    await h.reset();
    await h.db.db.insert(users).values({ ...USERS.admin, platformRole: "super_admin" });
    const acc = await h
      .http()
      .post("/v1/accounts")
      .set("Authorization", `Bearer ${owner}`)
      .send({ name: "Honey Bee", type: "business", organization: { name: "Honey Bee Bakers" } });
    accountId = acc.body.id;
    await wallet.adjust(accountId, 1_000_000, "test funds");
    cakeId = ((await h.http().get("/v1/public/catalog")).body as CatalogResponse).packageTypes.find(
      (p) => p.code === "cake_single",
    )!.id;

    const veh = await h.http().post("/v1/admin/fleet/vehicles").set(asStaff()).send({
      registration: "DC 06 GP",
      make: "Toyota",
      model: "Quantum",
      fuelType: "petrol",
      litresPer100Km: 11,
    });
    driver = (
      await h.http().post("/v1/admin/fleet/drivers").set(asStaff()).send({
        email: DRIVER_USER.email,
        fullName: "Bongani Zulu",
        phone: "0847778888",
        vehicleId: veh.body.id,
        dailyStopCapacity: 10,
      })
    ).body as Driver;
    await h
      .http()
      .post("/v1/admin/fleet/shifts")
      .set(asStaff())
      .send({ driverId: driver.id, date: TODAY });

    // The programme ships switched off, because cashback is a cost the owner chooses.
    const seeded = (await h.http().get("/v1/admin/loyalty/program").set(asStaff()))
      .body as LoyaltyProgram;
    await h
      .http()
      .put("/v1/admin/loyalty/program")
      .set(asStaff())
      .send({ ...seeded, enabled: true })
      .expect(200);
  });

  const asOwner = () => ({ Authorization: `Bearer ${owner}`, "X-Account-Id": accountId });
  const asStaff = () => ({ Authorization: `Bearer ${staff}` });
  const asDriver = () => ({ Authorization: `Bearer ${driverToken}` });

  const status = async () =>
    (await h.http().get("/v1/account/loyalty").set(asOwner()).expect(200)).body as LoyaltyStatus;

  /** Book, deliver and drain the outbox, so the booking is actually charged. */
  async function deliver(): Promise<{ booking: Booking; settlement: Settlement }> {
    const q = (
      await h
        .http()
        .post("/v1/account/quotes")
        .set(asOwner())
        .send({
          serviceLevelCode: "on_demand",
          collection: {
            address: addr("Honey Bee, Menlyn", MENLYN, "Menlyn"),
            contact: { name: "Baker", phone: "0821111111", email: null },
            instructions: null,
          },
          drops: [
            {
              address: addr("12 Oak St, Centurion", CENTURION, "Centurion"),
              recipient: { name: "Jane", phone: "0821234567", email: null },
              instructions: null,
              parcels: [
                { packageTypeId: cakeId, quantity: 1, weightKg: null, description: "Cake" },
              ],
            },
          ],
          options: {},
        })
    ).body as Quote;
    const booking = (
      await h.http().post("/v1/account/bookings").set(asOwner()).send({ quoteId: q.id })
    ).body as Booking;
    await h
      .http()
      .post(`/v1/admin/dispatch/shipments/${booking.shipments[0]!.id}/auto-assign`)
      .set(asStaff())
      .expect(201);
    await h
      .http()
      .post("/v1/driver/collect")
      .set(asDriver())
      .send({ bookingId: booking.id, location: MENLYN })
      .expect(201);
    await h
      .http()
      .post("/v1/driver/deliver")
      .set(asDriver())
      .send({
        shipmentId: booking.shipments[0]!.id,
        receivedBy: "Jane",
        photoDataUrl: PNG,
        actualKm: 12,
      })
      .expect(201);
    await h.dispatcher.tick();
    const settlement = (
      await h
        .http()
        .get(`/v1/admin/dispatch/shipments/${booking.shipments[0]!.id}/settlement`)
        .set(asStaff())
    ).body.settlement as Settlement;
    return { booking, settlement };
  }

  it("puts every customer on a tier from their first booking", async () => {
    const s = await status();
    expect(s.enabled).toBe(true); // switched on in beforeEach; it ships off
    expect(s.tier.code).toBe("bronze");
    expect(s.windowSpendCents).toBe(0);
    expect(s.nextTier?.code).toBe("silver");
    expect(s.toNextTierCents).toBe(s.nextTier!.minSpendCents);
  });

  it("pays cashback into the wallet on money actually taken, excluding VAT", async () => {
    const before = (await h.http().get("/v1/account/wallet").set(asOwner())).body as WalletSummary;
    const { booking, settlement } = await deliver();

    const s = await status();
    expect(s.recent).toHaveLength(1);
    const award = s.recent[0]!;
    // 1% of revenue excluding VAT, never of the VAT itself — that is SARS's money passing through
    expect(award.eligibleCents).toBe(settlement.revenueCents);
    expect(award.amountCents).toBe(Math.floor((settlement.revenueCents * 100) / 10_000));
    expect(award.tierCode).toBe("bronze");

    const after = (await h.http().get("/v1/account/wallet").set(asOwner())).body as WalletSummary;
    expect(after.balanceCents).toBe(before.balanceCents - booking.totalCents + award.amountCents);

    // it cost the business exactly what it paid out, and the books still balance
    expect(await ledger.balance("LOYALTY_EXPENSE", "company", null)).toBe(award.amountCents);
    expect((await ledger.trialBalance()).totalCents).toBe(0);
  });

  it("cannot pay twice for one booking, however often the event is redelivered", async () => {
    await deliver();
    await h.dispatcher.tick();
    await h.dispatcher.tick();
    const rows = await h.db.db.select().from(loyaltyAwards);
    expect(rows).toHaveLength(1);
    expect((await status()).earnedAllTimeCents).toBe(rows[0]!.amountCents);
  });

  it("moves a customer up a tier once their spend in the window justifies it", async () => {
    // set a tier the very first delivery will clear, so the move is visible
    await h
      .http()
      .put("/v1/admin/loyalty/program")
      .set(asStaff())
      .send({
        enabled: true,
        windowDays: 90,
        minAwardCents: 1,
        tiers: [
          { code: "bronze", name: "Bronze", minSpendCents: 0, cashbackBps: 100 },
          { code: "silver", name: "Silver", minSpendCents: 100, cashbackBps: 500 },
        ],
      })
      .expect(200);

    expect((await status()).tier.code).toBe("bronze");
    await deliver();
    const s = await status();
    expect(s.tier.code).toBe("silver");
    expect(s.nextTier).toBeNull();
    expect(s.toNextTierCents).toBeNull();
    // the first award was still earned at the tier held when the booking was charged
    expect(s.recent[0]!.tierCode).toBe("bronze");
  });

  it("skips an award too small to be worth explaining", async () => {
    await h
      .http()
      .put("/v1/admin/loyalty/program")
      .set(asStaff())
      .send({
        enabled: true,
        windowDays: 90,
        minAwardCents: 1_000_000,
        tiers: [{ code: "bronze", name: "Bronze", minSpendCents: 0, cashbackBps: 100 }],
      })
      .expect(200);
    await deliver();
    expect(await h.db.db.select().from(loyaltyAwards)).toHaveLength(0);
    expect((await status()).earnedAllTimeCents).toBe(0);
  });

  it("pays nothing at all when the programme is switched off", async () => {
    const program = (await h.http().get("/v1/admin/loyalty/program").set(asStaff()))
      .body as LoyaltyProgram;
    expect(program.enabled).toBe(true);
    await h
      .http()
      .put("/v1/admin/loyalty/program")
      .set(asStaff())
      .send({ ...program, enabled: false })
      .expect(200);
    await deliver();
    expect(await h.db.db.select().from(loyaltyAwards)).toHaveLength(0);
    expect(await ledger.balance("LOYALTY_EXPENSE", "company", null)).toBe(0);
  });

  it("refuses a programme nobody could belong to", async () => {
    const res = await h
      .http()
      .put("/v1/admin/loyalty/program")
      .set(asStaff())
      .send({
        enabled: true,
        windowDays: 90,
        minAwardCents: 100,
        tiers: [{ code: "gold", name: "Gold", minSpendCents: 500_000, cashbackBps: 300 }],
      });
    expect(res.status).toBe(422);
    expect(JSON.stringify(res.body)).toContain("must start at 0");
  });

  it("refuses duplicate tier codes", async () => {
    const res = await h
      .http()
      .put("/v1/admin/loyalty/program")
      .set(asStaff())
      .send({
        enabled: true,
        windowDays: 90,
        minAwardCents: 100,
        tiers: [
          { code: "bronze", name: "Bronze", minSpendCents: 0, cashbackBps: 100 },
          { code: "bronze", name: "Bronze again", minSpendCents: 100, cashbackBps: 200 },
        ],
      });
    expect(res.status).toBe(422);
  });

  it("sorts tiers however they are submitted, and picks the highest one earned", () => {
    const program: LoyaltyProgram = {
      enabled: true,
      windowDays: 90,
      minAwardCents: 0,
      tiers: [
        { code: "bronze", name: "Bronze", minSpendCents: 0, cashbackBps: 100 },
        { code: "silver", name: "Silver", minSpendCents: 500_000, cashbackBps: 200 },
        { code: "gold", name: "Gold", minSpendCents: 2_000_000, cashbackBps: 300 },
      ],
    };
    expect(pickTier(program, 0).code).toBe("bronze");
    expect(pickTier(program, 499_999).code).toBe("bronze");
    expect(pickTier(program, 500_000).code).toBe("silver");
    expect(pickTier(program, 9_999_999).code).toBe("gold");
  });

  it("tells finance what loyalty has cost", async () => {
    await deliver();
    const cost = (await h.http().get("/v1/admin/loyalty/cost").set(asStaff()).expect(200)).body as {
      awards: number;
      totalCents: number;
      byTier: Record<string, number>;
    };
    expect(cost.awards).toBe(1);
    expect(cost.totalCents).toBeGreaterThan(0);
    expect(cost.byTier["bronze"]).toBe(cost.totalCents);
    expect(cost.totalCents).toBe(await ledger.balance("LOYALTY_EXPENSE", "company", null));
  });

  it("keeps one account's cashback away from another", async () => {
    await deliver();
    const other = await h
      .http()
      .post("/v1/accounts")
      .set("Authorization", `Bearer ${owner}`)
      .send({ name: "Rival", type: "business", organization: { name: "Rival" } });
    const theirs = (
      await h
        .http()
        .get("/v1/account/loyalty")
        .set({ Authorization: `Bearer ${owner}`, "X-Account-Id": other.body.id })
        .expect(200)
    ).body as LoyaltyStatus;
    expect(theirs.earnedAllTimeCents).toBe(0);
    expect(theirs.recent).toHaveLength(0);
  });

  it("only a super admin may change the programme", async () => {
    const financeToken = await h.tokenFor(USERS.carol);
    await h.db.db
      .insert(users)
      .values({ ...USERS.carol, platformRole: "finance" })
      .onConflictDoUpdate({ target: users.id, set: { platformRole: "finance" } });
    const program = (await h.http().get("/v1/admin/loyalty/program").set(asStaff()))
      .body as LoyaltyProgram;
    await h
      .http()
      .get("/v1/admin/loyalty/program")
      .set({ Authorization: `Bearer ${financeToken}` })
      .expect(200);
    await h
      .http()
      .put("/v1/admin/loyalty/program")
      .set({ Authorization: `Bearer ${financeToken}` })
      .send(program)
      .expect(403);
  });
});
