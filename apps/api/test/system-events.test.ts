import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { systemEvents, users } from "@delicate/db";
import type { Quote, SystemEvent, SystemEventStats } from "@delicate/contracts";
import { createHarness, USERS, type Harness } from "./harness.js";
import { SystemEventsService } from "../src/modules/system-events/system-events.service.js";
import { Clock } from "../src/infra/clock.js";

const MENLYN = { lat: -25.7826, lng: 28.2755 };
const CENTURION = { lat: -25.8603, lng: 28.1894 };
const addr = (formatted: string, location: { lat: number; lng: number }) => ({
  formatted,
  line1: null,
  suburb: "Centurion",
  city: "Pretoria",
  postalCode: null,
  country: "ZA",
  location,
  placeId: null,
});

/**
 * The operational feed.
 *
 * Phase 8 exists because a webhook refused every payment for two weeks and the only trace was
 * container log, so the things worth protecting here are: that a failure actually lands in the
 * table, that it lands even when the thing it describes wrote nothing, that a credential never
 * does, and that a repeated fault cannot bury everything else.
 */
describe("system events", () => {
  let h: Harness;
  let events: SystemEventsService;
  let owner: string;
  let admin: string;
  let accountId: string;
  let cakeId: string;

  beforeAll(async () => {
    h = await createHarness();
    events = h.app.get(SystemEventsService);
    h.app.get(Clock).now = () => new Date("2026-09-23T07:00:00Z");
    owner = await h.tokenFor(USERS.alice);
    admin = await h.tokenFor(USERS.admin);
  });
  afterAll(() => h.close());

  beforeEach(async () => {
    await h.reset();
    await h.db.db.insert(users).values({ ...USERS.admin, platformRole: "super_admin" });
    const acc = await h
      .http()
      .post("/v1/accounts")
      .set("Authorization", `Bearer ${owner}`)
      .send({ name: "Honey Bee", type: "business", organization: { name: "Honey Bee Bakers" } });
    accountId = acc.body.id;
    const catalog = (await h.http().get("/v1/public/catalog")).body;
    cakeId = catalog.packageTypes.find((p: { code: string }) => p.code === "cake_single").id;
  });

  const asOwner = () => ({ Authorization: `Bearer ${owner}`, "X-Account-Id": accountId });
  const asAdmin = () => ({ Authorization: `Bearer ${admin}` });
  const rows = () => h.db.db.select().from(systemEvents);

  async function quote(): Promise<Quote> {
    const res = await h
      .http()
      .post("/v1/account/quotes")
      .set(asOwner())
      .send({
        serviceLevelCode: "standard",
        collection: {
          address: addr("Honey Bee, Menlyn", MENLYN),
          contact: { name: "Baker", phone: "0821111111", email: null },
          instructions: null,
        },
        drops: [
          {
            address: addr("12 Oak St, Centurion", CENTURION),
            recipient: { name: "Jane", phone: "0821234567", email: null },
            instructions: null,
            parcels: [{ packageTypeId: cakeId, quantity: 1, weightKg: null, description: null }],
          },
        ],
        options: {},
      });
    expect(res.status).toBe(201);
    return res.body as Quote;
  }

  it("never lets a credential reach the table, however a caller labels it", async () => {
    await events.recordAndWait({
      level: "error",
      category: "test.redaction",
      message: "payload refused",
      context: {
        passphrase: "hunter2",
        signature: "abc123",
        apiKey: "sk-live-xyz",
        authorization: "Bearer nope",
        nested: { password: "s3cret", merchantId: "kept" },
        amount: 1200,
      },
    });

    const [row] = await rows();
    const ctx = row!.context as Record<string, unknown>;
    expect(ctx["passphrase"]).toBe("[redacted]");
    expect(ctx["signature"]).toBe("[redacted]");
    expect(ctx["apiKey"]).toBe("[redacted]");
    expect(ctx["authorization"]).toBe("[redacted]");
    expect((ctx["nested"] as Record<string, unknown>)["password"]).toBe("[redacted]");
    // Over-redacting is the intended bias, but it must not eat the useful fields with it.
    expect((ctx["nested"] as Record<string, unknown>)["merchantId"]).toBe("kept");
    expect(ctx["amount"]).toBe(1200);
    expect(JSON.stringify(ctx)).not.toContain("hunter2");
  });

  it("folds a repeated fault into one row with a count, so it cannot bury the rest", async () => {
    for (let i = 0; i < 5; i += 1) {
      await events.recordAndWait({
        level: "warning",
        category: "webhook.bobpay",
        message: `attempt ${i}`,
        dedupeKey: "bobpay:unsigned",
      });
    }

    const all = await rows();
    expect(all).toHaveLength(1);
    expect(all[0]!.count).toBe(5);
    // The newest detail wins: the latest failure is the one being looked at.
    expect(all[0]!.message).toBe("attempt 4");
  });

  it("keeps an unkeyed event per occurrence, because each one is its own bug", async () => {
    for (let i = 0; i < 3; i += 1) {
      await events.recordAndWait({ level: "error", category: "http.5xx", message: `boom ${i}` });
    }
    expect(await rows()).toHaveLength(3);
  });

  it("swallows its own failure rather than breaking the thing it is describing", async () => {
    // A category is `text`, so the only reliable way to make the insert fail is a bad level.
    await expect(
      events.recordAndWait({
        level: "catastrophe" as "error",
        category: "test.invalid",
        message: "should not throw",
      }),
    ).resolves.toBeUndefined();
    expect(await rows()).toHaveLength(0);
  });

  it("records a refused webhook, with the payload, because that is the whole complaint", async () => {
    // No signature, no source IP, nothing configured: BobPay refuses it. What matters is that
    // the refusal is now visible without reading two hundred hours of container log.
    const res = await h.http().post("/v1/webhooks/bobpay").send({ custom_payment_id: "TU-1" });
    expect(res.status).toBeGreaterThanOrEqual(400);

    const all = await rows();
    const hit = all.find((r) => r.category === "webhook.bobpay");
    expect(hit).toBeDefined();
    expect(hit!.level).toBe("error");
    expect(hit!.message).toContain("refused");
    expect((hit!.context as Record<string, unknown>)["provider"]).toBe("bobpay");
  });

  it("records a booking rejection with the shortfall, which was discarded before", async () => {
    const q = await quote();
    const res = await h
      .http()
      .post("/v1/account/bookings")
      .set(asOwner())
      .send({ quoteId: q.id, slot: { date: "2026-09-24", windowKey: "std_morning" } });
    expect(res.status).toBe(402);

    const all = await rows();
    const hit = all.find((r) => r.category === "booking.rejected");
    expect(hit).toBeDefined();
    expect(hit!.level).toBe("warning");
    expect(hit!.accountId).toBe(accountId);
    const ctx = hit!.context as Record<string, unknown>;
    expect(ctx["reason"]).toBe("rejected_insufficient_funds");
    // The detail the old code threw away one line after it arrived.
    expect((ctx["details"] as Record<string, unknown>)["shortfallCents"]).toBe(
      q.breakdown.totalCents,
    );
  });

  it("carries the request id, so a customer's error screenshot leads to the row", async () => {
    const res = await h
      .http()
      .post("/v1/webhooks/bobpay")
      .set("x-request-id", "req-traceable-1")
      .send({ custom_payment_id: "TU-2" });
    expect(res.status).toBeGreaterThanOrEqual(400);

    const all = await rows();
    expect(all.find((r) => r.requestId === "req-traceable-1")).toBeDefined();
  });

  it("folds the 4xx worth watching in bulk, and ignores the rest", async () => {
    // A validation failure is one caller believing something untrue about the API; forty of
    // them after a deploy is the signal, so they fold rather than flooding.
    for (let i = 0; i < 3; i += 1) {
      await h.http().post("/v1/account/quotes").set(asOwner()).send({ nonsense: true });
    }
    // Settle the fire-and-forget writes from the request path.
    await new Promise((r) => setTimeout(r, 300));

    const all = await rows();
    const folded = all.filter((r) => r.category === "http.validation_failed");
    expect(folded).toHaveLength(1);
    expect(folded[0]!.count).toBe(3);
    expect(folded[0]!.level).toBe("warning");
  });

  it("serves the feed to a super admin and refuses everybody else", async () => {
    await events.recordAndWait({
      level: "error",
      category: "test.visible",
      message: "something broke",
    });

    const mine = await h.http().get("/v1/admin/system-events").set(asAdmin());
    expect(mine.status).toBe(200);
    const items = mine.body.items as SystemEvent[];
    expect(items.map((i) => i.category)).toContain("test.visible");

    // A customer cannot read the insides of everybody else's failed requests.
    await h.http().get("/v1/admin/system-events").set(asOwner()).expect(403);
  });

  it("filters by level, category and message, which is how the page is actually used", async () => {
    await events.recordAndWait({ level: "error", category: "a.one", message: "disk on fire" });
    await events.recordAndWait({ level: "warning", category: "b.two", message: "mildly warm" });

    const errors = await h.http().get("/v1/admin/system-events?level=error").set(asAdmin());
    expect((errors.body.items as SystemEvent[]).map((i) => i.category)).toEqual(["a.one"]);

    const byCategory = await h.http().get("/v1/admin/system-events?category=b.two").set(asAdmin());
    expect(byCategory.body.items as SystemEvent[]).toHaveLength(1);

    const search = await h.http().get("/v1/admin/system-events?q=on+fire").set(asAdmin());
    expect((search.body.items as SystemEvent[]).map((i) => i.message)).toEqual(["disk on fire"]);
  });

  it("counts by level and lists the categories it actually found", async () => {
    await events.recordAndWait({ level: "error", category: "x.one", message: "a" });
    await events.recordAndWait({ level: "error", category: "x.one", message: "b" });
    await events.recordAndWait({ level: "info", category: "y.two", message: "c" });

    const res = await h.http().get("/v1/admin/system-events/stats?hours=24").set(asAdmin());
    const stats = res.body as SystemEventStats;
    expect(stats.errors).toBe(2);
    expect(stats.info).toBe(1);
    expect(stats.warnings).toBe(0);
    expect(stats.categories.map((c) => c.category).sort()).toEqual(["x.one", "y.two"]);
  });

  it("prunes past the retention window and leaves everything inside it", async () => {
    await events.recordAndWait({ level: "info", category: "old.one", message: "ancient" });
    await events.recordAndWait({ level: "info", category: "new.one", message: "recent" });
    await h.db.db
      .update(systemEvents)
      .set({ createdAt: sql`now() - interval '91 days'` })
      .where(eq(systemEvents.category, "old.one"));

    expect(await events.prune(90)).toBe(1);
    const left = await rows();
    expect(left.map((r) => r.category)).toEqual(["new.one"]);
  });
});
