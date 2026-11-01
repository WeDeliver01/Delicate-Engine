import { Injectable } from "@nestjs/common";
import { and, countDistinct, eq, gte, lte, sql } from "drizzle-orm";
import type {
  SiteAnalyticsCustomEvent,
  SiteAnalyticsDailyPoint,
  SiteAnalyticsDevice,
  SiteAnalyticsOverview,
  SiteAnalyticsReferrer,
  SiteAnalyticsTopPage,
} from "@delicate/contracts";
import { siteEvents, siteSessions } from "@delicate/db";
import { DbService } from "../../infra/db.module.js";
import { Clock } from "../../infra/clock.js";
import { AppError } from "../../common/errors.js";

/** Read-only queries over `site_sessions` / `site_events`, the same shape as the money reports. */
@Injectable()
export class SiteAnalyticsService {
  constructor(
    private readonly dbs: DbService,
    private readonly clock: Clock,
  ) {}

  private range(from?: string, to?: string): { start: Date; end: Date } {
    const end = to ? new Date(`${to}T23:59:59.999Z`) : this.clock.now();
    const start = from
      ? new Date(`${from}T00:00:00.000Z`)
      : new Date(end.getTime() - 29 * 86_400_000);
    if (start > end) {
      throw AppError.validation([{ path: ["from"], message: "the start is after the end" }]);
    }
    return { start, end };
  }

  async overview(from?: string, to?: string): Promise<SiteAnalyticsOverview> {
    const { start, end } = this.range(from, to);
    const [row] = await this.dbs.db
      .select({
        sessions: sql<string>`count(*)::int`,
        pageviews: sql<string>`coalesce(sum(${siteSessions.pageviews}), 0)::bigint`,
        uniqueVisitors: countDistinct(siteSessions.visitorId),
        bounced: sql<string>`count(*) filter (where ${siteSessions.pageviews} <= 1)::int`,
      })
      .from(siteSessions)
      .where(and(gte(siteSessions.startedAt, start), lte(siteSessions.startedAt, end)));

    const sessions = Number(row?.sessions ?? 0);
    const pageviews = Number(row?.pageviews ?? 0);
    const bounced = Number(row?.bounced ?? 0);

    return {
      from: start.toISOString().slice(0, 10),
      to: end.toISOString().slice(0, 10),
      sessions,
      pageviews,
      uniqueVisitors: Number(row?.uniqueVisitors ?? 0),
      bounceRate: sessions ? Math.round((bounced / sessions) * 100) : 0,
      avgPageviewsPerSession: sessions ? Math.round((pageviews / sessions) * 10) / 10 : 0,
    };
  }

  async daily(from?: string, to?: string): Promise<SiteAnalyticsDailyPoint[]> {
    const { start, end } = this.range(from, to);
    const rows = await this.dbs.db
      .select({
        date: sql<string>`to_char(${siteSessions.startedAt}, 'YYYY-MM-DD')`,
        sessions: sql<string>`count(*)::int`,
        pageviews: sql<string>`coalesce(sum(${siteSessions.pageviews}), 0)::bigint`,
        uniqueVisitors: countDistinct(siteSessions.visitorId),
      })
      .from(siteSessions)
      .where(and(gte(siteSessions.startedAt, start), lte(siteSessions.startedAt, end)))
      .groupBy(sql`1`)
      .orderBy(sql`1`);

    const byDate = new Map(rows.map((r) => [r.date, r]));
    const out: SiteAnalyticsDailyPoint[] = [];
    for (let d = new Date(start); d <= end; d = new Date(d.getTime() + 86_400_000)) {
      const key = d.toISOString().slice(0, 10);
      const row = byDate.get(key);
      out.push({
        date: key,
        sessions: Number(row?.sessions ?? 0),
        pageviews: Number(row?.pageviews ?? 0),
        uniqueVisitors: Number(row?.uniqueVisitors ?? 0),
      });
      if (out.length > 400) break;
    }
    return out;
  }

  async topPages(from?: string, to?: string, limit = 20): Promise<SiteAnalyticsTopPage[]> {
    const { start, end } = this.range(from, to);
    const rows = await this.dbs.db
      .select({
        path: siteEvents.path,
        pageviews: sql<string>`count(*)::int`,
        uniqueVisitors: countDistinct(siteEvents.visitorId),
      })
      .from(siteEvents)
      .where(
        and(
          eq(siteEvents.type, "pageview"),
          gte(siteEvents.occurredAt, start),
          lte(siteEvents.occurredAt, end),
        ),
      )
      .groupBy(siteEvents.path)
      .orderBy(sql`2 desc`)
      .limit(limit);

    return rows.map((r) => ({
      path: r.path ?? "(unknown)",
      pageviews: Number(r.pageviews),
      uniqueVisitors: Number(r.uniqueVisitors),
    }));
  }

  async referrers(from?: string, to?: string, limit = 20): Promise<SiteAnalyticsReferrer[]> {
    const { start, end } = this.range(from, to);
    const rows = await this.dbs.db
      .select({
        referrer: sql<string>`coalesce(nullif(${siteSessions.referrer}, ''), '(direct)')`,
        sessions: sql<string>`count(*)::int`,
      })
      .from(siteSessions)
      .where(and(gte(siteSessions.startedAt, start), lte(siteSessions.startedAt, end)))
      .groupBy(sql`1`)
      .orderBy(sql`2 desc`)
      .limit(limit);

    return rows.map((r) => ({ referrer: r.referrer, sessions: Number(r.sessions) }));
  }

  async devices(from?: string, to?: string): Promise<SiteAnalyticsDevice[]> {
    const { start, end } = this.range(from, to);
    const rows = await this.dbs.db
      .select({
        deviceType: sql<string>`coalesce(${siteSessions.deviceType}, 'other')`,
        sessions: sql<string>`count(*)::int`,
      })
      .from(siteSessions)
      .where(and(gte(siteSessions.startedAt, start), lte(siteSessions.startedAt, end)))
      .groupBy(sql`1`)
      .orderBy(sql`2 desc`);

    return rows.map((r) => ({ deviceType: r.deviceType, sessions: Number(r.sessions) }));
  }

  async customEvents(from?: string, to?: string, limit = 20): Promise<SiteAnalyticsCustomEvent[]> {
    const { start, end } = this.range(from, to);
    const rows = await this.dbs.db
      .select({
        name: siteEvents.name,
        count: sql<string>`count(*)::int`,
        uniqueVisitors: countDistinct(siteEvents.visitorId),
      })
      .from(siteEvents)
      .where(
        and(
          eq(siteEvents.type, "custom"),
          gte(siteEvents.occurredAt, start),
          lte(siteEvents.occurredAt, end),
        ),
      )
      .groupBy(siteEvents.name)
      .orderBy(sql`2 desc`)
      .limit(limit);

    return rows.map((r) => ({
      name: r.name,
      count: Number(r.count),
      uniqueVisitors: Number(r.uniqueVisitors),
    }));
  }
}
