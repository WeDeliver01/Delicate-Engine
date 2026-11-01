import { Module } from "@nestjs/common";
import { TelemetryIngestController } from "./ingest.controller.js";
import { TelemetryIngestService } from "./ingest.service.js";
import { SiteAnalyticsController } from "./site-analytics.controller.js";
import { SiteAnalyticsService } from "./site-analytics.service.js";

/** In-platform analytics: our own traffic and product-event data, ingest and reporting. */
@Module({
  controllers: [TelemetryIngestController, SiteAnalyticsController],
  providers: [TelemetryIngestService, SiteAnalyticsService],
  exports: [TelemetryIngestService, SiteAnalyticsService],
})
export class TelemetryModule {}
