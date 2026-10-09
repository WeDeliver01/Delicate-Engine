import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { accounts, driverPositions, users } from "@delicate/db";
import type {
  Booking,
  CatalogResponse,
  Driver,
  Notification,
  PublicLiveTracking,
  Quote,
} from "@delicate/contracts";
import { createHarness, USERS, type Harness } from "./harness.js";
import { WalletService } from "../src/modules/wallet/wallet.service.js";
import { NotificationService } from "../src/modules/notifications/notification.service.js";
import { Clock } from "../src/infra/clock.js";

/**
 * The recipient's live-tracking link.
 *
 * The point of these tests is the boundary rather than the happy path: the link has to work
 * for the person waiting at the gate, and it has to be useless for everyone else — no
 * guessing it from a waybill, no driver's phone number, no street address, no notes written
 * for the office.
 */

const MENLYN = { lat: -25.7826, lng: 28.2755 };
const CENTURION = { lat: -25.8603, lng: 28.1894 };
const addr = (formatted: string, location: { lat: number; lng: number }, suburb: string) => ({
  formatted,
  line1: "12 Oak Street",
  suburb,
  city: "Pretoria",
  postalCode: null,
  country: "ZA",
  location,
  placeId: null,
});
const DRIVER_USER = {
  id: "10000000-0000-4000-8000-000000000031",
  email: "kagiso@delicatecourier.local",
};

describe("recipient live tracking", () => {
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
    await h.app.get(NotificationService).seedTemplates();
    await h.db.db.insert(users).values({ ...USERS.admin, platformRole: "super_admin" });
    accountId = (
      await h
        .http()
        .post("/v1/accounts")
        .set("Authorization", `Bearer ${owner}`)
        .send({ name: "Honey Bee", type: "business", organization: { name: "Honey Bee Bakers" } })
    ).body.id;
    await h.db.db
      .update(accounts)
      .set({ billingEmail: "orders@honeybee.local" })
      .where(eq(accounts.id, accountId));
    await wallet.adjust(accountId, 500_000, "test funds");
    cakeId = ((await h.http().get("/v1/public/catalog")).body as CatalogResponse).packageTypes.find(
      (p) => p.code === "cake_single",
    )!.id;
    const veh = await h.http().post("/v1/admin/fleet/vehicles").set(asStaff()).send({
      registration: "DC 09 GP",
      make: "Toyota",
      model: "Quantum",
      fuelType: "petrol",
      litresPer100Km: 11,
    });
    driver = (
      await h.http().post("/v1/admin/fleet/drivers").set(asStaff()).send({
        email: DRIVER_USER.email,
        fullName: "Kagiso Molefe",
        phone: "0843332222",
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

  async function book(): Promise<Booking> {
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
    const res = await h.http().post("/v1/account/bookings").set(asOwner()).send({ quoteId: q.id });
    expect(res.status).toBe(201);
    return res.body as Booking;
  }

  /** Drive a booking to out-for-delivery and return the link the recipient was sent. */
  async function sendItOut(): Promise<{ booking: Booking; token: string }> {
    const booking = await book();
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
      .post("/v1/driver/status")
      .set(asDriver())
      .send({ shipmentId: booking.shipments[0]!.id, status: "out_for_delivery" })
      .expect(201);
    await h.dispatcher.tick();

    const rows = (await h.http().get("/v1/admin/notifications?limit=100").set(asStaff()))
      .body as Notification[];
    const sms = rows.find((n) => n.kind === "shipment.out_for_delivery")!;
    expect(sms).toBeTruthy();
    const token = sms.body.match(/\/live\/(trk_[A-Za-z0-9_-]{22})/)?.[1];
    expect(token, `no tracking link in: ${sms.body}`).toBeTruthy();
    return { booking, token: token! };
  }

  const live = (token: string) => h.http().get(`/v1/public/live/${token}`);

  it("puts a tracking link in the recipient's message and answers it without a login", async () => {
    const { booking, token } = await sendItOut();

    const res = await live(token);
    expect(res.status).toBe(200);
    const view = res.body as PublicLiveTracking;
    expect(view).toMatchObject({
      waybill: booking.shipments[0]!.waybill,
      status: "out_for_delivery",
      statusLabel: "Out for delivery",
      state: "live",
      destinationPlace: { suburb: "Centurion", city: "Pretoria" },
    });
    // First name only. A link that travels by SMS gets forwarded, and the number is the
    // driver's own.
    expect(view.driverFirstName).toBe("Kagiso");
    expect(JSON.stringify(view)).not.toContain("0843332222");
    expect(JSON.stringify(view)).not.toContain("Molefe");
    // The recipient knows their own address; whoever the link reached does not need it.
    expect(JSON.stringify(view)).not.toContain("12 Oak Street");
  });

  it("reuses one token per shipment, so an older message's link still works", async () => {
    const { booking, token } = await sendItOut();

    // A second message about the same parcel — the driver saying they are ten minutes out.
    await h
      .http()
      .post("/v1/driver/notify")
      .set(asDriver())
      .send({
        shipmentId: booking.shipments[0]!.id,
        target: "recipient",
        channel: "sms",
        eta: 10,
      })
      .expect(201);

    const rows = (await h.http().get("/v1/admin/notifications?limit=100").set(asStaff()))
      .body as Notification[];
    for (const row of rows.filter((r) => r.body.includes("/live/"))) {
      expect(row.body).toContain(token);
    }
    await live(token).expect(200);
  });

  it("shows the driver's position and an ETA once there is one", async () => {
    const { token } = await sendItOut();
    await h
      .http()
      .post("/v1/driver/location")
      .set(asDriver())
      .send({ pings: [{ location: MENLYN, recordedAt: "2026-09-23T07:00:00.000Z" }] })
      .expect(202);

    const view = (await live(token)).body as PublicLiveTracking;
    expect(view.position).toMatchObject({ lat: MENLYN.lat, lng: MENLYN.lng, stale: false });
    expect(view.destination).toMatchObject(CENTURION);
    expect(view.distanceKm).toBeGreaterThan(0);
    expect(view.etaMinutes).toBeGreaterThan(0);
    expect(view.stopsAway).toBe(0);
  });

  it("does not compute an ETA from a position we stopped hearing about", async () => {
    const { token } = await sendItOut();
    await h.db.db.insert(driverPositions).values({
      driverId: driver.id,
      location: MENLYN,
      recordedAt: new Date("2026-09-23T06:00:00Z"), // an hour before "now"
    });

    const view = (await live(token)).body as PublicLiveTracking;
    expect(view.position?.stale).toBe(true);
    // The minutes would be computed from where the van was an hour ago and read as now.
    expect(view.etaMinutes).toBeNull();
    expect(view.message).toContain("a little while ago");
  });

  it("refuses a token that is not one, and one that is well-formed but unknown", async () => {
    await live("nonsense").expect(422); // fails the param schema before any lookup
    await live(`trk_${"A".repeat(22)}`).expect(404);
    // A waybill is not a key to this. That is the whole reason the token exists.
    const { booking } = await sendItOut();
    await live(booking.shipments[0]!.waybill).expect(422);
  });

  it("withholds the notes on the recipient's timeline", async () => {
    const { booking, token } = await sendItOut();
    await h
      .http()
      .post("/v1/driver/status")
      .set(asDriver())
      .send({
        shipmentId: booking.shipments[0]!.id,
        status: "on_hold",
        note: "nobody home, phoned the shop",
      })
      .expect(201);

    const res = await h.http().get(`/v1/public/live/${token}/timeline`);
    expect(res.status).toBe(200);
    const items = res.body.items as { status: string; label: string }[];
    expect(items.map((i) => i.status)).toContain("on_hold");
    expect(items.find((i) => i.status === "on_hold")!.label).toBe("On hold");
    // Written for the office, not for the person waiting.
    expect(JSON.stringify(res.body)).not.toContain("phoned the shop");
  });

  it("keeps answering after delivery, with who signed and no driver note", async () => {
    const { booking, token } = await sendItOut();
    await h
      .http()
      .post("/v1/driver/deliver")
      .set(asDriver())
      .send({
        shipmentId: booking.shipments[0]!.id,
        receivedBy: "Jane",
        photoDataUrl:
          "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
        actualKm: 14,
        note: "left at the security gate",
      })
      .expect(201);

    const view = (await live(token)).body as PublicLiveTracking;
    expect(view.state).toBe("delivered");
    expect(view.proofOfDelivery?.receivedBy).toBe("Jane");
    expect(view.deliveredAt).toBeTruthy();
    expect(JSON.stringify(view)).not.toContain("security gate");
  });

  it("will not show one account the timeline of another account's shipment", async () => {
    const { booking } = await sendItOut();
    const intruderToken = await h.tokenFor(USERS.bob);
    const intruderAccount = (
      await h
        .http()
        .post("/v1/accounts")
        .set("Authorization", `Bearer ${intruderToken}`)
        .send({ name: "Rival Bakes", type: "business", organization: { name: "Rival Bakes" } })
    ).body.id;

    const res = await h
      .http()
      .get(`/v1/account/shipments/${booking.shipments[0]!.id}/timeline`)
      .set({ Authorization: `Bearer ${intruderToken}`, "X-Account-Id": intruderAccount });
    expect(res.status).toBe(404);
  });
});
