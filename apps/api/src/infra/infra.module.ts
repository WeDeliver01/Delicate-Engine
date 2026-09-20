import { Global, Module } from "@nestjs/common";
import { DbModule } from "./db.module.js";
import { OutboxService } from "./outbox.service.js";
import { AuditService } from "./audit.service.js";
import { SettingsService } from "./settings.service.js";
import { GeoModule } from "./geo/geo.module.js";

@Global()
@Module({
  imports: [DbModule, GeoModule],
  providers: [OutboxService, AuditService, SettingsService],
  exports: [DbModule, GeoModule, OutboxService, AuditService, SettingsService],
})
export class InfraModule {}
