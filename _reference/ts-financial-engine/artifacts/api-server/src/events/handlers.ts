import { deliveryCompletedPayload } from "./schemas.js";
import { settleDelivery } from "./settleDelivery.js";
import type { IncomingEvent } from "./schemas.js";

export interface HandlerResult {
  handled: boolean;
  detail?: Record<string, unknown>;
}

/**
 * Routes a validated inbox event to its settlement handler.
 *
 * Phase 1 only knows DeliveryCompleted. For any other type we return
 * handled:false so the caller leaves the inbox row in "received", we have
 * durably captured the event and can replay it once a handler exists.
 *
 * Adding an event type later is a one-line addition here plus its handler;
 * the ingest endpoint and inbox never change.
 */
export async function handleEvent(event: IncomingEvent): Promise<HandlerResult> {
  switch (event.eventType) {
    case "DeliveryCompleted": {
      const payload = deliveryCompletedPayload.parse(event.payload);
      const result = await settleDelivery({ ...payload, idempotencyKey: event.dedupeKey });
      return {
        handled: true,
        detail: {
          deliveryId: result.deliveryId,
          status: result.status,
          alreadySettled: result.alreadySettled,
        },
      };
    }
    default:
      return { handled: false };
  }
}
