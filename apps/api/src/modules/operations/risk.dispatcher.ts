import { Injectable } from "@nestjs/common";
import { PinoLogger } from "nestjs-pino";
import { RiskService } from "./risk.service.js";

/**
 * Runs the at-risk sweep on its own slow loop in the worker.
 *
 * Its own loop, not the outbox's: "late" is a fact about the clock, and nothing happens in the
 * system at the moment it becomes true, so no event can carry it. A minute is plenty — the
 * point is to beat the customer's phone call, not to be exact to the second.
 *
 * Deliberately not a job queue. ADR 0002 says pg-boss arrives when scheduled jobs do, and one
 * sweep that is safe to run twice is not enough reason to add a queue; it would also be the
 * only thing in it.
 */
@Injectable()
export class RiskDispatcher {
  private stopping = false;
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly risk: RiskService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(RiskDispatcher.name);
  }

  start(intervalMs = 60_000): void {
    this.stopping = false;
    this.logger.info({ intervalMs }, "risk sweep started");
    void this.loop(intervalMs);
  }

  stop(): void {
    this.stopping = true;
    if (this.timer) clearTimeout(this.timer);
  }

  private async loop(intervalMs: number): Promise<void> {
    while (!this.stopping) {
      try {
        await this.risk.sweep();
      } catch (err) {
        // A failed sweep must never take the worker down: the next one runs in a minute.
        this.logger.error({ err }, "risk sweep failed");
      }
      if (this.stopping) break;
      await new Promise<void>((resolve) => {
        this.timer = setTimeout(resolve, intervalMs);
      });
    }
  }
}
