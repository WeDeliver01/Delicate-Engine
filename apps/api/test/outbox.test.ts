import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { outboxMessages, users } from "@delicate/db";
import { createHarness, USERS, type Harness } from "./harness.js";
import { EventHandlerRegistry } from "../src/worker/event-handlers.js";
import { OutboxService } from "../src/infra/outbox.service.js";
import { AppError } from "../src/common/errors.js";

describe("transactional outbox", () => {
  let h: Harness;
  let registry: EventHandlerRegistry;
  let outbox: OutboxService;
  let admin: string;

  beforeAll(async () => {
    h = await createHarness();
    registry = h.app.get(EventHandlerRegistry);
    outbox = h.app.get(OutboxService);
    admin = await h.tokenFor(USERS.admin);
  });
  afterAll(() => h.close());
  beforeEach(async () => {
    await h.reset();
    await h.db.db.insert(users).values({ ...USERS.admin, platformRole: "super_admin" });
  });

  async function createAccountViaApi() {
    const token = await h.tokenFor(USERS.alice);
    const res = await h
      .http()
      .post("/v1/accounts")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Alice", type: "individual" });
    expect(res.status).toBe(201);
    return res.body.id as string;
  }

  it("delivers pending events to registered handlers exactly once per row", async () => {
    const seen: string[] = [];
    registry.register("account.created", async (e) => {
      seen.push(e.payload.accountId);
    });
    const accountId = await createAccountViaApi();

    expect(await h.dispatcher.tick()).toBe(2); // account.created + membership.granted
    expect(await h.dispatcher.tick()).toBe(0);
    expect(seen).toEqual([accountId]);

    const rows = await h.db.db.select().from(outboxMessages);
    expect(rows.every((r) => r.status === "delivered" && r.attempts === 1 && r.deliveredAt)).toBe(
      true,
    );
  });

  it("retries a failing handler with backoff and dead-letters after maxAttempts", async () => {
    let calls = 0;
    registry.register("membership.revoked", async () => {
      calls += 1;
      throw new Error("downstream unavailable");
    });

    await h.db.transaction(async (tx) => {
      await outbox.emit(
        tx,
        "membership.revoked",
        { accountId: "20000000-0000-4000-8000-000000000001", userId: USERS.bob.id },
        { dedupeKey: "test:revoke:1" },
      );
    });
    await h.db.db.update(outboxMessages).set({ maxAttempts: 2 });

    expect(await h.dispatcher.tick()).toBe(1);
    let [row] = await h.db.db.select().from(outboxMessages);
    expect(row).toMatchObject({ status: "failed", attempts: 1 });
    expect(row!.lastError).toMatch(/downstream unavailable/);
    expect(row!.nextAttemptAt.getTime()).toBeGreaterThan(Date.now() + 1000);

    // Not due yet: nothing claimed.
    expect(await h.dispatcher.tick()).toBe(0);

    await h.db.db.update(outboxMessages).set({ nextAttemptAt: new Date(Date.now() - 1) });
    expect(await h.dispatcher.tick()).toBe(1);
    [row] = await h.db.db.select().from(outboxMessages);
    expect(row).toMatchObject({ status: "dead", attempts: 2 });
    expect(calls).toBe(2);

    // Operator re-arms it through the admin API (audited), and it is picked up again.
    const requeue = await h
      .http()
      .post(`/v1/admin/outbox/${row!.id}/requeue`)
      .set("Authorization", `Bearer ${admin}`);
    expect(requeue.status).toBe(201);
    expect(await h.dispatcher.tick()).toBe(1);
    expect(calls).toBe(3);
  });

  it("refuses a second emission of the same business fact", async () => {
    const payload = { accountId: "20000000-0000-4000-8000-000000000002", userId: USERS.bob.id };
    await h.db.transaction((tx) =>
      outbox.emit(tx, "membership.revoked", payload, { dedupeKey: "test:revoke:dup" }),
    );
    await expect(
      h.db.transaction((tx) =>
        outbox.emit(tx, "membership.revoked", payload, { dedupeKey: "test:revoke:dup" }),
      ),
    ).rejects.toMatchObject({ code: "duplicate_event" } satisfies Partial<AppError>);
    expect(
      await h.db.db.$count(outboxMessages, eq(outboxMessages.dedupeKey, "test:revoke:dup")),
    ).toBe(1);
  });

  it("rolls the event back together with the state change", async () => {
    await expect(
      h.db.transaction(async (tx) => {
        await outbox.emit(
          tx,
          "membership.revoked",
          { accountId: "20000000-0000-4000-8000-000000000003", userId: USERS.bob.id },
          { dedupeKey: "test:revoke:rollback" },
        );
        throw new Error("simulated failure after emit");
      }),
    ).rejects.toThrow("simulated failure");
    expect(await h.db.db.$count(outboxMessages)).toBe(0);
  });

  it("exposes stats and listing to super admins only", async () => {
    await createAccountViaApi();
    const alice = await h.tokenFor(USERS.alice);
    expect(
      (await h.http().get("/v1/admin/outbox/stats").set("Authorization", `Bearer ${alice}`)).status,
    ).toBe(403);
    const stats = await h
      .http()
      .get("/v1/admin/outbox/stats")
      .set("Authorization", `Bearer ${admin}`);
    expect(stats.status).toBe(200);
    expect(stats.body).toEqual({ pending: 2 });
    const list = await h
      .http()
      .get("/v1/admin/outbox?status=pending&limit=1")
      .set("Authorization", `Bearer ${admin}`);
    expect(list.body.items).toHaveLength(1);
    expect(list.body.nextCursor).toBeTruthy();
  });
});
