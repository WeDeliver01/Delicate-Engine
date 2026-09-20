import { Module } from "@nestjs/common";
import { ENV, type Env } from "../../config/env.js";
import { WalletService } from "./wallet.service.js";
import { TopUpService } from "./topup.service.js";
import {
  AdminWalletController,
  PaymentWebhooksController,
  WalletController,
} from "./wallet.controller.js";
import { PAYMENT_PROVIDERS } from "./payments/payment.provider.js";
import { ManualEftProvider } from "./payments/manual-eft.provider.js";
import { PayFastProvider } from "./payments/payfast.provider.js";

@Module({
  controllers: [WalletController, PaymentWebhooksController, AdminWalletController],
  providers: [
    WalletService,
    TopUpService,
    {
      provide: PAYMENT_PROVIDERS,
      inject: [ENV],
      useFactory: (env: Env) => [new ManualEftProvider(env), new PayFastProvider(env)],
    },
  ],
  exports: [WalletService, TopUpService],
})
export class WalletModule {}
