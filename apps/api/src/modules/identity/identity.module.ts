import { Module } from "@nestjs/common";
import { WalletModule } from "../wallet/wallet.module.js";
import { IdentityService } from "./identity.service.js";
import { ActiveAccountController, IdentityController } from "./identity.controller.js";

@Module({
  imports: [WalletModule],
  controllers: [IdentityController, ActiveAccountController],
  providers: [IdentityService],
  exports: [IdentityService],
})
export class IdentityModule {}
