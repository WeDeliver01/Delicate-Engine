import { and, eq, lte, or, sql } from "drizzle-orm";
import { db } from "../db/client";
import { events, webhookEndpoints, webhookDeliveries } from "../db/schema";
import { hmacSha256 } from "../lib/http";

const MAX_ATTEMPTS = 6;
const BACKOFF_MS = [0, 30_000, 120_000, 600_000, 1_800_000, 3_600_000];

function matches(eventType: string, subscribed: string[]): boolean {
  return subscribed.includes("*") || subscribed.includes(eventType);
}

/** Create pending delivery rows for every endpoint subscribed to this event. */
export async function enqueueWebhooks(eventId: string, eventType: string): Promise<number> {
  const endpoints = await db
    .select()
    .from(webhookEndpoints)
    .where(eq(webhookEndpoints.enabled, true));

  const targets = endpoints.filter((e) => matches(eventType, e.eventTypes ?? ["*"]));
  if (targets.length === 0) return 0;

  await db
    .insert(webhookDeliveries)
    .values(
      targets.map((e) => ({
        endpointId: e.id,
        eventId,
        status: "pending" as const,
        nextRetryAt: new Date(),
      })),
    );
  return targets.length;
}

async function deliverOne(delivery: typeof webhookDeliveries.$inferSelect): Promise<void> {
  const endpoint = (
    await db.select().from(webhookEndpoints).where(eq(webhookEndpoints.id, delivery.endpointId)).limit(1)
  )[0];
  const event = (
    await db.select().from(events).where(eq(events.id, delivery.eventId)).limit(1)
  )[0];
  if (!endpoint || !event) {
    await db
      .update(webhookDeliveries)
      .set({ status: "failed", lastError: "endpoint or event missing" })
      .where(eq(webhookDeliveries.id, delivery.id));
    return;
  }

  const body = JSON.stringify({
    id: event.id,
    type: event.type,
    source: event.source,
    nodeId: event.nodeId,
    occurredAt: event.occurredAt,
    payload: event.payload,
  });
  const signature = hmacSha256(endpoint.secret, body);
  const attempt = delivery.attempts + 1;

  try {
    const res = await fetch(endpoint.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-delicate-event": event.type,
        "x-delicate-signature": signature,
        "x-delicate-delivery": delivery.id,
      },
      body,
      signal: AbortSignal.timeout(10_000),
    });

    if (res.ok) {
      await db
        .update(webhookDeliveries)
        .set({ status: "delivered", attempts: attempt, responseCode: res.status, lastError: null })
        .where(eq(webhookDeliveries.id, delivery.id));
      return;
    }
    throw new Error(`HTTP ${res.status}`);
  } catch (err) {
    const done = attempt >= MAX_ATTEMPTS;
    const backoff = BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)] ?? 3_600_000;
    await db
      .update(webhookDeliveries)
      .set({
        status: done ? "failed" : "pending",
        attempts: attempt,
        lastError: err instanceof Error ? err.message : String(err),
        nextRetryAt: new Date(Date.now() + backoff),
      })
      .where(eq(webhookDeliveries.id, delivery.id));
  }
}

/** Process due deliveries. Called by the scheduler on an interval. */
export async function processWebhookDeliveries(limit = 50): Promise<number> {
  const due = await db
    .select()
    .from(webhookDeliveries)
    .where(
      and(
        eq(webhookDeliveries.status, "pending"),
        or(
          sql`${webhookDeliveries.nextRetryAt} is null`,
          lte(webhookDeliveries.nextRetryAt, new Date()),
        ),
      ),
    )
    .limit(limit);

  for (const d of due) await deliverOne(d);
  return due.length;
}
