import { createHash } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { eq, sql } from "drizzle-orm";
import type { TelemetryIngestRequest } from "@delicate/contracts";
import { siteEvents, siteSessions } from "@delicate/db";
import { DbService } from "../../infra/db.module.js";
import { Clock } from "../../infra/clock.js";

/**
 * Not a secret, just a pepper: we never need to recover the IP, only to tell "same network, same
 * minute" apart for a rough unique-session count without keeping anything that identifies a
 * person who never told us who they are.
 */
const IP_PEPPER = "delicate-engine-telemetry";

function hashIp(ip: string | undefined): string | null {
  if (!ip) return null;
  return createHash("sha256").update(`${IP_PEPPER}:${ip}`).digest("hex").slice(0, 32);
}

function deviceFromUserAgent(ua: string | undefined): {
  deviceType: string;
  browser: string;
  os: string;
} {
  const s = ua ?? "";
  const deviceType = /mobi/i.test(s) ? "mobile" : /tablet|ipad/i.test(s) ? "tablet" : "desktop";
  const browser = /edg\//i.test(s)
    ? "edge"
    : /chrome\//i.test(s)
      ? "chrome"
      : /firefox\//i.test(s)
        ? "firefox"
        : /safari\//i.test(s) && !/chrome\//i.test(s)
          ? "safari"
          : "other";
  const os = /windows/i.test(s)
    ? "windows"
    : /mac os|macintosh/i.test(s)
      ? "macos"
      : /android/i.test(s)
        ? "android"
        : /iphone|ipad|ios/i.test(s)
          ? "ios"
          : /linux/i.test(s)
            ? "linux"
            : "other";
  return { deviceType, browser, os };
}

/**
 * Writes what the beacon sends. At-least-once by design (a retried beacon can resend the same
 * batch): the session upsert is idempotent on `id`, and a duplicate event row only double-counts
 * a count that is already approximate (a page can be reloaded, a tab backgrounded and resumed),
 * so this never tries to be exactly-once the way a ledger write has to be.
 */
@Injectable()
export class TelemetryIngestService {
  constructor(
    private readonly dbs: DbService,
    private readonly clock: Clock,
  ) {}

  async ingest(
    input: TelemetryIngestRequest,
    ip: string | undefined,
    userAgent: string | undefined,
  ) {
    const now = this.clock.now();
    const { deviceType, browser, os } = deviceFromUserAgent(userAgent);
    const ipHash = hashIp(ip);
    const firstEvent = input.events[0]!;

    await this.dbs.transaction(async (tx) => {
      const existing = await tx.query.siteSessions.findFirst({
        where: eq(siteSessions.id, input.sessionId),
      });

      if (!existing) {
        await tx.insert(siteSessions).values({
          id: input.sessionId,
          visitorId: input.visitorId,
          app: input.app,
          entryPath: firstEvent.path ?? firstEvent.name,
          referrer: input.referrer,
          utmSource: input.utmSource,
          utmMedium: input.utmMedium,
          utmCampaign: input.utmCampaign,
          deviceType,
          browser,
          os,
          ipHash,
          accountId: input.accountId,
          pageviews: input.events.filter((e) => e.type === "pageview").length,
          startedAt: now,
          lastSeenAt: now,
        });
      } else {
        const newPageviews = input.events.filter((e) => e.type === "pageview").length;
        await tx
          .update(siteSessions)
          .set({
            lastSeenAt: now,
            pageviews: sql`${siteSessions.pageviews} + ${newPageviews}`,
            accountId: input.accountId ?? existing.accountId,
          })
          .where(eq(siteSessions.id, input.sessionId));
      }

      await tx.insert(siteEvents).values(
        input.events.map((e) => ({
          sessionId: input.sessionId,
          visitorId: input.visitorId,
          app: input.app,
          type: e.type,
          name: e.name,
          path: e.path,
          referrer: input.referrer,
          props: e.props,
          accountId: input.accountId,
          occurredAt: e.occurredAt ? new Date(e.occurredAt) : now,
        })),
      );
    });
  }
}
