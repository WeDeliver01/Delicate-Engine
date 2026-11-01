import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { users } from "@delicate/db";
import { createHarness, USERS, type Harness } from "./harness.js";
import { Clock } from "../src/infra/clock.js";

describe("in-platform analytics", () => {
  let h: Harness;
  let staff: string;

  beforeAll(async () => {
    h = await createHarness();
    h.app.get(Clock).now = () => new Date("2026-09-23T07:00:00Z");
    staff = await h.tokenFor(USERS.admin);
  });
  afterAll(() => h.close());
  beforeEach(async () => {
    await h.reset();
    await h.db.db.insert(users).values({ ...USERS.admin, platformRole: "super_admin" });
  });

  const asStaff = () => ({ Authorization: `Bearer ${staff}` });
  const RANGE = "?from=2026-09-01&to=2026-09-30";

  it("records a session and its pageviews from the public beacon, with no auth needed", async () => {
    const visitorId = randomUUID();
    const sessionId = randomUUID();

    await h
      .http()
      .post("/v1/telemetry/events")
      .send({
        visitorId,
        sessionId,
        app: "marketing",
        referrer: "https://www.google.com/",
        events: [{ type: "pageview", name: "/", path: "/" }],
      })
      .expect(201);

    // Same session, a second page: the beacon sends the session id again rather than minting one.
    await h
      .http()
      .post("/v1/telemetry/events")
      .send({
        visitorId,
        sessionId,
        app: "marketing",
        events: [{ type: "pageview", name: "/quote", path: "/quote" }],
      })
      .expect(201);

    const overview = (
      await h.http().get(`/v1/admin/site-analytics/overview${RANGE}`).set(asStaff()).expect(200)
    ).body;
    expect(overview.sessions).toBe(1);
    expect(overview.pageviews).toBe(2);
    expect(overview.uniqueVisitors).toBe(1);
    expect(overview.bounceRate).toBe(0);

    const topPages = (
      await h.http().get(`/v1/admin/site-analytics/top-pages${RANGE}`).set(asStaff()).expect(200)
    ).body;
    expect(topPages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "/", pageviews: 1 }),
        expect.objectContaining({ path: "/quote", pageviews: 1 }),
      ]),
    );

    const referrers = (
      await h.http().get(`/v1/admin/site-analytics/referrers${RANGE}`).set(asStaff()).expect(200)
    ).body;
    expect(referrers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ referrer: "https://www.google.com/", sessions: 1 }),
      ]),
    );
  });

  it("counts a custom event and the visitors behind it", async () => {
    const visitorId = randomUUID();
    const sessionId = randomUUID();

    await h
      .http()
      .post("/v1/telemetry/events")
      .send({
        visitorId,
        sessionId,
        app: "portal",
        events: [
          { type: "pageview", name: "/portal/book", path: "/portal/book" },
          { type: "custom", name: "booking_confirmed", path: "/portal/book", props: { bookingId: "x" } },
        ],
      })
      .expect(201);

    const events = (
      await h.http().get(`/v1/admin/site-analytics/events${RANGE}`).set(asStaff()).expect(200)
    ).body;
    expect(events).toEqual([
      expect.objectContaining({ name: "booking_confirmed", count: 1, uniqueVisitors: 1 }),
    ]);
  });

  it("refuses a staff-only report to a caller with no platform role", async () => {
    await h.http().get(`/v1/admin/site-analytics/overview${RANGE}`).expect(401);
  });

  it("rejects a batch with no events and a batch over the cap", async () => {
    const base = { visitorId: randomUUID(), sessionId: randomUUID(), app: "marketing" as const };
    await h.http().post("/v1/telemetry/events").send({ ...base, events: [] }).expect(422);
    await h
      .http()
      .post("/v1/telemetry/events")
      .send({ ...base, events: Array.from({ length: 26 }, () => ({ type: "pageview", name: "/" })) })
      .expect(422);
  });
});
