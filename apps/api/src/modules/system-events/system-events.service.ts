import { Injectable } from "@nestjs/common";
import { and, desc, eq, gte, ilike, lt, lte, sql, type SQL } from "drizzle-orm";
import { systemEvents } from "@delicate/db";
import type { SystemEvent, SystemEventLevel, SystemEventStats } from "@delicate/contracts";
import { DbService } from "../../infra/db.module.js";
import { requestContext } from "../../common/request-context.js";

export interface RecordSystemEvent {
  level: SystemEventLevel;
  /** Dotted, coarse to fine: `webhook.bobpay`, `booking.rejected`, `http.5xx`. */
  category: string;
  message: string;
  context?: Record<string, unknown>;
  accountId?: string | null;
  /**
   * Supply this when the same fault can repeat. Rows sharing a key within the same hour are
   * folded into one with a count, so a wedged integration cannot bury everything else.
   */
  dedupeKey?: string;
}

/** Key names that never reach the database, whatever a caller passes in `context`. */
const REDACT =
  /pass(word|phrase)?|secret|token|signature|authoriz|api[-_]?key|private|cookie|credential/i;

const MAX_MESSAGE = 500;
const MAX_CONTEXT_CHARS = 8_000;

/**
 * The operational feed's writer.
 *
 * Three rules shape this whole file.
 *
 * It never throws. A logger that can fail the request it is describing is worse than no
 * logger: the first thing it breaks is the error path, which is already the least-tested code
 * in the system. Every method swallows its own failures into the structured log.
 *
 * It never joins the caller's transaction. A booking rejection writes nothing else and still
 * has to leave a trace, and an event explaining a rolled-back transaction that rolls back with
 * it is an event about nothing. So these rows go on their own connection, deliberately outside
 * whatever the caller is doing.
 *
 * And it never records a secret. Callers pass context freely -- webhook payloads, request
 * bodies -- so redaction belongs here, where it cannot be forgotten, rather than at thirty
 * call sites.
 */
@Injectable()
export class SystemEventsService {
  constructor(private readonly db: DbService) {}

  /**
   * Write an event. Fire-and-forget by design: callers are usually on an error path and have
   * something more important to get on with, so nobody is made to await this.
   */
  record(entry: RecordSystemEvent): void {
    void this.recordAndWait(entry);
  }

  /** The same write, awaited. For tests, and for the worker, which has nothing to race. */
  async recordAndWait(entry: RecordSystemEvent): Promise<void> {
    try {
      const ctx = requestContext.get();
      const key = entry.dedupeKey ? `${entry.dedupeKey}:${hourBucket(new Date())}` : null;
      const values = {
        level: entry.level,
        category: entry.category.slice(0, 64),
        message: entry.message.slice(0, MAX_MESSAGE),
        context: redact(entry.context),
        requestId: ctx?.requestId ?? null,
        accountId: entry.accountId ?? ctx?.accountId ?? null,
        dedupeKey: key,
      };

      if (!key) {
        await this.db.db.insert(systemEvents).values(values);
        return;
      }
      // Second and later occurrences within the hour bump the row instead of adding one.
      await this.db.db
        .insert(systemEvents)
        .values(values)
        .onConflictDoUpdate({
          target: systemEvents.dedupeKey,
          // The index is partial, so the predicate has to be repeated here or Postgres will
          // not match it and the whole insert fails. The service swallows that, which means
          // the symptom is a feed that silently records nothing -- the one failure mode this
          // table must not have.
          targetWhere: sql`${systemEvents.dedupeKey} is not null`,
          set: {
            count: sql`${systemEvents.count} + 1`,
            lastSeenAt: new Date(),
            // Keep the newest detail: the latest failure is the one being looked at.
            message: values.message,
            context: values.context,
          },
        });
    } catch (err) {
      // Deliberately terminal. See the class comment: this must not be able to fail a request.
      console.error("could not record system event", entry.category, err);
    }
  }

  async list(query: {
    level?: SystemEventLevel;
    category?: string;
    accountId?: string;
    q?: string;
    from?: Date;
    to?: Date;
    limit: number;
    cursor?: string;
  }): Promise<{ items: SystemEvent[]; nextCursor: string | null }> {
    const where: SQL[] = [];
    if (query.level) where.push(eq(systemEvents.level, query.level));
    if (query.category) where.push(eq(systemEvents.category, query.category));
    if (query.accountId) where.push(eq(systemEvents.accountId, query.accountId));
    if (query.q) where.push(ilike(systemEvents.message, `%${query.q}%`));
    if (query.from) where.push(gte(systemEvents.createdAt, query.from));
    if (query.to) where.push(lte(systemEvents.createdAt, query.to));
    // Keyset rather than offset: the feed is written to while somebody is reading it, and an
    // offset would show them the same row twice.
    if (query.cursor) where.push(lt(systemEvents.createdAt, new Date(query.cursor)));

    const rows = await this.db.db
      .select()
      .from(systemEvents)
      .where(where.length ? and(...where) : undefined)
      .orderBy(desc(systemEvents.createdAt))
      .limit(query.limit + 1);

    const page = rows.slice(0, query.limit);
    const last = page.at(-1);
    return {
      items: page.map(toDto),
      nextCursor: rows.length > query.limit && last ? last.createdAt.toISOString() : null,
    };
  }

  async get(id: string): Promise<SystemEvent | null> {
    const [row] = await this.db.db.select().from(systemEvents).where(eq(systemEvents.id, id));
    return row ? toDto(row) : null;
  }

  /** The header counts, plus whichever categories actually exist in the window. */
  async stats(sinceHours = 24): Promise<SystemEventStats> {
    const since = new Date(Date.now() - sinceHours * 3_600_000);
    const rows = await this.db.db
      .select({
        level: systemEvents.level,
        category: systemEvents.category,
        count: sql<number>`sum(${systemEvents.count})::int`,
        lastSeenAt: sql<string>`max(${systemEvents.lastSeenAt})::text`,
      })
      .from(systemEvents)
      .where(gte(systemEvents.createdAt, since))
      .groupBy(systemEvents.level, systemEvents.category)
      .orderBy(desc(sql`sum(${systemEvents.count})`));

    const total = (level: SystemEventLevel) =>
      rows.filter((r) => r.level === level).reduce((sum, r) => sum + Number(r.count), 0);

    return {
      since: since.toISOString(),
      errors: total("error"),
      warnings: total("warning"),
      info: total("info"),
      categories: rows.map((r) => ({
        category: r.category,
        level: r.level,
        count: Number(r.count),
        lastSeenAt: new Date(r.lastSeenAt).toISOString(),
      })),
    };
  }

  /**
   * Drop anything older than the retention window.
   *
   * Run from the worker's nightly sweep. Returns how many went, so the job can log something
   * useful rather than "done".
   */
  async prune(olderThanDays = 90): Promise<number> {
    const cutoff = new Date(Date.now() - olderThanDays * 86_400_000);
    // `rowCount` rather than `returning`, which would pull every deleted id back into memory
    // to count them -- on the first run after a busy quarter that is the whole quarter.
    const deleted = await this.db.db.execute(
      sql`delete from ${systemEvents} where ${systemEvents.createdAt} < ${cutoff}`,
    );
    return deleted.rowCount ?? 0;
  }
}

/** Dedupe within the hour, so a fold rolls over on its own instead of living forever. */
function hourBucket(at: Date): string {
  return at.toISOString().slice(0, 13);
}

/**
 * Strip anything that looks like a credential, at any depth, and cap the size.
 *
 * Matching on key names is crude and deliberately so: it over-redacts, which costs a support
 * person one question, where under-redacting puts a live secret in a table that a page then
 * renders.
 */
function redact(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return null;
  if (depth > 6) return "[too deep]";
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => redact(v, depth + 1));
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = REDACT.test(k) ? "[redacted]" : redact(v, depth + 1);
    }
    return depth === 0 ? cap(out) : out;
  }
  if (typeof value === "string") return value.slice(0, 2_000);
  if (typeof value === "number" || typeof value === "boolean") return value;
  return String(value).slice(0, 2_000);
}

function cap(obj: Record<string, unknown>): Record<string, unknown> {
  const json = JSON.stringify(obj);
  if (json !== undefined && json.length <= MAX_CONTEXT_CHARS) return obj;
  return { truncated: true, preview: (json ?? "").slice(0, MAX_CONTEXT_CHARS) };
}

function toDto(row: typeof systemEvents.$inferSelect): SystemEvent {
  return {
    id: row.id,
    level: row.level,
    category: row.category,
    message: row.message,
    context: row.context ?? null,
    requestId: row.requestId,
    accountId: row.accountId,
    count: row.count,
    lastSeenAt: row.lastSeenAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
  };
}
