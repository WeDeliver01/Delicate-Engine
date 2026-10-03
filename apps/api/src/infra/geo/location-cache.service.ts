import { createHash } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { and, eq, gte, sql } from "drizzle-orm";
import { operatingToday, type GeocodeSuggestion, type LatLng } from "@delicate/contracts";
import { geoUsageDaily, geocodedAddresses, routeLegs } from "@delicate/db";
import { DbService } from "../db.module.js";
import { Clock } from "../clock.js";

/**
 * What we already know, so we stop asking a mapping provider questions we have answered.
 *
 * Every quote needs a geocode per address and a distance per leg, and almost all of those
 * repeat: the same depot, the same regular bakeries, the same suburbs. Keeping the answers in
 * Postgres turns a daily quota into a non-issue, makes pricing survive a provider outage, and
 * means the business slowly accumulates its own map of the places it delivers to.
 *
 * Postgres rather than a cache server, deliberately. These rows are worth keeping — a cache
 * lost on restart hands the quota back every deploy, and at this volume the difference between
 * a local query and a memory store is a millisecond against a network call we are avoiding
 * entirely.
 */
@Injectable()
export class LocationCacheService {
  constructor(
    private readonly dbs: DbService,
    private readonly clock: Clock,
  ) {}

  /**
   * How long a measured distance stays usable.
   *
   * Roads change over months, not days, so this is long. It is not forever, because a stale
   * distance is not a stale map — it is a wrong price, charged to a real customer. Sixty days
   * is short enough that a new offramp reaches the rate card within a quarter.
   */
  private static readonly DISTANCE_TTL_DAYS = 60;

  /**
   * Coordinates are rounded to four decimals, about eleven metres, before they become a key.
   *
   * Exact coordinates would almost never collide and the cache would never hit. Eleven metres
   * is far below the point where road distance changes — two doors on the same street share a
   * route — so this trades nothing real for a cache that actually works.
   */
  private static readonly COORD_DP = 4;

  // ── addresses ──────────────────────────────────────────────────────────────

  /**
   * A fingerprint for an address as typed.
   *
   * Case, punctuation and spacing are noise: "10 Camellia Avenue", "10 Camellia Ave." and
   * "10  camellia avenue" are one place and should be one row. Common abbreviations are
   * expanded so the short and long forms agree.
   */
  static fingerprintAddress(query: string): { fingerprint: string; normalized: string } {
    const normalized = query
      .toLowerCase()
      .normalize("NFKD")
      // Strip accents, so "Rivonia" and "Rivoniá" are the same query.
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9\s]/g, " ")
      .replace(/\b(ave|avenue)\b/g, "avenue")
      .replace(/\b(rd|road)\b/g, "road")
      .replace(/\b(st|street)\b/g, "street")
      .replace(/\b(dr|drive)\b/g, "drive")
      .replace(/\b(cres|crescent)\b/g, "crescent")
      .replace(/\b(sa|south africa|rsa)\b/g, "")
      .replace(/\s+/g, " ")
      .trim();
    return {
      fingerprint: createHash("sha256").update(normalized).digest("hex"),
      normalized,
    };
  }

  /** The address we already resolved for this query, or null. */
  async lookupAddress(query: string): Promise<GeocodeSuggestion | null> {
    const { fingerprint } = LocationCacheService.fingerprintAddress(query);
    const [row] = await this.dbs.db
      .select()
      .from(geocodedAddresses)
      .where(eq(geocodedAddresses.fingerprint, fingerprint));
    if (!row) return null;

    // Awaited. It is one small UPDATE against a network call we just avoided, so the cost is
    // nothing — and a write that outlives the request that started it holds locks after the
    // caller has gone, which is a whole class of strange behaviour bought for no gain.
    await this.dbs.db
      .update(geocodedAddresses)
      .set({ hitCount: sql`${geocodedAddresses.hitCount} + 1`, lastUsedAt: this.clock.now() })
      .where(eq(geocodedAddresses.id, row.id))
      .catch(() => undefined);

    return {
      formatted: row.formatted,
      location: { lat: row.lat, lng: row.lng },
      placeId: row.providerPlaceId,
      suburb: row.suburb,
      city: row.city,
      postalCode: row.postalCode,
    };
  }

  /** Keep the first suggestion for a query, which is the one a customer almost always picks. */
  async rememberAddress(query: string, best: GeocodeSuggestion, provider: string): Promise<void> {
    const { fingerprint, normalized } = LocationCacheService.fingerprintAddress(query);
    await this.dbs.db
      .insert(geocodedAddresses)
      .values({
        fingerprint,
        normalized,
        formatted: best.formatted,
        lat: best.location.lat,
        lng: best.location.lng,
        suburb: best.suburb,
        city: best.city,
        postalCode: best.postalCode,
        provider,
        providerPlaceId: best.placeId,
        lastUsedAt: this.clock.now(),
      })
      // Two requests for the same new address can race; the first one to land wins and the
      // second is not an error worth failing a lookup over.
      .onConflictDoNothing({ target: geocodedAddresses.fingerprint })
      .catch(() => undefined);
  }

  // ── distances ──────────────────────────────────────────────────────────────

  static fingerprintLeg(from: LatLng, to: LatLng, mode = "drive"): string {
    const r = (n: number) => n.toFixed(LocationCacheService.COORD_DP);
    return createHash("sha256")
      .update(`${r(from.lat)},${r(from.lng)}>${r(to.lat)},${r(to.lng)}:${mode}`)
      .digest("hex");
  }

  /**
   * The cached kilometres for each consecutive leg, with null where we have never measured.
   *
   * Returns a slot per leg rather than all-or-nothing, so a route with one new stop asks the
   * provider about that stop alone instead of re-measuring the whole loop.
   */
  async lookupLegs(points: LatLng[]): Promise<(number | null)[]> {
    if (points.length < 2) return [];
    const cutoff = new Date(
      this.clock.now().getTime() - LocationCacheService.DISTANCE_TTL_DAYS * 86_400_000,
    );

    const results: (number | null)[] = [];
    for (let i = 0; i < points.length - 1; i++) {
      const fingerprint = LocationCacheService.fingerprintLeg(points[i]!, points[i + 1]!);
      const [row] = await this.dbs.db
        .select()
        .from(routeLegs)
        .where(and(eq(routeLegs.fingerprint, fingerprint), gte(routeLegs.measuredAt, cutoff)));
      results.push(row ? row.metres / 1000 : null);
      if (row) {
        await this.dbs.db
          .update(routeLegs)
          .set({ hitCount: sql`${routeLegs.hitCount} + 1`, lastUsedAt: this.clock.now() })
          .where(eq(routeLegs.id, row.id))
          .catch(() => undefined);
      }
    }
    return results;
  }

  /** Store a measured leg. Re-measuring an expired one refreshes it rather than duplicating. */
  async rememberLeg(from: LatLng, to: LatLng, km: number, provider: string): Promise<void> {
    const fingerprint = LocationCacheService.fingerprintLeg(from, to);
    const now = this.clock.now();
    await this.dbs.db
      .insert(routeLegs)
      .values({
        fingerprint,
        fromLat: from.lat,
        fromLng: from.lng,
        toLat: to.lat,
        toLng: to.lng,
        metres: Math.round(km * 1000),
        provider,
        lastUsedAt: now,
        measuredAt: now,
      })
      .onConflictDoUpdate({
        target: routeLegs.fingerprint,
        set: { metres: Math.round(km * 1000), provider, measuredAt: now, lastUsedAt: now },
      })
      .catch(() => undefined);
  }

  // ── the daily allowance ────────────────────────────────────────────────────

  /**
   * Spend one call against today's budget, or refuse.
   *
   * In the database because the API and the worker both price things, and two processes each
   * counting to their own limit is how an allowance gets spent twice. The row is upserted and
   * incremented in one statement, so concurrent callers cannot both read the same total.
   *
   * Returning false is not an error: the caller falls back to cache or to straight-line
   * distance. Running out of quota should make the engine cautious, not broken.
   */
  async spend(provider: string, dailyBudget: number): Promise<boolean> {
    const day = operatingToday(this.clock.now());
    const [row] = await this.dbs.db
      .insert(geoUsageDaily)
      .values({ day, provider, calls: 1, updatedAt: this.clock.now() })
      .onConflictDoUpdate({
        target: [geoUsageDaily.day, geoUsageDaily.provider],
        set: { calls: sql`${geoUsageDaily.calls} + 1`, updatedAt: this.clock.now() },
      })
      .returning({ calls: geoUsageDaily.calls });

    if ((row?.calls ?? 0) <= dailyBudget) return true;

    // Over budget. Give the call back so the counter reflects what was actually spent, and
    // record the refusal — a day that keeps hitting this is a day that needs a bigger plan.
    await this.dbs.db
      .update(geoUsageDaily)
      .set({
        calls: sql`${geoUsageDaily.calls} - 1`,
        skipped: sql`${geoUsageDaily.skipped} + 1`,
      })
      .where(and(eq(geoUsageDaily.day, day), eq(geoUsageDaily.provider, provider)));
    return false;
  }

  /**
   * Lookups answered from our own records today, across addresses and legs.
   *
   * The number that says whether the cache is earning its keep — and, next to the spend, the
   * only honest basis for deciding the free plan is still the right plan.
   */
  async savedCallsToday(): Promise<number> {
    const since = new Date(`${operatingToday(this.clock.now())}T00:00:00Z`);
    const [addresses] = await this.dbs.db
      .select({ n: sql<number>`COALESCE(SUM(${geocodedAddresses.hitCount}), 0)::int` })
      .from(geocodedAddresses)
      .where(gte(geocodedAddresses.lastUsedAt, since));
    const [legs] = await this.dbs.db
      .select({ n: sql<number>`COALESCE(SUM(${routeLegs.hitCount}), 0)::int` })
      .from(routeLegs)
      .where(gte(routeLegs.lastUsedAt, since));
    return (addresses?.n ?? 0) + (legs?.n ?? 0);
  }

  /** What today has cost, for the console. */
  async usageToday(provider: string): Promise<{ calls: number; skipped: number }> {
    const day = operatingToday(this.clock.now());
    const [row] = await this.dbs.db
      .select()
      .from(geoUsageDaily)
      .where(and(eq(geoUsageDaily.day, day), eq(geoUsageDaily.provider, provider)));
    return { calls: row?.calls ?? 0, skipped: row?.skipped ?? 0 };
  }
}
