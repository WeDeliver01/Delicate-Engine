import { Module } from "@nestjs/common";
import { AdminAnalyticsController } from "./analytics.controller.js";
import { AnalyticsService } from "./analytics.service.js";
import { ReconciliationService } from "./reconciliation.service.js";

/** Reporting and exports. Read-only: it never writes, so it can never disagree with the ledger. */
@Module({
  controllers: [AdminAnalyticsController],
  providers: [AnalyticsService, ReconciliationService],
  exports: [AnalyticsService, ReconciliationService],
})
export class AnalyticsModule {}
