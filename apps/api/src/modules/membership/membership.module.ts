import { Module } from "@nestjs/common";
import { WalletModule } from "../wallet/wallet.module.js";
import { MembershipService } from "./membership.service.js";
import {
  AccountMembershipController,
  AdminMembershipController,
  PublicMembershipController,
} from "./membership.controller.js";

/**
 * Paid membership.
 *
 * Exported because pricing asks it for a discount on every quote, and imports the wallet
 * because the usual way a monthly fee is collected is a debit against it.
 */
@Module({
  imports: [WalletModule],
  controllers: [PublicMembershipController, AccountMembershipController, AdminMembershipController],
  providers: [MembershipService],
  exports: [MembershipService],
})
export class MembershipModule {}
