import { eq } from "drizzle-orm";
import { db } from "../db/client";
import { events } from "../db/schema";

export interface IngestInput {
  source: string;
  type: string;
  dedupKey: string;
  actorType?: "customer" | "driver" | "ops" | "system";
  actorId?: string | null;
  nodeId?: string | null;
  tagId?: string | null;
  geoLat?: number | null;
  geoLng?: number | null;
  amountCents?: number | null;
  payload?: Record<string, unknown>;
  occurredAt?: Date;
}

export interface IngestResult {
  event: typeof events.$inferSelect;
  duplicate: boolean;
}

/**
 * Insert an event, deduplicating on dedupKey. If the same real-world event
 * arrives twice (webhook retries, double taps), the second call returns the
 * existing row with duplicate=true and no new row is written.
 */
export async function ingestEvent(input: IngestInput): Promise<IngestResult> {
  const inserted = await db
    .insert(events)
    .values({
      source: input.source,
      type: input.type,
      dedupKey: input.dedupKey,
      actorType: input.actorType ?? "system",
      actorId: input.actorId ?? null,
      nodeId: input.nodeId ?? null,
      tagId: input.tagId ?? null,
      geoLat: input.geoLat ?? null,
      geoLng: input.geoLng ?? null,
      amountCents: input.amountCents ?? null,
      payload: input.payload ?? {},
      occurredAt: input.occurredAt ?? new Date(),
    })
    .onConflictDoNothing({ target: events.dedupKey })
    .returning();

  if (inserted.length > 0 && inserted[0]) {
    return { event: inserted[0], duplicate: false };
  }

  const existing = await db
    .select()
    .from(events)
    .where(eq(events.dedupKey, input.dedupKey))
    .limit(1);

  if (!existing[0]) {
    throw new Error("Ingest conflict but no existing event found");
  }
  return { event: existing[0], duplicate: true };
}
