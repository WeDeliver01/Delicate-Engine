import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { PinoLogger } from "nestjs-pino";
import { and, eq, sql } from "drizzle-orm";
import type { WebhookDelivery } from "@delicate/contracts";
import { webhookSubscriptions } from "@delicate/db";
import { DbService } from "../../infra/db.module.js";

/** How long a receiver gets before we call it a failure. */
const DELIVERY_TIMEOUT_MS = 10_000;

/** Consecutive failures before a subscription is switched off and someone is told. */
const FAILURE_LIMIT = 20;

export const SIGNATURE_HEADER = "x-delicate-signature";
export const DELIVERY_HEADER = "x-delicate-delivery";
export const EVENT_HEADER = "x-delicate-event";

/**
 * Telling another system what happened here.
 *
 * Everything the engine raises has, until now, stayed inside it: the outbox fed our own
 * handlers and the only thing that left was an email or an SMS. A system that books on a
 * customer's behalf needs the other half — otherwise a parcel is collected, delivered and
 * signed for while the merchant's own order sits untouched.
 *
 * Delivery is at-least-once and makes no promise about order. The alternative is holding a
 * queue per receiver and stalling everything behind one slow endpoint, which turns somebody
 * else's outage into ours. Each delivery carries a unique id and a signature over the exact
 * body, so a receiver can verify it and discard a repeat.
 */
@Injectable()
export class WebhookSender {
  constructor(
    private readonly dbs: DbService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(WebhookSender.name);
  }

  static newSecret(): string {
    return `whsec_${randomBytes(24).toString("base64url")}`;
  }

  /**
   * Sign a body exactly as a receiver should verify it: HMAC-SHA256 over the bytes sent,
   * base64. Over the serialised body rather than the object, because the receiver only ever
   * has bytes and re-serialising changes key order and whitespace.
   */
  static sign(body: string, secret: string): string {
    return createHmac("sha256", secret).update(body).digest("base64");
  }

  /**
   * Deliver one event to every subscription that wants it.
   *
   * Returns the number of failures rather than throwing on the first: one broken receiver
   * must not stop a working one from being told. The caller decides what a partial failure
   * means — for the outbox handler it means "throw, and the dispatcher will bring it back".
   */
  async deliver(event: {
    type: string;
    occurredAt: Date;
    accountId: string | null;
    data: Record<string, unknown>;
  }): Promise<{ delivered: number; failed: number }> {
    const subscriptions = await this.dbs.db
      .select()
      .from(webhookSubscriptions)
      .where(eq(webhookSubscriptions.status, "active"));

    const wanted = subscriptions.filter(
      (s) => s.eventTypes.length === 0 || s.eventTypes.includes(event.type),
    );
    if (wanted.length === 0) return { delivered: 0, failed: 0 };

    let delivered = 0;
    let failed = 0;

    for (const subscription of wanted) {
      const delivery: WebhookDelivery = {
        id: randomUUID(),
        type: event.type,
        occurredAt: event.occurredAt.toISOString(),
        accountId: event.accountId,
        data: event.data,
      };
      const body = JSON.stringify(delivery);

      const ok = await this.post(subscription, body, delivery);
      if (ok) delivered += 1;
      else failed += 1;
    }

    return { delivered, failed };
  }

  private async post(
    subscription: typeof webhookSubscriptions.$inferSelect,
    body: string,
    delivery: WebhookDelivery,
  ): Promise<boolean> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DELIVERY_TIMEOUT_MS);
    try {
      const response = await fetch(subscription.url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [SIGNATURE_HEADER]: WebhookSender.sign(body, subscription.secret),
          [DELIVERY_HEADER]: delivery.id,
          [EVENT_HEADER]: delivery.type,
        },
        body,
        signal: controller.signal,
      });

      if (!response.ok) {
        await this.recordFailure(subscription, `HTTP ${response.status}`);
        return false;
      }

      await this.dbs.db
        .update(webhookSubscriptions)
        .set({ lastDeliveredAt: new Date(), consecutiveFailures: 0, lastFailureReason: null })
        .where(eq(webhookSubscriptions.id, subscription.id));
      return true;
    } catch (err) {
      await this.recordFailure(subscription, err instanceof Error ? err.message : String(err));
      return false;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Record the failure, and give up on a receiver that has stopped answering entirely.
   *
   * A subscription pointing at a dead URL would otherwise retry every event forever, which
   * costs a request per event per attempt and buries the one receiver that is working. Twenty
   * consecutive failures is well past a deploy or a brief outage.
   */
  private async recordFailure(
    subscription: typeof webhookSubscriptions.$inferSelect,
    reason: string,
  ): Promise<void> {
    const next = subscription.consecutiveFailures + 1;
    const disable = next >= FAILURE_LIMIT;

    this.logger.warn(
      { subscriptionId: subscription.id, url: subscription.url, reason, consecutiveFailures: next },
      disable ? "disabling a webhook subscription that keeps failing" : "webhook delivery failed",
    );

    await this.dbs.db
      .update(webhookSubscriptions)
      .set({
        lastFailedAt: new Date(),
        lastFailureReason: reason.slice(0, 500),
        consecutiveFailures: sql`${webhookSubscriptions.consecutiveFailures} + 1`,
        ...(disable ? { status: "disabled" as const } : {}),
      })
      .where(
        and(
          eq(webhookSubscriptions.id, subscription.id),
          eq(webhookSubscriptions.status, "active"),
        ),
      );
  }
}
