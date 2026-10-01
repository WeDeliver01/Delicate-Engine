import { Global, Module } from "@nestjs/common";
import { PinoLogger } from "nestjs-pino";
import { ENV, type Env } from "../../config/env.js";
import { GEO_PROVIDER, type GeoProvider } from "./geo.provider.js";
import { GeoapifyProvider } from "./geoapify.provider.js";
import { LocationIqProvider } from "./locationiq.provider.js";
import { FallbackGeoProvider } from "./fallback.provider.js";
import { ChainGeoProvider } from "./chain.provider.js";

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

@Global()
@Module({
  providers: [
    {
      provide: GEO_PROVIDER,
      inject: [ENV, PinoLogger],
      useFactory: (env: Env, logger: PinoLogger) => {
        // Order is the fallback order. Each is included only when it has a key, so an
        // unconfigured vendor is absent rather than failing on every request.
        const chain: GeoProvider[] = [];
        if (env.GEOAPIFY_API_KEY) {
          chain.push(new GeoapifyProvider(env.GEOAPIFY_API_KEY, DEPOT_BIAS, logger));
        }
        if (env.LOCATIONIQ_API_KEY) {
          chain.push(new LocationIqProvider(env.LOCATIONIQ_API_KEY, logger));
        }
        chain.push(
          new FallbackGeoProvider(
            DEFAULT_ROAD_FACTOR_BPS,
            `DelicateEngine/1.0 (${env.API_PUBLIC_URL})`,
            logger,
          ),
        );
        return new ChainGeoProvider(chain, logger);
      },
    },
  ],
  exports: [GEO_PROVIDER],
})
export class GeoModule {}
