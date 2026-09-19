import { eq } from "drizzle-orm";
import { db } from "../db/client";
import { loyaltyAccounts } from "../db/schema";
import { postLedgerEntry } from "./ledger";
import { evaluateMilestones } from "./milestones";
import { tierForMonthShipments } from "./tiers";
import { cashbackCents } from "../lib/money";

/** Current loyalty month period for a date, in SAST (Africa/Johannesburg). */
export function monthPeriod(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-ZA", {
    timeZone: "Africa/Johannesburg",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(date);
  const year = parts.find((p) => p.type === "year")?.value ?? "0000";
  const month = parts.find((p) => p.type === "month")?.value ?? "00";
  return `${year}-${month}`;
}

async function getOrCreateAccount(nodeId: string): Promise<string> {
  const existing = await db
    .select({ id: loyaltyAccounts.id })
    .from(loyaltyAccounts)
    .where(eq(loyaltyAccounts.nodeId, nodeId))
    .limit(1);
  if (existing[0]) return existing[0].id;

  const created = await db
    .insert(loyaltyAccounts)
    .values({ nodeId })
    .onConflictDoNothing({ target: loyaltyAccounts.nodeId })
    .returning({ id: loyaltyAccounts.id });
  if (created[0]) return created[0].id;

  const reselect = await db
    .select({ id: loyaltyAccounts.id })
    .from(loyaltyAccounts)
    .where(eq(loyaltyAccounts.nodeId, nodeId))
    .limit(1);
  if (!reselect[0]) throw new Error("could not create loyalty account");
  return reselect[0].id;
}

export interface AccrualInput {
  nodeId: string;
  sourceEventId: string;
  amountCents: number | null; // delivery charge, if the webhook supplied it
  occurredAt: Date;
  flatPerShipmentCents: number; // fallback credit when no amount is known
}

export interface AccrualResult {
  applied: boolean; // false if this event was already accrued
  cashbackCents: number;
  lifetimeShipments: number;
  monthShipments: number;
  tier: string;
  milestonesAwarded: string[];
}

/**
 * Apply loyalty for one completed delivery. Idempotent on sourceEventId: the
 * accrual ledger row (unique on source_event_id + "accrual") is the single
 * anchor that guarantees a shipment is counted exactly once, even at zero cash
 * back. The whole thing runs in one serialized transaction per node.
 */
export async function applyDeliveryCompleted(input: AccrualInput): Promise<AccrualResult> {
  const accountId = await getOrCreateAccount(input.nodeId);
  const period = monthPeriod(input.occurredAt);

  return db.transaction(async (tx) => {
    // Lock the account row up front so concurrent completions for the same node
    // serialize and the shipment counters stay consistent.
    const rows = await tx
      .select()
      .from(loyaltyAccounts)
      .where(eq(loyaltyAccounts.id, accountId))
      .for("update");
    const account = rows[0];
    if (!account) throw new Error("loyalty account vanished mid-transaction");

    const monthBase = account.monthPeriod === period ? account.monthShipments : 0;
    const newMonth = monthBase + 1;
    const newLifetime = account.lifetimeShipments + 1;

    const { code: tier, cashbackBps } = await tierForMonthShipments(newMonth);
    const credit =
      input.amountCents && input.amountCents > 0
        ? cashbackCents(input.amountCents, cashbackBps)
        : input.flatPerShipmentCents;

    // Post the accrual entry. If it no-ops, this event was already processed.
    const posted = await postLedgerEntry(tx, {
      accountId,
      entryType: "accrual",
      amountCents: credit,
      sourceEventId: input.sourceEventId,
      reference: "cash back on completed delivery",
    });

    if (!posted.posted) {
      return {
        applied: false,
        cashbackCents: 0,
        lifetimeShipments: account.lifetimeShipments,
        monthShipments: account.monthShipments,
        tier: account.tier,
        milestonesAwarded: [],
      };
    }

    await tx
      .update(loyaltyAccounts)
      .set({
        lifetimeShipments: newLifetime,
        monthShipments: newMonth,
        monthPeriod: period,
        tier: tier,
      })
      .where(eq(loyaltyAccounts.id, accountId));

    const awarded = await evaluateMilestones(tx, accountId, newLifetime, input.sourceEventId);

    return {
      applied: true,
      cashbackCents: credit,
      lifetimeShipments: newLifetime,
      monthShipments: newMonth,
      tier,
      milestonesAwarded: awarded,
    };
  });
}
