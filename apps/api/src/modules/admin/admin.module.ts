import { Module } from "@nestjs/common";
import { AdminController } from "./admin.controller.js";
import { AdminSettingsController } from "./settings.controller.js";
import { AdminIntegrationsController } from "./integrations.controller.js";
import { WalletModule } from "../wallet/wallet.module.js";
import { NotificationModule } from "../notifications/notification.module.js";
import { GeoModule } from "../../infra/geo/geo.module.js";

/** Cross-cutting admin surfaces: settings, and the one place that says what is switched on. */
@Module({
  imports: [WalletModule, NotificationModule, GeoModule],
  controllers: [AdminController, AdminSettingsController, AdminIntegrationsController],
})
export class AdminModule {}
