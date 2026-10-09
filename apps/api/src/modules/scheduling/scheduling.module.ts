import { Module } from "@nestjs/common";
import { SchedulingService } from "./scheduling.service.js";
import { AdminCapacityController, PublicSlotsController } from "./scheduling.controller.js";
import { CatalogModule } from "../catalog/catalog.module.js";

@Module({
  imports: [CatalogModule],
  controllers: [PublicSlotsController, AdminCapacityController],
  providers: [SchedulingService],
  exports: [SchedulingService],
})
export class SchedulingModule {}
