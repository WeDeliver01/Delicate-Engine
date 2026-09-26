import { Injectable } from "@nestjs/common";
import { and, asc, eq } from "drizzle-orm";
import type { CreateSavedFilter, SavedFilter } from "@delicate/contracts";
import { savedFilters } from "@delicate/db";
import { DbService } from "../../infra/db.module.js";
import { AppError } from "../../common/errors.js";

/**
 * Searches people keep.
 *
 * Owned by the user rather than the account: "the ones I have to chase" is a personal working
 * set, and making everyone's visible to everyone would recreate the wall of options that
 * saving a filter is meant to avoid.
 */
@Injectable()
export class SavedFilterService {
  constructor(private readonly dbs: DbService) {}

  async list(userId: string, scope: string): Promise<{ items: SavedFilter[] }> {
    const rows = await this.dbs.db
      .select()
      .from(savedFilters)
      .where(and(eq(savedFilters.userId, userId), eq(savedFilters.scope, scope)))
      .orderBy(asc(savedFilters.name));
    return { items: rows.map(toSavedFilter) };
  }

  async create(
    userId: string,
    accountId: string | null,
    input: CreateSavedFilter,
  ): Promise<SavedFilter> {
    // Saving over a name you already used replaces it, because that is what someone means by
    // saving "Late deliveries" a second time — not collecting two of them.
    const existing = await this.dbs.db.query.savedFilters.findFirst({
      where: and(
        eq(savedFilters.userId, userId),
        eq(savedFilters.scope, input.scope),
        eq(savedFilters.name, input.name),
      ),
    });

    if (existing) {
      const [row] = await this.dbs.db
        .update(savedFilters)
        .set({ query: input.query })
        .where(eq(savedFilters.id, existing.id))
        .returning();
      return toSavedFilter(row!);
    }

    const [row] = await this.dbs.db
      .insert(savedFilters)
      .values({
        userId,
        accountId: input.scope === "portal" ? accountId : null,
        scope: input.scope,
        name: input.name,
        query: input.query,
      })
      .returning();
    return toSavedFilter(row!);
  }

  async remove(id: string, userId: string): Promise<{ ok: true }> {
    const [row] = await this.dbs.db
      .delete(savedFilters)
      .where(and(eq(savedFilters.id, id), eq(savedFilters.userId, userId)))
      .returning();
    if (!row) throw AppError.notFound("saved_filter", { id });
    return { ok: true };
  }
}

function toSavedFilter(r: typeof savedFilters.$inferSelect): SavedFilter {
  return {
    id: r.id,
    name: r.name,
    scope: r.scope as SavedFilter["scope"],
    query: r.query as Record<string, unknown>,
    createdAt: r.createdAt.toISOString(),
  };
}
