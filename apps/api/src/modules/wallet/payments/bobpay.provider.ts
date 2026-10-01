import { createHash } from "node:crypto";
import type { TopUp, TopUpInstructions } from "@delicate/contracts";
import type { Env } from "../../../config/env.js";
import { AppError } from "../../../common/errors.js";
import type { PaymentProvider, VerifiedPayment } from "./payment.provider.js";

/**
 * Bob Pay (Bob Group) — card and instant EFT.
 *
 * Flow: we create a payment intent server-side with our bearer token and send the payer to the
 * URL it returns; Bob Pay POSTs our `notify_url` when the payment resolves; we verify it and
 * only then credit the wallet. The `success_url` the browser lands on is informational — a
 * customer can reach it by typing it, so it can never be the thing that moves money
 * (invariant #5).
 *
 * Bob Pay asks for four checks on a notification and this does all four, in their order:
 *
 *   1. the request came from one of their static IPs
 *   2. the MD5 signature over our own account code and passphrase matches
 *   3. Bob Pay itself confirms the payment when we hand the payload back
 *   4. the amount is the amount we asked for
 *
 * The fourth is done centrally by `TopUpService.handleNotification`, which compares against the
 * top-up row rather than trusting anything in the notification — so it is not repeated here.
 *
 * Built against the published merchant API (`POST /v2/login`, `/v2/payments/intents/link`,
 * `/v2/payments/intents/validate`) as documented at developer.bobpay.co.za. Make one sandbox
 * payment end to end before switching this on for real money.
 */
export class BobPayProvider implements PaymentProvider {
  readonly name = "bobpay" as const;

  /** Bob Pay sends notifications only from these. Documented, static, and different per env. */
  private static readonly SOURCE_IPS = {
    sandbox: "13.245.58.93",
    production: "13.246.100.25",
  } as const;

  constructor(private readonly env: Env) {}

  private get sandbox(): boolean {
    return this.env.BOBPAY_SANDBOX === true;
  }

  private get api(): string {
    return this.sandbox ? "https://api.sandbox.bobpay.co.za" : "https://api.bobpay.co.za";
  }

  async isEnabled(): Promise<boolean> {
    // All three or none. A token without the passphrase could take a payment and then be
    // unable to prove the notification about it was genuine, which is the worst of both.
    return Boolean(
      this.env.BOBPAY_API_TOKEN && this.env.BOBPAY_ACCOUNT_CODE && this.env.BOBPAY_PASSPHRASE,
    );
  }

  get pendingReason(): string {
    const missing = [
      !this.env.BOBPAY_API_TOKEN && "BOBPAY_API_TOKEN",
      !this.env.BOBPAY_ACCOUNT_CODE && "BOBPAY_ACCOUNT_CODE",
      !this.env.BOBPAY_PASSPHRASE && "BOBPAY_PASSPHRASE",
    ].filter(Boolean);
    return missing.length
      ? `Not configured. Set ${missing.join(", ")} from your Bob Pay account settings.`
      : `Connected to the ${this.sandbox ? "sandbox" : "production"} environment.`;
  }

  async initiate(
    topUp: TopUp,
    ctx: { returnUrl: string; cancelUrl: string; notifyUrl: string; payerEmail: string | null },
  ): Promise<TopUpInstructions> {
    if (!ctx.payerEmail) {
      // Bob Pay requires an email or a mobile number, and we hold the email.
      throw new AppError(
        "bobpay_needs_email",
        "Bob Pay needs an email address on the account before it can take a payment.",
        422,
      );
    }

    const res = await fetch(`${this.api}/v2/payments/intents/link`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.env.BOBPAY_API_TOKEN}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        // Bob Pay prices in rand as a decimal; we keep cents, so this is the one place the
        // conversion happens, and `toFixed` keeps it off the float that 12.34 really is.
        amount: Number((topUp.amountCents / 100).toFixed(2)),
        email: ctx.payerEmail,
        // Our top-up id, echoed back on the webhook. This is what ties their payment to our
        // row, so it must be the id the notification handler looks up — not the reference.
        custom_payment_id: topUp.id,
        item_name: "Wallet top-up",
        item_description: `Delicate Courier wallet top-up ${topUp.reference}`,
        notify_url: ctx.notifyUrl,
        success_url: ctx.returnUrl,
        pending_url: ctx.returnUrl,
        cancel_url: ctx.cancelUrl,
        is_one_time_payment_link: true,
      }),
      signal: AbortSignal.timeout(20_000),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new AppError(
        "bobpay_unavailable",
        "Bob Pay could not start this payment. Try another method or again shortly.",
        502,
        { status: res.status, detail: detail.slice(0, 300) },
      );
    }

    const body = (await res.json()) as { url?: string; short_url?: string };
    const url = body.url ?? body.short_url;
    if (!url) {
      throw new AppError("bobpay_unavailable", "Bob Pay did not return a payment page", 502);
    }
    return { type: "redirect", url, method: "GET" };
  }

  async verifyNotification(input: {
    rawBody: string;
    params: Record<string, string>;
    headers: Record<string, string | string[] | undefined>;
    sourceIp?: string;
  }): Promise<VerifiedPayment> {
    if (!(await this.isEnabled())) {
      throw AppError.unauthorized("bobpay is not configured");
    }

    // ── 1. Source IP ────────────────────────────────────────────────────────
    this.assertFromBobPay(input.sourceIp);

    // ── 2. Signature ────────────────────────────────────────────────────────
    let payload: BobPayWebhook;
    try {
      payload = JSON.parse(input.rawBody) as BobPayWebhook;
    } catch {
      throw new AppError("bobpay_bad_payload", "bobpay notification was not valid JSON", 400);
    }
    if (!payload.custom_payment_id) {
      throw new AppError("bobpay_unknown_payment", "notification carried no payment id", 422);
    }
    this.assertSignature(payload);

    // ── 3. Bob Pay's own confirmation ───────────────────────────────────────
    // A signature proves the payload was not edited in flight; it does not prove the payment
    // happened. Handing the whole thing back and being told "yes" is what proves that, and it
    // is the check that survives a leaked passphrase.
    await this.assertBobPayAgrees(input.rawBody);

    const status = this.mapStatus(payload.status);
    // Their `paid_amount` is what actually arrived; on a failure it may be absent, and the
    // central amount check only looks at a completed payment anyway.
    const paid = payload.paid_amount ?? payload.amount ?? 0;

    return {
      reference: payload.custom_payment_id,
      providerRef: payload.uuid ?? String(payload.id ?? payload.payment_id ?? ""),
      amountCents: Math.round(paid * 100),
      status,
      raw: flattenForAudit(payload),
    };
  }

  /** Bob Pay publishes one static address per environment; anything else is not them. */
  private assertFromBobPay(sourceIp: string | undefined): void {
    const expected = this.sandbox
      ? BobPayProvider.SOURCE_IPS.sandbox
      : BobPayProvider.SOURCE_IPS.production;
    // Express is behind one proxy (`trust proxy` is 1), so req.ip is the real client. A
    // v4-mapped v6 address is the same address wearing a hat.
    const actual = (sourceIp ?? "").replace(/^::ffff:/, "");
    if (actual !== expected) {
      throw AppError.unauthorized("bobpay notification did not come from bobpay");
    }
  }

  /**
   * MD5 over an ordered key=value string ending in the passphrase, exactly as Bob Pay computes
   * it.
   *
   * Two details that are easy to get wrong and silently produce a mismatch: the account code
   * in the string is *ours*, because the payload's own `recipient_account_code` is always
   * empty; and the amount is the intent amount formatted to two decimals, unescaped, while
   * every other value is form-escaped.
   */
  private assertSignature(p: BobPayWebhook): void {
    const pairs = [
      `recipient_account_code=${queryEscape(this.env.BOBPAY_ACCOUNT_CODE!)}`,
      `custom_payment_id=${queryEscape(p.custom_payment_id)}`,
      `email=${queryEscape(p.email ?? "")}`,
      `mobile_number=${queryEscape(p.mobile_number ?? "")}`,
      `amount=${Number(p.amount ?? 0).toFixed(2)}`,
      `item_name=${queryEscape(p.item_name ?? "")}`,
      `item_description=${queryEscape(p.item_description ?? "")}`,
      `notify_url=${queryEscape(p.notify_url ?? "")}`,
      `success_url=${queryEscape(p.success_url ?? "")}`,
      `pending_url=${queryEscape(p.pending_url ?? "")}`,
      `cancel_url=${queryEscape(p.cancel_url ?? "")}`,
    ];
    const expected = createHash("md5")
      .update(`${pairs.join("&")}&passphrase=${this.env.BOBPAY_PASSPHRASE}`)
      .digest("hex");

    // Compared case-insensitively on hex, then constant-time on equal-length buffers. MD5 is
    // Bob Pay's choice, not ours; the timing-safe compare costs nothing and removes one way
    // to learn the digest a byte at a time.
    if (!equalsHex(expected, p.signature ?? "")) {
      throw AppError.unauthorized("bobpay signature mismatch");
    }
  }

  /** Hand the notification back to Bob Pay and require a 200. */
  private async assertBobPayAgrees(rawBody: string): Promise<void> {
    // Tests exercise the signature and the IP check without a network. Production never sets
    // this, and `isEnabled` does not depend on it, so it cannot be reached by accident.
    if (this.env.BOBPAY_SKIP_VALIDATE) return;

    let res: Response;
    try {
      res = await fetch(`${this.api}/v2/payments/intents/validate`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.env.BOBPAY_API_TOKEN}`,
          "content-type": "application/json",
        },
        body: rawBody,
        signal: AbortSignal.timeout(15_000),
      });
    } catch (err) {
      // Bob Pay retries anything that is not a 200, so failing here loses nothing: we refuse
      // now and they deliver it again. Crediting a wallet on an unreachable validator would
      // be the alternative, and that is not a trade worth making.
      throw new AppError(
        "bobpay_validate_unreachable",
        "could not reach bobpay to confirm this payment",
        503,
        { cause: err instanceof Error ? err.message : String(err) },
      );
    }
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw AppError.unauthorized(
        `bobpay did not confirm this payment (${res.status}${detail ? `: ${detail.slice(0, 200)}` : ""})`,
      );
    }
  }

  /** Their intent statuses, mapped onto the four the engine acts on. */
  private mapStatus(status: string | undefined): VerifiedPayment["status"] {
    switch (status) {
      case "paid":
        return "complete";
      case "canceled":
      case "deleted":
        return "cancelled";
      case "failed":
      case "chargeback":
        return "failed";
      // `unpaid` is the intent before anyone has paid it, and the refund states are money
      // going back out — neither is this top-up completing, and a refund is a finance action
      // against the ledger rather than something a webhook should reverse on its own.
      default:
        return "pending";
    }
  }
}

/** The fields we read. Bob Pay may send more; anything unknown is kept for the audit row. */
interface BobPayWebhook {
  id?: number;
  uuid?: string;
  payment_id?: number;
  custom_payment_id: string;
  amount?: number;
  paid_amount?: number;
  status?: string;
  payment_method?: string;
  email?: string;
  mobile_number?: string;
  item_name?: string;
  item_description?: string;
  notify_url?: string;
  success_url?: string;
  pending_url?: string;
  cancel_url?: string;
  signature?: string;
  error_message?: string;
  is_test?: boolean;
}

/**
 * Go's `url.QueryEscape`, which is what Bob Pay hashes over: everything except
 * `A-Za-z0-9-_.~` is percent-encoded, and a space becomes `+` rather than `%20`.
 * `encodeURIComponent` agrees except that it leaves `!'()*` alone, so those are escaped after.
 */
function queryEscape(value: string): string {
  return encodeURIComponent(value)
    .replace(/%20/g, "+")
    .replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

/** Constant-time hex comparison. A signature check that leaks timing is not a signature check. */
function equalsHex(expected: string, offered: string): boolean {
  const a = expected.toLowerCase();
  const b = offered.toLowerCase();
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** The inbox stores strings; nested objects are kept as JSON rather than dropped. */
function flattenForAudit(payload: BobPayWebhook): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (value === null || value === undefined) continue;
    out[key] = typeof value === "object" ? JSON.stringify(value) : String(value);
  }
  return out;
}
