import { eq } from "drizzle-orm";
import { db, payoutRequests } from "@workspace/db";
import { walletService } from "./walletService.js";

export class PayoutService {
  async available(driverId: string, asOf: Date = new Date()): Promise<number> {
    return (await walletService.earnings(driverId, asOf)).available;
  }

  async request(driverId: string, amountCents?: number): Promise<{ id: string; amountCents: number }> {
    return db.transaction(async (tx) => {
      const { available } = await walletService.earnings(driverId, new Date(), tx as unknown as typeof db);
      const amount = amountCents ?? available;
      if (amount <= 0) throw new Error("No vested funds available to pay out");
      if (amount > available) throw new Error(`Requested ${amount} exceeds available ${available}`);

      const [req] = await tx.insert(payoutRequests).values({ driverId, amountCents: amount, status: "pending" }).returning();

      await walletService.post(
        {
          driverId,
          account: "earnings",
          type: "payout",
          amountCents: -amount,
          payoutId: req!.id,
          idempotencyKey: `payout:${req!.id}`,
          description: "Payout request",
        },
        tx as unknown as typeof db,
      );
      return { id: req!.id, amountCents: amount };
    });
  }

  async process(payoutId: string, status: "paid" | "cancelled", note?: string): Promise<void> {
    await db.transaction(async (tx) => {
      const [req] = await tx.select().from(payoutRequests).where(eq(payoutRequests.id, payoutId));
      if (!req) throw new Error("Payout not found");
      if (req.status !== "pending") throw new Error(`Payout already ${req.status}`);

      if (status === "cancelled") {
        await walletService.post(
          {
            driverId: req.driverId,
            account: "earnings",
            type: "refund",
            amountCents: req.amountCents,
            payoutId: req.id,
            idempotencyKey: `payout-reverse:${req.id}`,
            description: "Payout cancelled",
          },
          tx as unknown as typeof db,
        );
      }
      await tx
        .update(payoutRequests)
        .set({ status, processedAt: new Date(), note: note ?? null, updatedAt: new Date() })
        .where(eq(payoutRequests.id, payoutId));
    });
  }

  async list(driverId?: string) {
    const q = db.select().from(payoutRequests);
    return driverId ? q.where(eq(payoutRequests.driverId, driverId)) : q;
  }
}

export const payoutService = new PayoutService();
