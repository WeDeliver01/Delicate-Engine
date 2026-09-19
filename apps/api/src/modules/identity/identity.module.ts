import { Module } from "@nestjs/common";
import { IdentityService } from "./identity.service.js";
import { ActiveAccountController, IdentityController } from "./identity.controller.js";

@Module({
  controllers: [IdentityController, ActiveAccountController],
  providers: [IdentityService],
  exports: [IdentityService],
})
export class IdentityModule {}
