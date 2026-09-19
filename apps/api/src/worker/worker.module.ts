import { Module, type OnModuleInit } from "@nestjs/common";
import { PinoLogger } from "nestjs-pino";
import { EventHandlerRegistry } from "./event-handlers.js";
import { OutboxDispatcher } from "./outbox-dispatcher.js";

/**
 * Registers Phase 0 consumers. Each later domain module contributes its own handlers by
 * injecting `EventHandlerRegistry` in its `onModuleInit`.
 */
@Module({
  providers: [EventHandlerRegistry, OutboxDispatcher],
  exports: [EventHandlerRegistry, OutboxDispatcher],
})
export class WorkerModule implements OnModuleInit {
  constructor(
    private readonly registry: EventHandlerRegistry,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(WorkerModule.name);
  }

  onModuleInit(): void {
    this.registry.register("account.created", async (e) => {
      this.logger.info(
        { accountId: e.payload.accountId, accountName: e.payload.name },
        "account created",
      );
    });
    this.registry.register("membership.granted", async (e) => {
      this.logger.info(e.payload, "membership granted");
    });
    this.registry.register("membership.revoked", async (e) => {
      this.logger.info(e.payload, "membership revoked");
    });
  }
}
