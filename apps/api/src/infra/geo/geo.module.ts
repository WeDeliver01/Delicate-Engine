import { Global, Module } from "@nestjs/common";
import { PinoLogger } from "nestjs-pino";
import { ENV, type Env } from "../../config/env.js";
import { GEO_PROVIDER, type GeoProvider } from "./geo.provider.js";
import { GeoapifyProvider } from "./geoapify.provider.js";
import { LocationIqProvider } from "./locationiq.provider.js";
import { FallbackGeoProvider } from "./fallback.provider.js";
import { ChainGeoProvider } from "./chain.provider.js";
import { CachedGeoProvider } from "./cached.provider.js";
import { LocationCacheService } from "./location-cache.service.js";
import { DbService } from "../db.module.js";
import { Clock } from "../clock.js";

/**
 * Straight-line distance understates a drive through Tshwane by roughly a third; 1.3 is the
 * factor that makes the no-key fallback approximately honest rather than cheap.
 */
const DEFAULT_ROAD_FACTOR_BPS = 13_000;

/**
 * Where the loop starts and ends, and what autocomplete is biased toward. Lynnwood Ridge, to
 * match the seeded depot address — the operator can move the depot in Settings, but this bias
 * only has to be roughly right to put Pretoria results above Cape Town ones.
 */
const DEPOT_BIAS = { lat: -25.7642, lng: 28.2917 };

/**
 * What we allow ourselves to spend of Geoapify's daily allowance.
 *
 * Their free plan is 3,000 a day and they describe it as a soft limit. Designing against the
 * stated number with no headroom means depending on a vendor's tolerance, so this keeps 600 in
 * reserve: enough that a busy Friday afternoon still prices after an unusual morning.
 */
export const GEO_DAILY_BUDGET = 2_400;

@Global()
@Module({
  providers: [
    LocationCacheService,
    {
      provide: GEO_PROVIDER,
      inject: [ENV, PinoLogger, DbService, Clock],
      useFactory: (env: Env, logger: PinoLogger, dbs: DbService, clock: Clock) => {
        // Order is the fallback order. Each is included only when it has a key, so an
        // unconfigured vendor is absent rather than failing on every request.
        const free = new FallbackGeoProvider(
          DEFAULT_ROAD_FACTOR_BPS,
          `DelicateEngine/1.0 (${env.API_PUBLIC_URL})`,
          logger,
        );

        const chain: GeoProvider[] = [];
        if (env.GEOAPIFY_API_KEY) {
          chain.push(new GeoapifyProvider(env.GEOAPIFY_API_KEY, DEPOT_BIAS, logger));
        }
        if (env.LOCATIONIQ_API_KEY) {
          chain.push(new LocationIqProvider(env.LOCATIONIQ_API_KEY, logger));
        }
        // Also last in the chain, for a vendor outage rather than a spent budget. The two
        // failures are different and both end here, which is the point: there is always
        // something that answers.
        chain.push(free);

        // The cache sits in front of the whole chain, so a hit costs no vendor anything and
        // the budget is checked once rather than once per provider.
        const cache = new LocationCacheService(dbs, clock);
        return new CachedGeoProvider(
          new ChainGeoProvider(chain, logger),
          free,
          cache,
          GEO_DAILY_BUDGET,
          logger,
        );
      },
    },
  ],
  exports: [GEO_PROVIDER, LocationCacheService],
})
export class GeoModule {}
