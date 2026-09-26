import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { deliverySlots, shipmentChangeRequests, shipments, users } from "@delicate/db";
import type { Booking, CatalogResponse, ChangeRequest, Quote } from "@delicate/contracts";
import { createHarness, USERS, type Harness } from "./harness.js";
import { WalletService } from "../src/modules/wallet/wallet.service.js";
import { Clock } from "../src/infra/clock.js";

const MENLYN = { lat: -25.7826, lng: 28.2755 };
const CENTURION = { lat: -25.8603, lng: 28.1894 };
const BROOKLYN = { lat: -25.7712, lng: 28.2372 };

const addr = (formatted: string, location: { lat: number; lng: number }, suburb = "Centurion") => ({
  formatted,
  line1: null,
  suburb,
  city: "Pretoria",
  postalCode: null,
  country: "ZA",
  location,
  placeId: null,
});

describe("shipment change requests", () => {
  let h: Harness;
  let wallet: WalletService;
  let owner: string;
  let dispatcherToken: string;
  let accountId: string;
  let cakeId: string;
  const SLOT = { date: "2026-09-24", windowKey: "morning" };
  const LATER_SLOT = { date: "2026-09-25", windowKey: "afternoon" };

  beforeAll(async () => {
    h = await createHarness();
    wallet = h.app.get(WalletService);
    h.app.get(Clock).now = () => new Date("2026-09-23T07:00:00Z");
    owner = await h.tokenFor(USERS.alice);
    dispatcherToken = await h.tokenFor(USERS.admin);
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
    await wallet.adjust(accountId, 1_000_000, "test funds");
    cakeId = ((await h.http().get("/v1/public/catalog")).body as CatalogResponse).packageTypes.find(
      (p) => p.code === "cake_single",
    )!.id;
  });

  const asOwner = () => ({ Authorization: `Bearer ${owner}`, "X-Account-Id": accountId });
  const asStaff = () => ({ Authorization: `Bearer ${dispatcherToken}` });

  async function bookOne(): Promise<{ booking: Booking; shipmentId: string }> {
    const q = (
      await h
        .http()
        .post("/v1/account/quotes")
        .set(asOwner())
        .send({
          serviceLevelCode: "standard",
          collection: {
            address: addr("Honey Bee, Menlyn", MENLYN, "Menlyn"),
            contact: { name: "Baker", phone: "0821111111", email: null },
            instructions: null,
          },
          drops: [
            {
              address: addr("12 Oak St, Centurion", CENTURION),
              recipient: { name: "Jane", phone: "0821234567", email: null },
              instructions: null,
              parcels: [{ packageTypeId: cakeId, quantity: 1, weightKg: 4, description: "Cake" }],
            },
          ],
          options: {},
        })
    ).body as Quote;

    const res = await h
      .http()
      .post("/v1/account/bookings")
      .set(asOwner())
      .send({ quoteId: q.id, slot: SLOT });
    expect(res.status).toBe(201);
    const booking = res.body as Booking;
    return { booking, shipmentId: booking.shipments[0]!.id };
  }

  // ── what the engine applies by itself ───────────────────────────────────────

  it("applies a corrected phone number immediately, without waiting for ops", async () => {
    // A wrong number helps nobody sitting in a queue: the driver needs it before they arrive.
    const { shipmentId } = await bookOne();

    const res = await h
      .http()
      .post(`/v1/account/shipments/${shipmentId}/changes`)
      .set(asOwner())
      .send({
        payload: {
          kind: "recipient_contact",
          recipient: { name: "Jane Doe", phone: "0829999999", email: null },
        },
        reason: "typo in the number",
      });

    expect(res.status).toBe(201);
    expect((res.body as ChangeRequest).status).toBe("auto_applied");

    const [row] = await h.db.db.select().from(shipments).where(eq(shipments.id, shipmentId));
    expect((row!.recipient as { phone: string }).phone).toBe("0829999999");
  });

  it("applies new delivery instructions immediately", async () => {
    const { shipmentId } = await bookOne();
    const res = await h
      .http()
      .post(`/v1/account/shipments/${shipmentId}/changes`)
      .set(asOwner())
      .send({ payload: { kind: "instructions", instructions: "Gate code 4412" } });

    expect(res.status).toBe(201);
    expect((res.body as ChangeRequest).status).toBe("auto_applied");
    const [row] = await h.db.db.select().from(shipments).where(eq(shipments.id, shipmentId));
    expect(row!.instructions).toBe("Gate code 4412");
  });

  // ── what waits for a human ──────────────────────────────────────────────────

  it("holds an address change and leaves the shipment untouched until approved", async () => {
    const { shipmentId } = await bookOne();
    const before = (await h.db.db.select().from(shipments).where(eq(shipments.id, shipmentId)))[0]!;

    const asked = await h
      .http()
      .post(`/v1/account/shipments/${shipmentId}/changes`)
      .set(asOwner())
      .send({
        payload: {
          kind: "delivery_address",
          deliveryAddress: addr("8 Fehrsen St, Brooklyn", BROOKLYN, "Brooklyn"),
        },
        reason: "they have moved office",
      });

    expect(asked.status).toBe(201);
    const request = asked.body as ChangeRequest;
    expect(request.status).toBe("pending");
    expect(request.heldBecause).toContain("price");

    // Nothing moves before someone says yes: the price was worked out on the old distance.
    const during = (await h.db.db.select().from(shipments).where(eq(shipments.id, shipmentId)))[0]!;
    expect(during.deliveryAddress).toEqual(before.deliveryAddress);

    const decided = await h
      .http()
      .post(`/v1/admin/changes/${request.id}/decide`)
      .set(asStaff())
      .send({ decision: "approve", note: "same suburb band, no price change" });

    expect(decided.status).toBe(201);
    const after = (await h.db.db.select().from(shipments).where(eq(shipments.id, shipmentId)))[0]!;
    expect((after.deliveryAddress as { suburb: string }).suburb).toBe("Brooklyn");
  });

  it("leaves the shipment alone when ops declines", async () => {
    const { shipmentId } = await bookOne();
    const asked = await h
      .http()
      .post(`/v1/account/shipments/${shipmentId}/changes`)
      .set(asOwner())
      .send({
        payload: {
          kind: "delivery_address",
          deliveryAddress: addr("8 Fehrsen St, Brooklyn", BROOKLYN, "Brooklyn"),
        },
      });

    await h
      .http()
      .post(`/v1/admin/changes/${(asked.body as ChangeRequest).id}/decide`)
      .set(asStaff())
      .send({ decision: "reject", note: "too far out of the run for today" })
      .expect(201);

    const row = (await h.db.db.select().from(shipments).where(eq(shipments.id, shipmentId)))[0]!;
    expect((row.deliveryAddress as { suburb: string }).suburb).toBe("Centurion");
  });

  // ── rescheduling moves the capacity with it ─────────────────────────────────

  it("moves the slot reservation when a reschedule is approved", async () => {
    // The whole point of holding a reschedule: the new day has to have room, and the old day
    // has to get its space back. A booking count left behind would quietly shrink capacity.
    const { shipmentId } = await bookOne();
    const booked = async (s: { date: string; windowKey: string }) =>
      (
        await h.db.db
          .select()
          .from(deliverySlots)
          .where(and(eq(deliverySlots.date, s.date), eq(deliverySlots.windowKey, s.windowKey)))
      )[0]?.bookedCount ?? 0;

    expect(await booked(SLOT)).toBe(1);

    const asked = await h
      .http()
      .post(`/v1/account/shipments/${shipmentId}/changes`)
      .set(asOwner())
      .send({
        payload: {
          kind: "reschedule",
          slotDate: LATER_SLOT.date,
          slotWindowKey: LATER_SLOT.windowKey,
        },
        reason: "nobody home on Thursday",
      });
    expect((asked.body as ChangeRequest).status).toBe("pending");
    // Still on the original day while it waits.
    expect(await booked(SLOT)).toBe(1);
    expect(await booked(LATER_SLOT)).toBe(0);

    await h
      .http()
      .post(`/v1/admin/changes/${(asked.body as ChangeRequest).id}/decide`)
      .set(asStaff())
      .send({ decision: "approve" })
      .expect(201);

    expect(await booked(SLOT)).toBe(0);
    expect(await booked(LATER_SLOT)).toBe(1);

    const row = (await h.db.db.select().from(shipments).where(eq(shipments.id, shipmentId)))[0]!;
    expect(row.slotDate).toBe(LATER_SLOT.date);
    expect(row.slotWindowKey).toBe(LATER_SLOT.windowKey);
  });

  it("refuses a reschedule onto a date that has already passed", async () => {
    const { shipmentId } = await bookOne();
    const res = await h
      .http()
      .post(`/v1/account/shipments/${shipmentId}/changes`)
      .set(asOwner())
      .send({
        payload: { kind: "reschedule", slotDate: "2026-09-20", slotWindowKey: "morning" },
      });
    // Held first, then refused on approval — the date check belongs where it is applied,
    // because a request can sit overnight and be approved the morning after.
    const id = (res.body as ChangeRequest).id;
    const decided = await h
      .http()
      .post(`/v1/admin/changes/${id}/decide`)
      .set(asStaff())
      .send({ decision: "approve" });
    expect(decided.status).toBe(409);
    expect(decided.body.code).toBe("date_passed");
  });

  // ── guards ──────────────────────────────────────────────────────────────────

  it("refuses a second pending change of the same kind", async () => {
    const { shipmentId } = await bookOne();
    const body = {
      payload: {
        kind: "delivery_address",
        deliveryAddress: addr("8 Fehrsen St, Brooklyn", BROOKLYN, "Brooklyn"),
      },
    };
    await h.http().post(`/v1/account/shipments/${shipmentId}/changes`).set(asOwner()).send(body);
    const second = await h
      .http()
      .post(`/v1/account/shipments/${shipmentId}/changes`)
      .set(asOwner())
      .send(body);
    expect(second.status).toBe(409);
    expect(second.body.code).toBe("change_already_pending");
  });

  it("refuses to change a shipment that is already finished", async () => {
    const { shipmentId } = await bookOne();
    await h.db.db
      .update(shipments)
      .set({ status: "delivered" })
      .where(eq(shipments.id, shipmentId));

    const res = await h
      .http()
      .post(`/v1/account/shipments/${shipmentId}/changes`)
      .set(asOwner())
      .send({ payload: { kind: "instructions", instructions: "too late" } });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("shipment_closed");
  });

  it("refuses to apply a held change once the parcel has been delivered", async () => {
    const { shipmentId } = await bookOne();
    const asked = await h
      .http()
      .post(`/v1/account/shipments/${shipmentId}/changes`)
      .set(asOwner())
      .send({
        payload: {
          kind: "delivery_address",
          deliveryAddress: addr("8 Fehrsen St, Brooklyn", BROOKLYN, "Brooklyn"),
        },
      });

    // It was delivered while the request sat in the queue. Approving now would rewrite history.
    await h.db.db
      .update(shipments)
      .set({ status: "delivered" })
      .where(eq(shipments.id, shipmentId));

    const decided = await h
      .http()
      .post(`/v1/admin/changes/${(asked.body as ChangeRequest).id}/decide`)
      .set(asStaff())
      .send({ decision: "approve" });
    expect(decided.status).toBe(409);
    expect(decided.body.code).toBe("shipment_closed");
  });

  it("cannot be ruled on twice", async () => {
    const { shipmentId } = await bookOne();
    const asked = await h
      .http()
      .post(`/v1/account/shipments/${shipmentId}/changes`)
      .set(asOwner())
      .send({
        payload: {
          kind: "delivery_address",
          deliveryAddress: addr("8 Fehrsen St, Brooklyn", BROOKLYN, "Brooklyn"),
        },
      });
    const id = (asked.body as ChangeRequest).id;
    await h
      .http()
      .post(`/v1/admin/changes/${id}/decide`)
      .set(asStaff())
      .send({ decision: "approve" })
      .expect(201);
    const again = await h
      .http()
      .post(`/v1/admin/changes/${id}/decide`)
      .set(asStaff())
      .send({ decision: "reject", note: "changed my mind" });
    expect(again.status).toBe(409);
    expect(again.body.code).toBe("already_decided");
  });

  it("keeps one account's shipments away from another", async () => {
    const { shipmentId } = await bookOne();
    // A second account belonging to the same signed-in person: being a member of one account
    // must not let them touch another's shipment just by switching the header.
    const other = await h
      .http()
      .post("/v1/accounts")
      .set("Authorization", `Bearer ${owner}`)
      .send({ name: "Rival Bakery", type: "business", organization: { name: "Rival" } })
      .expect(201);

    const res = await h
      .http()
      .post(`/v1/account/shipments/${shipmentId}/changes`)
      .set({ Authorization: `Bearer ${owner}`, "X-Account-Id": other.body.id })
      .send({ payload: { kind: "instructions", instructions: "nosy" } });
    expect(res.status).toBe(404);
  });

  it("lets a customer withdraw a request ops has not looked at", async () => {
    const { shipmentId } = await bookOne();
    const asked = await h
      .http()
      .post(`/v1/account/shipments/${shipmentId}/changes`)
      .set(asOwner())
      .send({
        payload: {
          kind: "delivery_address",
          deliveryAddress: addr("8 Fehrsen St, Brooklyn", BROOKLYN, "Brooklyn"),
        },
      });
    const id = (asked.body as ChangeRequest).id;
    await h.http().post(`/v1/account/changes/${id}/withdraw`).set(asOwner()).expect(201);

    const [row] = await h.db.db
      .select()
      .from(shipmentChangeRequests)
      .where(eq(shipmentChangeRequests.id, id));
    expect(row!.status).toBe("withdrawn");

    // And it is gone from the queue ops is working through.
    const queue = await h.http().get("/v1/admin/changes?status=pending").set(asStaff());
    expect((queue.body.items as ChangeRequest[]).map((c) => c.id)).not.toContain(id);
  });

  it("records what changed, both sides of it, for the audit trail", async () => {
    const { shipmentId } = await bookOne();
    await h
      .http()
      .post(`/v1/account/shipments/${shipmentId}/changes`)
      .set(asOwner())
      .send({
        payload: {
          kind: "recipient_contact",
          recipient: { name: "Jane Doe", phone: "0829999999", email: null },
        },
      });

    const [row] = await h.db.db
      .select()
      .from(shipmentChangeRequests)
      .where(eq(shipmentChangeRequests.shipmentId, shipmentId));
    expect((row!.previous as { recipient: { phone: string } }).recipient.phone).toBe("0821234567");
    expect((row!.requested as { recipient: { phone: string } }).recipient.phone).toBe("0829999999");
  });
});
