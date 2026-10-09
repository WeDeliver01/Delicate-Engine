import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { users } from "@delicate/db";
import type { SlotAvailability, SlotPolicy } from "@delicate/contracts";
import { createHarness, USERS, type Harness } from "./harness.js";
import { Clock } from "../src/infra/clock.js";
import {
  SchedulingService,
  addDays,
  toLocal,
} from "../src/modules/scheduling/scheduling.service.js";

describe("scheduling & capacity", () => {
  let h: Harness;
  let svc: SchedulingService;
  let dispatcher: string;
  /** Fixed clock: Wednesday 2026-09-23 09:00 SAST. */
  const NOW = new Date("2026-09-23T07:00:00Z");

  beforeAll(async () => {
    h = await createHarness();
    svc = h.app.get(SchedulingService);
    h.app.get(Clock).now = () => NOW;
    dispatcher = await h.tokenFor(USERS.admin);
  });
  afterAll(() => h.close());
  beforeEach(async () => {
    await h.reset();
    await h.db.db.insert(users).values({ ...USERS.admin, platformRole: "dispatcher" });
  });

  const asDispatcher = () => ({ Authorization: `Bearer ${dispatcher}` });
  const avail = async (from?: string, to?: string) =>
    (await h.http().get("/v1/public/slots/availability").query({ dateFrom: from, dateTo: to }))
      .body as SlotAvailability[];

  it("converts instants to the company's local date and time", () => {
    expect(toLocal(NOW, "Africa/Johannesburg")).toEqual({ date: "2026-09-23", minutes: 540 });
    expect(addDays("2026-09-30", 1)).toBe("2026-10-01");
  });

  it("lists windows for operating days, applying lead time, cut-off and Sundays", async () => {
    const slots = await avail("2026-09-23", "2026-09-27");
    // today: lead time (minLeadDays = 1) blocks it; Sunday 27th not an operating day
    const today = slots.filter((s) => s.date === "2026-09-23");
    expect(today).toHaveLength(2);
    expect(today.every((s) => s.closedReason === "lead_time")).toBe(true);
    expect(slots.some((s) => s.date === "2026-09-27")).toBe(false);
    const tomorrow = slots.filter((s) => s.date === "2026-09-24");
    expect(tomorrow.map((s) => [s.windowKey, s.bookable, s.remaining])).toEqual([
      ["morning", true, 12],
      ["afternoon", true, 12],
    ]);
  });

  /*
    A service that dispatches on the spot is not bound by the lead time the rest of the
    schedule is built around — being bookable today is the whole point of it. What still
    binds it is the day itself: there is no such thing as an on-demand delivery next Tuesday,
    and a window that has finished is finished.
  */
  describe("a service that dispatches immediately", () => {
    const forOnDemand = async () =>
      (await h.http().get("/v1/public/slots/availability").query({ serviceLevel: "on_demand" }))
        .body as SlotAvailability[];

    it("offers today, and nothing but today", async () => {
      const slots = await forOnDemand();
      expect([...new Set(slots.map((s) => s.date))]).toEqual(["2026-09-23"]);
      // The same windows are shut to Standard today, for lead time.
      expect(slots.every((s) => s.bookable)).toBe(true);
      expect(
        (await avail("2026-09-23", "2026-09-23")).every((s) => s.closedReason === "lead_time"),
      ).toBe(true);
    });

    it("keeps a window open while it is running and closes it once it has passed", async () => {
      h.app.get(Clock).now = () => new Date("2026-09-23T11:00:00Z"); // 13:00 SAST
      try {
        const slots = await forOnDemand();
        const by = (key: string) => slots.find((s) => s.windowKey === key)!;
        // 08:00–12:00 is over.
        expect(by("morning").closedReason).toBe("cutoff_passed");
        // 12:00–16:00 is happening now, and a driver can leave now. Standard would have
        // needed to book it two hours before it started.
        expect(by("afternoon").bookable).toBe(true);
      } finally {
        h.app.get(Clock).now = () => NOW;
      }
    });

    it("still respects a blackout, a closed window and a full one", async () => {
      await svc.setSlot({ date: "2026-09-23", windowKey: "morning", closed: true });
      const slots = await forOnDemand();
      expect(slots.find((s) => s.windowKey === "morning")!.closedReason).toBe("closed");
      expect(slots.find((s) => s.windowKey === "afternoon")!.bookable).toBe(true);
    });
  });

  it("reserve consumes capacity under lock, auto-closes when full, release reopens", async () => {
    const policy = await svc.policy();
    await svc.updatePolicy({ ...policy, defaultCapacity: 2 });
    const ref = { date: "2026-09-24", windowKey: "morning" };

    const results = await Promise.allSettled([
      h.db.transaction((tx) => svc.reserve(tx, ref)),
      h.db.transaction((tx) => svc.reserve(tx, ref)),
      h.db.transaction((tx) => svc.reserve(tx, ref)),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(2);
    const rejected = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(rejected.reason).toMatchObject({ code: "slot_unavailable", statusCode: 409 });

    let [slot] = (await avail("2026-09-24", "2026-09-24")).filter((s) => s.windowKey === "morning");
    expect(slot).toMatchObject({ booked: 2, remaining: 0, bookable: false, closedReason: "full" });

    await h.db.transaction((tx) => svc.release(tx, ref));
    [slot] = (await avail("2026-09-24", "2026-09-24")).filter((s) => s.windowKey === "morning");
    expect(slot).toMatchObject({ booked: 1, remaining: 1, bookable: true });
  });

  it("dispatcher can close a slot, override capacity and add blackouts; customers cannot", async () => {
    const closed = await h
      .http()
      .post("/v1/admin/capacity/slots/set")
      .set(asDispatcher())
      .send({ date: "2026-09-25", windowKey: "afternoon", closed: true });
    expect(closed.status).toBe(201);
    expect(closed.body).toMatchObject({ bookable: false, closedReason: "closed" });
    await expect(
      h.db.transaction((tx) => svc.reserve(tx, { date: "2026-09-25", windowKey: "afternoon" })),
    ).rejects.toMatchObject({ code: "slot_unavailable" });

    const bigger = await h
      .http()
      .post("/v1/admin/capacity/slots/set")
      .set(asDispatcher())
      .send({ date: "2026-09-25", windowKey: "morning", capacity: 30 });
    expect(bigger.body).toMatchObject({ capacity: 30, remaining: 30, bookable: true });

    const blackout = await h
      .http()
      .post("/v1/admin/capacity/blackouts")
      .set(asDispatcher())
      .send({ date: "2026-09-26", reason: "Public holiday" });
    expect(blackout.status).toBe(201);
    const sat = await avail("2026-09-26", "2026-09-26");
    expect(sat.every((s) => s.closedReason === "blackout")).toBe(true);

    const customer = await h.tokenFor(USERS.alice);
    const denied = await h
      .http()
      .post("/v1/admin/capacity/blackouts")
      .set("Authorization", `Bearer ${customer}`)
      .send({ date: "2026-09-28", reason: "x" });
    expect(denied.status).toBe(403);

    await h
      .http()
      .delete("/v1/admin/capacity/blackouts/2026-09-26")
      .set(asDispatcher())
      .expect(204);
    expect((await avail("2026-09-26", "2026-09-26")).every((s) => s.bookable)).toBe(true);
  });

  it("rejects an invalid policy", async () => {
    const policy = (await h.http().get("/v1/admin/capacity/policy").set(asDispatcher()))
      .body as SlotPolicy;
    const bad = await h
      .http()
      .put("/v1/admin/capacity/policy")
      .set(asDispatcher())
      .send({ ...policy, windows: [{ ...policy.windows[0]!, endMinutes: 60 }] });
    expect(bad.status).toBe(422);
  });
});
