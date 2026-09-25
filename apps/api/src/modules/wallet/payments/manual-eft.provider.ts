import type { TopUp, TopUpInstructions } from "@delicate/contracts";
import type { Env } from "../../../config/env.js";
import type { SettingsService } from "../../../infra/settings.service.js";
import type { PaymentProvider, VerifiedPayment } from "./payment.provider.js";

/** The eft branch of TopUpInstructions, named so it can be returned on its own. */
type EftBankDetails = Extract<TopUpInstructions, { type: "eft" }>["bank"];

/**
 * Bank transfer. The customer pays with our reference; finance matches it on the bank statement
 * and confirms in the console (audited). No automatic notification exists.
 *
 * The account details come from the company profile in the admin console, so changing bank does
 * not need a developer. The EFT_* environment variables remain as a fallback for a deployment
 * that has not filled the profile in yet.
 */
export class ManualEftProvider implements PaymentProvider {
  readonly name = "manual_eft" as const;

  constructor(
    private readonly env: Env,
    private readonly settings: SettingsService,
  ) {}

  async isEnabled(): Promise<boolean> {
    const bank = await this.bank();
    return Boolean(bank.accountNumber && bank.bankName);
  }

  async initiate(topUp: TopUp): Promise<TopUpInstructions> {
    return {
      type: "eft",
      bank: await this.bank(),
      reference: topUp.reference,
      note: "Use the reference exactly as shown. Your wallet is credited once our finance team matches the payment, usually within one business day.",
    };
  }

  /** Console first, environment second. */
  private async bank(): Promise<EftBankDetails> {
    const profile = await this.settings.get("company.tax_profile").catch(() => null);
    const fromProfile = profile?.bank;
    if (fromProfile?.accountNumber && fromProfile.bankName) {
      return {
        accountName: fromProfile.accountName || (profile?.legalName ?? "Delicate Courier"),
        bankName: fromProfile.bankName,
        accountNumber: fromProfile.accountNumber,
        branchCode: fromProfile.branchCode,
      };
    }
    return {
      accountName: this.env.EFT_ACCOUNT_NAME ?? "Delicate Courier",
      bankName: this.env.EFT_BANK_NAME ?? "",
      accountNumber: this.env.EFT_ACCOUNT_NUMBER ?? "",
      branchCode: this.env.EFT_BRANCH_CODE ?? "",
    };
  }

  async verifyNotification(): Promise<VerifiedPayment> {
    throw new Error("manual EFT has no provider notification; finance confirms in the console");
  }
}
