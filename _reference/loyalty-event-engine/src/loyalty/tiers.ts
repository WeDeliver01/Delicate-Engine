import { asc } from "drizzle-orm";
import { db } from "../db/client";
import { tierConfig } from "../db/schema";

type TierCode = "bronze" | "silver" | "gold" | "platinum" | "diamond" | "founder";

let cache: { at: number; rows: (typeof tierConfig.$inferSelect)[] } | null = null;
const TTL_MS = 60_000;

async function tiers() {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.rows;
  const rows = await db
    .select()
    .from(tierConfig)
    .orderBy(asc(tierConfig.minMonthShipments));
  cache = { at: Date.now(), rows };
  return rows;
}

/** Highest tier whose monthly threshold the account has reached. */
export async function tierForMonthShipments(monthShipments: number): Promise<{
  code: TierCode;
  cashbackBps: number;
}> {
  const rows = await tiers();
  let chosen = rows[0];
  for (const r of rows) {
    if (monthShipments >= r.minMonthShipments) chosen = r;
  }
  if (!chosen) return { code: "bronze", cashbackBps: 200 };
  return { code: chosen.code as TierCode, cashbackBps: chosen.cashbackBps };
}
