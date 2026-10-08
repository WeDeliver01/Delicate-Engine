import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { users } from "@delicate/db";
import type { Booking, CatalogResponse, Driver, Quote, Settlement } from "@delicate/contracts";
import { createHarness, USERS, type Harness } from "./harness.js";
import { WalletService } from "../src/modules/wallet/wallet.service.js";
import { LedgerService } from "../src/modules/ledger/ledger.service.js";
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
  id: "10000000-0000-4000-8000-000000000026",
  email: "sasha@delicatecourier.local",
};

interface Overview {
  from: string;
  to: string;
  deliveries: number;
  failed: number;
  bookings: number;
  revenueCents: number;
  vatCents: number;
  fuelCents: number;
  driverEarningsCents: number;
  marginCents: number;
  marginBps: number;
  averageOrderCents: number;
  averageKm: number;
  totalKm: number;
  activeAccounts: number;
  newAccounts: number;
}

describe("reports and exports", () => {
  let h: Harness;
  let wallet: WalletService;
  let ledger: LedgerService;
  let owner: string;
  let staff: string;
  let driverToken: string;
  let accountId: string;
  let cakeId: string;
  let driver: Driver;
  const TODAY = "2026-09-23";
  const RANGE = "?from=2026-09-01&to=2026-10-31";

  beforeAll(async () => {
    h = await createHarness();
    wallet = h.app.get(WalletService);
    ledger = h.app.get(LedgerService);
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
      registration: "DC 07 GP",
      make: "Toyota",
      model: "Quantum",
      fuelType: "petrol",
      litresPer100Km: 11,
    });
    driver = (
      await h.http().post("/v1/admin/fleet/drivers").set(asStaff()).send({
        email: DRIVER_USER.email,
        fullName: "Sasha Petrov",
        phone: "0842223333",
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

  const overview = async () =>
    (await h.http().get(`/v1/admin/analytics/overview${RANGE}`).set(asStaff()).expect(200))
      .body as Overview;

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
        actualKm: 18,
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

  it("reports zeroes rather than blanks when nothing has happened", async () => {
    const d = await overview();
    expect(d.deliveries).toBe(0);
    expect(d.revenueCents).toBe(0);
    expect(d.marginBps).toBe(0);
    expect(d.averageOrderCents).toBe(0);
  });

  it("adds up to exactly what the settlements say", async () => {
    const a = await deliver();
    const b = await deliver();
    const d = await overview();

    expect(d.deliveries).toBe(2);
    expect(d.revenueCents).toBe(a.settlement.revenueCents + b.settlement.revenueCents);
    expect(d.vatCents).toBe(a.settlement.vatCents + b.settlement.vatCents);
    expect(d.fuelCents).toBe(a.settlement.fuelCostCents + b.settlement.fuelCostCents);
    expect(d.driverEarningsCents).toBe(
      a.settlement.driverEarningCents + b.settlement.driverEarningCents,
    );
    expect(d.marginCents).toBe(a.settlement.marginCents + b.settlement.marginCents);
    expect(d.averageOrderCents).toBe(Math.round(d.revenueCents / 2));
    expect(d.totalKm).toBe(36);
    expect(d.averageKm).toBe(18);
  });

  it("never disagrees with the ledger", async () => {
    await deliver();
    const d = await overview();
    // revenue is credit-normal, so the ledger shows it negative
    expect(-(await ledger.balance("REVENUE", "company", null))).toBe(d.revenueCents);
    expect(-(await ledger.balance("VAT_OUTPUT", "company", null))).toBe(d.vatCents);
    expect(await ledger.balance("FUEL_EXPENSE", "company", null)).toBe(d.fuelCents);
    expect(d.marginCents).toBe(d.revenueCents - d.fuelCents - d.driverEarningsCents);
  });

  it("zero-fills quiet days, so a gap in trading reads as a gap", async () => {
    await deliver();
    const days = (
      await h.http().get("/v1/admin/analytics/daily?from=2026-09-20&to=2026-09-24").set(asStaff())
    ).body as { date: string; deliveries: number }[];
    expect(days).toHaveLength(5);
    expect(days[0]!.date).toBe("2026-09-20");
    expect(days.filter((x) => x.deliveries === 0).length).toBe(4);
    expect(days.reduce((s, x) => s + x.deliveries, 0)).toBe(1);
  });

  it("names who the business runs on, and what each driver produced", async () => {
    await deliver();
    const top = (await h.http().get(`/v1/admin/analytics/top-accounts${RANGE}`).set(asStaff()))
      .body as { name: string; deliveries: number; revenueCents: number }[];
    expect(top).toHaveLength(1);
    expect(top[0]!.name).toBe("Honey Bee");

    const perDriver = (await h.http().get(`/v1/admin/analytics/drivers${RANGE}`).set(asStaff()))
      .body as { name: string; deliveries: number; km: number }[];
    expect(perDriver[0]).toMatchObject({ name: "Sasha Petrov", deliveries: 1, km: 18 });
  });

  it("exports settlements as CSV a spreadsheet can open", async () => {
    const { settlement } = await deliver();
    const res = await h
      .http()
      .get(`/v1/admin/analytics/export.csv?kind=settlements${RANGE.replace("?", "&")}`)
      .set(asStaff())
      .expect(200);
    expect(res.headers["content-type"]).toContain("text/csv");
    expect(res.headers["content-disposition"]).toContain("attachment");

    const lines = res.text.trim().split("\r\n");
    expect(lines[0]).toBe(
      "waybill,settled_at,account,driver,revenue_ex_vat,vat,fuel_cost,driver_earning,margin,planned_km,actual_km",
    );
    expect(lines).toHaveLength(2);
    // amounts come out in rands with two decimals, not cents
    expect(lines[1]).toContain((settlement.revenueCents / 100).toFixed(2));
    expect(lines[1]).toContain("Sasha Petrov");
  });

  it("exports journals with debits and credits in their own columns", async () => {
    await deliver();
    const res = await h
      .http()
      .get(`/v1/admin/analytics/export.csv?kind=journals${RANGE.replace("?", "&")}`)
      .set(asStaff())
      .expect(200);
    const lines = res.text.trim().split("\r\n");
    expect(lines[0]).toContain("debit,credit");
    const body = lines.slice(1);
    expect(body.length).toBeGreaterThan(0);
    // every line carries one or the other, never both
    for (const l of body) {
      const cells = l.split(",");
      const debit = cells[8];
      const credit = cells[9];
      expect(Boolean(debit) && Boolean(credit)).toBe(false);
    }
  });

  it("offers every export kind without falling over on an empty range", async () => {
    for (const kind of ["settlements", "journals", "invoices", "bookings", "allocations"]) {
      const res = await h
        .http()
        .get(`/v1/admin/analytics/export.csv?kind=${kind}&from=2020-01-01&to=2020-01-02`)
        .set(asStaff());
      expect(res.status).toBe(200);
      expect(res.text.split("\r\n")[0]!.length).toBeGreaterThan(0); // header row always present
    }
  });

  it("refuses a range that runs backwards", async () => {
    const res = await h
      .http()
      .get("/v1/admin/analytics/overview?from=2026-10-01&to=2026-09-01")
      .set(asStaff());
    expect(res.status).toBe(422);
  });

  it("keeps exports away from dispatchers, who may still see the dashboard", async () => {
    const dispatcherToken = await h.tokenFor(USERS.carol);
    await h.db.db
      .insert(users)
      .values({ ...USERS.carol, platformRole: "dispatcher" })
      .onConflictDoUpdate({ target: users.id, set: { platformRole: "dispatcher" } });
    await h
      .http()
      .get(`/v1/admin/analytics/overview${RANGE}`)
      .set({ Authorization: `Bearer ${dispatcherToken}` })
      .expect(200);
    await h
      .http()
      .get(`/v1/admin/analytics/export.csv?kind=journals${RANGE.replace("?", "&")}`)
      .set({ Authorization: `Bearer ${dispatcherToken}` })
      .expect(403);
  });
});
