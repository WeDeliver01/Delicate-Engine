import { Module } from "@nestjs/common";
import { SchedulingService } from "./scheduling.service.js";
import { AdminCapacityController, PublicSlotsController } from "./scheduling.controller.js";

@Module({
  controllers: [PublicSlotsController, AdminCapacityController],
  providers: [SchedulingService],
  exports: [SchedulingService],
})
export class SchedulingModule {}
