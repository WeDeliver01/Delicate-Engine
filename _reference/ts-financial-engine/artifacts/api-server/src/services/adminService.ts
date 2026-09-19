import { eq, sql, desc } from "drizzle-orm";
import { db, drivers, deliveries, payoutRequests, walletTransactions } from "@workspace/db";
import { walletService } from "./walletService.js";
import { fuelService } from "./fuelService.js";

export class AdminService {
  async overview() {
    const [delivery_agg] = await db
      .select({
        totalRevenueCents: sql<number>`coalesce(sum(company_revenue_cents), 0)`,
        totalDriverPayoutCents: sql<number>`coalesce(sum(driver_payout_cents), 0)`,
        totalFuelCents: sql<number>`coalesce(sum(fuel_cents), 0)`,
        totalDeliveries: sql<number>`count(*)`,
        totalPriceCents: sql<number>`coalesce(sum(price_cents), 0)`,
      })
      .from(deliveries)
      .where(eq(deliveries.status, "settled"));

    const [driver_count] = await db
      .select({ activeDrivers: sql<number>`count(*)` })
      .from(drivers)
      .where(eq(drivers.active, true));

    const [payout_agg] = await db
      .select({ pendingPayoutsCents: sql<number>`coalesce(sum(amount_cents), 0)` })
      .from(payoutRequests)
      .where(eq(payoutRequests.status, "pending"));

    const totalRevenueCents = Number(delivery_agg?.totalRevenueCents ?? 0);
    const totalPriceCents = Number(delivery_agg?.totalPriceCents ?? 0);
    const marginBps = totalPriceCents > 0 ? Math.round((totalRevenueCents / totalPriceCents) * 10000) : null;

    return {
      totalRevenueCents,
      totalDriverPayoutCents: Number(delivery_agg?.totalDriverPayoutCents ?? 0),
      totalFuelCents: Number(delivery_agg?.totalFuelCents ?? 0),
      totalDeliveries: Number(delivery_agg?.totalDeliveries ?? 0),
      activeDrivers: Number(driver_count?.activeDrivers ?? 0),
      pendingPayoutsCents: Number(payout_agg?.pendingPayoutsCents ?? 0),
      marginBps,
    };
  }

  async driverBalances() {
    const allDrivers = await db.select().from(drivers).where(eq(drivers.active, true));
    const results = await Promise.all(
      allDrivers.map(async (d) => {
        const earnings = await walletService.earnings(d.id);
        const fuelCents = await fuelService.balance(d.id);
        return {
          driverId: d.id,
          driverName: d.name,
          availableCents: earnings.available,
          lockedCents: earnings.locked,
          fuelCents,
          nextUnlock: earnings.nextUnlock?.toISOString() ?? null,
        };
      }),
    );
    return results;
  }

  async recentDeliveries(limit = 20) {
    return db.select().from(deliveries).orderBy(desc(deliveries.createdAt)).limit(limit);
  }

  async recentPayouts(limit = 20) {
    return db.select().from(payoutRequests).orderBy(desc(payoutRequests.createdAt)).limit(limit);
  }
}

export const adminService = new AdminService();
