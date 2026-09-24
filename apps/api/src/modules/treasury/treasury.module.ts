import { Module, type OnModuleInit } from "@nestjs/common";
import { PinoLogger } from "nestjs-pino";
import { DbService } from "../../infra/db.module.js";
import { EventHandlerRegistry } from "../../worker/event-handlers.js";
import { AdminTreasuryController } from "./treasury.controller.js";
import { TreasuryService } from "./treasury.service.js";

/**
 * Treasury consumes settlements. It deliberately sits behind the outbox rather than inside
 * `SettlementService`: earmarking margin must never be able to fail a delivery, and a replay of
 * `settlement.posted` is harmless because allocations are keyed by reference.
 */
@Module({
  controllers: [AdminTreasuryController],
  providers: [TreasuryService],
  exports: [TreasuryService],
})
export class TreasuryModule implements OnModuleInit {
  constructor(
    private readonly registry: EventHandlerRegistry,
    private readonly treasury: TreasuryService,
    private readonly dbs: DbService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(TreasuryModule.name);
  }

  onModuleInit(): void {
    this.registry.register("settlement.posted", async (e) => {
      const result = await this.dbs.transaction((tx) =>
        this.treasury.allocateMargin(tx, {
          reference: `shipment:${e.payload.shipmentId}`,
          shipmentId: e.payload.shipmentId,
          marginCents: e.payload.marginCents,
          memo: `Settlement of shipment ${e.payload.shipmentId}`,
          // Allocate into the period the settlement happened in, not the period we processed it.
          at: new Date(e.occurredAt),
        }),
      );
      this.logger.info(
        {
          reference: result.settlementRef,
          marginCents: result.marginCents,
          lines: result.lines.length,
        },
        "margin allocated",
      );
    });
  }
}
