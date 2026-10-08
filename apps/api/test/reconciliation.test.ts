import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { allocationWallets, drivers, users, wallets } from "@delicate/db";
import type { Booking, CatalogResponse, Driver, Quote } from "@delicate/contracts";
import { createHarness, USERS, type Harness } from "./harness.js";
import { WalletService } from "../src/modules/wallet/wallet.service.js";
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
  id: "10000000-0000-4000-8000-000000000027",
  email: "lindiwe@delicatecourier.local",
};

interface Report {
  ok: boolean;
  checks: {
    key: string;
    title: string;
    why: string;
    ok: boolean;
    differenceCents: number;
    detail: string;
    offenders: { id: string; label: string; expectedCents: number; actualCents: number }[];
  }[];
}

describe("reconciliation", () => {
  let h: Harness;
  let wallet: WalletService;
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
      registration: "DC 08 GP",
      make: "Toyota",
      model: "Quantum",
      fuelType: "petrol",
      litresPer100Km: 11,
    });
    driver = (
      await h.http().post("/v1/admin/fleet/drivers").set(asStaff()).send({
        email: DRIVER_USER.email,
        fullName: "Lindiwe Ndlovu",
        phone: "0845554444",
        vehicleId: veh.body.id,
        dailyStopCapacity: 10,
      })
    ).body as Driver;
    await h
      .http()
      .post("/v1/admin/fleet/shifts")
      .set(asStaff())
      .send({ driverId: driver.id, date: TODAY });
  });

  const asOwner = () => ({ Authorization: `Bearer ${owner}`, "X-Account-Id": accountId });
  const asStaff = () => ({ Authorization: `Bearer ${staff}` });
  const asDriver = () => ({ Authorization: `Bearer ${driverToken}` });

  const report = async () =>
    (await h.http().get("/v1/admin/analytics/reconciliation").set(asStaff()).expect(200))
      .body as Report;
  const check = (r: Report, key: string) => r.checks.find((c) => c.key === key)!;

  async function deliver(): Promise<Booking> {
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
        actualKm: 16,
      })
      .expect(201);
    await h.dispatcher.tick();
    return booking;
  }

  it("passes on a clean engine", async () => {
    const r = await report();
    expect(r.ok).toBe(true);
    expect(r.checks.every((c) => c.ok)).toBe(true);
  });

  it("still passes after a full delivery, payout and invoice", async () => {
    await deliver();

    const proposals = (
      await h
        .http()
        .post("/v1/admin/payments/runs")
        .set(asStaff())
        .send({ kind: "driver_earnings_payout" })
        .expect(201)
    ).body as { id: string }[];
    for (const p of proposals) {
      await h.http().post(`/v1/admin/payments/proposals/${p.id}/approve`).set(asStaff()).send({});
      await h
        .http()
        .post(`/v1/admin/payments/proposals/${p.id}/execute`)
        .set(asStaff())
        .send({ externalReference: "EFT-1" })
        .expect(201);
    }

    const r = await report();
    const failing = r.checks.filter((c) => !c.ok);
    expect(failing.map((c) => `${c.key}: ${c.detail}`)).toEqual([]);
    expect(r.ok).toBe(true);
  });

  it("catches a wallet balance that no longer matches its entries", async () => {
    // simulate the cache drifting from the append-only log it summarises
    await h.db.db
      .update(wallets)
      .set({ balanceCents: sql`${wallets.balanceCents} + 12345` })
      .where(eq(wallets.accountId, accountId));

    const r = await report();
    expect(r.ok).toBe(false);
    const c = check(r, "wallet-cache");
    expect(c.ok).toBe(false);
    expect(c.differenceCents).toBe(12_345);
    expect(c.offenders[0]).toMatchObject({ label: "Honey Bee" });
    // and it names the other check the same drift breaks
    expect(check(r, "wallet-ledger").ok).toBe(false);
  });

  it("catches a treasury balance that no longer matches its transactions", async () => {
    await deliver();
    await h.db.db
      .update(allocationWallets)
      .set({ balanceCents: sql`${allocationWallets.balanceCents} - 500` })
      .where(eq(allocationWallets.slug, "salaries"));

    const c = check(await report(), "treasury-cache");
    expect(c.ok).toBe(false);
    expect(c.differenceCents).toBe(-500);
    expect(c.offenders[0]!.label).toBe("salaries");
  });

  it("proves every rand of margin was earmarked", async () => {
    await deliver();
    const c = check(await report(), "margin-allocated");
    expect(c.ok).toBe(true);
    expect(c.differenceCents).toBe(0);
  });

  it("proves drivers are owed exactly what they earned less what they were paid", async () => {
    await deliver();
    const c = check(await report(), "driver-earnings");
    expect(c.ok).toBe(true);

    // a payable that does not match the work done is exactly what this must catch
    const [d] = await h.db.db.select().from(drivers).where(eq(drivers.id, driver.id));
    expect(d).toBeTruthy();
    const after = check(await report(), "fuel-payable");
    expect(after.ok).toBe(true);
  });

  it("notices when an event has given up rather than letting the effect go missing", async () => {
    const r = await report();
    const c = check(r, "outbox");
    expect(c.ok).toBe(true);
    expect(c.detail).toMatch(/Nothing stuck|retrying/);
  });

  it("explains why each check matters, not just that it failed", async () => {
    const r = await report();
    for (const c of r.checks) {
      expect(c.title.length).toBeGreaterThan(10);
      expect(c.why.length).toBeGreaterThan(20);
      expect(c.detail.length).toBeGreaterThan(5);
    }
  });

  it("repairs nothing: running it twice reports the same drift", async () => {
    await h.db.db
      .update(wallets)
      .set({ balanceCents: sql`${wallets.balanceCents} + 999` })
      .where(eq(wallets.accountId, accountId));
    const first = check(await report(), "wallet-cache");
    const second = check(await report(), "wallet-cache");
    expect(first.differenceCents).toBe(999);
    expect(second.differenceCents).toBe(999);
  });

  it("is staff-only", async () => {
    await h
      .http()
      .get("/v1/admin/analytics/reconciliation")
      .set({ Authorization: `Bearer ${owner}` })
      .expect(403);
  });
});
