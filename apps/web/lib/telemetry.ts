"use client";

import { publicEnv } from "./env";
import { getActiveAccountId } from "./session";

/**
 * Our own beacon, in place of Google Analytics. Nothing here identifies a person beyond what
 * they already told us: a visitor id this browser made up and keeps in localStorage, and the
 * account id once they're signed in. A session is 30 minutes of activity on one tab's lineage;
 * it survives a reload (sessionStorage) but not idle time or a closed tab.
 */

const VISITOR_KEY = "delicate.telemetry.visitor";
const SESSION_KEY = "delicate.telemetry.session";
const IDLE_MS = 30 * 60 * 1000;

interface SessionMeta {
  id: string;
  referrer?: string;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  lastActivity: number;
}

function uuid(): string {
  return crypto.randomUUID();
}

function getVisitorId(): string {
  try {
    const existing = localStorage.getItem(VISITOR_KEY);
    if (existing) return existing;
    const id = uuid();
    localStorage.setItem(VISITOR_KEY, id);
    return id;
  } catch {
    return uuid();
  }
}

function freshSession(): SessionMeta {
  const params = new URLSearchParams(window.location.search);
  return {
    id: uuid(),
    referrer: document.referrer || undefined,
    utmSource: params.get("utm_source") ?? undefined,
    utmMedium: params.get("utm_medium") ?? undefined,
    utmCampaign: params.get("utm_campaign") ?? undefined,
    lastActivity: Date.now(),
  };
}

function getSession(): SessionMeta {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    const now = Date.now();
    if (raw) {
      const meta = JSON.parse(raw) as SessionMeta;
      if (now - meta.lastActivity < IDLE_MS) {
        meta.lastActivity = now;
        sessionStorage.setItem(SESSION_KEY, JSON.stringify(meta));
        return meta;
      }
    }
    const meta = freshSession();
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(meta));
    return meta;
  } catch {
    return freshSession();
  }
}

function appFor(path: string): "marketing" | "portal" | "admin" {
  if (path.startsWith("/admin")) return "admin";
  if (path.startsWith("/portal")) return "portal";
  return "marketing";
}

function send(
  events: Array<{
    type: "pageview" | "custom";
    name: string;
    path: string;
    props?: Record<string, unknown>;
  }>,
) {
  if (typeof window === "undefined") return;
  const visitorId = getVisitorId();
  const session = getSession();
  const path = window.location.pathname;
  const occurredAt = new Date().toISOString();

  const payload = JSON.stringify({
    visitorId,
    sessionId: session.id,
    app: appFor(path),
    referrer: session.referrer,
    utmSource: session.utmSource,
    utmMedium: session.utmMedium,
    utmCampaign: session.utmCampaign,
    accountId: getActiveAccountId() ?? undefined,
    events: events.map((e) => ({ ...e, occurredAt })),
  });

  const url = `${publicEnv.apiUrl}/v1/telemetry/events`;
  try {
    const sent =
      typeof navigator.sendBeacon === "function" &&
      navigator.sendBeacon(url, new Blob([payload], { type: "application/json" }));
    if (sent) return;
  } catch {
    // fall through to fetch
  }
  void fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: payload,
    keepalive: true,
  }).catch(() => {});
}

/** Call on every route change. */
export function trackPageview(path: string): void {
  send([{ type: "pageview", name: path, path }]);
}

/** A product moment worth counting beyond raw traffic, e.g. track("signup_completed"). */
export function track(name: string, props?: Record<string, unknown>): void {
  if (typeof window === "undefined") return;
  send([{ type: "custom", name, path: window.location.pathname, props }]);
}
