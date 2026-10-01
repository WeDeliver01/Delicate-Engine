import { PinoLogger } from "nestjs-pino";
import type { GeocodeSuggestion, LatLng } from "@delicate/contracts";
import type { GeoProvider } from "./geo.provider.js";
import type { LocationCacheService } from "./location-cache.service.js";

/**
 * Asks what we already know before asking a vendor, and stops asking once the day's allowance
 * is spent.
 *
 * Wraps the provider chain rather than living inside it, so the vendors stay simple HTTP
 * clients and the caching and the budget are one concern in one place. Swapping Geoapify for
 * someone else later changes nothing here.
 *
 * The two jobs cache differently, because they are worth different amounts:
 *
 *   - An address is looked up once per quote and the answer does not change. Cached forever.
 *   - A leg is looked up once per quote too, but the same legs repeat constantly — every
 *     delivery starts at the depot — so this is where the quota is actually saved. Cached for
 *     as long as a road layout can be trusted, and no longer, because a stale distance is a
 *     wrong price rather than a stale map.
 *
 * `free` is the no-key provider: OpenStreetMap for addresses and straight-line distance for
 * legs. It costs us nothing, so it is what the budget guard falls back to. Running out of a
 * vendor allowance should make the engine cautious, never stop it taking bookings.
 */
export class CachedGeoProvider implements GeoProvider {
  constructor(
    private readonly inner: GeoProvider,
    private readonly free: GeoProvider,
    private readonly cache: LocationCacheService,
    private readonly dailyBudget: number,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(CachedGeoProvider.name);
  }

  /** What last measured a distance, so a quote records how its price was reached. */
  private lastUsed = "cache";

  get name(): string {
    return this.lastUsed;
  }

  async geocode(query: string, limit = 5): Promise<GeocodeSuggestion[]> {
    const hit = await this.cache.lookupAddress(query);
    // One remembered suggestion, not a list. The cache stores what someone actually chose, and
    // returning that alone is the honest shape — we never knew the other options.
    if (hit) return [hit];

    if (!(await this.cache.spend(this.inner.name, this.dailyBudget))) {
      this.logger.warn(
        { query: query.slice(0, 40) },
        "daily geo budget spent; addresses from the free provider",
      );
      return this.free.geocode(query, limit);
    }

    const results = await this.inner.geocode(query, limit);
    if (results[0]) await this.cache.rememberAddress(query, results[0], this.inner.name);
    return results;
  }

  async routeLegsKm(points: LatLng[]): Promise<number[]> {
    if (points.length < 2) return [];

    const cached = await this.cache.lookupLegs(points);
    if (cached.every((km) => km !== null)) {
      this.lastUsed = "cache";
      return cached as number[];
    }

    if (await this.cache.spend(this.inner.name, this.dailyBudget)) {
      const measured = await this.inner.routeLegsKm(points);
      this.lastUsed = this.inner.name;
      await Promise.all(
        measured.map((km, i) =>
          this.cache.rememberLeg(points[i]!, points[i + 1]!, km, this.inner.name),
        ),
      );
      return measured;
    }

    // Out of allowance. Use every leg we already know and estimate only the rest, so a route
    // that is mostly familiar is still mostly accurate. Nothing estimated is written to the
    // cache — a guess must never become the stored answer for a real road.
    const estimated = await this.free.routeLegsKm(points);
    const legs = cached.map((km, i) => km ?? estimated[i] ?? 0);
    this.lastUsed = cached.some((km) => km !== null) ? `cache+${this.free.name}` : this.free.name;
    this.logger.warn(
      { known: cached.filter((km) => km !== null).length, legs: legs.length },
      "daily geo budget spent; distance from cache and straight-line estimate",
    );
    return legs;
  }
}
