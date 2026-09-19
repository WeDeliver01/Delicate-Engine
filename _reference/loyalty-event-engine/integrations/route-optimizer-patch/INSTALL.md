# Route Optimizer patch: push delivery completions to the Event Engine

This is the only change to Route Optimizer production code. It is additive,
env-gated, and non-blocking. Merging it changes nothing until you set the two
environment variables.

## What it does

When a driver completes a stop, the Route Optimizer sends one signed webhook to
the Event Engine. The Event Engine turns that into a `delivery.completed` event,
which drives loyalty cash back, tiers, and milestones.

## 1. Copy the file in

Copy `emitDeliveryCompleted.ts` into the Route Optimizer backend, for example
`server/integrations/delicate/emitDeliveryCompleted.ts`. It has no dependencies
beyond Node 18+ (`fetch` and `node:crypto`).

## 2. Set environment variables (Route Optimizer side)

```
DELICATE_WEBHOOK_URL=https://<event-engine-host>/webhooks/route-optimizer
DELICATE_WEBHOOK_SECRET=<same value as ROUTE_OPTIMIZER_WEBHOOK_SECRET on the Event Engine>
```

The secret must match the Event Engine's `ROUTE_OPTIMIZER_WEBHOOK_SECRET`. The
webhook is signed with HMAC-SHA256 over the exact request body; the Event Engine
rejects anything that does not verify, and rejects stale timestamps.

Until both are set, `emitDeliveryCompleted` returns immediately and does nothing.

## 3. Call it from the stop-completion handler

Find the handler that marks a stop complete. In the Route Optimizer this is the
driver "complete" action that writes a `driver_stop_events` row with
`action = 'complete'`. Right after that write succeeds, add:

```ts
import { emitDeliveryCompleted } from "./integrations/delicate/emitDeliveryCompleted";

// ... after the stop is persisted as completed ...
emitDeliveryCompleted({
  // Use the stop-event row id as the idempotency key. Stable across retries,
  // unique per completion.
  deliveryId: String(stopEvent.id),
  shipmentId: stop.shipmentId,
  waybill: stop.waybill,
  clientId: stop.clientId,        // the Route Optimizer client/store id
  clientName: stop.clientName,    // optional; lets the Event Engine name a new node
  amountCents: stop.deliveryChargeCents, // optional; omit if unknown (see below)
  completedAt: stopEvent.createdAt,
  driverId: driver.id,
  lat: stopEvent.lat,
  lng: stopEvent.lng,
});
```

This call does not need `await`. It returns instantly and pushes in the
background. If the Event Engine is down, the driver still completes the stop
normally.

### About `amountCents`

Cash back is a percentage of what the customer spends on delivery. If you can
supply the delivery charge for the stop as `amountCents`, the Event Engine
applies the tier percentage to it. If you cannot, omit it: the Event Engine
falls back to a flat per-shipment credit (configured in the `accrue_loyalty`
rule, default 0), and you can switch to percentage cash back later once the
charge is available. Shipment counting, tiers, and milestones work either way.

## 4. (Optional) collection confirmations

If you also want a driver tapping the NFC tag at pickup to register, that path
does not need a Route Optimizer change: the driver app calls the Event Engine
`POST /tags/resolve` (or the tag URL hits `GET /t`) with the driver's existing
token. See the main README.

## Reliability trade-off (your call)

The patch as written is **direct push with three in-process retries**. Smallest
footprint, lowest lag, no new tables. The Event Engine dedupes on `deliveryId`,
so retries never double-credit. The only failure mode is a missed credit if the
process dies mid-retry, which you can replay with a manual adjustment.

If you want **zero loss**, change step 3 to write the completion into a small
`delicate_outbox` table in the same database transaction as the stop completion,
and flush it from a background worker that calls the same HTTP send. That makes
the completion durable with the stop itself. It adds one table and one worker to
the Route Optimizer. Start with direct push; move to the outbox only if a missed
credit ever actually bites.

## Rolling back

Remove the `emitDeliveryCompleted(...)` call, or just unset the two environment
variables. Nothing else in the Route Optimizer depends on this.
