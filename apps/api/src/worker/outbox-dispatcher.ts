import { Inject, Injectable } from "@nestjs/common";
import { PinoLogger } from "nestjs-pino";
import { and, asc, eq, inArray, lte, sql } from "drizzle-orm";
import { DomainEvent } from "@delicate/contracts";
import { outboxMessages } from "@delicate/db";
import { ENV, type Env } from "../config/env.js";
import { DbService } from "../infra/db.module.js";
import { EventHandlerRegistry } from "./event-handlers.js";

/**
 * Drains the transactional outbox.
 *
 * Claim: `SELECT ... FOR UPDATE SKIP LOCKED` on due rows, mark `processing` with a lock owner,
 * commit. Deliver: run handlers. Outcome: `delivered`, or `failed` with exponential backoff,
 * or `dead` after `maxAttempts` (an operator re-arms via the admin API). Several worker
 * processes can run concurrently; SKIP LOCKED keeps them from claiming the same row.
 */
@Injectable()
export class OutboxDispatcher {
  private stopping = false;
  private timer: NodeJS.Timeout | null = null;

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly dbs: DbService,
    private readonly registry: EventHandlerRegistry,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(OutboxDispatcher.name);
  }

  start(): void {
    this.stopping = false;
    this.logger.info({ workerId: this.env.WORKER_ID }, "outbox dispatcher started");
    void this.loop();
  }

  async stop(): Promise<void> {
    this.stopping = true;
    if (this.timer) clearTimeout(this.timer);
    // Release anything this worker still holds so another instance can pick it up.
    await this.dbs.db
      .update(outboxMessages)
      .set({ status: "pending", lockedBy: null, lockedAt: null })
      .where(
        and(
          eq(outboxMessages.status, "processing"),
          eq(outboxMessages.lockedBy, this.env.WORKER_ID),
        ),
      );
  }

  private async loop(): Promise<void> {
    while (!this.stopping) {
      let processed = 0;
      try {
        processed = await this.tick();
      } catch (err) {
        this.logger.error({ err }, "outbox tick failed");
      }
      if (this.stopping) break;
      // Busy: go again immediately. Idle: wait for the poll interval.
      if (processed === 0) {
        await new Promise<void>((resolve) => {
          this.timer = setTimeout(resolve, this.env.OUTBOX_POLL_INTERVAL_MS);
        });
      }
    }
  }

  /** One claim-and-deliver cycle. Returns the number of messages handled. Public for tests. */
  async tick(): Promise<number> {
    const claimed = await this.claim();
    for (const row of claimed) {
      await this.deliver(row);
    }
    return claimed.length;
  }

  private async claim() {
    return this.dbs.transaction(async (tx) => {
      const due = await tx
        .select({ id: outboxMessages.id })
        .from(outboxMessages)
        .where(
          and(
            inArray(outboxMessages.status, ["pending", "failed"]),
            lte(outboxMessages.nextAttemptAt, new Date()),
          ),
        )
        .orderBy(asc(outboxMessages.nextAttemptAt))
        .limit(this.env.OUTBOX_BATCH_SIZE)
        .for("update", { skipLocked: true });
      if (due.length === 0) return [];
      return tx
        .update(outboxMessages)
        .set({ status: "processing", lockedBy: this.env.WORKER_ID, lockedAt: new Date() })
        .where(
          inArray(
            outboxMessages.id,
            due.map((d) => d.id),
          ),
        )
        .returning();
    });
  }

  private async deliver(row: typeof outboxMessages.$inferSelect): Promise<void> {
    const attempt = row.attempts + 1;
    try {
      const event = DomainEvent.parse(row.envelope);
      await this.registry.dispatch(event);
      await this.dbs.db
        .update(outboxMessages)
        .set({
          status: "delivered",
          attempts: attempt,
          deliveredAt: new Date(),
          lockedBy: null,
          lockedAt: null,
          lastError: null,
        })
        .where(eq(outboxMessages.id, row.id));
      this.logger.debug({ id: row.id, type: row.eventType, attempt }, "delivered");
    } catch (err) {
      const message = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
      const dead = attempt >= row.maxAttempts;
      await this.dbs.db
        .update(outboxMessages)
        .set({
          status: dead ? "dead" : "failed",
          attempts: attempt,
          nextAttemptAt: dead ? row.nextAttemptAt : backoffAt(attempt),
          lastError: message.slice(0, 2000),
          lockedBy: null,
          lockedAt: null,
        })
        .where(eq(outboxMessages.id, row.id));
      this.logger[dead ? "error" : "warn"](
        { id: row.id, type: row.eventType, attempt, dead, err: message },
        dead ? "message dead-lettered" : "delivery failed; will retry",
      );
    }
  }

  /** Reclaim rows whose lock owner died mid-delivery. Runs on start; cheap enough to run often. */
  async reclaimStale(olderThanMs = 5 * 60_000): Promise<number> {
    const cutoff = new Date(Date.now() - olderThanMs);
    const rows = await this.dbs.db
      .update(outboxMessages)
      .set({ status: "pending", lockedBy: null, lockedAt: null })
      .where(
        and(eq(outboxMessages.status, "processing"), sql`${outboxMessages.lockedAt} < ${cutoff}`),
      )
      .returning({ id: outboxMessages.id });
    if (rows.length) this.logger.warn({ count: rows.length }, "reclaimed stale processing rows");
    return rows.length;
  }
}

/** 2s, 4s, 8s … capped at 15 min, with jitter so a thundering herd spreads out. */
export function backoffAt(attempt: number, now = Date.now()): Date {
  const base = Math.min(2 ** attempt * 1000, 15 * 60_000);
  const jitter = Math.floor(Math.random() * 1000);
  return new Date(now + base + jitter);
}
