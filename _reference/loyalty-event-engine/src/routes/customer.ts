import { Router } from "express";
import { eq, desc } from "drizzle-orm";
import { db } from "../db/client";
import {
  customerUsers,
  loyaltyAccounts,
  walletLedger,
  milestoneAwards,
  milestones,
  tierConfig,
  events,
} from "../db/schema";
import {
  checkPassword,
  signCustomerToken,
  requireCustomer,
  type AuthedRequest,
} from "../lib/auth";
import { asyncHandler } from "../lib/http";
import { formatZar } from "../lib/money";

export const customerRouter = Router();

// POST /customer/login  { email, password }
customerRouter.post(
  "/login",
  asyncHandler(async (req, res) => {
    const { email, password } = req.body ?? {};
    if (!email || !password) return res.status(400).json({ error: "email and password required" });

    const user = (
      await db.select().from(customerUsers).where(eq(customerUsers.email, String(email).toLowerCase())).limit(1)
    )[0];
    if (!user || user.status !== "active") return res.status(401).json({ error: "invalid credentials" });

    const ok = await checkPassword(String(password), user.passwordHash);
    if (!ok) return res.status(401).json({ error: "invalid credentials" });

    const token = signCustomerToken({ sub: user.id, nodeId: user.nodeId, role: user.role });
    res.json({ token, displayName: user.displayName, nodeId: user.nodeId });
  }),
);

// GET /customer/wallet  -> balance, tier, and benefits
customerRouter.get(
  "/wallet",
  requireCustomer,
  asyncHandler(async (req: AuthedRequest, res) => {
    const nodeId = req.customer!.nodeId;
    const account = (
      await db.select().from(loyaltyAccounts).where(eq(loyaltyAccounts.nodeId, nodeId)).limit(1)
    )[0];
    if (!account) return res.json({ balanceCents: 0, balance: "R0.00", tier: "bronze", lifetimeShipments: 0 });

    const tier = (
      await db.select().from(tierConfig).where(eq(tierConfig.code, account.tier)).limit(1)
    )[0];

    res.json({
      balanceCents: account.walletBalanceCents,
      balance: formatZar(account.walletBalanceCents),
      tier: account.tier,
      tierLabel: tier?.label ?? account.tier,
      cashbackBps: tier?.cashbackBps ?? null,
      benefits: tier?.benefits ?? [],
      lifetimeShipments: account.lifetimeShipments,
      monthShipments: account.monthShipments,
    });
  }),
);

// GET /customer/ledger  -> recent wallet movements
customerRouter.get(
  "/ledger",
  requireCustomer,
  asyncHandler(async (req: AuthedRequest, res) => {
    const nodeId = req.customer!.nodeId;
    const account = (
      await db.select({ id: loyaltyAccounts.id }).from(loyaltyAccounts).where(eq(loyaltyAccounts.nodeId, nodeId)).limit(1)
    )[0];
    if (!account) return res.json({ entries: [] });

    const rows = await db
      .select()
      .from(walletLedger)
      .where(eq(walletLedger.accountId, account.id))
      .orderBy(desc(walletLedger.createdAt))
      .limit(50);

    res.json({
      entries: rows.map((r) => ({
        type: r.entryType,
        amount: formatZar(r.amountCents),
        amountCents: r.amountCents,
        balanceAfter: formatZar(r.balanceAfterCents),
        reference: r.reference,
        at: r.createdAt,
      })),
    });
  }),
);

// GET /customer/milestones  -> milestones reached
customerRouter.get(
  "/milestones",
  requireCustomer,
  asyncHandler(async (req: AuthedRequest, res) => {
    const nodeId = req.customer!.nodeId;
    const account = (
      await db.select({ id: loyaltyAccounts.id }).from(loyaltyAccounts).where(eq(loyaltyAccounts.nodeId, nodeId)).limit(1)
    )[0];
    if (!account) return res.json({ awarded: [] });

    const rows = await db
      .select({
        code: milestones.code,
        label: milestones.label,
        shipmentNumber: milestoneAwards.shipmentNumber,
        at: milestoneAwards.createdAt,
      })
      .from(milestoneAwards)
      .innerJoin(milestones, eq(milestoneAwards.milestoneId, milestones.id))
      .where(eq(milestoneAwards.accountId, account.id))
      .orderBy(desc(milestoneAwards.createdAt));

    res.json({ awarded: rows });
  }),
);

// GET /customer/activity  -> recent shipment/collection events for this node
customerRouter.get(
  "/activity",
  requireCustomer,
  asyncHandler(async (req: AuthedRequest, res) => {
    const nodeId = req.customer!.nodeId;
    const rows = await db
      .select()
      .from(events)
      .where(eq(events.nodeId, nodeId))
      .orderBy(desc(events.occurredAt))
      .limit(50);

    res.json({
      events: rows.map((e) => ({
        type: e.type,
        source: e.source,
        amountCents: e.amountCents,
        payload: e.payload,
        at: e.occurredAt,
      })),
    });
  }),
);
