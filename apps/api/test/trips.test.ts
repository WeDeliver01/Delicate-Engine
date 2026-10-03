import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { users } from "@delicate/db";
import type {
  Booking,
  CatalogResponse,
  CurrentTripResponse,
  Driver,
  DriverDay,
  Quote,
  Trip,
  TripSheet,
} from "@delicate/contracts";
import { createHarness, USERS, type Harness } from "./harness.js";
import { WalletService } from "../src/modules/wallet/wallet.service.js";
import { Clock } from "../src/infra/clock.js";
import { serviceMinutes } from "../src/modules/operations/trip.service.js";

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

describe("trips", () => {
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

  async function book(drops = 2): Promise<Booking> {
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
            instructions: "Ring the bell",
          },
          drops: [
            {
              address: addr("12 Oak St, Centurion", CENTURION, "Centurion"),
              recipient: { name: "Jane", phone: "0821234567", email: null },
              instructions: null,
              parcels: [
                { packageTypeId: cakeId, quantity: 2, weightKg: null, description: "Cake" },
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

  const newTrip = async (): Promise<Trip> => {
    const res = await h
      .http()
      .post("/v1/admin/dispatch/trips")
      .set(asDispatcher())
      .send({ driverId: driver.id, date: TODAY });
    expect(res.status).toBe(201);
    return res.body as Trip;
  };

  const sheet = async (id: string): Promise<TripSheet> =>
    (await h.http().get(`/v1/admin/dispatch/trips/${id}`).set(asDispatcher())).body as TripSheet;

  const addStops = (tripId: string, shipmentIds: string[], resequence = true) =>
    h
      .http()
      .post(`/v1/admin/dispatch/trips/${tripId}/stops`)
      .set(asDispatcher())
      .send({ shipmentIds, resequence });

  it("gives a trip a dated reference and refuses a second one for the same driver and day", async () => {
    const trip = await newTrip();
    expect(trip.reference).toMatch(/^TRIP-260923-\d{3}$/);
    expect(trip).toMatchObject({ status: "planned", driverName: "Sipho Dlamini" });
    expect(trip.vehicleRegistration).toBe("DC 01 GP");

    const again = await h
      .http()
      .post("/v1/admin/dispatch/trips")
      .set(asDispatcher())
      .send({ driverId: driver.id, date: TODAY });
    expect(again.status).toBe(409);
    expect(again.body.code).toBe("trip_exists");
  });

  it("adds a drop with its booking's collection, and assigns the shipment to the trip's driver", async () => {
    const b = await book(2);
    const trip = await newTrip();
    const res = await addStops(trip.id, [b.shipments[0]!.id]);
    expect(res.status).toBe(201);

    const s = res.body as TripSheet;
    // One drop was asked for; the collection it depends on came with it.
    expect(s.stops).toHaveLength(2);
    expect(s.stops.filter((x) => x.kind === "collection")).toHaveLength(1);
    const collection = s.stops.find((x) => x.kind === "collection")!;
    expect(collection.shipmentId).toBeNull();
    expect(collection.address.suburb).toBe("Menlyn");
    expect(collection.instructions).toBe("Ring the bell");
    // The collection carries everything loaded at that counter: both drops' parcels.
    expect(collection.parcels).toHaveLength(2);

    const drop = s.stops.find((x) => x.kind === "drop")!;
    expect(drop.waybill).toBe(b.shipments[0]!.waybill);
    expect(drop.address.suburb).toBe("Centurion");
    // A drop is never sequenced before its own collection.
    expect(collection.sequence).toBeLessThan(drop.sequence);

    // Dispatch stays the authority on who owes the drop, so the assignment must agree.
    const shipment = await h
      .http()
      .get(`/v1/admin/shipments/${b.shipments[0]!.id}`)
      .set(asDispatcher());
    expect(shipment.body.status).toBe("assigned");
  });

  it("adding the same shipment twice is a double-click, not an error", async () => {
    const b = await book(1);
    const trip = await newTrip();
    await addStops(trip.id, [b.shipments[0]!.id]).expect(201);
    const second = await addStops(trip.id, [b.shipments[0]!.id]);
    expect(second.status).toBe(201);
    expect((second.body as TripSheet).stops).toHaveLength(2);
  });

  it("sequences a day from the depot and records the plan each stop is measured against", async () => {
    const b = await book(2);
    const trip = await newTrip();
    const s = (
      await addStops(
        trip.id,
        b.shipments.map((x) => x.id),
      ).expect(201)
    ).body as TripSheet;

    expect(s.stops).toHaveLength(3);
    expect(s.stops.map((x) => x.sequence)).toEqual([1, 2, 3]);
    expect(s.sequenceSource).toBe("auto");
    expect(s.plannedKm).toBeGreaterThan(0);
    expect(s.route?.totalKm).toBeGreaterThan(0);
    // Every stop gets a planned arrival and a service time, in order.
    for (const stop of s.stops) {
      expect(stop.plannedArrivalMinute).toBeGreaterThan(0);
      expect(stop.plannedServiceMinutes).toBeGreaterThan(0);
    }
    const arrivals = s.stops.map((x) => x.plannedArrivalMinute!);
    expect([...arrivals].sort((a, b2) => a - b2)).toEqual(arrivals);
    // The collection still comes before both of its drops.
    expect(s.stops[0]!.kind).toBe("collection");
    // The window defaults to what the booking bought, until a dispatcher narrows it.
    expect(s.stops[0]!.window.source).toBe("slot");
  });

  it("lets a dispatcher reorder by hand, and then refuses to let the optimiser overrule them", async () => {
    const b = await book(2);
    const trip = await newTrip();
    const before = (
      await addStops(
        trip.id,
        b.shipments.map((x) => x.id),
      ).expect(201)
    ).body as TripSheet;

    // Reverse the two drops, keeping the collection first.
    const collection = before.stops.find((x) => x.kind === "collection")!;
    const drops = before.stops.filter((x) => x.kind === "drop");
    const order = [collection.id, drops[1]!.id, drops[0]!.id];
    const res = await h
      .http()
      .put(`/v1/admin/dispatch/trips/${trip.id}/sequence`)
      .set(asDispatcher())
      .send({ stopIds: order });
    expect(res.status).toBe(200);
    const after = res.body as TripSheet;
    expect(after.sequenceSource).toBe("dispatcher");
    expect(after.stops.map((x) => x.id)).toEqual(order);

    // The optimiser does not get to overrule a human who has already decided.
    const auto = await h
      .http()
      .post(`/v1/admin/dispatch/trips/${trip.id}/sequence/auto`)
      .set(asDispatcher());
    expect(auto.status).toBe(201);
    expect((auto.body as TripSheet).stops.map((x) => x.id)).toEqual(order);

    // Unless asked explicitly.
    const forced = await h
      .http()
      .post(`/v1/admin/dispatch/trips/${trip.id}/sequence/auto?force=true`)
      .set(asDispatcher());
    expect((forced.body as TripSheet).sequenceSource).toBe("auto");
  });

  it("rejects a partial reordering rather than silently dropping a stop", async () => {
    const b = await book(2);
    const trip = await newTrip();
    const s = (
      await addStops(
        trip.id,
        b.shipments.map((x) => x.id),
      ).expect(201)
    ).body as TripSheet;
    const res = await h
      .http()
      .put(`/v1/admin/dispatch/trips/${trip.id}/sequence`)
      .set(asDispatcher())
      .send({ stopIds: [s.stops[0]!.id, s.stops[1]!.id] });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("incomplete_sequence");
  });

  it("moves a shipment between trips instead of letting two drivers both own it", async () => {
    const b = await book(1);
    const first = await newTrip();
    await addStops(first.id, [b.shipments[0]!.id]).expect(201);

    const d2 = (
      await h.http().post("/v1/admin/fleet/drivers").set(asDispatcher()).send({
        email: "thabo@delicatecourier.local",
        fullName: "Thabo M",
        phone: "0830000000",
        dailyStopCapacity: 10,
      })
    ).body as Driver;
    const second = (
      await h
        .http()
        .post("/v1/admin/dispatch/trips")
        .set(asDispatcher())
        .send({ driverId: d2.id, date: TODAY })
        .expect(201)
    ).body as Trip;
    await addStops(second.id, [b.shipments[0]!.id]).expect(201);

    // The first trip is left empty: its orphaned collection goes too.
    expect((await sheet(first.id)).stops).toHaveLength(0);
    expect((await sheet(second.id)).stops).toHaveLength(2);
    const shipment = await h
      .http()
      .get(`/v1/admin/shipments/${b.shipments[0]!.id}`)
      .set(asDispatcher());
    expect(shipment.body.status).toBe("assigned");
  });

  it("hides a trip from the driver until it is released, and needs an open shift to start", async () => {
    const b = await book(1);
    const trip = await newTrip();
    await addStops(trip.id, [b.shipments[0]!.id]).expect(201);

    // Planned is a dispatcher's draft, so the app is told there is no trip rather than left
    // to guess from an empty body.
    expect((await h.http().get("/v1/driver/trip").set(asDriver())).body).toEqual({ trip: null });

    await h
      .http()
      .post(`/v1/admin/dispatch/trips/${trip.id}/release`)
      .set(asDispatcher())
      .expect(201);
    const visible = (await h.http().get("/v1/driver/trip").set(asDriver()))
      .body as CurrentTripResponse;
    expect(visible.trip!.id).toBe(trip.id);
    expect(visible.trip!.status).toBe("released");

    // No shift open yet.
    const early = await h
      .http()
      .post("/v1/driver/trip/start")
      .set(asDriver())
      .send({ tripId: trip.id });
    expect(early.status).toBe(409);
    expect(early.body.code).toBe("shift_not_open");

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
    const started = await h
      .http()
      .post("/v1/driver/trip/start")
      .set(asDriver())
      .send({ tripId: trip.id });
    expect(started.status).toBe(201);
    expect(started.body.status).toBe("started");
  });

  it("refuses to release an empty trip", async () => {
    const trip = await newTrip();
    const res = await h
      .http()
      .post(`/v1/admin/dispatch/trips/${trip.id}/release`)
      .set(asDispatcher());
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("trip_empty");
  });

  it("records an arrival with its lateness, and will not accept it twice", async () => {
    const b = await book(1);
    const trip = await newTrip();
    await addStops(trip.id, [b.shipments[0]!.id]).expect(201);
    await h
      .http()
      .post(`/v1/admin/dispatch/trips/${trip.id}/release`)
      .set(asDispatcher())
      .expect(201);
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
    await h
      .http()
      .post("/v1/driver/trip/start")
      .set(asDriver())
      .send({ tripId: trip.id })
      .expect(201);

    const s = await sheet(trip.id);
    const first = s.stops[0]!;
    const res = await h
      .http()
      .post("/v1/driver/trip/arrive")
      .set(asDriver())
      .send({ stopId: first.id, location: MENLYN });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe("arrived");
    expect(res.body.arrivedAt).toBeTruthy();

    // Idempotent: a driver tapping twice is not an error.
    const again = await h
      .http()
      .post("/v1/driver/trip/arrive")
      .set(asDriver())
      .send({ stopId: first.id, location: MENLYN });
    expect(again.status).toBe(201);
    expect(again.body.status).toBe("arrived");

    const progress = (await sheet(trip.id)).progress;
    expect(progress.currentStopId).toBe(first.id);
  });

  it("closes stops from the driver's own actions, and completes the trip once nothing is open", async () => {
    const b = await book(2);
    const trip = await newTrip();
    await addStops(
      trip.id,
      b.shipments.map((x) => x.id),
    ).expect(201);
    await h
      .http()
      .post(`/v1/admin/dispatch/trips/${trip.id}/release`)
      .set(asDispatcher())
      .expect(201);
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
    await h
      .http()
      .post("/v1/driver/trip/start")
      .set(asDriver())
      .send({ tripId: trip.id })
      .expect(201);

    // A trip with open stops cannot be closed.
    const early = await h
      .http()
      .post(`/v1/admin/dispatch/trips/${trip.id}/complete`)
      .set(asDispatcher());
    expect(early.status).toBe(409);
    expect(early.body.code).toBe("trip_has_open_stops");

    await h
      .http()
      .post("/v1/driver/collect")
      .set(asDriver())
      .send({ bookingId: b.id, location: MENLYN })
      .expect(201);
    for (const ship of b.shipments) {
      await h
        .http()
        .post("/v1/driver/deliver")
        .set(asDriver())
        .send({ shipmentId: ship.id, receivedBy: "Jane", photoDataUrl: PNG })
        .expect(201);
    }
    // Stops close from the events those actions emitted, not by dispatch reaching in here.
    expect(await h.dispatcher.tick()).toBeGreaterThan(0);

    const done = await sheet(trip.id);
    expect(done.stops.every((x) => x.status === "done")).toBe(true);
    expect(done.progress).toMatchObject({ total: 3, done: 3, skipped: 0, currentStopId: null });

    const completed = await h
      .http()
      .post(`/v1/admin/dispatch/trips/${trip.id}/complete`)
      .set(asDispatcher());
    expect(completed.status).toBe(201);
    expect(completed.body.status).toBe("completed");
  });

  it("a failed drop closes its stop as skipped rather than done", async () => {
    const b = await book(1);
    const trip = await newTrip();
    await addStops(trip.id, [b.shipments[0]!.id]).expect(201);
    await h
      .http()
      .post(`/v1/admin/dispatch/trips/${trip.id}/release`)
      .set(asDispatcher())
      .expect(201);
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
    await h
      .http()
      .post("/v1/driver/fail")
      .set(asDriver())
      .send({ shipmentId: b.shipments[0]!.id, reason: "recipient_unavailable" })
      .expect(201);
    expect(await h.dispatcher.tick()).toBeGreaterThan(0);

    const s = await sheet(trip.id);
    expect(s.stops.find((x) => x.kind === "drop")!.status).toBe("skipped");
    expect(s.stops.find((x) => x.kind === "collection")!.status).toBe("done");
  });

  it("narrows a window and says who narrowed it, keeping a pin as a pin", async () => {
    const b = await book(1);
    const trip = await newTrip();
    const s = (await addStops(trip.id, [b.shipments[0]!.id]).expect(201)).body as TripSheet;
    const drop = s.stops.find((x) => x.kind === "drop")!;

    const narrowed = await h
      .http()
      .put(`/v1/admin/dispatch/stops/${drop.id}/window`)
      .set(asDispatcher())
      .send({ startMinute: 660, endMinute: 780 });
    expect(narrowed.status).toBe(200);
    expect(narrowed.body.window).toEqual({
      startMinute: 660,
      endMinute: 780,
      source: "dispatcher",
    });

    const pinned = await h
      .http()
      .put(`/v1/admin/dispatch/stops/${drop.id}/window`)
      .set(asDispatcher())
      .send({ startMinute: null, endMinute: null, pinnedMinute: 700 });
    expect(pinned.body.window).toEqual({ startMinute: 700, endMinute: 700, source: "pinned" });

    const backwards = await h
      .http()
      .put(`/v1/admin/dispatch/stops/${drop.id}/window`)
      .set(asDispatcher())
      .send({ startMinute: 780, endMinute: 660 });
    expect(backwards.status).toBe(422);
  });

  it("will not remove a stop the driver has already reached", async () => {
    const b = await book(1);
    const trip = await newTrip();
    const s = (await addStops(trip.id, [b.shipments[0]!.id]).expect(201)).body as TripSheet;
    await h
      .http()
      .post(`/v1/admin/dispatch/trips/${trip.id}/release`)
      .set(asDispatcher())
      .expect(201);
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
    await h
      .http()
      .post("/v1/driver/trip/start")
      .set(asDriver())
      .send({ tripId: trip.id })
      .expect(201);
    const collection = s.stops.find((x) => x.kind === "collection")!;
    await h
      .http()
      .post("/v1/driver/trip/arrive")
      .set(asDriver())
      .send({ stopId: collection.id })
      .expect(201);

    const res = await h
      .http()
      .delete(`/v1/admin/dispatch/trips/${trip.id}/stops`)
      .set(asDispatcher())
      .send({ stopIds: [collection.id] });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("stop_already_worked");
  });

  it("abandoning a trip returns its undelivered shipments to the dispatcher's queue", async () => {
    const b = await book(2);
    const trip = await newTrip();
    await addStops(
      trip.id,
      b.shipments.map((x) => x.id),
    ).expect(201);

    const res = await h
      .http()
      .post(`/v1/admin/dispatch/trips/${trip.id}/abandon`)
      .set(asDispatcher())
      .send({ reason: "vehicle broke down" });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe("abandoned");

    const unassigned = await h.http().get("/v1/admin/dispatch/unassigned").set(asDispatcher());
    expect(unassigned.body).toHaveLength(2);

    // An abandoned trip is history, so the driver can be given a fresh one the same day.
    const replacement = await h
      .http()
      .post("/v1/admin/dispatch/trips")
      .set(asDispatcher())
      .send({ driverId: driver.id, date: TODAY });
    expect(replacement.status).toBe(201);
  });

  it("gives the driver the order the dispatcher decided, not the one the optimiser likes", async () => {
    const b = await book(2);
    const trip = await newTrip();
    const built = (
      await addStops(
        trip.id,
        b.shipments.map((x) => x.id),
      ).expect(201)
    ).body as TripSheet;

    // Reverse the two drops behind the collection — an order the optimiser would not pick.
    const collection = built.stops.find((x) => x.kind === "collection")!;
    const drops = built.stops.filter((x) => x.kind === "drop");
    const chosen = [collection.id, drops[1]!.id, drops[0]!.id];
    await h
      .http()
      .put(`/v1/admin/dispatch/trips/${trip.id}/sequence`)
      .set(asDispatcher())
      .send({ stopIds: chosen })
      .expect(200);
    await h
      .http()
      .post(`/v1/admin/dispatch/trips/${trip.id}/release`)
      .set(asDispatcher())
      .expect(201);

    // The invariant is that the day matches the trip, whatever the optimiser would have picked.
    const released = await sheet(trip.id);
    const key = (s: { kind: string; bookingId: string; shipmentId: string | null }) =>
      s.kind === "collection" ? `collect:${s.bookingId}` : `drop:${s.shipmentId}`;
    const day = (await h.http().get("/v1/driver/day").set(asDriver())).body as DriverDay;
    expect(day.stops.map(key)).toEqual(
      [...released.stops].sort((a, b2) => a.sequence - b2.sequence).map(key),
    );
    // And that order is the dispatcher's, not the one the stops were built in.
    expect(released.sequenceSource).toBe("dispatcher");
    expect(released.stops.map((s) => s.id).sort()).toEqual([...chosen].sort());
    expect([...released.stops].sort((a, b2) => a.sequence - b2.sequence).map((s) => s.id)).toEqual(
      chosen,
    );
  });

  it("keeps an assigned shipment on the driver's day even when no trip knows about it", async () => {
    // A parcel assigned but never put on a trip is a mistake to notice, not one to hide: a stop
    // dropped off the driver's screen is how a parcel spends the day in the van.
    const onTrip = await book(1);
    const offTrip = await book(1);
    const trip = await newTrip();
    await addStops(trip.id, [onTrip.shipments[0]!.id]).expect(201);
    await h
      .http()
      .post(`/v1/admin/dispatch/trips/${trip.id}/release`)
      .set(asDispatcher())
      .expect(201);
    await h
      .http()
      .post(`/v1/admin/dispatch/shipments/${offTrip.shipments[0]!.id}/assign`)
      .set(asDispatcher())
      .send({ driverId: driver.id })
      .expect(201);

    const day = (await h.http().get("/v1/driver/day").set(asDriver())).body as DriverDay;
    const waybills = day.stops.map((s) => s.waybill).filter(Boolean);
    expect(waybills).toContain(onTrip.shipments[0]!.waybill);
    expect(waybills).toContain(offTrip.shipments[0]!.waybill);
    // The planned stop comes first; the stray one is appended rather than interleaved.
    expect(waybills.indexOf(onTrip.shipments[0]!.waybill)).toBeLessThan(
      waybills.indexOf(offTrip.shipments[0]!.waybill),
    );
  });

  it("lists trips by date and driver", async () => {
    const trip = await newTrip();
    const byDate = await h.http().get(`/v1/admin/dispatch/trips?date=${TODAY}`).set(asDispatcher());
    expect(byDate.body).toHaveLength(1);
    expect(byDate.body[0].id).toBe(trip.id);
    const other = await h
      .http()
      .get("/v1/admin/dispatch/trips?date=2026-09-24")
      .set(asDispatcher());
    expect(other.body).toHaveLength(0);
  });
});

/**
 * The ported service-time rule. Kept as a unit test beside the integration ones because it is
 * the single biggest input to whether a planned arrival time is worth anything, and because it
 * is the first piece of the old planner's operational knowledge to come across.
 */
describe("service time", () => {
  it("gives a collection longer than a drop, both scaling with pieces", () => {
    expect(serviceMinutes("collection", 1)).toBeGreaterThan(serviceMinutes("drop", 1));
    expect(serviceMinutes("collection", 4)).toBeGreaterThan(serviceMinutes("collection", 1));
    expect(serviceMinutes("drop", 4)).toBeGreaterThan(serviceMinutes("drop", 1));
  });

  it("never returns less than a driver needs to park, nor more than a stop can take", () => {
    expect(serviceMinutes("collection", 0)).toBe(5);
    expect(serviceMinutes("drop", 0)).toBe(3);
    // A van with forty parcels still does not spend an hour at one door; the cap is the point.
    expect(serviceMinutes("collection", 40)).toBe(15);
    expect(serviceMinutes("drop", 40)).toBe(15);
  });
});
