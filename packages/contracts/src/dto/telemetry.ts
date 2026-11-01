import { z } from "zod";
import { Uuid } from "./common.js";

/**
 * In-platform analytics: our own record of traffic and product events, so questions about
 * visitors and funnels can be answered from our own rows instead of a third party's dashboard.
 *
 * The client never sends anything that identifies a person beyond what they already told us —
 * a visitor id it generated itself, and the account/user id once signed in.
 */

export const SiteApp = z.enum(["marketing", "portal", "admin"]);
export type SiteApp = z.infer<typeof SiteApp>;

export const SiteEventType = z.enum(["pageview", "custom"]);
export type SiteEventType = z.infer<typeof SiteEventType>;

/** One beacon call batches everything queued since the last flush. */
export const TelemetryEventInput = z.object({
  type: SiteEventType,
  /** Path for a pageview; the event name (e.g. "signup_completed") for a custom event. */
  name: z.string().min(1).max(200),
  path: z.string().max(2048).optional(),
  occurredAt: z.string().datetime().optional(),
  props: z.record(z.string(), z.unknown()).optional(),
});
export type TelemetryEventInput = z.infer<typeof TelemetryEventInput>;

export const TelemetryIngestRequest = z.object({
  visitorId: Uuid,
  sessionId: Uuid,
  app: SiteApp,
  /** Set only on the first event of a session; later calls omit it. */
  referrer: z.string().max(2048).optional(),
  utmSource: z.string().max(200).optional(),
  utmMedium: z.string().max(200).optional(),
  utmCampaign: z.string().max(200).optional(),
  accountId: Uuid.optional(),
  events: z.array(TelemetryEventInput).min(1).max(25),
});
export type TelemetryIngestRequest = z.infer<typeof TelemetryIngestRequest>;

export const SiteAnalyticsOverview = z.object({
  from: z.string(),
  to: z.string(),
  sessions: z.number(),
  pageviews: z.number(),
  uniqueVisitors: z.number(),
  bounceRate: z.number(),
  avgPageviewsPerSession: z.number(),
});
export type SiteAnalyticsOverview = z.infer<typeof SiteAnalyticsOverview>;

export const SiteAnalyticsDailyPoint = z.object({
  date: z.string(),
  sessions: z.number(),
  pageviews: z.number(),
  uniqueVisitors: z.number(),
});
export type SiteAnalyticsDailyPoint = z.infer<typeof SiteAnalyticsDailyPoint>;

export const SiteAnalyticsTopPage = z.object({
  path: z.string(),
  pageviews: z.number(),
  uniqueVisitors: z.number(),
});
export type SiteAnalyticsTopPage = z.infer<typeof SiteAnalyticsTopPage>;

export const SiteAnalyticsReferrer = z.object({
  referrer: z.string(),
  sessions: z.number(),
});
export type SiteAnalyticsReferrer = z.infer<typeof SiteAnalyticsReferrer>;

export const SiteAnalyticsDevice = z.object({
  deviceType: z.string(),
  sessions: z.number(),
});
export type SiteAnalyticsDevice = z.infer<typeof SiteAnalyticsDevice>;

export const SiteAnalyticsCustomEvent = z.object({
  name: z.string(),
  count: z.number(),
  uniqueVisitors: z.number(),
});
export type SiteAnalyticsCustomEvent = z.infer<typeof SiteAnalyticsCustomEvent>;
