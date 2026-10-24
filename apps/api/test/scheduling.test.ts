import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { users } from "@delicate/db";
import type { PublicSlotAvailability, SlotAvailability, SlotPolicy } from "@delicate/contracts";
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
  /**
   * The numbers behind a slot, as only staff are shown them. `/v1/public/slots/availability`
   * -- what a customer gets -- carries a health word instead; see the "what a customer sees"
   * block below for that half of the contract.
   */
  const avail = async (from?: string, to?: string) =>
    (
      await h
        .http()
        .get("/v1/admin/capacity/slots")
        .set(asDispatcher())
        .query({ dateFrom: from, dateTo: to })
    ).body as SlotAvailability[];

  it("converts instants to the company's local date and time", () => {
    expect(toLocal(NOW, "Africa/Johannesburg")).toEqual({ date: "2026-09-23", minutes: 540 });
    expect(addDays("2026-09-30", 1)).toBe("2026-10-01");
  });

  it("lists windows for operating days, applying lead time, cut-off and Sundays", async () => {
    const slots = await avail("2026-09-23", "2026-09-27");
    // today: lead time (minLeadDays = 1) blocks every window, whichever service sells it;
    // Sunday 27th is not an operating day at all.
    const today = slots.filter((s) => s.date === "2026-09-23");
    expect(today).toHaveLength(9); // four Standard windows, five Express
    expect(today.every((s) => s.closedReason === "lead_time")).toBe(true);
    expect(slots.some((s) => s.date === "2026-09-27")).toBe(false);

    const tomorrow = slots.filter((s) => s.date === "2026-09-24");
    expect(tomorrow.map((s) => [s.windowKey, s.bookable, s.remaining])).toEqual([
      ["std_morning", true, 6],
      ["std_late_morning", true, 6],
      ["std_midday", true, 6],
      ["std_afternoon", true, 6],
      ["exp_super_early", true, 3],
      ["exp_morning", true, 3],
      ["exp_brunch", true, 3],
      ["exp_lunch", true, 3],
      ["exp_late_afternoon", true, 3],
    ]);
  });

  /*
    A service that dispatches on the spot is not bound by the lead time the rest of the
    schedule is built around — being bookable today is the whole point of it. It draws from
    the Express bands, not the Standard ones: same-day and urgent is closer to the narrow
    pool than the wide, batching-friendly one.
  */
  describe("a service that dispatches immediately", () => {
    const forOnDemand = async () =>
      (await h.http().get("/v1/public/slots/availability").query({ serviceLevel: "on_demand" }))
        .body as PublicSlotAvailability[];

    it("offers today's Express bands, and nothing but today", async () => {
      const slots = await forOnDemand();
      expect([...new Set(slots.map((s) => s.date))]).toEqual(["2026-09-23"]);
      expect(slots.map((s) => s.windowKey).sort()).toEqual(
        ["exp_super_early", "exp_morning", "exp_brunch", "exp_lunch", "exp_late_afternoon"].sort(),
      );
      // The same bands are shut to Express today, for lead time.
      expect(
        (await avail("2026-09-23", "2026-09-23"))
          .filter((s) => s.windowKey.startsWith("exp_"))
          .every((s) => s.closedReason === "lead_time"),
      ).toBe(true);
    });

    it("closes a band once it has passed, and leaves a later one bookable immediately", async () => {
      const slots = await forOnDemand();
      const by = (key: string) => slots.find((s) => s.windowKey === key)!;
      // 07:00–09:00 ended exactly as the clock struck 09:00.
      expect(by("exp_super_early").closedReason).toBe("cutoff_passed");
      // 11:00–13:00 has not started yet, and immediate dispatch does not need the two hours'
      // notice Express would. It is bookable right now, same as the one actually running.
      expect(by("exp_morning").bookable).toBe(true);
      expect(by("exp_brunch").bookable).toBe(true);
    });

    it("keeps a band open while it is running and closes it the moment it ends", async () => {
      h.app.get(Clock).now = () => new Date("2026-09-23T11:00:00Z"); // 13:00 SAST
      try {
        const slots = await forOnDemand();
        const by = (key: string) => slots.find((s) => s.windowKey === key)!;
        // 11:00–13:00 is over.
        expect(by("exp_brunch").closedReason).toBe("cutoff_passed");
        // 13:00–15:00 is happening now, and a driver can leave now. Express would have
        // needed to book it two hours before it started.
        expect(by("exp_lunch").bookable).toBe(true);
      } finally {
        h.app.get(Clock).now = () => NOW;
      }
    });

    it("still respects a blackout, a closed window and a full one", async () => {
      await svc.setSlot({ date: "2026-09-23", windowKey: "exp_morning", closed: true });
      const slots = await forOnDemand();
      expect(slots.find((s) => s.windowKey === "exp_morning")!.closedReason).toBe("closed");
      expect(slots.find((s) => s.windowKey === "exp_brunch")!.bookable).toBe(true);
    });

    it("is never offered a Standard-only window", async () => {
      const slots = await forOnDemand();
      expect(slots.some((s) => s.windowKey.startsWith("std_"))).toBe(false);
    });
  });

  /**
   * What a customer sees, as distinct from what staff do: a health word standing in for the
   * count, never the count itself. Everything else above this point is read through the
   * admin endpoint on purpose — this block is the one place the public contract is tested.
   */
  describe("what a customer sees", () => {
    it("never carries a number of spaces", async () => {
      const res = await h
        .http()
        .get("/v1/public/slots/availability")
        .query({ dateFrom: "2026-09-24", dateTo: "2026-09-24", serviceLevel: "standard" });
      expect(res.status).toBe(200);
      const body = res.body as Record<string, unknown>[];
      expect(body.length).toBeGreaterThan(0);
      for (const slot of body) {
        expect(slot.capacity, "capacity reached the customer").toBeUndefined();
        expect(slot.booked, "booked reached the customer").toBeUndefined();
        expect(slot.remaining, "remaining reached the customer").toBeUndefined();
        expect(slot.health).toMatch(/^(healthy|limited|closed)$/);
      }
    });

    it("only offers Standard its own windows, and Express its own", async () => {
      const std = (
        await h
          .http()
          .get("/v1/public/slots/availability")
          .query({ dateFrom: "2026-09-24", dateTo: "2026-09-24", serviceLevel: "standard" })
      ).body as PublicSlotAvailability[];
      expect(std.every((s) => s.windowKey.startsWith("std_"))).toBe(true);
      expect(std).toHaveLength(4);

      const exp = (
        await h
          .http()
          .get("/v1/public/slots/availability")
          .query({ dateFrom: "2026-09-24", dateTo: "2026-09-24", serviceLevel: "express" })
      ).body as PublicSlotAvailability[];
      expect(exp.every((s) => s.windowKey.startsWith("exp_"))).toBe(true);
      expect(exp).toHaveLength(5);
    });

    it("reads healthy, then limited, then closed as a window empties, at the operator's own line", async () => {
      const policy = await svc.policy();
      // Four spaces and a 50% line: 50% free still reads healthy (the line is "below 50%",
      // not "at or below"), a quarter free reads limited, none left reads closed.
      await svc.updatePolicy({
        ...policy,
        windows: policy.windows.map((w) => (w.key === "std_morning" ? { ...w, capacity: 4 } : w)),
        healthLimitedBelowBps: 5_000,
      });
      const dateOnly = { dateFrom: "2026-09-24", dateTo: "2026-09-24", serviceLevel: "standard" };
      const health = async () =>
        (
          (await h.http().get("/v1/public/slots/availability").query(dateOnly))
            .body as PublicSlotAvailability[]
        ).find((s) => s.windowKey === "std_morning")!.health;

      expect(await health()).toBe("healthy"); // 4 of 4 free
      const ref = { date: "2026-09-24", windowKey: "std_morning" };
      const take = () =>
        h.db.transaction((tx) => svc.reserve(tx, ref, { serviceLevel: "standard" }));

      await take();
      expect(await health()).toBe("healthy"); // 3 of 4 free, 75%
      await take();
      expect(await health()).toBe("healthy"); // 2 of 4 free, exactly 50% -- not below the line
      await take();
      expect(await health()).toBe("limited"); // 1 of 4 free, 25%
      await take();
      expect(await health()).toBe("closed"); // nothing left
    });
  });

  it("reserve consumes capacity under lock, auto-closes when full, release reopens", async () => {
    // Constrained on the window itself, the way the console actually does it: a window's own
    // capacity wins over the policy default, so that is what has to change to bind this test.
    const policy = await svc.policy();
    await svc.updatePolicy({
      ...policy,
      windows: policy.windows.map((w) => (w.key === "std_morning" ? { ...w, capacity: 2 } : w)),
    });
    const ref = { date: "2026-09-24", windowKey: "std_morning" };

    const results = await Promise.allSettled([
      h.db.transaction((tx) => svc.reserve(tx, ref, { serviceLevel: "standard" })),
      h.db.transaction((tx) => svc.reserve(tx, ref, { serviceLevel: "standard" })),
      h.db.transaction((tx) => svc.reserve(tx, ref, { serviceLevel: "standard" })),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(2);
    const rejected = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(rejected.reason).toMatchObject({ code: "slot_unavailable", statusCode: 409 });

    let [slot] = (await avail("2026-09-24", "2026-09-24")).filter(
      (s) => s.windowKey === "std_morning",
    );
    expect(slot).toMatchObject({ booked: 2, remaining: 0, bookable: false, closedReason: "full" });

    await h.db.transaction((tx) => svc.release(tx, ref));
    [slot] = (await avail("2026-09-24", "2026-09-24")).filter((s) => s.windowKey === "std_morning");
    expect(slot).toMatchObject({ booked: 1, remaining: 1, bookable: true });
  });

  it("refuses to reserve a window against a service level that does not sell it", async () => {
    await expect(
      h.db.transaction((tx) =>
        svc.reserve(
          tx,
          { date: "2026-09-24", windowKey: "std_morning" },
          { serviceLevel: "express" },
        ),
      ),
    ).rejects.toMatchObject({ code: "validation_failed" });
  });

  it("dispatcher can close a slot, override capacity and add blackouts; customers cannot", async () => {
    const closed = await h
      .http()
      .post("/v1/admin/capacity/slots/set")
      .set(asDispatcher())
      .send({ date: "2026-09-25", windowKey: "std_afternoon", closed: true });
    expect(closed.status).toBe(201);
    expect(closed.body).toMatchObject({ bookable: false, closedReason: "closed" });
    await expect(
      h.db.transaction((tx) =>
        svc.reserve(
          tx,
          { date: "2026-09-25", windowKey: "std_afternoon" },
          { serviceLevel: "standard" },
        ),
      ),
    ).rejects.toMatchObject({ code: "slot_unavailable" });

    const bigger = await h
      .http()
      .post("/v1/admin/capacity/slots/set")
      .set(asDispatcher())
      .send({ date: "2026-09-25", windowKey: "std_morning", capacity: 30 });
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
