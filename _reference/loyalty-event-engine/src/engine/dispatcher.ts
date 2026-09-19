import { eq } from "drizzle-orm";
import { db } from "../db/client";
import { events, eventDispatchLog } from "../db/schema";
import { rulesForEvent } from "./rules";
import { applyDeliveryCompleted } from "../loyalty/accrual";
import { enqueueWebhooks } from "../webhooks/outbound";

type Event = typeof events.$inferSelect;

async function log(eventId: string, ruleId: string | null, action: string, status: string, detail?: string) {
  await db.insert(eventDispatchLog).values({
    eventId,
    ruleId,
    actionType: action,
    status,
    detail: detail ?? null,
  });
}

/**
 * Run all enabled rules for a freshly ingested event. Call this only for
 * non-duplicate events (ingest returns a duplicate flag) so webhook fan-out is
 * not re-enqueued; loyalty accrual is independently idempotent as a backstop.
 */
export async function dispatchEvent(event: Event): Promise<void> {
  const rules = await rulesForEvent(event.type);

  for (const rule of rules) {
    try {
      switch (rule.actionType) {
        case "accrue_loyalty": {
          if (event.type !== "delivery.completed") {
            await log(event.id, rule.id, rule.actionType, "skipped", "not a completion event");
            break;
          }
          if (!event.nodeId) {
            await log(event.id, rule.id, rule.actionType, "skipped", "event has no node");
            break;
          }
          const flat = Number((rule.config as Record<string, unknown>)?.flatPerShipmentCents ?? 0);
          const result = await applyDeliveryCompleted({
            nodeId: event.nodeId,
            sourceEventId: event.id,
            amountCents: event.amountCents,
            occurredAt: event.occurredAt,
            flatPerShipmentCents: flat,
          });
          await log(
            event.id,
            rule.id,
            rule.actionType,
            result.applied ? "ok" : "skipped",
            result.applied
              ? `+${result.cashbackCents}c, tier ${result.tier}, milestones ${result.milestonesAwarded.join(",") || "none"}`
              : "already accrued",
          );
          break;
        }
        case "send_webhook": {
          const n = await enqueueWebhooks(event.id, event.type);
          await log(event.id, rule.id, rule.actionType, "ok", `enqueued ${n} endpoint(s)`);
          break;
        }
        case "noop":
          await log(event.id, rule.id, rule.actionType, "ok");
          break;
        default:
          await log(event.id, rule.id, rule.actionType, "skipped", "unknown action");
      }
    } catch (err) {
      await log(event.id, rule.id, rule.actionType, "error", err instanceof Error ? err.message : String(err));
    }
  }

  await db.update(events).set({ processedAt: new Date() }).where(eq(events.id, event.id));
}
