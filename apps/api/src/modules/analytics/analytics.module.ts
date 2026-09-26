import { Module } from "@nestjs/common";
import { WalletModule } from "../wallet/wallet.module.js";
import { AdminAnalyticsController } from "./analytics.controller.js";
import { AnalyticsService } from "./analytics.service.js";
import { ReconciliationService } from "./reconciliation.service.js";
import { DashboardService } from "./dashboard.service.js";
import { MoneyTimelineService } from "./money-timeline.service.js";
import { DashboardController } from "./dashboard.controller.js";

/** Reporting and exports. Read-only: it never writes, so it can never disagree with the ledger. */
@Module({
  imports: [WalletModule],
  controllers: [AdminAnalyticsController, DashboardController],
  providers: [AnalyticsService, ReconciliationService, DashboardService, MoneyTimelineService],
  exports: [AnalyticsService, ReconciliationService, DashboardService, MoneyTimelineService],
})
export class AnalyticsModule {}
