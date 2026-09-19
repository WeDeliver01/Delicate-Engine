import { eq } from "drizzle-orm";
import type { PgTransaction } from "drizzle-orm/pg-core";
import { milestones, milestoneAwards } from "../db/schema";
import { postLedgerEntry } from "./ledger";

/**
 * Given the account's new lifetime shipment number, award any milestone it just
 * crossed. "every_n" milestones fire whenever lifetimeNumber is a multiple of n;
 * "at_n" fire exactly when lifetimeNumber equals n. Awards are idempotent via a
 * unique index on (account, milestone, shipment_number).
 */
export async function evaluateMilestones(
  // deno-lint-ignore no-explicit-any
  tx: PgTransaction<any, any, any>,
  accountId: string,
  lifetimeNumber: number,
  sourceEventId: string,
): Promise<string[]> {
  const defs = await tx.select().from(milestones).where(eq(milestones.enabled, true));
  const awarded: string[] = [];

  for (const m of defs) {
    const hit =
      (m.triggerType === "every_n" && lifetimeNumber % m.n === 0) ||
      (m.triggerType === "at_n" && lifetimeNumber === m.n);
    if (!hit) continue;

    const inserted = await tx
      .insert(milestoneAwards)
      .values({
        accountId,
        milestoneId: m.id,
        shipmentNumber: lifetimeNumber,
        eventId: sourceEventId,
      })
      .onConflictDoNothing({
        target: [
          milestoneAwards.accountId,
          milestoneAwards.milestoneId,
          milestoneAwards.shipmentNumber,
        ],
      })
      .returning();

    if (inserted.length === 0) continue; // already awarded

    if (m.rewardType === "credit" && m.rewardValueCents > 0) {
      // sourceEventId is intentionally null here. One shipment can cross several
      // milestones at once (e.g. #150 hits the 25/75/150 rules), and they would
      // collide on the (source_event_id, entry_type) unique index. Idempotency
      // for milestone credit is already guaranteed by the milestone_awards
      // insert above, so the ledger entry does not need that anchor. The event
      // is recorded in the reference for the audit trail.
      await postLedgerEntry(tx, {
        accountId,
        entryType: "milestone",
        amountCents: m.rewardValueCents,
        sourceEventId: null,
        reference: `milestone:${m.code}:#${lifetimeNumber}:evt:${sourceEventId}`,
      });
    }
    awarded.push(m.code);
  }
  return awarded;
}
