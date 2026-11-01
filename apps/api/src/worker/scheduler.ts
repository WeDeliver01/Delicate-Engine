import { Injectable, type OnModuleDestroy } from "@nestjs/common";
import { PgBoss } from "pg-boss";
import { PinoLogger } from "nestjs-pino";
import { ENV, type Env } from "../config/env.js";
import { Inject } from "@nestjs/common";

/** The jobs that exist. Named rather than free-form so a typo is a compile error. */
export const JOBS = {
  membershipRenewals: "membership.renewals",
} as const;

export type JobName = (typeof JOBS)[keyof typeof JOBS];

/**
 * Scheduled work.
 *
 * ADR 0002 settled the outbox question and said a job queue arrives when scheduled jobs do.
 * This is that: pg-boss, on the same Postgres, in its own `pgboss` schema. No Redis, nothing
 * new to run, and the same durability argument as the outbox -- a job that was accepted
 * survives the worker being restarted mid-flight.
 *
 * The outbox is not replaced by it and should not be. The outbox carries things that happened
 * and must reach their handlers exactly once; this carries things that must happen at a time,
 * which no event can announce because the only thing that occurred was the clock.
 *
 * Only the worker starts this. The API process creates the same provider so it can enqueue,
 * but never calls `work`, or every web container would race for the same jobs.
 */
@Injectable()
export class Scheduler implements OnModuleDestroy {
  private boss: PgBoss | null = null;
  private started = false;

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(Scheduler.name);
  }

  /** Connect and create the schema. Idempotent; safe to call from more than one process. */
  async start(): Promise<PgBoss> {
    if (this.boss && this.started) return this.boss;
    this.boss = new PgBoss({
      connectionString: this.env.DATABASE_URL,
      // One connection is plenty: the jobs here are minutes apart, not milliseconds.
      max: 2,
      schema: "pgboss",
    });
    this.boss.on("error", (err: unknown) => this.logger.error({ err }, "scheduler error"));
    await this.boss.start();
    this.started = true;
    return this.boss;
  }

  /**
   * Make sure the queue exists before anything is put on it or taken off it.
   *
   * pg-boss 12 no longer conjures a queue out of the first `work` or `send` call: a queue is a
   * row, and a schedule has a foreign key to it. `create_queue` is `ON CONFLICT DO NOTHING`, so
   * every process can call this on the way past without racing the others.
   */
  private async ensureQueue(name: JobName): Promise<PgBoss> {
    const boss = await this.start();
    await boss.createQueue(name);
    return boss;
  }

  /**
   * Register the handler for a job and the cron that fires it.
   *
   * `singletonKey` on the schedule is what stops two workers running the same renewal sweep:
   * pg-boss will only have one instance of a named job queued at a time.
   */
  async schedule(name: JobName, cron: string, handler: () => Promise<void>): Promise<void> {
    const boss = await this.ensureQueue(name);
    await boss.work(name, { batchSize: 1 }, async () => {
      this.logger.info({ job: name }, "job started");
      await handler();
      this.logger.info({ job: name }, "job finished");
    });
    await boss.schedule(name, cron, undefined, { tz: "Africa/Johannesburg" });
    this.logger.info({ job: name, cron }, "job scheduled");
  }

  /** Run a job now, outside its schedule. Used by the console when somebody will not wait. */
  async runNow(name: JobName): Promise<void> {
    const boss = await this.ensureQueue(name);
    await boss.send(name, {}, { singletonKey: `${name}:manual` });
  }

  async onModuleDestroy(): Promise<void> {
    if (this.boss && this.started) {
      this.started = false;
      await this.boss.stop({ graceful: true });
    }
  }
}
