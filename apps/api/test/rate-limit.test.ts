import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEFAULT_RULES, RateLimiter, clientKeyOf } from "../src/common/rate-limit.js";
import { createHarness, type Harness } from "./harness.js";
import type { Request } from "express";

describe("rate limiting", () => {
  it("lets a normal caller through and stops one that walks the waybill range", () => {
    const limiter = new RateLimiter();
    const rule = limiter.ruleFor("/v1/public/track/DC-260924-00001")!;
    expect(rule.what).toBe("tracking lookups");

    for (let i = 0; i < rule.limit; i++) {
      expect(() => limiter.consume("1.2.3.4", rule)).not.toThrow();
    }
    expect(() => limiter.consume("1.2.3.4", rule)).toThrowError(/Too many tracking lookups/);
  });

  it("says how long to wait, so a client can behave", () => {
    const limiter = new RateLimiter([
      { prefix: "/v1/public", limit: 1, windowMs: 60_000, what: "public requests" },
    ]);
    const rule = limiter.ruleFor("/v1/public/track/x")!;
    limiter.consume("ip", rule);
    try {
      limiter.consume("ip", rule);
      throw new Error("should have been limited");
    } catch (err) {
      const e = err as { statusCode: number; details: { retryAfterSeconds: number } };
      expect(e.statusCode).toBe(429);
      expect(e.details.retryAfterSeconds).toBeGreaterThan(0);
      expect(e.details.retryAfterSeconds).toBeLessThanOrEqual(60);
    }
  });

  it("limits each caller separately, so one abuser does not lock out everyone", () => {
    const limiter = new RateLimiter([
      { prefix: "/v1/public", limit: 2, windowMs: 60_000, what: "public requests" },
    ]);
    const rule = limiter.ruleFor("/v1/public/x")!;
    limiter.consume("abuser", rule);
    limiter.consume("abuser", rule);
    expect(() => limiter.consume("abuser", rule)).toThrow();
    expect(() => limiter.consume("someone-else", rule)).not.toThrow();
  });

  it("forgets a caller once their window passes", () => {
    const limiter = new RateLimiter([
      { prefix: "/v1/public", limit: 1, windowMs: 1_000, what: "public requests" },
    ]);
    const rule = limiter.ruleFor("/v1/public/x")!;
    const t0 = 1_000_000;
    limiter.consume("ip", rule, t0);
    expect(() => limiter.consume("ip", rule, t0 + 500)).toThrow();
    expect(() => limiter.consume("ip", rule, t0 + 1_500)).not.toThrow();
  });

  it("applies the most specific rule, whatever order they were declared in", () => {
    const limiter = new RateLimiter(DEFAULT_RULES);
    expect(limiter.ruleFor("/v1/public/track/DC-1")!.what).toBe("tracking lookups");
    expect(limiter.ruleFor("/v1/public/estimate")!.what).toBe("quote estimates");
    expect(limiter.ruleFor("/v1/public/catalog")!.what).toBe("public requests");
  });

  it("never limits webhooks: a provider that gets a 429 may stop retrying", () => {
    const limiter = new RateLimiter();
    expect(limiter.ruleFor("/v1/webhooks/payfast")).toBeNull();
    expect(limiter.ruleFor("/v1/webhooks/yoco")).toBeNull();
  });

  it("does not limit the signed-in app, which is already authenticated and audited", () => {
    const limiter = new RateLimiter();
    expect(limiter.ruleFor("/v1/account/bookings")).toBeNull();
    expect(limiter.ruleFor("/v1/admin/ledger/journals")).toBeNull();
    expect(limiter.ruleFor("/v1/driver/day")).toBeNull();
  });

  it("does not grow without bound", () => {
    const limiter = new RateLimiter([
      { prefix: "/v1/public", limit: 5, windowMs: 1_000, what: "public requests" },
    ]);
    const rule = limiter.ruleFor("/v1/public/x")!;
    const t0 = 2_000_000;
    for (let i = 0; i < 500; i++) limiter.consume(`ip-${i}`, rule, t0);
    expect(limiter.size).toBe(500);
    // well past the window, and past the sweep interval
    limiter.consume("later", rule, t0 + 120_000);
    expect(limiter.size).toBe(1);
  });

  it("identifies the caller behind a proxy, not the proxy", () => {
    const req = {
      headers: { "x-forwarded-for": "41.1.2.3, 10.0.0.1" },
      ip: "10.0.0.1",
      socket: { remoteAddress: "10.0.0.1" },
    } as unknown as Request;
    expect(clientKeyOf(req)).toBe("41.1.2.3");
  });
});

describe("security headers", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await createHarness();
  });
  afterAll(() => h.close());

  it("sets the headers a JSON API should, and hides the ones it should not send", async () => {
    const res = await h.http().get("/livez").expect(200);
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["x-frame-options"]).toBeDefined();
    expect(res.headers["referrer-policy"]).toBeDefined();
    expect(res.headers["x-powered-by"]).toBeUndefined();
  });

  it("counts public requests against the limit and says what is left", async () => {
    const res = await h.http().get("/v1/public/catalog").expect(200);
    expect(Number(res.headers["x-ratelimit-limit"])).toBeGreaterThan(0);
    expect(Number(res.headers["x-ratelimit-remaining"])).toBeGreaterThanOrEqual(0);
  });

  it("leaves the authenticated API unthrottled", async () => {
    const res = await h.http().get("/v1/account/wallet");
    expect(res.headers["x-ratelimit-limit"]).toBeUndefined();
  });
});
