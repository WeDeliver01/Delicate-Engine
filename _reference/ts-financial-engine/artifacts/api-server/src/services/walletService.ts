import { and, eq, sql, desc, gt } from "drizzle-orm";
import { db } from "@workspace/db";
import { walletTransactions } from "@workspace/db";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@workspace/db";

type Tx = NodePgDatabase<typeof schema>;
type Account = "earnings" | "fuel";

export interface PostEntry {
  driverId: string;
  account: Account;
  type: string;
  amountCents: number;
  idempotencyKey: string;
  deliveryId?: string;
  payoutId?: string;
  availableFrom?: Date | null;
  description?: string;
  currency?: string;
  metadata?: Record<string, unknown>;
}

export interface EarningsBalance {
  total: number;
  available: number;
  locked: number;
  nextUnlock: Date | null;
}

export class WalletService {
  async post(entry: PostEntry, tx: Tx | typeof db = db): Promise<void> {
    await (tx as typeof db)
      .insert(walletTransactions)
      .values({
        driverId: entry.driverId,
        account: entry.account,
        type: entry.type,
        amountCents: entry.amountCents,
        currency: entry.currency ?? "ZAR",
        deliveryId: entry.deliveryId ?? null,
        payoutId: entry.payoutId ?? null,
        availableFrom: entry.availableFrom ?? null,
        description: entry.description ?? null,
        metadata: entry.metadata ?? null,
        idempotencyKey: entry.idempotencyKey,
      })
      .onConflictDoNothing({ target: walletTransactions.idempotencyKey });
  }

  async balance(driverId: string, account: Account, tx: Tx | typeof db = db): Promise<number> {
    const wt = walletTransactions;
    const [row] = await (tx as typeof db)
      .select({ sum: sql<number>`coalesce(sum(${wt.amountCents}), 0)` })
      .from(wt)
      .where(and(eq(wt.driverId, driverId), eq(wt.account, account)));
    return Number(row?.sum ?? 0);
  }

  async earnings(driverId: string, asOf: Date = new Date(), tx: Tx | typeof db = db): Promise<EarningsBalance> {
    const wt = walletTransactions;
    const [agg] = await (tx as typeof db)
      .select({
        total: sql<number>`coalesce(sum(${wt.amountCents}), 0)`,
        available: sql<number>`coalesce(sum(case
            when ${wt.amountCents} < 0 then ${wt.amountCents}
            when ${wt.availableFrom} is null then ${wt.amountCents}
            when ${wt.availableFrom} <= ${asOf} then ${wt.amountCents}
            else 0 end), 0)`,
      })
      .from(wt)
      .where(and(eq(wt.driverId, driverId), eq(wt.account, "earnings")));

    const [next] = await (tx as typeof db)
      .select({ at: sql<Date | null>`min(${wt.availableFrom})` })
      .from(wt)
      .where(
        and(
          eq(wt.driverId, driverId),
          eq(wt.account, "earnings"),
          gt(wt.amountCents, 0),
          gt(wt.availableFrom!, asOf),
        ),
      );

    const total = Number(agg?.total ?? 0);
    const available = Math.max(0, Number(agg?.available ?? 0));
    return { total, available, locked: total - available, nextUnlock: next?.at ?? null };
  }

  async ledger(driverId: string, account: Account, limit = 50, tx: Tx | typeof db = db) {
    return (tx as typeof db)
      .select()
      .from(walletTransactions)
      .where(and(eq(walletTransactions.driverId, driverId), eq(walletTransactions.account, account)))
      .orderBy(desc(walletTransactions.createdAt))
      .limit(limit);
  }
}

export const walletService = new WalletService();
