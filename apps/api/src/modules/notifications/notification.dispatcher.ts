import { Inject, Injectable } from "@nestjs/common";
import { PinoLogger } from "nestjs-pino";
import { ENV, type Env } from "../../config/env.js";
import { NotificationService } from "./notification.service.js";

/**
 * Sends queued notifications, on its own loop in the worker process.
 *
 * Deliberately separate from the outbox dispatcher: talking to a mail host is slow and fails in
 * ways a domain event handler must not inherit. An outbox handler only ever *writes* the message
 * down; this loop is the only thing that reaches the network, so a provider outage delays
 * messages without backing up the event stream behind them.
 */
@Injectable()
export class NotificationDispatcher {
  private stopping = false;
  private timer?: NodeJS.Timeout;

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly notifications: NotificationService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(NotificationDispatcher.name);
  }

  start(): void {
    this.stopping = false;
    this.logger.info("notification dispatcher started");
    void this.loop();
  }

  stop(): void {
    this.stopping = true;
    if (this.timer) clearTimeout(this.timer);
  }

  private async loop(): Promise<void> {
    while (!this.stopping) {
      let sent = 0;
      try {
        sent = await this.notifications.dispatchDue();
      } catch (err) {
        this.logger.error({ err }, "notification tick failed");
      }
      if (this.stopping) break;
      if (sent === 0) {
        await new Promise<void>((resolve) => {
          // Slower than the outbox: nothing here is urgent to the second.
          this.timer = setTimeout(resolve, this.env.OUTBOX_POLL_INTERVAL_MS * 5);
        });
      }
    }
  }
}
