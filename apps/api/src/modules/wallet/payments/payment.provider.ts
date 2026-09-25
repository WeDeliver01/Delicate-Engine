import type { PaymentProviderName, TopUp, TopUpInstructions } from "@delicate/contracts";

/**
 * Inbound money boundary. A provider turns a pending top-up into instructions for the payer,
 * and (for online providers) verifies the server-to-server notification that proves payment.
 * The wallet is credited ONLY from `verifyNotification` or a finance confirmation — never from
 * a browser redirect (invariant #5).
 */
export interface PaymentProvider {
  readonly name: PaymentProviderName;
  /**
   * Is the provider configured well enough to accept top-ups? Async because a provider may be
   * configured from the admin console rather than the environment.
   */
  isEnabled(): Promise<boolean>;
  initiate(
    topUp: TopUp,
    ctx: { returnUrl: string; cancelUrl: string; notifyUrl: string; payerEmail: string | null },
  ): Promise<TopUpInstructions>;
  /**
   * Validate a provider notification. Returns the confirmed payment or throws. `rawBody` is the
   * exact bytes received (signatures are computed over them), `params` the parsed fields.
   */
  verifyNotification(input: {
    rawBody: string;
    params: Record<string, string>;
    headers: Record<string, string | string[] | undefined>;
    sourceIp?: string;
  }): Promise<VerifiedPayment>;
}

export interface VerifiedPayment {
  /** Our top-up id or reference the provider echoed back. */
  reference: string;
  providerRef: string;
  amountCents: number;
  status: "complete" | "failed" | "cancelled" | "pending";
  raw: Record<string, string>;
}

export const PAYMENT_PROVIDERS = Symbol("PAYMENT_PROVIDERS");
