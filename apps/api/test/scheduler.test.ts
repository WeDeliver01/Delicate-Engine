import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { createHarness, type Harness } from "./harness.js";
import { JOBS, Scheduler } from "../src/worker/scheduler.js";

/**
 * Scheduled work.
 *
 * This exists because the renewal tests call `renewDue()` straight, which proves the sweep but
 * not that anything ever calls it. The wiring is the fragile half: pg-boss will not accept a
 * schedule for a queue that does not exist, and the only place that showed up was the worker's
 * log in production.
 */
describe("scheduler", () => {
  let h: Harness;
  let scheduler: Scheduler;

  beforeAll(async () => {
    h = await createHarness();
    scheduler = h.app.get(Scheduler);
    // Start from nothing, which is the condition that broke: pg-boss owns this schema and
    // nothing in the harness truncates it, so a queue left behind by an earlier run would
    // hide exactly the failure this file is here to catch.
    await h.db.db.execute(sql`drop schema if exists pgboss cascade`);
  });
  afterAll(async () => {
    await scheduler.onModuleDestroy();
    await h.close();
  });

  it("registers the renewal sweep's cron, creating the queue it hangs off", async () => {
    let ran = 0;
    await scheduler.schedule(JOBS.membershipRenewals, "15 2 * * *", async () => {
      ran += 1;
    });

    const schedules = await h.db.db.execute(
      sql`select name, cron from pgboss.schedule where name = ${JOBS.membershipRenewals}`,
    );
    expect(schedules.rows).toHaveLength(1);
    expect(schedules.rows[0]).toMatchObject({ cron: "15 2 * * *" });
    expect(ran).toBe(0);
  });

  it("accepts a job pushed by hand, for when somebody will not wait for 2am", async () => {
    await expect(scheduler.runNow(JOBS.membershipRenewals)).resolves.toBeUndefined();

    const queued = await h.db.db.execute(
      sql`select count(*)::int as n from pgboss.job where name = ${JOBS.membershipRenewals}`,
    );
    expect((queued.rows[0] as { n: number }).n).toBeGreaterThan(0);
  });
});
