import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { users, walletEntries } from "@delicate/db";
import type {
  Booking,
  CatalogResponse,
  Driver,
  DriverDay,
  Quote,
  Settlement,
  WalletSummary,
} from "@delicate/contracts";
import { createHarness, USERS, type Harness } from "./harness.js";
import { WalletService } from "../src/modules/wallet/wallet.service.js";
import { Clock } from "../src/infra/clock.js";
import { LedgerService } from "../src/modules/ledger/ledger.service.js";

const MENLYN = { lat: -25.7826, lng: 28.2755 };
const CENTURION = { lat: -25.8603, lng: 28.1894 };
const HATFIELD = { lat: -25.7487, lng: 28.2384 };
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
  id: "10000000-0000-4000-8000-000000000020",
  email: "sipho@delicatecourier.local",
};

describe("fleet, dispatch & settlement", () => {
  let h: Harness;
  let wallet: WalletService;
  let ledger: LedgerService;
  let owner: string;
  let dispatcher: string;
  let driverToken: string;
  let accountId: string;
  let cakeId: string;
  let driver: Driver;
  const TODAY = "2026-09-23"; // Wednesday, on-demand bookings land today
  const SLOT = { date: "2026-09-24", windowKey: "morning" };

  beforeAll(async () => {
    h = await createHarness();
    wallet = h.app.get(WalletService);
    ledger = h.app.get(LedgerService);
    h.app.get(Clock).now = () => new Date("2026-09-23T07:00:00Z");
    owner = await h.tokenFor(USERS.alice);
    dispatcher = await h.tokenFor(USERS.admin);
    driverToken = await h.tokenFor(DRIVER_USER);
  });
  afterAll(() => h.close());

  beforeEach(async () => {
    await h.reset();
    await h.db.db.insert(users).values({ ...USERS.admin, platformRole: "dispatcher" });
    const acc = await h
      .http()
      .post("/v1/accounts")
      .set("Authorization", `Bearer ${owner}`)
      .send({ name: "Honey Bee", type: "business", organization: { name: "Honey Bee Bakers" } });
    accountId = acc.body.id;
    await wallet.adjust(accountId, 500_000, "test funds");
    cakeId = ((await h.http().get("/v1/public/catalog")).body as CatalogResponse).packageTypes.find(
      (p) => p.code === "cake_single",
    )!.id;

    const veh = await h
      .http()
      .post("/v1/admin/fleet/vehicles")
      .set("Authorization", `Bearer ${dispatcher}`)
      .send({
        registration: "DC 01 GP",
        make: "Toyota",
        model: "Quantum",
        fuelType: "petrol",
        litresPer100Km: 11,
      });
    const d = await h
      .http()
      .post("/v1/admin/fleet/drivers")
      .set("Authorization", `Bearer ${dispatcher}`)
      .send({
        email: DRIVER_USER.email,
        fullName: "Sipho Dlamini",
        phone: "0831234567",
        vehicleId: veh.body.id,
        dailyStopCapacity: 10,
      });
    expect(d.status).toBe(201);
    driver = d.body;
  });

  const asOwner = () => ({ Authorization: `Bearer ${owner}`, "X-Account-Id": accountId });
  const asDriver = () => ({ Authorization: `Bearer ${driverToken}` });
  const asDispatcher = () => ({ Authorization: `Bearer ${dispatcher}` });

  async function book(serviceLevelCode: "standard" | "on_demand", drops = 1): Promise<Booking> {
    const q = (
      await h
        .http()
        .post("/v1/account/quotes")
        .set(asOwner())
        .send({
          serviceLevelCode,
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
            {
              address: addr("5 Burnett St, Hatfield", HATFIELD, "Hatfield"),
              recipient: { name: "John", phone: "0827654321", email: null },
              instructions: null,
              parcels: [
                { packageTypeId: cakeId, quantity: 1, weightKg: null, description: "Cake" },
              ],
            },
          ].slice(0, drops),
          options: {},
        })
    ).body as Quote;
    const res = await h
      .http()
      .post("/v1/account/bookings")
      .set(asOwner())
      .send({ quoteId: q.id, slot: serviceLevelCode === "standard" ? SLOT : undefined });
    expect(res.status).toBe(201);
    return res.body as Booking;
  }

  it("links a driver to their login by email and gates driver endpoints", async () => {
    const me = await h.http().get("/v1/driver/me").set(asDriver());
    expect(me.status).toBe(200);
    expect(me.body.driver.id).toBe(driver.id);
    expect(me.body.driver.userId).toBe(DRIVER_USER.id);
    expect(me.body).toMatchObject({ owedEarningsCents: 0, owedFuelCents: 0 });
    const notDriver = await h.http().get("/v1/driver/me").set("Authorization", `Bearer ${owner}`);
    expect(notDriver.status).toBe(403);
  });

  it("auto-assigns on booking confirmation to a driver with a shift and capacity; dispatcher can override", async () => {
    const b = await book("on_demand");
    // no shift today → nobody available → stays booked
    expect(await h.dispatcher.tick()).toBeGreaterThan(0);
    let s = await h.http().get(`/v1/admin/shipments/${b.shipments[0]!.id}`).set(asDispatcher());
    expect(s.body.status).toBe("booked");
    expect(
      (await h.http().get("/v1/admin/dispatch/unassigned").set(asDispatcher())).body,
    ).toHaveLength(1);

    await h
      .http()
      .post("/v1/admin/fleet/shifts")
      .set(asDispatcher())
      .send({ driverId: driver.id, date: TODAY })
      .expect(201);
    const auto = await h
      .http()
      .post(`/v1/admin/dispatch/shipments/${b.shipments[0]!.id}/auto-assign`)
      .set(asDispatcher());
    expect(auto.status).toBe(201);
    expect(auto.body).toMatchObject({ driverId: driver.id, source: "auto", active: true });
    expect(auto.body.plannedKm).toBeGreaterThan(10);
    s = await h.http().get(`/v1/admin/shipments/${b.shipments[0]!.id}`).set(asDispatcher());
    expect(s.body.status).toBe("assigned");

    // a second driver, further away and busier, is ranked second; dispatcher can still pick them
    const d2 = (
      await h.http().post("/v1/admin/fleet/drivers").set(asDispatcher()).send({
        email: "thabo@delicatecourier.local",
        fullName: "Thabo M",
        phone: "0830000000",
        homeBase: HATFIELD,
      })
    ).body as Driver;
    await h
      .http()
      .post("/v1/admin/fleet/shifts")
      .set(asDispatcher())
      .send({ driverId: d2.id, date: TODAY });
    const cands = await h
      .http()
      .get(`/v1/admin/dispatch/shipments/${b.shipments[0]!.id}/candidates`)
      .set(asDispatcher());
    expect(cands.body.map((c: { driverId: string }) => c.driverId)).toContain(d2.id);
    const over = await h
      .http()
      .post(`/v1/admin/dispatch/shipments/${b.shipments[0]!.id}/assign`)
      .set(asDispatcher())
      .send({ driverId: d2.id, note: "Sipho is running late" });
    expect(over.body).toMatchObject({ driverId: d2.id, source: "dispatcher" });
    // the day view follows the active assignment
    expect(
      ((await h.http().get("/v1/driver/day").set(asDriver())).body as DriverDay).stops,
    ).toHaveLength(0);
  });

  it("driver works a two-drop booking end to end; each drop settles; the wallet is charged once; the books balance", async () => {
    const b = await book("on_demand", 2);
    await h
      .http()
      .post("/v1/admin/fleet/shifts")
      .set(asDispatcher())
      .send({ driverId: driver.id, date: TODAY });
    for (const s of b.shipments)
      await h
        .http()
        .post(`/v1/admin/dispatch/shipments/${s.id}/auto-assign`)
        .set(asDispatcher())
        .expect(201);

    // The work is theirs the moment dispatch assigns it. There is nothing to press first: a
    // driver standing at the collection should not be refused by their own app.
    const day = (await h.http().get("/v1/driver/day").set(asDriver())).body as DriverDay;
    expect(day.stops.map((s) => s.kind)).toEqual(["collection", "drop", "drop"]);
    expect(day.stops[0]!.shipments).toHaveLength(2);
    expect(day.progress.all).toEqual({ total: 3, done: 0, outstanding: 3 });
    expect(day.progress.allDone).toBe(false);

    const collected = await h
      .http()
      .post("/v1/driver/collect")
      .set(asDriver())
      .send({ bookingId: b.id, location: MENLYN });
    expect(collected.status).toBe(201);
    expect(collected.body.every((s: { status: string }) => s.status === "collected")).toBe(true);

    // simulate a GPS trail Menlyn → Centurion so actual km comes from the trail
    await h
      .http()
      .post("/v1/driver/location")
      .set(asDriver())
      .send({
        pings: [
          { location: MENLYN, recordedAt: new Date(Date.now() - 60_000).toISOString() },
          {
            location: { lat: -25.82, lng: 28.23 },
            recordedAt: new Date(Date.now() - 30_000).toISOString(),
          },
          { location: CENTURION, recordedAt: new Date().toISOString() },
        ],
      })
      .expect(202);

    const noPod = await h
      .http()
      .post("/v1/driver/deliver")
      .set(asDriver())
      .send({ shipmentId: b.shipments[0]!.id, receivedBy: "Jane" });
    expect(noPod.status).toBe(422);

    const d1 = await h.http().post("/v1/driver/deliver").set(asDriver()).send({
      shipmentId: b.shipments[0]!.id,
      receivedBy: "Jane",
      photoDataUrl: PNG,
      location: CENTURION,
    });
    expect(d1.status).toBe(201);
    expect(d1.body.shipment.status).toBe("delivered");
    expect(d1.body.pod).toMatchObject({ receivedBy: "Jane", hasPhoto: true, hasSignature: false });

    // first drop settled; wallet still only holds (booking not complete)
    const s1 = (
      await h
        .http()
        .get(`/v1/admin/dispatch/shipments/${b.shipments[0]!.id}/settlement`)
        .set(asDispatcher())
    ).body.settlement as Settlement;
    expect(s1.driverId).toBe(driver.id);
    expect(s1.actualKm).toBeGreaterThan(5);
    expect(s1.revenueCents + s1.vatCents).toBe(
      Math.floor(b.breakdown.subtotalCents / 2) + Math.floor(b.breakdown.vatCents / 2),
    );
    expect(s1.driverEarningCents).toBe(4_500);
    expect(s1.fuelCostCents).toBe(Math.round(s1.actualKm * 120));
    expect(s1.marginCents).toBe(s1.revenueCents - s1.fuelCostCents - s1.driverEarningCents);
    let w = (await h.http().get("/v1/account/wallet").set(asOwner())).body as WalletSummary;
    expect(w).toMatchObject({ balanceCents: 500_000, heldCents: b.totalCents });

    const d2 = await h.http().post("/v1/driver/deliver").set(asDriver()).send({
      shipmentId: b.shipments[1]!.id,
      receivedBy: "John",
      signatureDataUrl: PNG,
      actualKm: 9.4,
    });
    expect(d2.status).toBe(201);
    const s2 = (
      await h
        .http()
        .get(`/v1/admin/dispatch/shipments/${b.shipments[1]!.id}/settlement`)
        .set(asDispatcher())
    ).body.settlement as Settlement;
    expect(s2.actualKm).toBe(9.4);
    expect(s1.revenueCents + s2.revenueCents).toBe(b.breakdown.subtotalCents);
    expect(s1.vatCents + s2.vatCents).toBe(b.breakdown.vatCents);

    // booking complete → hold captured for exactly the total, once
    w = (await h.http().get("/v1/account/wallet").set(asOwner())).body as WalletSummary;
    expect(w).toMatchObject({ balanceCents: 500_000 - b.totalCents, heldCents: 0 });
    expect(await h.db.db.$count(walletEntries, eq(walletEntries.kind, "charge"))).toBe(1);
    expect(
      ((await h.http().get(`/v1/account/bookings/${b.id}`).set(asOwner())).body as Booking).status,
    ).toBe("completed");

    // driver sees what they are owed; the ledger balances; liability matches the wallet
    const me = await h.http().get("/v1/driver/me").set(asDriver());
    expect(me.body.owedEarningsCents).toBe(9_000);
    expect(me.body.owedFuelCents).toBe(s1.fuelCostCents + s2.fuelCostCents);
    const tb = await ledger.trialBalance();
    expect(tb.totalCents).toBe(0);
    expect(await ledger.balance("CUSTOMER_PREPAID_LIABILITY", "account", accountId)).toBe(
      -(500_000 - b.totalCents),
    );
    expect(await ledger.balance("REVENUE", "company", null)).toBe(-b.breakdown.subtotalCents);
    expect(await ledger.balance("VAT_OUTPUT", "company", null)).toBe(-b.breakdown.vatCents);

    // replaying delivery cannot double-settle
    const again = await h
      .http()
      .post("/v1/driver/deliver")
      .set(asDriver())
      .send({ shipmentId: b.shipments[1]!.id, receivedBy: "John", signatureDataUrl: PNG });
    expect(again.status).toBe(409);
    expect(await ledger.balance("REVENUE", "company", null)).toBe(-b.breakdown.subtotalCents);

    // The day is finished, and the driver is told so rather than being shown an empty list.
    const done = (await h.http().get("/v1/driver/day").set(asDriver())).body as DriverDay;
    expect(done.progress.allDone).toBe(true);
    expect(done.progress.deliveries.done).toBe(2);
    expect(done.stops.every((x) => x.done)).toBe(true);

    // An odometer reading is volunteered, not demanded, and nothing the driver did today
    // required one. So the first reading is the opening one however late it is given...
    const opening = await h
      .http()
      .post("/v1/driver/odometer")
      .set(asDriver())
      .send({ odometerKm: 120_400.5, fuelPct: 70 });
    expect(opening.status).toBe(201);
    expect(opening.body.startOdometerKm).toBe(120_400.5);
    expect(opening.body.endOdometerKm).toBeNull();

    // ...and a later one closes the pair, so the day still spans the van's running.
    const closing = await h
      .http()
      .post("/v1/driver/odometer")
      .set(asDriver())
      .send({ odometerKm: 120_452.1, fuelPct: 55 });
    expect(closing.body.startOdometerKm).toBe(120_400.5);
    expect(closing.body.endOdometerKm).toBe(120_452.1);
    const fuel = await h.http().post("/v1/driver/fuel").set(asDriver()).send({
      litres: 30.5,
      amountCents: 68_000,
      odometerKm: 120_452,
      station: "Engen Menlyn",
      receiptDataUrl: PNG,
    });
    expect(fuel.status).toBe(201);
    expect(fuel.body.hasReceipt).toBe(true);
  });

  it("has nowhere to put an odometer reading from a driver nobody rostered, and says so", async () => {
    // The app turns this empty answer into a sentence. If it came back as an object instead,
    // the driver would be told the reading was saved when there was no day to save it against.
    const res = await h
      .http()
      .post("/v1/driver/odometer")
      .set(asDriver())
      .send({ odometerKm: 1_000 });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({});
    expect(res.text).toBe("");
  });

  it("opens the roster row from the driver's first position, since nobody clocks on", async () => {
    await h
      .http()
      .post("/v1/admin/fleet/shifts")
      .set(asDispatcher())
      .send({ driverId: driver.id, date: TODAY })
      .expect(201);

    // Rostered but no sign of the van yet: on the roster, not yet on the road.
    const rostered = (await h.http().get("/v1/driver/day").set(asDriver())).body as DriverDay;
    expect(rostered.shift?.status).toBe("scheduled");
    expect(rostered.shift?.startedAt).toBeNull();

    const firstSeen = new Date(Date.now() - 120_000).toISOString();
    await h
      .http()
      .post("/v1/driver/location")
      .set(asDriver())
      .send({
        pings: [
          { location: MENLYN, recordedAt: firstSeen },
          { location: CENTURION, recordedAt: new Date().toISOString() },
        ],
      })
      .expect(202);

    // The earliest ping of the batch is when the day began, not when the batch arrived — the
    // app buffers while out of signal, so the two differ by however long the dead spot lasted.
    const moving = (await h.http().get("/v1/driver/day").set(asDriver())).body as DriverDay;
    expect(moving.shift?.status).toBe("open");
    expect(moving.shift?.startedAt).toBe(firstSeen);

    // A later batch must not shunt the start time forward.
    await h
      .http()
      .post("/v1/driver/location")
      .set(asDriver())
      .send({ pings: [{ location: MENLYN, recordedAt: new Date().toISOString() }] })
      .expect(202);
    const later = (await h.http().get("/v1/driver/day").set(asDriver())).body as DriverDay;
    expect(later.shift?.startedAt).toBe(firstSeen);
  });

  it("a failed attempt settles (chargeable by rule), the drop can be reassigned, and files are served to staff", async () => {
    const b = await book("on_demand");
    await h
      .http()
      .post("/v1/admin/fleet/shifts")
      .set(asDispatcher())
      .send({ driverId: driver.id, date: TODAY });
    await h
      .http()
      .post(`/v1/admin/dispatch/shipments/${b.shipments[0]!.id}/auto-assign`)
      .set(asDispatcher());
    await h.http().post("/v1/driver/collect").set(asDriver()).send({ bookingId: b.id });
    const failed = await h.http().post("/v1/driver/fail").set(asDriver()).send({
      shipmentId: b.shipments[0]!.id,
      reason: "recipient_unavailable",
      note: "no answer",
      photoDataUrl: PNG,
    });
    expect(failed.status).toBe(201);
    expect(failed.body.status).toBe("failed");
    const st = (
      await h
        .http()
        .get(`/v1/admin/dispatch/shipments/${b.shipments[0]!.id}/settlement`)
        .set(asDispatcher())
    ).body;
    expect(st.settlement.revenueCents).toBe(b.breakdown.subtotalCents);
    expect((await h.http().get("/v1/account/wallet").set(asOwner())).body.heldCents).toBe(0);

    // dispatcher can send it out again with another driver
    const d2 = (
      await h
        .http()
        .post("/v1/admin/fleet/drivers")
        .set(asDispatcher())
        .send({ email: "thabo@delicatecourier.local", fullName: "Thabo M", phone: "0830000000" })
    ).body as Driver;
    await h
      .http()
      .post("/v1/admin/fleet/shifts")
      .set(asDispatcher())
      .send({ driverId: d2.id, date: TODAY });
    const re = await h
      .http()
      .post(`/v1/admin/dispatch/shipments/${b.shipments[0]!.id}/assign`)
      .set(asDispatcher())
      .send({ driverId: d2.id });
    expect(re.status).toBe(201);

    // customer cannot read evidence files; staff can
    const fileId = (await h.db.db.query.files.findFirst())!.id;
    expect((await h.http().get(`/v1/admin/files/${fileId}`).set(asOwner())).status).toBe(403);
    const file = await h.http().get(`/v1/admin/files/${fileId}`).set(asDispatcher());
    expect(file.status).toBe(200);
    expect(file.headers["content-type"]).toBe("image/png");
  });
});
