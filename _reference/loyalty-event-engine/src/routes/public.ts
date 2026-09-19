import { Router, type Request } from "express";
import { and, eq, lt } from "drizzle-orm";
import { db } from "../db/client";
import { tags, nodes, loyaltyAccounts } from "../db/schema";
import { extractTapParams, verifyTap, type TapParams } from "../lib/ntag424";
import { verifyDriverToken, verifyCustomerToken } from "../lib/auth";
import { ingestEvent } from "../engine/ingest";
import { dispatchEvent } from "../engine/dispatcher";
import { asyncHandler } from "../lib/http";

export const publicRouter = Router();

publicRouter.get("/health", (_req, res) => res.json({ ok: true, service: "delicate-event-engine" }));

function resolveActor(req: Request): { type: "driver" | "customer" | "anonymous"; id: string | null } {
  const h = req.header("authorization");
  if (!h?.startsWith("Bearer ")) return { type: "anonymous", id: null };
  const token = h.slice(7).trim();
  try {
    return { type: "driver", id: verifyDriverToken(token).driverId };
  } catch {
    /* not a driver token */
  }
  try {
    return { type: "customer", id: verifyCustomerToken(token).sub };
  } catch {
    /* not a customer token */
  }
  return { type: "anonymous", id: null };
}

interface TapContext {
  params: TapParams;
  lat?: number;
  lng?: number;
}

/**
 * Core SUN tap resolution.
 *  1. Cryptographically verify the tap (CMAC).
 *  2. Atomically advance the tag's read counter (replay protection).
 *  3. Behave based on who tapped: a driver confirms a collection; a logged-in
 *     customer gets their dashboard; an anonymous tap returns node identity so a
 *     frontend can route to portal login.
 */
async function resolveTap(req: Request, ctx: TapContext) {
  const decoded = verifyTap(ctx.params);
  if (!decoded.macValid) {
    return { status: 401 as const, body: { error: "tag signature invalid" } };
  }

  const tagRow = (await db.select().from(tags).where(eq(tags.tagUid, decoded.uid)).limit(1))[0];
  if (!tagRow) return { status: 404 as const, body: { error: "tag not registered" } };
  if (tagRow.status !== "active") return { status: 403 as const, body: { error: `tag ${tagRow.status}` } };

  // Atomic replay guard: only advance if the new counter is strictly higher.
  const advanced = await db
    .update(tags)
    .set({ lastReadCounter: decoded.readCounter })
    .where(and(eq(tags.id, tagRow.id), lt(tags.lastReadCounter, decoded.readCounter)))
    .returning({ id: tags.id });
  if (advanced.length === 0) {
    return { status: 409 as const, body: { error: "replayed or stale tap" } };
  }

  const node = (await db.select().from(nodes).where(eq(nodes.id, tagRow.nodeId)).limit(1))[0];
  if (!node) return { status: 500 as const, body: { error: "tag points to missing node" } };

  const actor = resolveActor(req);

  if (actor.type === "driver") {
    const { event } = await ingestEvent({
      source: "nfc_tap",
      type: "collection.confirmed",
      dedupKey: `nfc:collection:${decoded.uid}:${decoded.readCounter}`,
      actorType: "driver",
      actorId: actor.id,
      nodeId: node.id,
      tagId: tagRow.id,
      geoLat: ctx.lat ?? null,
      geoLng: ctx.lng ?? null,
      payload: { tagLabel: tagRow.label, readCounter: decoded.readCounter },
    });
    await dispatchEvent(event);
    return {
      status: 200 as const,
      body: {
        action: "collection_confirmed",
        node: { id: node.id, name: node.name },
        tag: tagRow.label,
        eventId: event.id,
      },
    };
  }

  // Customer or anonymous: record an access tap, return dashboard pointer.
  const { event } = await ingestEvent({
    source: "nfc_tap",
    type: "tag.tapped",
    dedupKey: `nfc:access:${decoded.uid}:${decoded.readCounter}`,
    actorType: actor.type === "customer" ? "customer" : "system",
    actorId: actor.id,
    nodeId: node.id,
    tagId: tagRow.id,
    payload: { tagLabel: tagRow.label, readCounter: decoded.readCounter },
  });
  await dispatchEvent(event);

  const account = (
    await db.select().from(loyaltyAccounts).where(eq(loyaltyAccounts.nodeId, node.id)).limit(1)
  )[0];

  return {
    status: 200 as const,
    body: {
      action: actor.type === "customer" ? "open_dashboard" : "require_login",
      node: { id: node.id, name: node.name },
      tag: tagRow.label,
      authenticated: actor.type === "customer",
      wallet: account ? { balanceCents: account.walletBalanceCents, tier: account.tier } : null,
    },
  };
}

// GET /t?picc_data=..&cmac=..  (the tag's NDEF URL can point straight here)
publicRouter.get(
  "/t",
  asyncHandler(async (req, res) => {
    const url = new URL(req.originalUrl, `https://${req.headers.host ?? "localhost"}`);
    const params = extractTapParams(url);
    if (!params) return res.status(400).json({ error: "missing tag params" });
    const out = await resolveTap(req, { params });
    res.status(out.status).json(out.body);
  }),
);

// POST /tags/resolve  { picc, cmac, enc?, lat?, lng? }  (frontend-friendly)
publicRouter.post(
  "/tags/resolve",
  asyncHandler(async (req, res) => {
    const { picc, cmac, enc, lat, lng } = req.body ?? {};
    if (!picc || !cmac) return res.status(400).json({ error: "picc and cmac required" });
    const out = await resolveTap(req, { params: { picc, cmac, enc }, lat, lng });
    res.status(out.status).json(out.body);
  }),
);
