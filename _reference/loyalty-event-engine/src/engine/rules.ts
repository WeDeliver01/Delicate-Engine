import { and, eq, inArray, asc } from "drizzle-orm";
import { db } from "../db/client";
import { rules } from "../db/schema";

export type Rule = typeof rules.$inferSelect;

/** Enabled rules whose eventType matches the given type or is the wildcard "*". */
export async function rulesForEvent(eventType: string): Promise<Rule[]> {
  return db
    .select()
    .from(rules)
    .where(and(eq(rules.enabled, true), inArray(rules.eventType, [eventType, "*"])))
    .orderBy(asc(rules.priority));
}
