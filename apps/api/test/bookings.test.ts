import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { bookings, deliverySlots, outboxMessages, users } from "@delicate/db";
import type {
  Booking,
  CatalogResponse,
  Quote,
  TrackingView,
  WalletSummary,
} from "@delicate/contracts";
import { createHarness, USERS, type Harness } from "./harness.js";
import { WalletService } from "../src/modules/wallet/wallet.service.js";
import { Clock } from "../src/infra/clock.js";
import { SchedulingService } from "../src/modules/scheduling/scheduling.service.js";

const MENLYN = { lat: -25.7826, lng: 28.2755 };
const CENTURION = { lat: -25.8603, lng: 28.1894 };
const HATFIELD = { lat: -25.7487, lng: 28.2384 };
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

describe("bookings & shipments", () => {
  let h: Harness;
  let wallet: WalletService;
  let owner: string;
  let dispatcher: string;
  let accountId: string;
  let cakeId: string;
  const SLOT = { date: "2026-09-24", windowKey: "morning" };

  beforeAll(async () => {
    h = await createHarness();
    wallet = h.app.get(WalletService);
    h.app.get(Clock).now = () => new Date("2026-09-23T07:00:00Z");
    owner = await h.tokenFor(USERS.alice);
    dispatcher = await h.tokenFor(USERS.admin);
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
    const catalog = (await h.http().get("/v1/public/catalog")).body as CatalogResponse;
    cakeId = catalog.packageTypes.find((p) => p.code === "cake_single")!.id;
  });

  const asOwner = () => ({ Authorization: `Bearer ${owner}`, "X-Account-Id": accountId });
  const summary = async () =>
    (await h.http().get("/v1/account/wallet").set(asOwner())).body as WalletSummary;

  async function quote(serviceLevelCode = "standard", drops = 1): Promise<Quote> {
    const res = await h
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
            address: addr("12 Oak St, Centurion", CENTURION),
            recipient: { name: "Jane", phone: "0821234567", email: null },
            instructions: null,
            parcels: [
              { packageTypeId: cakeId, quantity: 1, weightKg: 4, description: "Birthday cake" },
            ],
          },
          {
            address: addr("5 Burnett St, Hatfield", HATFIELD, "Hatfield"),
            recipient: { name: "John", phone: "0827654321", email: null },
            instructions: "call on arrival",
            parcels: [{ packageTypeId: cakeId, quantity: 1, weightKg: null, description: null }],
          },
        ].slice(0, drops),
        options: {},
      });
    expect(res.status).toBe(201);
    return res.body as Quote;
  }

  it("rejects an unfunded booking (402), records it, and takes no slot or hold", async () => {
    const q = await quote();
    const res = await h
      .http()
      .post("/v1/account/bookings")
      .set(asOwner())
      .send({ quoteId: q.id, slot: SLOT });
    expect(res.status).toBe(402);
    expect(res.body.code).toBe("insufficient_funds");
    expect(res.body.details.shortfallCents).toBe(q.breakdown.totalCents);

    const rows = await h.db.db.select().from(bookings).where(eq(bookings.accountId, accountId));
    expect(rows.map((r) => r.status)).toEqual(["rejected_insufficient_funds"]);
    expect(rows[0]!.holdId).toBeNull();
    expect((await summary()).heldCents).toBe(0);
    const slot = (
      await h
        .http()
        .get("/v1/public/slots/availability")
        .query({ dateFrom: SLOT.date, dateTo: SLOT.date })
    ).body.find((s: { windowKey: string }) => s.windowKey === "morning");
    expect(slot.booked).toBe(0);
    // quote is still bookable once funded
    const q2 = (await h.http().get(`/v1/account/quotes/${q.id}`).set(asOwner())).body as Quote;
    expect(q2.status).toBe("priced");
  });

  it("confirms a funded booking atomically: hold, slot, waybills, events, quote consumed", async () => {
    await wallet.adjust(accountId, 100_000, "test funds");
    const q = await quote("standard", 2);
    const res = await h
      .http()
      .post("/v1/account/bookings")
      .set(asOwner())
      .send({ quoteId: q.id, slot: SLOT });
    expect(res.status).toBe(201);
    const b = res.body as Booking;
    expect(b.status).toBe("confirmed");
    expect(b.reference).toMatch(/^BK-\d{6}-\d{4}$/);
    expect(b.totalCents).toBe(q.breakdown.totalCents);
    expect(b.shipments).toHaveLength(2);
    expect(b.shipments.map((s) => s.waybill)).toEqual([
      expect.stringMatching(/^DC-\d{6}-00001$/),
      expect.stringMatching(/^DC-\d{6}-00002$/),
    ]);
    expect(b.shipments.every((s) => s.status === "booked" && s.slotDate === SLOT.date)).toBe(true);

    expect(await summary()).toMatchObject({
      balanceCents: 100_000,
      heldCents: q.breakdown.totalCents,
      availableCents: 100_000 - q.breakdown.totalCents,
    });
    const slot = (
      await h
        .http()
        .get("/v1/public/slots/availability")
        .query({ dateFrom: SLOT.date, dateTo: SLOT.date })
    ).body.find((s: { windowKey: string }) => s.windowKey === "morning");
    expect(slot.booked).toBe(1);
    expect(
      ((await h.http().get(`/v1/account/quotes/${q.id}`).set(asOwner())).body as Quote).status,
    ).toBe("booked");

    const events = (await h.db.db.select().from(outboxMessages)).map((e) => e.eventType);
    expect(events).toContain("booking.confirmed");

    // replaying the same submit returns the same booking, no second hold
    const replay = await h
      .http()
      .post("/v1/account/bookings")
      .set(asOwner())
      .send({ quoteId: q.id, slot: SLOT });
    expect(replay.status).toBe(201);
    expect(replay.body.id).toBe(b.id);
    expect((await summary()).heldCents).toBe(q.breakdown.totalCents);

    // the quote cannot be booked twice under a different key either
    const again = await h
      .http()
      .post("/v1/account/bookings")
      .set(asOwner())
      .send({ quoteId: q.id, slot: SLOT, idempotencyKey: "another-attempt-1" });
    expect(again.status).toBe(409);
    expect(again.body.code).toBe("quote_used");
  });

  it("standard needs a slot; on-demand does not; a full slot rejects and records", async () => {
    await wallet.adjust(accountId, 200_000, "test funds");
    const noSlot = await h
      .http()
      .post("/v1/account/bookings")
      .set(asOwner())
      .send({ quoteId: (await quote("standard")).id });
    expect(noSlot.status).toBe(422);

    const od = await h
      .http()
      .post("/v1/account/bookings")
      .set(asOwner())
      .send({ quoteId: (await quote("on_demand")).id });
    expect(od.status).toBe(201);
    expect(od.body.slotDate).toBeNull();

    const sched = h.app.get(SchedulingService);
    await sched.updatePolicy({ ...(await sched.policy()), defaultCapacity: 1 });
    const first = await h
      .http()
      .post("/v1/account/bookings")
      .set(asOwner())
      .send({ quoteId: (await quote()).id, slot: { date: "2026-09-25", windowKey: "afternoon" } });
    expect(first.status).toBe(201);
    const second = await h
      .http()
      .post("/v1/account/bookings")
      .set(asOwner())
      .send({ quoteId: (await quote()).id, slot: { date: "2026-09-25", windowKey: "afternoon" } });
    expect(second.status).toBe(409);
    expect(second.body.code).toBe("slot_unavailable");
    const rejected = await h.db.db
      .select()
      .from(bookings)
      .where(eq(bookings.status, "rejected_slot_unavailable"));
    expect(rejected).toHaveLength(1);
  });

  /*
    On-demand is collected the day it is booked. It does not have to name a window, but the
    portal does ask for one — the customer wants to know roughly when, and a job that takes a
    driver should count against the day like every other one. Today, though, and only today:
    next Tuesday at the on-demand price, with none of the notice the schedule is built on, is
    not something we sell.
  */
  describe("on-demand and the day it is booked", () => {
    const TODAY = "2026-09-23"; // the fixed clock, 09:00 SAST

    it("takes today's window and counts it against the day", async () => {
      await wallet.adjust(accountId, 200_000, "test funds");
      const res = await h
        .http()
        .post("/v1/account/bookings")
        .set(asOwner())
        .send({
          quoteId: (await quote("on_demand")).id,
          // Closed to Standard — the lead time is a day — and open to this.
          slot: { date: TODAY, windowKey: "morning" },
        });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      expect(res.body.slotDate).toBe(TODAY);
      expect(res.body.slotWindowKey).toBe("morning");

      const [row] = await h.db.db
        .select()
        .from(deliverySlots)
        .where(and(eq(deliverySlots.date, TODAY), eq(deliverySlots.windowKey, "morning")));
      expect(row!.bookedCount).toBe(1);
    });

    it("refuses any other day", async () => {
      await wallet.adjust(accountId, 200_000, "test funds");
      const res = await h
        .http()
        .post("/v1/account/bookings")
        .set(asOwner())
        .send({
          quoteId: (await quote("on_demand")).id,
          slot: { date: "2026-09-25", windowKey: "morning" },
        });
      expect(res.status).toBe(422);
    });
  });

  /*
    A waybill is read down a phone and copied off a label, so it is six characters with
    nothing confusable in them -- and random, because a number that counts up tells anyone
    holding two of them how much work we did in between.
  */
  describe("waybills", () => {
    it("is six characters with nothing confusable in it", async () => {
      await wallet.adjust(accountId, 1_000_000, "funds");
      const b = (
        await h
          .http()
          .post("/v1/account/bookings")
          .set(asOwner())
          .send({ quoteId: (await quote()).id, slot: SLOT })
      ).body as Booking;
      // No I, L, O, 0 or 1: the characters people get wrong when reading one out.
      expect(b.shipments[0]!.waybill).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/);
    });

    it("gives every drop on one booking a different one", async () => {
      await wallet.adjust(accountId, 1_000_000, "funds");
      const q = await quote("standard", 2);
      const b = (
        await h
          .http()
          .post("/v1/account/bookings")
          .set(asOwner())
          .send({ quoteId: q.id, slot: SLOT })
      ).body as Booking;
      const waybills = b.shipments.map((s) => s.waybill);
      expect(waybills).toHaveLength(2);
      // Two drops on one booking are inserted one after another, so neither is in the table
      // when the other's number is checked. They still have to differ.
      expect(new Set(waybills).size).toBe(2);
    });

    it("finds one however it was typed", async () => {
      await wallet.adjust(accountId, 1_000_000, "funds");
      const b = (
        await h
          .http()
          .post("/v1/account/bookings")
          .set(asOwner())
          .send({ quoteId: (await quote()).id, slot: SLOT })
      ).body as Booking;
      const waybill = b.shipments[0]!.waybill;

      for (const typed of [
        waybill.toLowerCase(),
        `  ${waybill}  `,
        `${waybill.slice(0, 3)} ${waybill.slice(3)}`,
        // The one substitution worth forgiving: there is no O or I in a waybill, so a zero
        // or a one in a six-character code came from somebody's hand.
        waybill.replace(/O/g, "0").replace(/I/g, "1"),
      ]) {
        const res = await h.http().get(`/v1/public/track/${encodeURIComponent(typed)}`);
        expect(res.status, typed).toBe(200);
        expect(res.body.waybill).toBe(waybill);
      }
    });
  });

  it("cancellation releases the hold and the slot; not after collection", async () => {
    await wallet.adjust(accountId, 100_000, "test funds");
    const b = (
      await h
        .http()
        .post("/v1/account/bookings")
        .set(asOwner())
        .send({ quoteId: (await quote()).id, slot: SLOT })
    ).body as Booking;
    const cancelled = await h
      .http()
      .post(`/v1/account/bookings/${b.id}/cancel`)
      .set(asOwner())
      .send({ reason: "customer changed plans" });
    expect(cancelled.status).toBe(201);
    expect(cancelled.body.status).toBe("cancelled");
    expect(cancelled.body.shipments[0].status).toBe("cancelled");
    expect(await summary()).toMatchObject({
      balanceCents: 100_000,
      heldCents: 0,
      availableCents: 100_000,
    });
    const slot = (
      await h
        .http()
        .get("/v1/public/slots/availability")
        .query({ dateFrom: SLOT.date, dateTo: SLOT.date })
    ).body.find((s: { windowKey: string }) => s.windowKey === "morning");
    expect(slot.booked).toBe(0);

    const b2 = (
      await h
        .http()
        .post("/v1/account/bookings")
        .set(asOwner())
        .send({ quoteId: (await quote()).id, slot: SLOT })
    ).body as Booking;
    const sid = b2.shipments[0]!.id;
    await h
      .http()
      .post(`/v1/admin/dispatch/shipments/${sid}/status`)
      .set("Authorization", `Bearer ${dispatcher}`)
      .send({ status: "collected" })
      .expect(201);
    const late = await h
      .http()
      .post(`/v1/account/bookings/${b2.id}/cancel`)
      .set(asOwner())
      .send({ reason: "too late" });
    expect(late.status).toBe(409);
    expect(late.body.code).toBe("booking_in_progress");
  });

  it("dispatcher drives the shipment state machine; booking rolls up; public tracking shows the timeline", async () => {
    await wallet.adjust(accountId, 100_000, "test funds");
    const b = (
      await h
        .http()
        .post("/v1/account/bookings")
        .set(asOwner())
        .send({ quoteId: (await quote("standard", 2)).id, slot: SLOT })
    ).body as Booking;
    const [s1, s2] = b.shipments;
    const status = (id: string, st: string) =>
      h
        .http()
        .post(`/v1/admin/dispatch/shipments/${id}/status`)
        .set("Authorization", `Bearer ${dispatcher}`)
        .send({ status: st, note: st === "delivered" ? "left with security" : undefined });

    const bad = await status(s1!.id, "delivered"); // booked -> delivered is not allowed
    expect(bad.status).toBe(409);
    expect(bad.body.code).toBe("invalid_transition");

    await status(s1!.id, "assigned").expect(201);
    await status(s1!.id, "collected").expect(201);
    expect(
      ((await h.http().get(`/v1/account/bookings/${b.id}`).set(asOwner())).body as Booking).status,
    ).toBe("in_progress");
    await status(s1!.id, "delivered").expect(201);
    await status(s2!.id, "collected").expect(201);
    await status(s2!.id, "failed").expect(201);
    expect(
      ((await h.http().get(`/v1/account/bookings/${b.id}`).set(asOwner())).body as Booking).status,
    ).toBe("completed");

    const track = await h.http().get(`/v1/public/track/${s1!.waybill.toLowerCase()}`);
    expect(track.status).toBe(200);
    const view = track.body as TrackingView;
    expect(view).toMatchObject({
      waybill: s1!.waybill,
      status: "delivered",
      serviceLevel: "Standard",
      destination: { suburb: "Centurion", city: "Pretoria" },
    });
    expect(view.slot?.label).toContain("Morning");
    expect(view.timeline.map((t) => t.status)).toEqual([
      "booked",
      "assigned",
      "collected",
      "delivered",
    ]);
    expect(JSON.stringify(view)).not.toContain("Jane"); // no recipient PII on the public page

    // a customer cannot drive statuses
    expect(
      (
        await h
          .http()
          .post(`/v1/admin/dispatch/shipments/${s2!.id}/status`)
          .set(asOwner())
          .send({ status: "delivered" })
      ).status,
    ).toBe(403);
    expect((await h.http().get("/v1/public/track/DC-000000-99999")).status).toBe(404);
  });

  it("books a quote that was priced on the address alone, with the people named at booking", async () => {
    // The fast path: a customer gets a price by typing one address, then names the recipient
    // when they commit. The shipment still ends up with somebody to deliver to.
    await wallet.adjust(accountId, 1_000_000, "funds");
    const q = (
      await h
        .http()
        .post("/v1/account/quotes")
        .set(asOwner())
        .send({
          serviceLevelCode: "standard",
          collection: {
            address: addr("Honey Bee, Menlyn", MENLYN, "Menlyn"),
            contact: { name: "Baker", phone: "0821111111", altPhone: null, email: null },
          },
          drops: [{ address: addr("12 Oak St, Centurion", CENTURION) }],
        })
    ).body as Quote;
    expect(q.request.drops[0]!.recipient).toBeNull();

    const res = await h
      .http()
      .post("/v1/account/bookings")
      .set(asOwner())
      .send({
        quoteId: q.id,
        slot: SLOT,
        drops: [{ recipient: { name: "Jane Dlamini", phone: "0821234567", email: null } }],
      });

    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const booking = res.body as Booking;
    expect(booking.shipments[0]!.recipient.name).toBe("Jane Dlamini");
  });

  it("refuses to book a nameless delivery, before taking a slot or holding funds", async () => {
    // A driver cannot knock on a door with no name and no number. Refused up front rather
    // than rolled back, so nothing is reserved on the way to finding out.
    await wallet.adjust(accountId, 1_000_000, "funds");
    const q = (
      await h
        .http()
        .post("/v1/account/quotes")
        .set(asOwner())
        .send({
          serviceLevelCode: "standard",
          collection: {
            address: addr("Honey Bee, Menlyn", MENLYN, "Menlyn"),
            contact: { name: "Baker", phone: "0821111111", altPhone: null, email: null },
          },
          drops: [{ address: addr("12 Oak St, Centurion", CENTURION) }],
        })
    ).body as Quote;

    const res = await h
      .http()
      .post("/v1/account/bookings")
      .set(asOwner())
      .send({ quoteId: q.id, slot: SLOT });

    expect(res.status).toBe(422);
    // Nothing was taken on the way to refusing.
    const after = await summary();
    expect(after.heldCents).toBe(0);
  });

  it("refuses to book a collection with nobody at it", async () => {
    // The other end of the same problem. A quote is priced on addresses and may carry
    // nobody; a collection is a driver arriving at a door, and a door needs a name to ask
    // for and a number to ring.
    await wallet.adjust(accountId, 1_000_000, "funds");
    const q = (
      await h
        .http()
        .post("/v1/account/quotes")
        .set(asOwner())
        .send({
          serviceLevelCode: "standard",
          collection: { address: addr("Honey Bee, Menlyn", MENLYN, "Menlyn") },
          drops: [
            {
              address: addr("12 Oak St, Centurion", CENTURION),
              recipient: { name: "Jane", phone: "0821234567", altPhone: null, email: null },
            },
          ],
        })
    ).body as Quote;

    const res = await h
      .http()
      .post("/v1/account/bookings")
      .set(asOwner())
      .send({ quoteId: q.id, slot: SLOT });

    expect(res.status, JSON.stringify(res.body)).toBe(422);
    expect((await summary()).heldCents).toBe(0);
  });

  it("carries the second number through to the shipment", async () => {
    // The number that saves the delivery when nobody answers the first one, so it has to
    // survive the trip from the form to the thing a driver looks at.
    await wallet.adjust(accountId, 1_000_000, "funds");
    const q = (
      await h
        .http()
        .post("/v1/account/quotes")
        .set(asOwner())
        .send({
          serviceLevelCode: "standard",
          collection: {
            address: addr("Honey Bee, Menlyn", MENLYN, "Menlyn"),
            contact: { name: "Baker", phone: "0821111111", altPhone: null, email: null },
          },
          drops: [
            {
              address: addr("12 Oak St, Centurion", CENTURION),
              recipient: {
                name: "Jane",
                phone: "0821234567",
                altPhone: "0117654321",
                email: null,
              },
            },
          ],
        })
    ).body as Quote;

    const res = await h
      .http()
      .post("/v1/account/bookings")
      .set(asOwner())
      .send({ quoteId: q.id, slot: SLOT });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect((res.body as Booking).shipments[0]!.recipient.altPhone).toBe("0117654321");
  });
});
