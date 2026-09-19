import { eq, sql } from "drizzle-orm";
import { db } from "../db/client";
import { loyaltyAccounts, walletLedger, auditLogs } from "../db/schema";
import { processWebhookDeliveries } from "../webhooks/outbound";
import { monthPeriod } from "../loyalty/accrual";
import { tierForMonthShipments } from "../loyalty/tiers";
import { ledgerSumCents } from "../loyalty/ledger";

let timers: NodeJS.Timeout[] = [];

/** Retry due webhook deliveries every 30 seconds. */
function startWebhookWorker() {
  const tick = async () => {
    try {
      await processWebhookDeliveries(50);
    } catch (err) {
      console.error("[webhook worker]", err);
    }
  };
  timers.push(setInterval(tick, 30_000));
}

/**
 * At the start of a new month, accounts whose monthPeriod is stale have their
 * monthly shipment counter reset and their tier recomputed (to bronze, since a
 * fresh month starts at zero shipments). Runs hourly; cheap and idempotent.
 */
async function rolloverMonths() {
  const period = monthPeriod(new Date());
  const stale = await db
    .select()
    .from(loyaltyAccounts)
    .where(sql`${loyaltyAccounts.monthPeriod} <> ${period} and ${loyaltyAccounts.monthShipments} > 0`);

  for (const acc of stale) {
    const { code } = await tierForMonthShipments(0);
    await db
      .update(loyaltyAccounts)
      .set({ monthShipments: 0, monthPeriod: period, tier: code })
      .where(eq(loyaltyAccounts.id, acc.id));
  }
  if (stale.length > 0) {
    await db.insert(auditLogs).values({
      actor: "system",
      action: "month_rollover",
      entity: "loyalty_account",
      detail: { count: stale.length, period },
    });
  }
}

function startMonthWorker() {
  const tick = async () => {
    try {
      await rolloverMonths();
    } catch (err) {
      console.error("[month worker]", err);
    }
  };
  timers.push(setInterval(tick, 3_600_000));
  void tick();
}

/**
 * Nightly safety net: verify each account's cached balance equals the sum of
 * its ledger. The ledger is the source of truth; a mismatch is logged and the
 * cache is corrected. In normal operation this should find nothing.
 */
async function reconcileBalances() {
  const accounts = await db.select().from(loyaltyAccounts);
  let corrected = 0;
  for (const acc of accounts) {
    await db.transaction(async (tx) => {
      const rows = await tx
        .select()
        .from(loyaltyAccounts)
        .where(eq(loyaltyAccounts.id, acc.id))
        .for("update");
      const current = rows[0];
      if (!current) return;
      const real = await ledgerSumCents(tx, acc.id);
      if (real !== current.walletBalanceCents) {
        await tx.update(loyaltyAccounts).set({ walletBalanceCents: real }).where(eq(loyaltyAccounts.id, acc.id));
        await tx.insert(walletLedger).values({
          accountId: acc.id,
          entryType: "adjustment",
          amountCents: 0,
          balanceAfterCents: real,
          reference: `reconciliation: cache ${current.walletBalanceCents} -> ledger ${real}`,
        });
        corrected++;
      }
    });
  }
  if (corrected > 0) {
    await db.insert(auditLogs).values({
      actor: "system",
      action: "reconcile_balances",
      entity: "loyalty_account",
      detail: { corrected },
    });
    console.warn(`[reconcile] corrected ${corrected} account balance(s)`);
  }
}

function startReconcileWorker() {
  // Every 6 hours.
  timers.push(setInterval(() => void reconcileBalances().catch((e) => console.error("[reconcile]", e)), 21_600_000));
}

export function startWorkers() {
  startWebhookWorker();
  startMonthWorker();
  startReconcileWorker();
  console.log("[workers] webhook, month-rollover, and reconciliation workers started");
}

export function stopWorkers() {
  for (const t of timers) clearInterval(t);
  timers = [];
}
