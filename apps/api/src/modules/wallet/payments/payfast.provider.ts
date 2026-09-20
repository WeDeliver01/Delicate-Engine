import { createHash } from "node:crypto";
import type { TopUp, TopUpInstructions } from "@delicate/contracts";
import type { Env } from "../../../config/env.js";
import { AppError } from "../../../common/errors.js";
import type { PaymentProvider, VerifiedPayment } from "./payment.provider.js";

/**
 * PayFast (payfast.io). Flow: we POST the payer to PayFast with a signed form; PayFast calls
 * our ITN (notify) URL server-to-server; we verify (1) the signature with our passphrase,
 * (2) the amount, (3) with PayFast's validate endpoint, then credit the wallet. The browser
 * return URL is informational only.
 */
export class PayFastProvider implements PaymentProvider {
  readonly name = "payfast" as const;

  constructor(private readonly env: Env) {}

  isEnabled(): boolean {
    return Boolean(
      this.env.PAYFAST_MERCHANT_ID && this.env.PAYFAST_MERCHANT_KEY && this.env.PAYFAST_PASSPHRASE,
    );
  }

  private get host(): string {
    return this.env.PAYFAST_SANDBOX ? "https://sandbox.payfast.co.za" : "https://www.payfast.co.za";
  }

  async initiate(
    topUp: TopUp,
    ctx: { returnUrl: string; cancelUrl: string; notifyUrl: string; payerEmail: string | null },
  ): Promise<TopUpInstructions> {
    // Field order matters: PayFast signs fields in the order they appear in the form.
    const fields: Record<string, string> = {
      merchant_id: this.env.PAYFAST_MERCHANT_ID!,
      merchant_key: this.env.PAYFAST_MERCHANT_KEY!,
      return_url: ctx.returnUrl,
      cancel_url: ctx.cancelUrl,
      notify_url: ctx.notifyUrl,
      ...(ctx.payerEmail ? { email_address: ctx.payerEmail } : {}),
      m_payment_id: topUp.id,
      amount: (topUp.amountCents / 100).toFixed(2),
      item_name: `Delicate Courier wallet top-up ${topUp.reference}`,
      custom_str1: topUp.reference,
    };
    fields["signature"] = signature(fields, this.env.PAYFAST_PASSPHRASE!);
    return { type: "redirect", url: `${this.host}/eng/process`, method: "POST", fields };
  }

  async verifyNotification(input: { params: Record<string, string> }): Promise<VerifiedPayment> {
    const params = { ...input.params };
    const received = params["signature"];
    delete params["signature"];
    if (!received || received !== signature(params, this.env.PAYFAST_PASSPHRASE!)) {
      throw AppError.unauthorized("payfast signature mismatch");
    }
    if (params["merchant_id"] !== this.env.PAYFAST_MERCHANT_ID) {
      throw AppError.unauthorized("payfast merchant mismatch");
    }
    // Server-to-server confirmation that this notification really came from PayFast.
    if (!this.env.PAYFAST_SKIP_VALIDATE) {
      const body = new URLSearchParams(input.params).toString();
      const res = await fetch(`${this.host}/eng/query/validate`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body,
      });
      const text = (await res.text()).trim();
      if (text !== "VALID") throw AppError.unauthorized(`payfast validate returned ${text}`);
    }
    const status = params["payment_status"];
    return {
      reference: params["m_payment_id"] ?? "",
      providerRef: params["pf_payment_id"] ?? "",
      amountCents: Math.round(Number(params["amount_gross"] ?? "0") * 100),
      status:
        status === "COMPLETE"
          ? "complete"
          : status === "CANCELLED"
            ? "cancelled"
            : status === "FAILED"
              ? "failed"
              : "pending",
      raw: input.params,
    };
  }
}

/** PayFast signature: urlencoded key=value pairs in order, + passphrase, MD5. */
export function signature(fields: Record<string, string>, passphrase: string): string {
  const encode = (v: string) => encodeURIComponent(v.trim()).replace(/%20/g, "+");
  const parts = Object.entries(fields)
    .filter(([, v]) => v !== undefined && v !== "")
    .map(([k, v]) => `${k}=${encode(v)}`);
  parts.push(`passphrase=${encode(passphrase)}`);
  return createHash("md5").update(parts.join("&")).digest("hex");
}
