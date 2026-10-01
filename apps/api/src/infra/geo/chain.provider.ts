import { PinoLogger } from "nestjs-pino";
import type { GeocodeSuggestion, LatLng } from "@delicate/contracts";
import type { GeoProvider } from "./geo.provider.js";

/**
 * Tries each provider in turn: Geoapify, then LocationIQ, then straight-line distance.
 *
 * The two jobs fail differently, so they fall through differently.
 *
 * Autocomplete returning nothing is indistinguishable from "no such address", so an empty list
 * moves to the next provider — a vendor that is up but has never heard of a new estate is as
 * useless to the customer as one that is down.
 *
 * Distance is the opposite. It feeds the price, and a wrong number is worse than no number, so
 * only a thrown error moves on. The last resort is straight-line distance with a road factor,
 * which is honest but approximate — `name` records which provider actually produced the figure,
 * and it is stored on the quote so a price can always be explained years later.
 */
export class ChainGeoProvider implements GeoProvider {
  /**
   * Whichever provider answered last. Read when a quote is persisted, so it reflects the
   * provider that produced that quote's distance rather than whichever is configured today.
   * Assigned in the constructor, because a field initialiser cannot see constructor
   * parameter properties.
   */
  private lastUsed: string;

  constructor(
    private readonly providers: GeoProvider[],
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(ChainGeoProvider.name);
    this.lastUsed = providers[0]?.name ?? "none";
  }

  get name(): string {
    return this.lastUsed;
  }

  async geocode(query: string, limit = 5): Promise<GeocodeSuggestion[]> {
    for (const provider of this.providers) {
      try {
        const results = await provider.geocode(query, limit);
        if (results.length > 0) return results;
      } catch (err) {
        this.logger.warn({ err, provider: provider.name }, "geocode failed; trying the next");
      }
    }
    return [];
  }

  async routeLegsKm(points: LatLng[]): Promise<number[]> {
    for (const [index, provider] of this.providers.entries()) {
      try {
        const legs = await provider.routeLegsKm(points);
        this.lastUsed = provider.name;
        if (index > 0) {
          // Worth a line in the log: a quote priced on the fallback is a quote priced on a
          // different number than the same booking would get tomorrow.
          this.logger.warn(
            { provider: provider.name, points: points.length },
            "priced on a fallback distance provider",
          );
        }
        return legs;
      } catch (err) {
        this.logger.warn({ err, provider: provider.name }, "distance failed; trying the next");
      }
    }
    throw new Error("no distance provider could measure this route");
  }
}
