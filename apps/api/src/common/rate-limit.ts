import type { NextFunction, Request, Response } from "express";
import { AppError } from "./errors.js";

/**
 * Rate limiting for the endpoints anyone can reach.
 *
 * The one that matters is public tracking: a waybill is a short, sequential-looking code, and
 * without a limit someone can walk the range and read every recipient's suburb and delivery
 * status. The others are ordinary abuse control — quoting is a routing API call that costs real
 * money, and sign-in is worth slowing down.
 *
 * Deliberately in memory and deliberately simple. A shared store would be more accurate across
 * several API instances, but it would also put a network round trip in front of every request
 * and a new thing to be down. Per-instance limits still cut the attack down by the number of
 * instances, which is the right trade at this size — revisit it when there are many.
 *
 * Webhooks are never limited: a provider that gets a 429 may stop retrying, and a payment we
 * refuse to hear about is worse than one we hear about too often. They are signature-verified
 * and deduplicated by the inbox, which is the real protection.
 */

export interface RateLimitRule {
  /** Matched against the request path, longest prefix first. */
  prefix: string;
  /** Requests allowed per window, per client. */
  limit: number;
  windowMs: number;
  /** Human wording for the error, so the caller knows what they tripped. */
  what: string;
}

export const DEFAULT_RULES: RateLimitRule[] = [
  // Guessing waybills is the thing this exists to stop.
  { prefix: "/v1/public/track", limit: 30, windowMs: 60_000, what: "tracking lookups" },
  // Every quote is a paid routing call.
  { prefix: "/v1/public/estimate", limit: 20, windowMs: 60_000, what: "quote estimates" },
  { prefix: "/v1/public/geocode", limit: 60, windowMs: 60_000, what: "address lookups" },
  // A recipient watching the van refreshes every few seconds, which is fine and should not
  // spend the bucket everything else under /v1/public shares. Guessing is not the worry here:
  // the token is 128 bits, and no number of tries inside a minute makes that reachable.
  { prefix: "/v1/public/live", limit: 60, windowMs: 60_000, what: "tracking refreshes" },
  { prefix: "/v1/public", limit: 120, windowMs: 60_000, what: "public requests" },
];

interface Bucket {
  count: number;
  resetAt: number;
}

export class RateLimiter {
  private readonly buckets = new Map<string, Bucket>();
  private lastSweep = 0;

  constructor(private readonly rules: RateLimitRule[] = DEFAULT_RULES) {
    // Longest prefix wins, so a specific rule beats the catch-all regardless of declaration order.
    this.rules = [...rules].sort((a, b) => b.prefix.length - a.prefix.length);
  }

  /** The rule for a path, or null when the path is not limited. */
  ruleFor(path: string): RateLimitRule | null {
    return this.rules.find((r) => path.startsWith(r.prefix)) ?? null;
  }

  /** Returns what is left in the window, or throws once it is spent. */
  consume(
    clientKey: string,
    rule: RateLimitRule,
    now = Date.now(),
  ): { remaining: number; resetAt: number } {
    this.sweep(now);
    const key = `${rule.prefix}|${clientKey}`;
    const bucket = this.buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      const fresh = { count: 1, resetAt: now + rule.windowMs };
      this.buckets.set(key, fresh);
      return { remaining: rule.limit - 1, resetAt: fresh.resetAt };
    }
    bucket.count += 1;
    if (bucket.count > rule.limit) {
      const seconds = Math.ceil((bucket.resetAt - now) / 1000);
      throw new AppError(
        "rate_limited",
        `Too many ${rule.what}. Try again in ${seconds} second${seconds === 1 ? "" : "s"}.`,
        429,
        { retryAfterSeconds: seconds },
      );
    }
    return { remaining: rule.limit - bucket.count, resetAt: bucket.resetAt };
  }

  /** Drop expired buckets occasionally, so a long-running process does not grow forever. */
  private sweep(now: number): void {
    if (now - this.lastSweep < 60_000) return;
    this.lastSweep = now;
    for (const [key, bucket] of this.buckets) {
      if (bucket.resetAt <= now) this.buckets.delete(key);
    }
  }

  get size(): number {
    return this.buckets.size;
  }
}

/** Identify the caller: the proxy-forwarded address when we trust one, else the socket. */
export function clientKeyOf(req: Request): string {
  const forwarded = req.headers["x-forwarded-for"];
  const first = Array.isArray(forwarded) ? forwarded[0] : forwarded?.split(",")[0];
  return (first ?? req.ip ?? req.socket.remoteAddress ?? "unknown").trim();
}

export function rateLimitMiddleware(limiter = new RateLimiter()) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const rule = limiter.ruleFor(req.path);
    if (!rule) return next();
    try {
      const { remaining, resetAt } = limiter.consume(clientKeyOf(req), rule);
      res.setHeader("x-ratelimit-limit", String(rule.limit));
      res.setHeader("x-ratelimit-remaining", String(Math.max(0, remaining)));
      res.setHeader("x-ratelimit-reset", String(Math.ceil(resetAt / 1000)));
      next();
    } catch (err) {
      if (err instanceof AppError && err.statusCode === 429) {
        const detail = err.details as { retryAfterSeconds: number };
        res.setHeader("retry-after", String(detail.retryAfterSeconds));
      }
      next(err);
    }
  };
}
