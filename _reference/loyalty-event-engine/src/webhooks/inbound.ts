import type { Request, Response } from "express";
import { eq } from "drizzle-orm";
import { db } from "../db/client";
import { nodes, inboundWebhooks } from "../db/schema";
import { hmacSha256, safeHexEqual } from "../lib/http";
import { ingestEvent } from "../engine/ingest";
import { dispatchEvent } from "../engine/dispatcher";

interface RawBodyRequest extends Request {
  rawBody?: string;
}

async function resolveOrCreateNode(
  externalClientId: string,
  name: string | undefined,
): Promise<string | null> {
  const found = await db
    .select({ id: nodes.id })
    .from(nodes)
    .where(eq(nodes.externalClientId, externalClientId))
    .limit(1);
  if (found[0]) return found[0].id;
  if (!name) return null; // cannot name a new node; store event without one

  const created = await db
    .insert(nodes)
    .values({ externalClientId, name })
    .onConflictDoNothing({ target: nodes.externalClientId })
    .returning({ id: nodes.id });
  if (created[0]) return created[0].id;

  const reselect = await db
    .select({ id: nodes.id })
    .from(nodes)
    .where(eq(nodes.externalClientId, externalClientId))
    .limit(1);
  return reselect[0]?.id ?? null;
}

/**
 * POST /webhooks/route-optimizer
 * Headers: x-delicate-signature (HMAC-SHA256 hex of the raw body),
 *          x-delicate-timestamp (unix seconds), x-delicate-delivery (id).
 * Body shape (delivery completion):
 *   { type, deliveryId, shipmentId, waybill, clientId, clientName,
 *     amountCents, completedAt, driverId, lat, lng }
 */
export async function routeOptimizerWebhook(req: RawBodyRequest, res: Response) {
  const secret = process.env.ROUTE_OPTIMIZER_WEBHOOK_SECRET;
  if (!secret) return res.status(500).json({ error: "webhook secret not configured" });

  const raw = req.rawBody ?? "";
  const signature = req.header("x-delicate-signature") ?? "";
  const expected = hmacSha256(secret, raw);
  const signatureValid = safeHexEqual(signature, expected);

  // Replay guard.
  const tsHeader = Number(req.header("x-delicate-timestamp") ?? 0);
  const maxSkew = Number(process.env.WEBHOOK_MAX_SKEW_SECONDS ?? 300);
  const now = Math.floor(Date.now() / 1000);
  const fresh = tsHeader > 0 && Math.abs(now - tsHeader) <= maxSkew;

  const deliveryId = req.header("x-delicate-delivery") ?? String(req.body?.deliveryId ?? "");

  // Record the inbound attempt (idempotent on source + deliveryId).
  const recorded = await db
    .insert(inboundWebhooks)
    .values({
      source: "route_optimizer",
      deliveryId: deliveryId || `unsigned:${expected.slice(0, 16)}`,
      signatureValid,
      payload: req.body ?? {},
    })
    .onConflictDoNothing({ target: [inboundWebhooks.source, inboundWebhooks.deliveryId] })
    .returning({ id: inboundWebhooks.id });

  if (!signatureValid) return res.status(401).json({ error: "invalid signature" });
  if (!fresh) return res.status(401).json({ error: "stale or missing timestamp" });

  // Duplicate delivery: already handled, acknowledge without reprocessing.
  if (recorded.length === 0) return res.status(200).json({ ok: true, duplicate: true });

  const b = req.body ?? {};
  if ((b.type ?? "delivery.completed") !== "delivery.completed") {
    return res.status(200).json({ ok: true, ignored: b.type });
  }

  const shipmentRef = String(b.shipmentId ?? b.waybill ?? deliveryId);
  const nodeId = b.clientId
    ? await resolveOrCreateNode(String(b.clientId), b.clientName ? String(b.clientName) : undefined)
    : null;

  const { event, duplicate } = await ingestEvent({
    source: "route_optimizer",
    type: "delivery.completed",
    dedupKey: `ro:completion:${shipmentRef}`,
    actorType: "driver",
    actorId: b.driverId ? String(b.driverId) : null,
    nodeId,
    amountCents: typeof b.amountCents === "number" ? b.amountCents : null,
    geoLat: typeof b.lat === "number" ? b.lat : null,
    geoLng: typeof b.lng === "number" ? b.lng : null,
    payload: { waybill: b.waybill ?? null, shipmentId: b.shipmentId ?? null, clientName: b.clientName ?? null },
    occurredAt: b.completedAt ? new Date(b.completedAt) : new Date(),
  });

  if (!duplicate) await dispatchEvent(event);

  return res.status(200).json({ ok: true, eventId: event.id, duplicate });
}
