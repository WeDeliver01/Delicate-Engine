import type { TopUp, TopUpInstructions } from "@delicate/contracts";
import type { Env } from "../../../config/env.js";
import { AppError } from "../../../common/errors.js";
import type { PaymentProvider, VerifiedPayment } from "./payment.provider.js";

/**
 * BobPay.
 *
 * Deliberately not implemented against a guessed API. Money coming in is the one place where a
 * wrong assumption is silent: an invented signature check would look like it worked right up to
 * the moment someone forged a notification and credited their own wallet.
 *
 * What is needed to finish it: BobPay's merchant API documentation and sandbox credentials —
 * specifically how a payment is initiated (redirect or hosted form), what the webhook payload
 * looks like, and how its signature is computed. The rest of the pipeline is already built:
 * `initiate` returns instructions, `verifyNotification` returns a verified payment, and the
 * wallet is credited only from that (invariant #5).
 *
 * Until then the provider reports itself unconfigured, which is visible in the console under
 * Settings → What is switched on, rather than silently absent.
 */
export class BobPayProvider implements PaymentProvider {
  readonly name = "bobpay" as const;

  constructor(private readonly env: Env) {}

  async isEnabled(): Promise<boolean> {
    // Even with a key present this stays off: there is no verified integration behind it yet.
    return false;
  }

  get pendingReason(): string {
    return this.env.BOBPAY_MERCHANT_ID
      ? "BOBPAY_MERCHANT_ID is set, but the integration is not built: the API documentation and a sandbox payment are needed to verify the webhook signature before real money can be credited."
      : "Not configured. BobPay needs its merchant API documentation and sandbox credentials before it can be switched on.";
  }

  async initiate(_topUp: TopUp): Promise<TopUpInstructions> {
    throw new AppError("provider_unavailable", this.pendingReason, 503);
  }

  async verifyNotification(): Promise<VerifiedPayment> {
    // Never accept a notification we cannot prove came from BobPay.
    throw AppError.unauthorized("bobpay notifications cannot be verified yet");
  }
}
