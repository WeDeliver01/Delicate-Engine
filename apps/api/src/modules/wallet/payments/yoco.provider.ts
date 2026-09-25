import { createHmac, timingSafeEqual } from "node:crypto";
import type { TopUp, TopUpInstructions } from "@delicate/contracts";
import type { Env } from "../../../config/env.js";
import { AppError } from "../../../common/errors.js";
import type { PaymentProvider, VerifiedPayment } from "./payment.provider.js";

/**
 * Yoco online checkout.
 *
 * Flow: we create a checkout server-side with our secret key and send the payer to the returned
 * URL; Yoco calls our webhook when the payment succeeds; we verify the signature and only then
 * credit the wallet. The browser's return URL is informational — a customer can reach it by
 * typing it, so it can never be the thing that moves money (invariant #5).
 *
 * The request and signature shapes here follow Yoco's published checkout and webhook API
 * (`POST /api/checkouts`, and Svix-style `webhook-id` / `webhook-timestamp` / `webhook-signature`
 * headers over `id.timestamp.body`). Confirm them against the current documentation and a
 * sandbox payment before switching this on for real money.
 */
export class YocoProvider implements PaymentProvider {
  readonly name = "yoco" as const;
  private static readonly API = "https://payments.yoco.com/api";

  constructor(private readonly env: Env) {}

  async isEnabled(): Promise<boolean> {
    return Boolean(this.env.YOCO_SECRET_KEY && this.env.YOCO_WEBHOOK_SECRET);
  }

  async initiate(
    topUp: TopUp,
    ctx: { returnUrl: string; cancelUrl: string; notifyUrl: string; payerEmail: string | null },
  ): Promise<TopUpInstructions> {
    const res = await fetch(`${YocoProvider.API}/checkouts`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.env.YOCO_SECRET_KEY}`,
        "content-type": "application/json",
        // Our own top-up id: a retried create returns the same checkout rather than a second one.
        "idempotency-key": topUp.id,
      },
      body: JSON.stringify({
        amount: topUp.amountCents,
        currency: "ZAR",
        successUrl: ctx.returnUrl,
        cancelUrl: ctx.cancelUrl,
        failureUrl: ctx.cancelUrl,
        metadata: { topUpId: topUp.id, reference: topUp.reference },
      }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new AppError(
        "yoco_unavailable",
        "Yoco could not start this payment. Try another method or again shortly.",
        502,
        { status: res.status, detail: detail.slice(0, 300) },
      );
    }
    const body = (await res.json()) as { redirectUrl?: string; id?: string };
    if (!body.redirectUrl) {
      throw new AppError("yoco_unavailable", "Yoco did not return a payment page", 502);
    }
    return { type: "redirect", url: body.redirectUrl, method: "GET" };
  }

  async verifyNotification(input: {
    rawBody: string;
    params: Record<string, string>;
    headers: Record<string, string | string[] | undefined>;
  }): Promise<VerifiedPayment> {
    const id = header(input.headers, "webhook-id");
    const timestamp = header(input.headers, "webhook-timestamp");
    const signature = header(input.headers, "webhook-signature");
    if (!id || !timestamp || !signature) {
      throw AppError.unauthorized("yoco webhook is missing its signature headers");
    }

    // Reject anything older than five minutes: a captured webhook must not be replayable
    // forever, and the inbox only dedupes what it has already seen.
    const ageSeconds = Math.abs(Date.now() / 1000 - Number(timestamp));
    if (!Number.isFinite(ageSeconds) || ageSeconds > 300) {
      throw AppError.unauthorized("yoco webhook timestamp is outside the accepted window");
    }

    const secret = this.env.YOCO_WEBHOOK_SECRET!;
    // The secret is issued as "whsec_<base64>"; the bytes after the prefix are the key.
    const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
    const expected = createHmac("sha256", key)
      .update(`${id}.${timestamp}.${input.rawBody}`)
      .digest("base64");

    // The header may carry several space-separated versioned signatures ("v1,<sig> v1,<sig>").
    const offered = signature
      .split(" ")
      .map((part) => part.split(",").pop() ?? "")
      .filter(Boolean);
    if (!offered.some((candidate) => equals(candidate, expected))) {
      throw AppError.unauthorized("yoco webhook signature mismatch");
    }

    const payload = JSON.parse(input.rawBody) as {
      type?: string;
      payload?: {
        id?: string;
        status?: string;
        amount?: number;
        metadata?: { topUpId?: string; reference?: string };
      };
    };
    const data = payload.payload ?? {};
    const reference = data.metadata?.topUpId ?? data.metadata?.reference;
    if (!reference) {
      throw new AppError("yoco_unknown_payment", "webhook carried no top-up reference", 422);
    }

    return {
      reference,
      providerRef: data.id ?? id,
      amountCents: Number(data.amount ?? 0),
      status:
        payload.type === "payment.succeeded" || data.status === "succeeded" ? "complete" : "failed",
      raw: input.params,
    };
  }
}

function header(
  headers: Record<string, string | string[] | undefined>,
  name: string,
): string | null {
  const value = headers[name] ?? headers[name.toLowerCase()];
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

/** Constant-time comparison: a signature check that leaks timing is not a signature check. */
function equals(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
