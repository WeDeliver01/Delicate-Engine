import { eq, sql } from "drizzle-orm";
import type { PgTransaction } from "drizzle-orm/pg-core";
import { loyaltyAccounts, walletLedger } from "../db/schema";

type LedgerEntryType =
  | "accrual"
  | "milestone"
  | "referral"
  | "redemption"
  | "adjustment"
  | "reversal";

export interface PostEntryInput {
  accountId: string;
  entryType: LedgerEntryType;
  amountCents: number; // signed
  sourceEventId?: string | null;
  reference?: string;
}

export interface PostEntryResult {
  posted: boolean; // false if it was an idempotent no-op
  balanceAfterCents: number;
}

/**
 * Post a ledger entry and update the cached account balance, atomically.
 * Must run inside a transaction (tx) so the balance read, the insert, and the
 * cached-balance update cannot interleave with another writer.
 *
 * Idempotency: a unique index on (source_event_id, entry_type) means a repeated
 * accrual for the same event silently no-ops instead of double crediting.
 */
export async function postLedgerEntry(
  // deno-lint-ignore no-explicit-any
  tx: PgTransaction<any, any, any>,
  input: PostEntryInput,
): Promise<PostEntryResult> {
  // Lock the account row for the duration of the transaction.
  const accountRows = await tx
    .select()
    .from(loyaltyAccounts)
    .where(eq(loyaltyAccounts.id, input.accountId))
    .for("update");
  const account = accountRows[0];
  if (!account) throw new Error(`loyalty account ${input.accountId} not found`);

  const balanceAfter = account.walletBalanceCents + input.amountCents;

  const inserted = await tx
    .insert(walletLedger)
    .values({
      accountId: input.accountId,
      entryType: input.entryType,
      amountCents: input.amountCents,
      balanceAfterCents: balanceAfter,
      sourceEventId: input.sourceEventId ?? null,
      reference: input.reference ?? null,
    })
    .onConflictDoNothing({
      target: [walletLedger.sourceEventId, walletLedger.entryType],
    })
    .returning();

  if (inserted.length === 0) {
    // Duplicate accrual for this event; balance unchanged.
    return { posted: false, balanceAfterCents: account.walletBalanceCents };
  }

  await tx
    .update(loyaltyAccounts)
    .set({ walletBalanceCents: balanceAfter })
    .where(eq(loyaltyAccounts.id, input.accountId));

  return { posted: true, balanceAfterCents: balanceAfter };
}

/** Recompute a balance from the ledger (used by the nightly reconciliation). */
export async function ledgerSumCents(
  // deno-lint-ignore no-explicit-any
  tx: PgTransaction<any, any, any>,
  accountId: string,
): Promise<number> {
  const rows = await tx
    .select({ total: sql<number>`coalesce(sum(${walletLedger.amountCents}), 0)` })
    .from(walletLedger)
    .where(eq(walletLedger.accountId, accountId));
  return Number(rows[0]?.total ?? 0);
}
