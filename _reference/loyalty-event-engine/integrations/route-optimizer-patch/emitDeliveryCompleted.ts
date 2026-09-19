import { createHmac } from "node:crypto";

// ─────────────────────────────────────────────────────────────────────────────
// Delicate Event Engine — Route Optimizer outbound patch
//
// Drop this file into the Route Optimizer backend and call emitDeliveryCompleted
// from the stop-completion handler (see INSTALL.md). It is:
//   - env-gated: if DELICATE_WEBHOOK_URL / DELICATE_WEBHOOK_SECRET are unset,
//     it does nothing, so merging the code changes no behaviour until you switch
//     it on.
//   - non-blocking: it never awaits in the request path and never throws into
//     your dispatch flow. A failed push can never stall a driver completing a
//     stop.
//   - idempotent on the receiver: deliveryId is the stable idempotency key, so
//     retries are safe.
//
// Reliability trade-off: this is direct push with a few in-process retries. If
// the process dies mid-retry the event is lost. The Event Engine cannot silently
// double-credit (it dedupes), so the only failure mode is a missed credit, which
// you can replay manually. If you need zero loss, write completions to a small
// outbox table here and flush from a worker instead. INSTALL.md covers both.
// ─────────────────────────────────────────────────────────────────────────────

export interface DeliveryCompletedInput {
  deliveryId: string; // stable id for this completion (use the stop-event id)
  shipmentId?: string | number;
  waybill?: string;
  clientId?: string | number; // Route Optimizer client/store id
  clientName?: string;
  amountCents?: number; // delivery charge in cents, if known (drives cash back)
  completedAt?: Date | string;
  driverId?: string | number;
  lat?: number;
  lng?: number;
}

const MAX_ATTEMPTS = 3;
const RETRY_DELAYS_MS = [1_000, 5_000, 15_000];

function sign(secret: string, body: string): string {
  return createHmac("sha256", secret).update(body).digest("hex");
}

async function send(url: string, secret: string, body: string, deliveryId: string): Promise<void> {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-delicate-signature": sign(secret, body),
      "x-delicate-timestamp": timestamp,
      "x-delicate-delivery": deliveryId,
    },
    body,
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`event engine responded ${res.status}`);
}

/**
 * Fire-and-forget a delivery completion to the Delicate Event Engine.
 * Safe to call synchronously from a request handler: it returns immediately and
 * does the work in the background.
 */
export function emitDeliveryCompleted(input: DeliveryCompletedInput): void {
  const url = process.env.DELICATE_WEBHOOK_URL;
  const secret = process.env.DELICATE_WEBHOOK_SECRET;
  if (!url || !secret) return; // disabled until configured

  const body = JSON.stringify({
    type: "delivery.completed",
    deliveryId: input.deliveryId,
    shipmentId: input.shipmentId ?? null,
    waybill: input.waybill ?? null,
    clientId: input.clientId ?? null,
    clientName: input.clientName ?? null,
    amountCents: typeof input.amountCents === "number" ? input.amountCents : null,
    completedAt: input.completedAt ? new Date(input.completedAt).toISOString() : new Date().toISOString(),
    driverId: input.driverId ?? null,
    lat: typeof input.lat === "number" ? input.lat : null,
    lng: typeof input.lng === "number" ? input.lng : null,
  });

  void (async () => {
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      try {
        await send(url, secret, body, input.deliveryId);
        return;
      } catch (err) {
        const last = attempt === MAX_ATTEMPTS - 1;
        if (last) {
          console.error(
            `[delicate] failed to push completion ${input.deliveryId} after ${MAX_ATTEMPTS} attempts:`,
            err instanceof Error ? err.message : err,
          );
          return;
        }
        await new Promise((r) => setTimeout(r, RETRY_DELAYS_MS[attempt] ?? 15_000));
      }
    }
  })();
}
