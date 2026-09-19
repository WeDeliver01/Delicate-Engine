import { Router, type Request, type Response, type NextFunction } from "express";
import { eq } from "drizzle-orm";
import { db, drivers, deliveries } from "@workspace/db";
import { walletService } from "../services/walletService.js";
import { payoutService } from "../services/payoutService.js";
import { fuelService } from "../services/fuelService.js";

interface AuthedRequest extends Request {
  driverId?: string;
}

async function driverAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  const token = (req.headers.authorization ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return void res.status(401).json({ error: "Unauthorized" });
  const driver = await db.query.drivers.findFirst({ where: eq(drivers.portalToken, token) });
  if (!driver) return void res.status(401).json({ error: "Unauthorized" });
  req.driverId = driver.id;
  next();
}

const router = Router();
router.use(driverAuth);

router.get("/me", async (req: AuthedRequest, res) => {
  const d = await db.query.drivers.findFirst({ where: eq(drivers.id, req.driverId!) });
  res.json({ id: d!.id, name: d!.name, depotLabel: d!.depotLabel, fuelCardId: d!.fuelCardId });
});

router.get("/wallet", async (req: AuthedRequest, res) => {
  const [earnings, fuelCents, availableForPayout] = await Promise.all([
    walletService.earnings(req.driverId!),
    fuelService.balance(req.driverId!),
    payoutService.available(req.driverId!),
  ]);
  res.json({ earnings, fuelCents, availableForPayout });
});

router.get("/ledger", async (req: AuthedRequest, res) => {
  const account = req.query["account"] === "fuel" ? "fuel" : "earnings";
  res.json(await walletService.ledger(req.driverId!, account));
});

router.get("/deliveries", async (req: AuthedRequest, res) => {
  res.json(await db.select().from(deliveries).where(eq(deliveries.driverId, req.driverId!)));
});

router.post("/payouts", async (req: AuthedRequest, res) => {
  const body = req.body as { amountCents?: number };
  res.json(await payoutService.request(req.driverId!, body?.amountCents));
});

router.get("/payouts", async (req: AuthedRequest, res) => {
  res.json(await payoutService.list(req.driverId!));
});

export default router;
