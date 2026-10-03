import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { users } from "@delicate/db";
import type {
  AssignmentRecommendation,
  Booking,
  CatalogResponse,
  DayPlan,
  DispatchBoard,
  Driver,
  Quote,
  Trip,
  TripSheet,
} from "@delicate/contracts";
import { createHarness, USERS, type Harness } from "./harness.js";
import { WalletService } from "../src/modules/wallet/wallet.service.js";
import { Clock } from "../src/infra/clock.js";

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
const DRIVER_USER = {
  id: "10000000-0000-4000-8000-000000000020",
  email: "sipho@delicatecourier.local",
};

describe("dispatch board", () => {
  let h: Harness;
  let wallet: WalletService;
  let owner: string;
  let dispatcher: string;
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
      .set(asDispatcher())
      .send({ registration: "DC 01 GP", fuelType: "petrol", litresPer100Km: 7 });
    driver = (
      await h.http().post("/v1/admin/fleet/drivers").set(asDispatcher()).send({
        email: DRIVER_USER.email,
        fullName: "Sipho Dlamini",
        phone: "0831234567",
        vehicleId: veh.body.id,
        dailyStopCapacity: 10,
      })
    ).body;
  });

  const asOwner = () => ({ Authorization: `Bearer ${owner}`, "X-Account-Id": accountId });
  const asDriver = () => ({ Authorization: `Bearer ${driverToken}` });
  const asDispatcher = () => ({ Authorization: `Bearer ${dispatcher}` });

  async function book(drops = 1): Promise<Booking> {
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
    const res = await h.http().post("/v1/account/bookings").set(asOwner()).send({ quoteId: q.id });
    expect(res.status).toBe(201);
    return res.body as Booking;
  }

  const board = async (): Promise<DispatchBoard> =>
    (await h.http().get(`/v1/admin/dispatch/board?date=${TODAY}`).set(asDispatcher()))
      .body as DispatchBoard;

  const openShift = async () => {
    await h
      .http()
      .post("/v1/admin/fleet/shifts")
      .set(asDispatcher())
      .send({ driverId: driver.id, date: TODAY })
      .expect(201);
    await h
      .http()
      .post("/v1/driver/shift/start")
      .set(asDriver())
      .send({ odometerKm: 1000, fuelPct: 80, location: MENLYN })
      .expect(201);
  };

  it("shows on-demand work on today's board even though it has no slot date", async () => {
    const b = await book(1);
    const bd = await board();
    expect(bd.date).toBe(TODAY);
    const card = bd.cards.find((c) => c.waybill === b.shipments[0]!.waybill);
    expect(card).toBeDefined();
    expect(card!.slotDate).toBeNull();
    // Nobody has it yet.
    expect(card!.lane).toBe("unassigned");
    expect(card!.exceptions).toContain("no_driver");
    expect(bd.laneCounts.unassigned).toBe(1);
    expect(bd.exceptionCounts.no_driver).toBe(1);
  });

  it("carries both addresses, the customer and the price on every card", async () => {
    const b = await book(1);
    const card = (await board()).cards.find((c) => c.waybill === b.shipments[0]!.waybill)!;
    expect(card.collection.address.suburb).toBe("Menlyn");
    expect(card.delivery.address.suburb).toBe("Centurion");
    expect(card.collection.contact?.name).toBe("Baker");
    expect(card.delivery.contact?.name).toBe("Jane");
    expect(card.accountName).toBe("Honey Bee");
    expect(card.priceCents).toBeGreaterThan(0);
    expect(card.bookingReference).toBe(b.reference);
  });

  it("moves a card from unassigned to assigned, then to going-to-collect once the trip starts", async () => {
    const b = await book(1);
    await openShift();

    // Assigned, but nobody has handed the driver a day.
    await h
      .http()
      .post(`/v1/admin/dispatch/shipments/${b.shipments[0]!.id}/assign`)
      .set(asDispatcher())
      .send({ driverId: driver.id })
      .expect(201);
    let card = (await board()).cards.find((c) => c.waybill === b.shipments[0]!.waybill)!;
    expect(card.lane).toBe("awaiting_driver");
    expect(card.driverName).toBe("Sipho Dlamini");
    expect(card.tripId).toBeNull();

    // On a trip, but not started: still waiting on the driver.
    const trip = (
      await h
        .http()
        .post("/v1/admin/dispatch/trips")
        .set(asDispatcher())
        .send({ driverId: driver.id, date: TODAY })
        .expect(201)
    ).body as Trip;
    await h
      .http()
      .post(`/v1/admin/dispatch/trips/${trip.id}/stops`)
      .set(asDispatcher())
      .send({ shipmentIds: [b.shipments[0]!.id], resequence: true })
      .expect(201);
    card = (await board()).cards.find((c) => c.waybill === b.shipments[0]!.waybill)!;
    expect(card.lane).toBe("awaiting_driver");
    expect(card.tripReference).toBe(trip.reference);
    expect(card.stopSequence).toBeGreaterThan(0);

    // Started, and the driver's current stop is this booking's collection.
    await h
      .http()
      .post(`/v1/admin/dispatch/trips/${trip.id}/release`)
      .set(asDispatcher())
      .expect(201);
    await h
      .http()
      .post("/v1/driver/trip/start")
      .set(asDriver())
      .send({ tripId: trip.id })
      .expect(201);
    card = (await board()).cards.find((c) => c.waybill === b.shipments[0]!.waybill)!;
    expect(card.lane).toBe("en_route_collection");
  });

  it("calls a shipment out for delivery only when the driver is actually on its drop", async () => {
    const b = await book(2);
    await openShift();
    const trip = (
      await h
        .http()
        .post("/v1/admin/dispatch/trips")
        .set(asDispatcher())
        .send({ driverId: driver.id, date: TODAY })
        .expect(201)
    ).body as Trip;
    await h
      .http()
      .post(`/v1/admin/dispatch/trips/${trip.id}/stops`)
      .set(asDispatcher())
      .send({ shipmentIds: b.shipments.map((s) => s.id), resequence: true })
      .expect(201);
    await h
      .http()
      .post(`/v1/admin/dispatch/trips/${trip.id}/release`)
      .set(asDispatcher())
      .expect(201);
    await h
      .http()
      .post("/v1/driver/trip/start")
      .set(asDriver())
      .send({ tripId: trip.id })
      .expect(201);
    await h
      .http()
      .post("/v1/driver/collect")
      .set(asDriver())
      .send({ bookingId: b.id, location: MENLYN })
      .expect(201);
    expect(await h.dispatcher.tick()).toBeGreaterThan(0);

    const sheet = (await h.http().get(`/v1/admin/dispatch/trips/${trip.id}`).set(asDispatcher()))
      .body as TripSheet;
    const nextDrop = [...sheet.stops]
      .sort((a, b2) => a.sequence - b2.sequence)
      .find((s) => s.kind === "drop" && s.status === "pending")!;

    const bd = await board();
    const out = bd.cards.filter((c) => c.lane === "out_for_delivery");
    const collected = bd.cards.filter((c) => c.lane === "collected");
    // Exactly one of the two is being delivered right now — the one the driver is on.
    expect(out).toHaveLength(1);
    expect(out[0]!.waybill).toBe(nextDrop.waybill);
    expect(collected).toHaveLength(1);
    expect(collected[0]!.waybill).not.toBe(nextDrop.waybill);
  });

  it("flags a stop as behind schedule once its window has closed on a started trip", async () => {
    const b = await book(1);
    await openShift();
    const trip = (
      await h
        .http()
        .post("/v1/admin/dispatch/trips")
        .set(asDispatcher())
        .send({ driverId: driver.id, date: TODAY })
        .expect(201)
    ).body as Trip;
    const sheet = (
      await h
        .http()
        .post(`/v1/admin/dispatch/trips/${trip.id}/stops`)
        .set(asDispatcher())
        .send({ shipmentIds: [b.shipments[0]!.id], resequence: true })
        .expect(201)
    ).body as TripSheet;
    const drop = sheet.stops.find((s) => s.kind === "drop")!;

    // Clock is 09:00 SAST. A window that closed at 08:00 is already missed.
    await h
      .http()
      .put(`/v1/admin/dispatch/stops/${drop.id}/window`)
      .set(asDispatcher())
      .send({ startMinute: 420, endMinute: 480 })
      .expect(200);

    // Not started yet: nothing is late, the day simply has not begun.
    let card = (await board()).cards.find((c) => c.waybill === b.shipments[0]!.waybill)!;
    expect(card.exceptions).not.toContain("behind_schedule");

    await h
      .http()
      .post(`/v1/admin/dispatch/trips/${trip.id}/release`)
      .set(asDispatcher())
      .expect(201);
    await h
      .http()
      .post("/v1/driver/trip/start")
      .set(asDriver())
      .send({ tripId: trip.id })
      .expect(201);

    const bd = await board();
    card = bd.cards.find((c) => c.waybill === b.shipments[0]!.waybill)!;
    expect(card.exceptions).toContain("behind_schedule");
    expect(card.window).toMatchObject({ startMinute: 420, endMinute: 480, source: "dispatcher" });
    expect(bd.exceptionCounts.behind_schedule).toBe(1);
    expect(bd.drivers.find((d) => d.driverId === driver.id)!.behindCount).toBe(1);
  });

  it("keeps a late shipment in the lane it is actually in rather than binning it as an exception", async () => {
    const b = await book(1);
    await openShift();
    await h
      .http()
      .post(`/v1/admin/dispatch/shipments/${b.shipments[0]!.id}/assign`)
      .set(asDispatcher())
      .send({ driverId: driver.id })
      .expect(201);
    const card = (await board()).cards.find((c) => c.waybill === b.shipments[0]!.waybill)!;
    // It has a driver, so it is "assigned" — and `exceptions` is a property of the card, not a
    // lane that swallows it.
    expect(card.lane).toBe("awaiting_driver");
    expect(Array.isArray(card.exceptions)).toBe(true);
  });

  it("describes a driver's day on the rail, and says what they are doing", async () => {
    const b = await book(1);
    let bd = await board();
    let rail = bd.drivers.find((d) => d.driverId === driver.id)!;
    expect(rail).toMatchObject({
      name: "Sipho Dlamini",
      vehicleRegistration: "DC 01 GP",
      shiftStatus: "none",
      activity: "no_shift",
      tripId: null,
    });

    await openShift();
    const trip = (
      await h
        .http()
        .post("/v1/admin/dispatch/trips")
        .set(asDispatcher())
        .send({ driverId: driver.id, date: TODAY })
        .expect(201)
    ).body as Trip;
    await h
      .http()
      .post(`/v1/admin/dispatch/trips/${trip.id}/stops`)
      .set(asDispatcher())
      .send({ shipmentIds: [b.shipments[0]!.id], resequence: true })
      .expect(201);
    bd = await board();
    rail = bd.drivers.find((d) => d.driverId === driver.id)!;
    expect(rail.activity).toBe("planned");
    expect(rail.progress).toMatchObject({ total: 2, done: 0 });

    await h
      .http()
      .post(`/v1/admin/dispatch/trips/${trip.id}/release`)
      .set(asDispatcher())
      .expect(201);
    expect((await board()).drivers.find((d) => d.driverId === driver.id)!.activity).toBe("ready");

    await h
      .http()
      .post("/v1/driver/trip/start")
      .set(asDriver())
      .send({ tripId: trip.id })
      .expect(201);
    bd = await board();
    rail = bd.drivers.find((d) => d.driverId === driver.id)!;
    expect(rail.activity).toBe("working");
    // The rail says where they are standing, which trip_stops alone does not know.
    expect(rail.currentStop).toMatchObject({ kind: "collection", sequence: 1, address: "Menlyn" });
    expect(rail.lastSeen?.location).toMatchObject(MENLYN);
  });

  it("recommends a driver with a reason a dispatcher can read", async () => {
    const b = await book(1);
    await openShift();
    const recs = (
      await h
        .http()
        .get(`/v1/admin/dispatch/board/recommendations/${b.shipments[0]!.id}`)
        .set(asDispatcher())
    ).body as AssignmentRecommendation[];
    expect(recs).toHaveLength(1);
    expect(recs[0]).toMatchObject({ driverId: driver.id, name: "Sipho Dlamini", load: 0 });
    expect(recs[0]!.reason).toContain("km from the collection");
    expect(recs[0]!.reason).toContain("nothing on their day yet");
  });

  it("puts a shipment on a driver's day in one move, making the trip when they have none", async () => {
    const b = await book(1);
    await openShift();
    const res = await h
      .http()
      .post("/v1/admin/dispatch/board/assign")
      .set(asDispatcher())
      .send({ shipmentId: b.shipments[0]!.id, driverId: driver.id, date: TODAY });
    expect(res.status).toBe(201);
    expect(res.body.tripId).toBeTruthy();

    const card = (await board()).cards.find((c) => c.waybill === b.shipments[0]!.waybill)!;
    expect(card.tripId).toBe(res.body.tripId);
    expect(card.driverId).toBe(driver.id);

    // A second shipment reuses the day rather than failing on the one-trip-per-driver rule.
    const b2 = await book(1);
    const again = await h
      .http()
      .post("/v1/admin/dispatch/board/assign")
      .set(asDispatcher())
      .send({ shipmentId: b2.shipments[0]!.id, driverId: driver.id, date: TODAY });
    expect(again.status).toBe(201);
    expect(again.body.tripId).toBe(res.body.tripId);
  });

  it("plans the whole day across drivers, and changes nothing until it is applied", async () => {
    const a = await book(2);
    const bb = await book(1);
    await openShift();
    const second = (
      await h.http().post("/v1/admin/fleet/drivers").set(asDispatcher()).send({
        email: "thabo@delicatecourier.local",
        fullName: "Thabo M",
        phone: "0830000000",
        dailyStopCapacity: 10,
      })
    ).body as Driver;
    await h
      .http()
      .post("/v1/admin/fleet/shifts")
      .set(asDispatcher())
      .send({ driverId: second.id, date: TODAY })
      .expect(201);

    const plan = (await h.http().get(`/v1/admin/dispatch/plan?date=${TODAY}`).set(asDispatcher()))
      .body as DayPlan;
    expect(plan.date).toBe(TODAY);
    expect(plan.drivers).toHaveLength(2);
    const placed = plan.drivers.flatMap((d) => d.shipmentIds);
    expect(placed.sort()).toEqual([...a.shipments, ...bb.shipments].map((s) => s.id).sort());
    // Both drivers get work: an idle driver while a customer waits is the costliest mistake.
    expect(plan.drivers.every((d) => d.shipmentIds.length > 0)).toBe(true);
    expect(plan.unplaced).toHaveLength(0);
    expect(plan.totalKm).toBeGreaterThan(0);

    // Reading a plan assigns nothing.
    expect(
      ((await h.http().get("/v1/admin/dispatch/unassigned").set(asDispatcher())).body as unknown[])
        .length,
    ).toBe(3);

    // The same morning proposes the same plan; advice that moves every time is noise.
    const again = (await h.http().get(`/v1/admin/dispatch/plan?date=${TODAY}`).set(asDispatcher()))
      .body as DayPlan;
    expect(again.drivers.map((d) => d.shipmentIds)).toEqual(plan.drivers.map((d) => d.shipmentIds));
  });

  it("applies a plan into trips and leaves them unreleased for a dispatcher to sign off", async () => {
    const a = await book(2);
    await openShift();
    const applied = (
      await h
        .http()
        .post("/v1/admin/dispatch/plan/apply")
        .set(asDispatcher())
        .send({ date: TODAY })
        .expect(201)
    ).body as DayPlan;
    expect(applied.drivers.find((d) => d.driverId === driver.id)!.tripReference).toBeTruthy();

    const trips = (await h.http().get(`/v1/admin/dispatch/trips?date=${TODAY}`).set(asDispatcher()))
      .body as Trip[];
    expect(trips).toHaveLength(1);
    // Planned, not released: the driver cannot see it until a person says so.
    expect(trips[0]!.status).toBe("planned");
    expect(trips[0]!.progress.total).toBe(3);
    expect((await h.http().get("/v1/driver/trip").set(asDriver())).body).toEqual({ trip: null });
    expect(a.shipments).toHaveLength(2);
  });

  it("says plainly that nobody is on shift rather than planning an empty day", async () => {
    await book(1);
    const plan = (await h.http().get(`/v1/admin/dispatch/plan?date=${TODAY}`).set(asDispatcher()))
      .body as DayPlan;
    expect(plan.drivers).toHaveLength(0);
    expect(plan.warnings.join(" ")).toContain("Nobody is on shift");
    expect(plan.unplaced).toHaveLength(1);
    expect(plan.unplaced[0]!.reason).toContain("no driver has a shift");
  });

  it("keeps a customer's work off a vehicle class they will not accept", async () => {
    const b = await book(1);
    await openShift();
    // The driver's van is a hatchback; this customer insists on a cargo vehicle.
    const vehicles = (await h.http().get("/v1/admin/fleet/vehicles").set(asDispatcher())).body as {
      id: string;
      registration: string;
    }[];
    await h
      .http()
      .put(`/v1/admin/fleet/vehicles/${vehicles[0]!.id}`)
      .set(asDispatcher())
      .send({
        registration: vehicles[0]!.registration,
        fuelType: "petrol",
        constraints: {
          class: "hatchback",
          maxParcels: null,
          excludedPackageTypes: [],
          maxByPackageType: {},
        },
      })
      .expect(200);
    await h.db.db.execute(
      sql`update accounts set requires_vehicle_class = 'cargo' where id = ${accountId}`,
    );

    const plan = (await h.http().get(`/v1/admin/dispatch/plan?date=${TODAY}`).set(asDispatcher()))
      .body as DayPlan;
    // It still has to go somewhere — there is only one driver — but the rule it breaks is named
    // rather than silently accepted.
    expect(plan.warnings.join(" ")).toContain("cargo");
    expect(plan.warnings.join(" ")).toContain(b.shipments[0]!.waybill);
  });

  it("reports the operating clock so the board does not have to guess it", async () => {
    // 07:00 UTC is 09:00 in Johannesburg; a browser in another timezone must not decide this.
    expect((await board()).nowMinute).toBe(9 * 60);
  });
});
