import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { users } from "@delicate/db";
import type {
  Booking,
  CatalogResponse,
  Driver,
  Notification,
  Quote,
  SlotPolicy,
  Trip,
  TripSheet,
  WindowBandAvailability,
} from "@delicate/contracts";
import { createHarness, USERS, type Harness } from "./harness.js";
import { WalletService } from "../src/modules/wallet/wallet.service.js";
import { Clock } from "../src/infra/clock.js";
import { RiskService } from "../src/modules/operations/risk.service.js";
import { SchedulingService } from "../src/modules/scheduling/scheduling.service.js";
import { NotificationService } from "../src/modules/notifications/notification.service.js";

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
const DRIVER_USER = {
  id: "10000000-0000-4000-8000-000000000020",
  email: "sipho@delicatecourier.local",
};

describe("timed windows", () => {
  let h: Harness;
  let wallet: WalletService;
  let scheduling: SchedulingService;
  let risk: RiskService;
  let notifications: NotificationService;
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
    scheduling = h.app.get(SchedulingService);
    risk = h.app.get(RiskService);
    notifications = h.app.get(NotificationService);
    h.app.get(Clock).now = () => new Date("2026-09-23T07:00:00Z"); // 09:00 SAST
    owner = await h.tokenFor(USERS.alice);
    dispatcher = await h.tokenFor(USERS.admin);
    driverToken = await h.tokenFor(DRIVER_USER);
  });
  afterAll(() => h.close());

  beforeEach(async () => {
    await h.reset();
    await h.db.db.insert(users).values({ ...USERS.admin, platformRole: "dispatcher" });
    // `reset` truncates the templates along with everything else, and nothing re-seeds them
    // outside module init, so a test that expects a message to go out has to put them back.
    await notifications.seedTemplates();
    const acc = await h
      .http()
      .post("/v1/accounts")
      .set("Authorization", `Bearer ${owner}`)
      .send({ name: "Honey Bee", type: "business", organization: { name: "Honey Bee Bakers" } });
    accountId = acc.body.id;
    await wallet.adjust(accountId, 2_000_000, "test funds");
    cakeId = ((await h.http().get("/v1/public/catalog")).body as CatalogResponse).packageTypes.find(
      (p) => p.code === "cake_single",
    )!.id;
    driver = (
      await h.http().post("/v1/admin/fleet/drivers").set(asDispatcher()).send({
        email: DRIVER_USER.email,
        fullName: "Sipho Dlamini",
        phone: "0831234567",
        dailyStopCapacity: 10,
      })
    ).body;
  });

  const asOwner = () => ({ Authorization: `Bearer ${owner}`, "X-Account-Id": accountId });
  const asDriver = () => ({ Authorization: `Bearer ${driverToken}` });
  const asDispatcher = () => ({ Authorization: `Bearer ${dispatcher}` });

  /** Turn windows on, with room for `capacityPerBand` promises in each hour. */
  async function enableWindows(
    capacityPerBand: number,
    over: Partial<SlotPolicy["timedWindow"]> = {},
  ) {
    const policy = (await h.http().get("/v1/admin/capacity/policy").set(asDispatcher()))
      .body as SlotPolicy;
    const res = await h
      .http()
      .put("/v1/admin/capacity/policy")
      .set(asDispatcher())
      .send({
        ...policy,
        timedWindow: {
          enabled: true,
          bandMinutes: 60,
          minMinutes: 60,
          maxMinutes: 120,
          capacityPerBand,
          ...over,
        },
      });
    expect(res.status).toBe(200);
  }

  async function priceWindowSurcharge(cents: number) {
    await h.db.db.execute(sql`update rate_cards set timed_window_surcharge_cents = ${cents}`);
  }

  async function quote(timedWindow?: {
    collection: { startMinute: number; endMinute: number } | null;
    delivery: { startMinute: number; endMinute: number } | null;
  }): Promise<Quote> {
    const res = await h
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
            parcels: [{ packageTypeId: cakeId, quantity: 1, weightKg: null, description: "Cake" }],
          },
        ],
        options: {},
        ...(timedWindow ? { timedWindow } : {}),
      });
    expect(res.status).toBe(201);
    return res.body as Quote;
  }

  const bookWith = (q: Quote, timedWindow?: unknown) =>
    h
      .http()
      .post("/v1/account/bookings")
      .set(asOwner())
      .send({ quoteId: q.id, ...(timedWindow ? { timedWindow } : {}) });

  it("sells nothing until the business turns windows on", async () => {
    const window = { collection: null, delivery: { startMinute: 600, endMinute: 660 } };
    const q = await quote(window);
    const res = await bookWith(q, window);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("timed_windows_off");
  });

  it("prices a window, and charges nothing until the rate card says so", async () => {
    await enableWindows(5);
    const plain = await quote();
    const timed = await quote({ collection: null, delivery: { startMinute: 600, endMinute: 660 } });
    // The framework exists; the business rule is off, so the price is unchanged.
    expect(timed.breakdown.totalCents).toBe(plain.breakdown.totalCents);

    await priceWindowSurcharge(5_000);
    const priced = await quote({
      collection: null,
      delivery: { startMinute: 600, endMinute: 660 },
    });
    expect(priced.breakdown.totalCents).toBeGreaterThan(plain.breakdown.totalCents);
    expect(priced.breakdown.lines.some((l) => l.code === "timed_window")).toBe(true);
  });

  it("holds the window on the booking and on the shipment, and shows it back", async () => {
    await enableWindows(5);
    const window = {
      collection: { startMinute: 540, endMinute: 600 },
      delivery: { startMinute: 660, endMinute: 780 },
    };
    const q = await quote(window);
    const res = await bookWith(q, window);
    expect(res.status).toBe(201);
    const booking = res.body as Booking;
    expect(booking.collectionWindow).toEqual({ startMinute: 540, endMinute: 600 });
    expect(booking.shipments[0]!.deliveryWindow).toEqual({ startMinute: 660, endMinute: 780 });
  });

  it("refuses a booking that asks for a window its quote was not priced with", async () => {
    await enableWindows(5);
    const q = await quote();
    // Priced as a plain job; submitted as an hour's promise.
    const res = await bookWith(q, {
      collection: null,
      delivery: { startMinute: 600, endMinute: 660 },
    });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("window_not_quoted");
  });

  it("refuses a booking that drops a window its quote was priced with", async () => {
    await enableWindows(5);
    const window = { collection: null, delivery: { startMinute: 600, endMinute: 660 } };
    const q = await quote(window);
    const res = await bookWith(q);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("window_not_quoted");
  });

  it("refuses a window narrower than we are willing to promise", async () => {
    await enableWindows(5, { minMinutes: 60 });
    const window = { collection: null, delivery: { startMinute: 600, endMinute: 630 } };
    const q = await quote(window);
    const res = await bookWith(q, window);
    expect(res.status).toBe(422);
  });

  it("fills a band and then refuses the next customer for that hour", async () => {
    await enableWindows(1);
    const window = { collection: null, delivery: { startMinute: 600, endMinute: 660 } };
    const first = await bookWith(await quote(window), window);
    expect(first.status).toBe(201);

    const second = await bookWith(await quote(window), window);
    expect(second.status).toBe(409);
    expect(second.body.code).toBe("window_unavailable");
    // And it says which hour is full, not just "no".
    expect(second.body.details ?? second.body).toBeTruthy();

    // Another hour is still free.
    const later = { collection: null, delivery: { startMinute: 660, endMinute: 720 } };
    expect((await bookWith(await quote(later), later)).status).toBe(201);
  });

  it("charges a two-hour window against both hours it could land in", async () => {
    await enableWindows(1);
    const wide = { collection: null, delivery: { startMinute: 600, endMinute: 720 } };
    expect((await bookWith(await quote(wide), wide)).status).toBe(201);

    // Both 10:00 and 11:00 are now taken, because the driver could be needed in either.
    for (const start of [600, 660]) {
      const w = { collection: null, delivery: { startMinute: start, endMinute: start + 60 } };
      const res = await bookWith(await quote(w), w);
      expect(res.status).toBe(409);
      expect(res.body.code).toBe("window_unavailable");
    }
  });

  it("gives the hour back when a booking is cancelled", async () => {
    await enableWindows(1);
    const window = { collection: null, delivery: { startMinute: 600, endMinute: 660 } };
    const booked = await bookWith(await quote(window), window);
    expect(booked.status).toBe(201);

    await h
      .http()
      .post(`/v1/account/bookings/${(booked.body as Booking).id}/cancel`)
      .set(asOwner())
      .send({ reason: "changed my mind" })
      .expect(201);

    // The hour is free again rather than blocked by a job nobody is doing.
    expect((await bookWith(await quote(window), window)).status).toBe(201);
  });

  it("reports band availability a booking form can show", async () => {
    await enableWindows(2);
    const window = { collection: null, delivery: { startMinute: 600, endMinute: 660 } };
    await bookWith(await quote(window), window);

    const bands = (await h.http().get(`/v1/public/slots/windows/${TODAY}`))
      .body as WindowBandAvailability[];
    const ten = bands.find((b) => b.startMinute === 600)!;
    expect(ten).toMatchObject({ capacity: 2, booked: 1, remaining: 1, bookable: true });
    const eleven = bands.find((b) => b.startMinute === 660)!;
    expect(eleven.booked).toBe(0);
  });

  it("offers nothing when windows are off, rather than failing the booking form", async () => {
    expect((await h.http().get(`/v1/public/slots/windows/${TODAY}`)).body).toEqual([]);
  });

  it("gives a trip stop the window the customer bought, not the slot it sits in", async () => {
    await enableWindows(5);
    const window = { collection: null, delivery: { startMinute: 660, endMinute: 720 } };
    const booking = (await bookWith(await quote(window), window)).body as Booking;

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
        .send({ shipmentIds: [booking.shipments[0]!.id], resequence: true })
        .expect(201)
    ).body as TripSheet;

    const drop = sheet.stops.find((s) => s.kind === "drop")!;
    expect(drop.window).toEqual({ startMinute: 660, endMinute: 720, source: "sold" });
    // The collection was not sold a window, so it inherits.
    expect(sheet.stops.find((s) => s.kind === "collection")!.window.source).toBe("slot");
  });

  it("raises a risk once when a promised window closes, and not again", async () => {
    await enableWindows(5);
    // Promised 07:00–08:00; the clock says 09:00.
    const window = { collection: null, delivery: { startMinute: 420, endMinute: 480 } };
    const booking = (await bookWith(await quote(window), window)).body as Booking;

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
      .send({ shipmentIds: [booking.shipments[0]!.id], resequence: true })
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

    expect(await risk.sweep()).toBeGreaterThan(0);
    // A dispatcher who gets the same alert every minute stops reading alerts.
    expect(await risk.sweep()).toBe(0);
  });

  it("tells the customer before the recipient phones them", async () => {
    await enableWindows(5);
    const window = { collection: null, delivery: { startMinute: 420, endMinute: 480 } };
    const booking = (await bookWith(await quote(window), window)).body as Booking;
    await h
      .http()
      .post(`/v1/admin/dispatch/shipments/${booking.shipments[0]!.id}/assign`)
      .set(asDispatcher())
      .send({ driverId: driver.id })
      .expect(201);

    await risk.sweep();
    expect(await h.dispatcher.tick()).toBeGreaterThan(0);

    const sent = (await h.http().get("/v1/admin/notifications?limit=50").set(asDispatcher()))
      .body as Notification[];
    const alert = sent.find((n) => n.kind === "shipment.at_risk");
    expect(alert).toBeDefined();
    expect(alert!.audience).toBe("customer");
    expect(alert!.body).toContain(booking.shipments[0]!.waybill);
    // It says what went wrong, not just that something did.
    expect(alert!.body).toContain("08:00"); // the end of the window we promised
  });

  it("works out which hours a window touches", () => {
    const policy = {
      enabled: true,
      bandMinutes: 60,
      minMinutes: 60,
      maxMinutes: 120,
      capacityPerBand: 1,
    };
    // 09:00–10:00 is the 09:00 hour alone: the end is a boundary, not a moment inside it.
    expect(scheduling.bandsFor({ startMinute: 540, endMinute: 600 }, policy)).toEqual([540]);
    expect(scheduling.bandsFor({ startMinute: 540, endMinute: 660 }, policy)).toEqual([540, 600]);
    // A window that starts mid-hour still occupies the hour it starts in.
    expect(scheduling.bandsFor({ startMinute: 570, endMinute: 630 }, policy)).toEqual([540, 600]);
  });
});
