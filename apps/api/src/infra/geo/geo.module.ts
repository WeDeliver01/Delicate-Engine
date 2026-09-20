import { Global, Module } from "@nestjs/common";
import { PinoLogger } from "nestjs-pino";
import { ENV, type Env } from "../../config/env.js";
import { GEO_PROVIDER } from "./geo.provider.js";
import { GoogleGeoProvider } from "./google.provider.js";
import { FallbackGeoProvider } from "./fallback.provider.js";

const DEFAULT_ROAD_FACTOR_BPS = 13_000;

@Global()
@Module({
  providers: [
    {
      provide: GEO_PROVIDER,
      inject: [ENV, PinoLogger],
      useFactory: (env: Env, logger: PinoLogger) =>
        env.GOOGLE_MAPS_API_KEY
          ? new GoogleGeoProvider(env.GOOGLE_MAPS_API_KEY, DEFAULT_ROAD_FACTOR_BPS, logger)
          : new FallbackGeoProvider(
              DEFAULT_ROAD_FACTOR_BPS,
              `DelicateEngine/1.0 (${env.API_PUBLIC_URL})`,
              logger,
            ),
    },
  ],
  exports: [GEO_PROVIDER],
})
export class GeoModule {}
