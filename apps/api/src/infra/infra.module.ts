import { Global, Module } from "@nestjs/common";
import { DbModule } from "./db.module.js";
import { OutboxService } from "./outbox.service.js";
import { AuditService } from "./audit.service.js";
import { SettingsService } from "./settings.service.js";
import { GeoModule } from "./geo/geo.module.js";
import { Clock } from "./clock.js";
import { TripPlanRegistry } from "./trip-plan.registry.js";

@Global()
@Module({
  imports: [DbModule, GeoModule],
  providers: [OutboxService, AuditService, SettingsService, Clock, TripPlanRegistry],
  exports: [
    DbModule,
    GeoModule,
    OutboxService,
    AuditService,
    SettingsService,
    Clock,
    TripPlanRegistry,
  ],
})
export class InfraModule {}
