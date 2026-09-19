import { Global, Module } from "@nestjs/common";
import { DbModule } from "./db.module.js";
import { OutboxService } from "./outbox.service.js";
import { AuditService } from "./audit.service.js";

@Global()
@Module({
  imports: [DbModule],
  providers: [OutboxService, AuditService],
  exports: [DbModule, OutboxService, AuditService],
})
export class InfraModule {}
