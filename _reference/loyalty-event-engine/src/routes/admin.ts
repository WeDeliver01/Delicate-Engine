import { Router } from "express";
import { eq, desc } from "drizzle-orm";
import { db } from "../db/client";
import {
  nodes,
  tags,
  customerUsers,
  loyaltyAccounts,
  webhookEndpoints,
  webhookDeliveries,
  inboundWebhooks,
  events,
  eventDispatchLog,
  auditLogs,
} from "../db/schema";
import { requireAdmin, hashPassword } from "../lib/auth";
import { asyncHandler } from "../lib/http";
import { postLedgerEntry } from "../loyalty/ledger";

export const adminRouter = Router();
adminRouter.use(requireAdmin);

async function audit(action: string, entity: string, detail: Record<string, unknown>) {
  await db.insert(auditLogs).values({ actor: "admin", action, entity, detail });
}

// ── Nodes ────────────────────────────────────────────────────────────────────
adminRouter.post(
  "/nodes",
  asyncHandler(async (req, res) => {
    const { name, externalClientId, type, contactEmail, contactPhone } = req.body ?? {};
    if (!name) return res.status(400).json({ error: "name required" });
    const [node] = await db
      .insert(nodes)
      .values({ name, externalClientId: externalClientId ?? null, type: type ?? "bakery", contactEmail, contactPhone })
      .returning();
    await db.insert(loyaltyAccounts).values({ nodeId: node!.id }).onConflictDoNothing();
    await audit("create_node", "node", { id: node!.id });
    res.status(201).json(node);
  }),
);

adminRouter.get(
  "/nodes",
  asyncHandler(async (_req, res) => {
    res.json(await db.select().from(nodes).orderBy(desc(nodes.createdAt)).limit(200));
  }),
);

// ── Tags ─────────────────────────────────────────────────────────────────────
// Register a physical NTAG 424 DNA tag. tagUid is the 7-byte UID (hex) the tag
// mirrors in its PICC data. initialCounter lets you align with a tag that has
// already been tapped during personalization/testing.
adminRouter.post(
  "/tags",
  asyncHandler(async (req, res) => {
    const { tagUid, label, nodeId, batch, initialCounter } = req.body ?? {};
    if (!tagUid || !label || !nodeId) {
      return res.status(400).json({ error: "tagUid, label, nodeId required" });
    }
    const node = (await db.select({ id: nodes.id }).from(nodes).where(eq(nodes.id, nodeId)).limit(1))[0];
    if (!node) return res.status(404).json({ error: "node not found" });

    const [tag] = await db
      .insert(tags)
      .values({
        tagUid: String(tagUid).toLowerCase(),
        label,
        nodeId,
        batch: batch ?? null,
        lastReadCounter: Number(initialCounter ?? 0),
      })
      .returning();
    await audit("register_tag", "tag", { id: tag!.id, label });
    res.status(201).json(tag);
  }),
);

adminRouter.patch(
  "/tags/:id",
  asyncHandler(async (req, res) => {
    const { status, label } = req.body ?? {};
    const set: Record<string, unknown> = {};
    if (status) set.status = status;
    if (label) set.label = label;
    const [tag] = await db.update(tags).set(set).where(eq(tags.id, String(req.params.id))).returning();
    if (!tag) return res.status(404).json({ error: "tag not found" });
    res.json(tag);
  }),
);

// ── Customer users ───────────────────────────────────────────────────────────
adminRouter.post(
  "/customer-users",
  asyncHandler(async (req, res) => {
    const { nodeId, email, password, displayName, role } = req.body ?? {};
    if (!nodeId || !email || !password || !displayName) {
      return res.status(400).json({ error: "nodeId, email, password, displayName required" });
    }
    const passwordHash = await hashPassword(String(password));
    const [user] = await db
      .insert(customerUsers)
      .values({ nodeId, email: String(email).toLowerCase(), passwordHash, displayName, role: role ?? "owner" })
      .returning({ id: customerUsers.id, email: customerUsers.email, nodeId: customerUsers.nodeId });
    await audit("create_customer_user", "customer_user", { id: user!.id });
    res.status(201).json(user);
  }),
);

// ── Manual wallet adjustment ─────────────────────────────────────────────────
adminRouter.post(
  "/nodes/:nodeId/adjust",
  asyncHandler(async (req, res) => {
    const { amountCents, reason } = req.body ?? {};
    if (typeof amountCents !== "number" || !reason) {
      return res.status(400).json({ error: "amountCents (number) and reason required" });
    }
    const account = (
      await db.select({ id: loyaltyAccounts.id }).from(loyaltyAccounts).where(eq(loyaltyAccounts.nodeId, String(req.params.nodeId))).limit(1)
    )[0];
    if (!account) return res.status(404).json({ error: "loyalty account not found" });

    const result = await db.transaction(async (tx) => {
      return postLedgerEntry(tx, {
        accountId: account.id,
        entryType: "adjustment",
        amountCents,
        sourceEventId: null,
        reference: `admin adjustment: ${reason}`,
      });
    });
    await audit("wallet_adjustment", "loyalty_account", { nodeId: String(req.params.nodeId), amountCents, reason });
    res.json({ balanceAfterCents: result.balanceAfterCents });
  }),
);

// ── Webhook endpoints ────────────────────────────────────────────────────────
adminRouter.post(
  "/webhook-endpoints",
  asyncHandler(async (req, res) => {
    const { name, url, secret, eventTypes } = req.body ?? {};
    if (!name || !url || !secret) return res.status(400).json({ error: "name, url, secret required" });
    const [ep] = await db
      .insert(webhookEndpoints)
      .values({ name, url, secret, eventTypes: Array.isArray(eventTypes) ? eventTypes : ["*"] })
      .returning({ id: webhookEndpoints.id, name: webhookEndpoints.name, url: webhookEndpoints.url });
    res.status(201).json(ep);
  }),
);

// ── Observability ────────────────────────────────────────────────────────────
adminRouter.get(
  "/events",
  asyncHandler(async (_req, res) => {
    res.json(await db.select().from(events).orderBy(desc(events.receivedAt)).limit(100));
  }),
);

adminRouter.get(
  "/dispatch-log",
  asyncHandler(async (_req, res) => {
    res.json(await db.select().from(eventDispatchLog).orderBy(desc(eventDispatchLog.createdAt)).limit(100));
  }),
);

adminRouter.get(
  "/inbound-webhooks",
  asyncHandler(async (_req, res) => {
    res.json(await db.select().from(inboundWebhooks).orderBy(desc(inboundWebhooks.createdAt)).limit(100));
  }),
);

adminRouter.get(
  "/webhook-deliveries",
  asyncHandler(async (_req, res) => {
    res.json(await db.select().from(webhookDeliveries).orderBy(desc(webhookDeliveries.createdAt)).limit(100));
  }),
);
