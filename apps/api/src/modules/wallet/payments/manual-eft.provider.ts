import type { TopUp, TopUpInstructions } from "@delicate/contracts";
import type { Env } from "../../../config/env.js";
import type { PaymentProvider, VerifiedPayment } from "./payment.provider.js";

/**
 * Bank transfer. The customer pays with our reference; finance matches it on the bank
 * statement and confirms in the console (audited). No automatic notification exists.
 */
export class ManualEftProvider implements PaymentProvider {
  readonly name = "manual_eft" as const;

  constructor(private readonly env: Env) {}

  isEnabled(): boolean {
    return Boolean(this.env.EFT_ACCOUNT_NUMBER && this.env.EFT_BANK_NAME);
  }

  async initiate(topUp: TopUp): Promise<TopUpInstructions> {
    return {
      type: "eft",
      bank: {
        accountName: this.env.EFT_ACCOUNT_NAME ?? "Delicate Courier",
        bankName: this.env.EFT_BANK_NAME ?? "",
        accountNumber: this.env.EFT_ACCOUNT_NUMBER ?? "",
        branchCode: this.env.EFT_BRANCH_CODE ?? "",
      },
      reference: topUp.reference,
      note: "Use the reference exactly as shown. Your wallet is credited once our finance team matches the payment, usually within one business day.",
    };
  }

  async verifyNotification(): Promise<VerifiedPayment> {
    throw new Error("manual EFT has no provider notification; finance confirms in the console");
  }
}
