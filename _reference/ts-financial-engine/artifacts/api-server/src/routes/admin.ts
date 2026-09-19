import { Router, type Request, type Response, type NextFunction } from "express";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, drivers, bakeries, zoneRates, pricingRules, driverBakeryAssignments } from "@workspace/db";
import { deliveryService } from "../services/deliveryService.js";
import { payoutService } from "../services/payoutService.js";
import { fuelService } from "../services/fuelService.js";
import { adminService } from "../services/adminService.js";

const ADMIN_API_KEY = process.env["ADMIN_API_KEY"] ?? "dev-admin-key";

function adminAuth(req: Request, res: Response, next: NextFunction) {
  const token = (req.headers.authorization ?? "").replace(/^Bearer\s+/i, "").trim();
  if (token !== ADMIN_API_KEY) return void res.status(401).json({ error: "Unauthorized" });
  next();
}

function pick(body: Record<string, unknown>, fields: string[]) {
  const out: Record<string, unknown> = {};
  for (const f of fields) if (f in body) out[f] = body[f];
  return out;
}

const EDITABLE = {
  drivers: {
    table: drivers,
    fields: ["name", "phone", "email", "depotLabel", "depotLat", "depotLng", "vehicleKmPerLitre", "fuelCardId", "active"],
  },
  bakeries: {
    table: bakeries,
    fields: ["code", "name", "pickupAddress", "pickupLat", "pickupLng", "active"],
  },
  "zone-rates": {
    table: zoneRates,
    fields: ["bakeryId", "zone", "priceCents", "currency", "source"],
  },
  "pricing-rules": {
    table: pricingRules,
    fields: ["label", "scopeType", "scopeRef", "distanceMinKm", "distanceMaxKm", "fuelCostPerKmCents", "driverBaseFeeCents", "variableCostsCents", "batchingBps", "strategy", "driverShareBps", "driverPerKmCents", "priority", "active", "effectiveFrom", "effectiveTo"],
  },
} as const;

const router = Router();
router.use(adminAuth);

router.get("/overview", async (_req, res) => {
  res.json(await adminService.overview());
});

router.get("/driver-balances", async (_req, res) => {
  res.json(await adminService.driverBalances());
});

router.get("/activity", async (_req, res) => {
  res.json({ deliveries: await adminService.recentDeliveries(), payouts: await adminService.recentPayouts() });
});

for (const [name, def] of Object.entries(EDITABLE) as [string, { table: any; fields: string[] }][]) {
  router.get(`/${name}`, async (_req, res) => {
    res.json(await db.select().from(def.table));
  });
  router.post(`/${name}`, async (req, res) => {
    const rows = await db.insert(def.table).values(pick(req.body as Record<string, unknown>, def.fields)).returning();
    res.json(rows[0]);
  });
  router.patch(`/${name}/:id`, async (req, res) => {
    const rows = await db.update(def.table).set(pick(req.body as Record<string, unknown>, def.fields)).where(eq(def.table.id, req.params["id"] as string)).returning();
    res.json(rows[0]);
  });
  router.delete(`/${name}/:id`, async (req, res) => {
    await db.delete(def.table).where(eq(def.table.id, req.params["id"] as string));
    res.json({ ok: true });
  });
}

router.get("/assignments", async (_req, res) => {
  res.json(await db.select().from(driverBakeryAssignments));
});

router.post("/assignments", async (req, res) => {
  const body = req.body as { driverId: string; bakeryId: string };
  const [row] = await db.insert(driverBakeryAssignments).values({ driverId: body.driverId, bakeryId: body.bakeryId }).returning();
  res.json(row);
});

router.post("/deliveries", async (req, res) => {
  res.json(await deliveryService.createAndSettle(req.body as Parameters<typeof deliveryService.createAndSettle>[0]));
});

router.post("/deliveries/:id/refund", async (req, res) => {
  await deliveryService.refund(req.params["id"] as string);
  res.json({ ok: true });
});

router.get("/payouts", async (_req, res) => {
  res.json(await payoutService.list());
});

router.patch("/payouts/:id", async (req, res) => {
  const body = req.body as { status: "paid" | "cancelled"; note?: string };
  await payoutService.process(req.params["id"] as string, body.status, body.note);
  res.json({ ok: true });
});

router.post("/drivers/:id/fuel-spend", async (req, res) => {
  const body = req.body as { amountCents: number; reference?: string; description?: string };
  await fuelService.spend(req.params["id"] as string, body.amountCents, body.reference ?? randomUUID(), body.description);
  res.json({ ok: true, balanceCents: await fuelService.balance(req.params["id"] as string) });
});

export default router;
