import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { YocoProvider } from "../src/modules/wallet/payments/yoco.provider.js";
import { BobPayProvider } from "../src/modules/wallet/payments/bobpay.provider.js";
import type { Env } from "../src/config/env.js";
import type { TopUp } from "@delicate/contracts";

const SECRET = "whsec_" + Buffer.from("a-test-signing-key-long-enough").toString("base64");

const env = {
  YOCO_SECRET_KEY: "sk_test_abcdefghijklmnop",
  YOCO_WEBHOOK_SECRET: SECRET,
} as unknown as Env;

const topUp: TopUp = {
  id: "11111111-1111-4111-8111-111111111111",
  accountId: "22222222-2222-4222-8222-222222222222",
  reference: "DC-TOPUP-1",
  provider: "yoco",
  amountCents: 50_000,
  status: "pending",
  createdAt: new Date().toISOString(),
} as unknown as TopUp;

const ctx = {
  returnUrl: "https://app.test/return",
  cancelUrl: "https://app.test/cancel",
  notifyUrl: "https://api.test/hook",
  payerEmail: null,
};

/** Build the headers Yoco would send for a body, so the verifier is tested against real input. */
function signed(body: string, at = Math.floor(Date.now() / 1000), id = "msg_1") {
  const key = Buffer.from(SECRET.replace(/^whsec_/, ""), "base64");
  const sig = createHmac("sha256", key).update(`${id}.${at}.${body}`).digest("base64");
  return {
    "webhook-id": id,
    "webhook-timestamp": String(at),
    "webhook-signature": `v1,${sig}`,
  };
}

const succeeded = JSON.stringify({
  type: "payment.succeeded",
  payload: {
    id: "pay_123",
    status: "succeeded",
    amount: 50_000,
    metadata: { topUpId: topUp.id, reference: topUp.reference },
  },
});

describe("Yoco", () => {
  let provider: YocoProvider;

  beforeEach(() => {
    provider = new YocoProvider(env);
    vi.restoreAllMocks();
  });

  it("is off until both the key and the webhook secret are set", async () => {
    expect(await provider.isEnabled()).toBe(true);
    expect(await new YocoProvider({ YOCO_SECRET_KEY: "sk" } as unknown as Env).isEnabled()).toBe(
      false,
    );
    expect(await new YocoProvider({} as unknown as Env).isEnabled()).toBe(false);
  });

  it("creates a checkout and sends the payer to the URL Yoco returns", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: "ch_1", redirectUrl: "https://pay.yoco.com/ch_1" }), {
        status: 200,
      }),
    );
    const out = await provider.initiate(topUp, ctx);
    expect(out).toEqual({ type: "redirect", url: "https://pay.yoco.com/ch_1", method: "GET" });

    const [, init] = fetchMock.mock.calls[0]!;
    const body = JSON.parse(String(init!.body));
    expect(body.amount).toBe(50_000); // cents, not rands
    expect(body.currency).toBe("ZAR");
    expect(body.metadata.topUpId).toBe(topUp.id);
    // a retried create must not make a second checkout
    expect((init!.headers as Record<string, string>)["idempotency-key"]).toBe(topUp.id);
  });

  it("surfaces a provider outage as a retryable error, not a crash", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("upstream down", { status: 502 }));
    await expect(provider.initiate(topUp, ctx)).rejects.toMatchObject({ code: "yoco_unavailable" });
  });

  it("accepts a correctly signed webhook", async () => {
    const result = await provider.verifyNotification({
      rawBody: succeeded,
      params: {},
      headers: signed(succeeded),
    });
    expect(result).toMatchObject({
      reference: topUp.id,
      providerRef: "pay_123",
      amountCents: 50_000,
      status: "complete",
    });
  });

  it("rejects a forged signature", async () => {
    const headers = signed(succeeded);
    headers["webhook-signature"] = "v1,not-the-right-signature";
    await expect(
      provider.verifyNotification({ rawBody: succeeded, params: {}, headers }),
    ).rejects.toMatchObject({ code: "unauthorized" });
  });

  it("rejects a body altered after signing", async () => {
    const headers = signed(succeeded);
    const tampered = succeeded.replace('"amount":50000', '"amount":5000000');
    await expect(
      provider.verifyNotification({ rawBody: tampered, params: {}, headers }),
    ).rejects.toMatchObject({ code: "unauthorized" });
  });

  it("rejects a replay of an old webhook", async () => {
    const old = Math.floor(Date.now() / 1000) - 3600;
    await expect(
      provider.verifyNotification({
        rawBody: succeeded,
        params: {},
        headers: signed(succeeded, old),
      }),
    ).rejects.toMatchObject({ code: "unauthorized" });
  });

  it("rejects a webhook with no signature headers at all", async () => {
    await expect(
      provider.verifyNotification({ rawBody: succeeded, params: {}, headers: {} }),
    ).rejects.toMatchObject({ code: "unauthorized" });
  });

  it("accepts a header carrying several versioned signatures", async () => {
    const headers = signed(succeeded);
    headers["webhook-signature"] = `v1,someoldsignature ${headers["webhook-signature"]}`;
    const result = await provider.verifyNotification({ rawBody: succeeded, params: {}, headers });
    expect(result.status).toBe("complete");
  });

  it("reports a failed payment as failed rather than complete", async () => {
    const failed = JSON.stringify({
      type: "payment.failed",
      payload: { id: "pay_2", status: "failed", amount: 50_000, metadata: { topUpId: topUp.id } },
    });
    const result = await provider.verifyNotification({
      rawBody: failed,
      params: {},
      headers: signed(failed),
    });
    expect(result.status).toBe("failed");
  });

  it("refuses a webhook that names no top-up", async () => {
    const orphan = JSON.stringify({
      type: "payment.succeeded",
      payload: { id: "pay_3", status: "succeeded", amount: 100 },
    });
    await expect(
      provider.verifyNotification({ rawBody: orphan, params: {}, headers: signed(orphan) }),
    ).rejects.toMatchObject({ code: "yoco_unknown_payment" });
  });
});

describe("BobPay", () => {
  it("stays off and says what it needs, rather than pretending to work", async () => {
    const provider = new BobPayProvider({} as unknown as Env);
    expect(await provider.isEnabled()).toBe(false);
    expect(provider.pendingReason).toContain("documentation");
    await expect(provider.initiate(topUp)).rejects.toMatchObject({ code: "provider_unavailable" });
  });

  it("stays off even when a merchant id is present, because nothing verifies a notification", async () => {
    const provider = new BobPayProvider({ BOBPAY_MERCHANT_ID: "m-1" } as unknown as Env);
    expect(await provider.isEnabled()).toBe(false);
    await expect(provider.verifyNotification()).rejects.toMatchObject({ code: "unauthorized" });
  });
});
