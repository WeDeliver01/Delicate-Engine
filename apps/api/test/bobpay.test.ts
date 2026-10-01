import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BobPayProvider } from "../src/modules/wallet/payments/bobpay.provider.js";
import type { Env } from "../src/config/env.js";
import type { TopUp } from "@delicate/contracts";

const ACCOUNT_CODE = "ABC123";
const PASSPHRASE = "a-test-passphrase";
const SANDBOX_IP = "13.245.58.93";
const PRODUCTION_IP = "13.246.100.25";

const env = (over: Partial<Env> = {}) =>
  ({
    BOBPAY_API_TOKEN: "test-token-1234567890",
    BOBPAY_ACCOUNT_CODE: ACCOUNT_CODE,
    BOBPAY_PASSPHRASE: PASSPHRASE,
    BOBPAY_SANDBOX: true,
    // The server-to-server confirmation is exercised separately; most tests here are about
    // the checks that happen before it.
    BOBPAY_SKIP_VALIDATE: true,
    ...over,
  }) as unknown as Env;

const topUp = {
  id: "11111111-1111-4111-8111-111111111111",
  reference: "TU-260901-0007",
  amountCents: 129_999,
} as unknown as TopUp;

/**
 * Bob Pay's documented escape: Go's `url.QueryEscape`. Written out here independently of the
 * provider so the test would catch the provider changing it, rather than agreeing with itself.
 */
function queryEscape(value: string): string {
  return encodeURIComponent(value)
    .replace(/%20/g, "+")
    .replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

interface Webhook {
  custom_payment_id: string;
  amount: number;
  paid_amount?: number;
  status: string;
  email?: string;
  mobile_number?: string;
  item_name?: string;
  item_description?: string;
  notify_url?: string;
  success_url?: string;
  pending_url?: string;
  cancel_url?: string;
  uuid?: string;
  signature?: string;
}

/** A webhook body signed the way Bob Pay signs one. */
function sign(payload: Webhook, passphrase = PASSPHRASE, accountCode = ACCOUNT_CODE): string {
  const pairs = [
    `recipient_account_code=${queryEscape(accountCode)}`,
    `custom_payment_id=${queryEscape(payload.custom_payment_id)}`,
    `email=${queryEscape(payload.email ?? "")}`,
    `mobile_number=${queryEscape(payload.mobile_number ?? "")}`,
    `amount=${payload.amount.toFixed(2)}`,
    `item_name=${queryEscape(payload.item_name ?? "")}`,
    `item_description=${queryEscape(payload.item_description ?? "")}`,
    `notify_url=${queryEscape(payload.notify_url ?? "")}`,
    `success_url=${queryEscape(payload.success_url ?? "")}`,
    `pending_url=${queryEscape(payload.pending_url ?? "")}`,
    `cancel_url=${queryEscape(payload.cancel_url ?? "")}`,
  ];
  return createHash("md5")
    .update(`${pairs.join("&")}&passphrase=${passphrase}`)
    .digest("hex");
}

const webhook = (over: Partial<Webhook> = {}): Webhook => {
  const base: Webhook = {
    custom_payment_id: topUp.id,
    amount: 1299.99,
    paid_amount: 1299.99,
    status: "paid",
    email: "customer@example.com",
    mobile_number: "+27821234567",
    item_name: "Wallet top-up",
    item_description: "Delicate Courier wallet top-up TU-260901-0007",
    notify_url: "https://dev.delicatecourier.co.za/api/v1/wallet/notify/bobpay",
    success_url: "https://dev.delicatecourier.co.za/portal/wallet?topup=ok",
    pending_url: "https://dev.delicatecourier.co.za/portal/wallet?topup=ok",
    cancel_url: "https://dev.delicatecourier.co.za/portal/wallet?topup=cancelled",
    uuid: "550e8400-e29b-41d4-a716-446655440000",
    ...over,
  };
  return { ...base, signature: sign(base) };
};

const notify = (body: Webhook, sourceIp = SANDBOX_IP) => ({
  rawBody: JSON.stringify(body),
  params: {},
  headers: {},
  sourceIp,
});

describe("Bob Pay", () => {
  beforeEach(() => vi.restoreAllMocks());

  describe("configuration", () => {
    it("stays off until it can both take a payment and verify one", async () => {
      // A token on its own could collect money and then be unable to prove the notification
      // about it was genuine, which is the worst of both.
      const provider = new BobPayProvider(env({ BOBPAY_PASSPHRASE: undefined }));
      expect(await provider.isEnabled()).toBe(false);
      expect(provider.pendingReason).toContain("BOBPAY_PASSPHRASE");
    });

    it("names every missing setting at once, not one per attempt", async () => {
      const provider = new BobPayProvider({} as unknown as Env);
      expect(await provider.isEnabled()).toBe(false);
      expect(provider.pendingReason).toContain("BOBPAY_API_TOKEN");
      expect(provider.pendingReason).toContain("BOBPAY_ACCOUNT_CODE");
      expect(provider.pendingReason).toContain("BOBPAY_PASSPHRASE");
    });

    it("says which environment it is pointed at once it is configured", async () => {
      expect(await new BobPayProvider(env()).isEnabled()).toBe(true);
      expect(new BobPayProvider(env()).pendingReason).toContain("sandbox");
      expect(new BobPayProvider(env({ BOBPAY_SANDBOX: false })).pendingReason).toContain(
        "production",
      );
    });
  });

  describe("starting a payment", () => {
    it("sends rand to Bob Pay while the engine keeps cents, and carries our id", async () => {
      const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify({ url: "https://sandbox.bobpay.co.za/pay/ref/3WFFG" }), {
          status: 200,
        }),
      );

      const result = await new BobPayProvider(env()).initiate(topUp, {
        returnUrl: "https://example.test/ok",
        cancelUrl: "https://example.test/no",
        notifyUrl: "https://example.test/notify",
        payerEmail: "customer@example.com",
      });

      expect(result).toEqual({
        type: "redirect",
        url: "https://sandbox.bobpay.co.za/pay/ref/3WFFG",
        method: "GET",
      });

      const [url, init] = fetchMock.mock.calls[0]!;
      expect(String(url)).toBe("https://api.sandbox.bobpay.co.za/v2/payments/intents/link");
      const body = JSON.parse(String((init as RequestInit).body));
      // 129_999 cents is R1,299.99 — not R129,999, and not 1299.9900000000001.
      expect(body.amount).toBe(1299.99);
      // The webhook is matched back to our row by this, so it must be the top-up id.
      expect(body.custom_payment_id).toBe(topUp.id);
      expect(body.notify_url).toBe("https://example.test/notify");
    });

    it("uses the live host when it is not in sandbox", async () => {
      const fetchMock = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValue(new Response(JSON.stringify({ url: "https://my.bobpay.co.za/pay/x" })));
      await new BobPayProvider(env({ BOBPAY_SANDBOX: false })).initiate(topUp, {
        returnUrl: "https://example.test/ok",
        cancelUrl: "https://example.test/no",
        notifyUrl: "https://example.test/notify",
        payerEmail: "customer@example.com",
      });
      expect(String(fetchMock.mock.calls[0]![0])).toBe(
        "https://api.bobpay.co.za/v2/payments/intents/link",
      );
    });

    it("asks for an email rather than sending a request Bob Pay will refuse", async () => {
      await expect(
        new BobPayProvider(env()).initiate(topUp, {
          returnUrl: "https://example.test/ok",
          cancelUrl: "https://example.test/no",
          notifyUrl: "https://example.test/notify",
          payerEmail: null,
        }),
      ).rejects.toMatchObject({ code: "bobpay_needs_email" });
    });

    it("surfaces a refusal as a retryable gateway error, not a crash", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response("amount too small", { status: 422 }),
      );
      await expect(
        new BobPayProvider(env()).initiate(topUp, {
          returnUrl: "https://example.test/ok",
          cancelUrl: "https://example.test/no",
          notifyUrl: "https://example.test/notify",
          payerEmail: "customer@example.com",
        }),
      ).rejects.toMatchObject({ code: "bobpay_unavailable" });
    });
  });

  describe("verifying a notification", () => {
    it("accepts a correctly signed payment from Bob Pay's address", async () => {
      const verified = await new BobPayProvider(env()).verifyNotification(notify(webhook()));
      expect(verified).toMatchObject({
        reference: topUp.id,
        status: "complete",
        amountCents: 129_999,
        providerRef: "550e8400-e29b-41d4-a716-446655440000",
      });
    });

    it("refuses a notification from any other address", async () => {
      // The signature is valid; the source is not. Both have to hold.
      await expect(
        new BobPayProvider(env()).verifyNotification(notify(webhook(), "41.76.108.2")),
      ).rejects.toMatchObject({ code: "unauthorized" });
    });

    it("refuses the sandbox address when it is live, and the reverse", async () => {
      await expect(
        new BobPayProvider(env({ BOBPAY_SANDBOX: false })).verifyNotification(
          notify(webhook(), SANDBOX_IP),
        ),
      ).rejects.toMatchObject({ code: "unauthorized" });
      await expect(
        new BobPayProvider(env()).verifyNotification(notify(webhook(), PRODUCTION_IP)),
      ).rejects.toMatchObject({ code: "unauthorized" });
    });

    it("accepts an IPv4-mapped IPv6 source, which is the same address", async () => {
      const verified = await new BobPayProvider(env()).verifyNotification(
        notify(webhook(), `::ffff:${SANDBOX_IP}`),
      );
      expect(verified.status).toBe("complete");
    });

    it("refuses a payload whose amount was edited in flight", async () => {
      // The attack this exists to stop: change the amount, keep the signature.
      const tampered = { ...webhook(), amount: 12_999.99, paid_amount: 12_999.99 };
      await expect(
        new BobPayProvider(env()).verifyNotification(notify(tampered)),
      ).rejects.toMatchObject({ code: "unauthorized" });
    });

    it("refuses a payload signed with the wrong passphrase", async () => {
      const body = webhook();
      body.signature = sign(body, "not-our-passphrase");
      await expect(
        new BobPayProvider(env()).verifyNotification(notify(body)),
      ).rejects.toMatchObject({ code: "unauthorized" });
    });

    it("refuses a payload signed against another merchant's account code", async () => {
      const body = webhook();
      body.signature = sign(body, PASSPHRASE, "ZZZ999");
      await expect(
        new BobPayProvider(env()).verifyNotification(notify(body)),
      ).rejects.toMatchObject({ code: "unauthorized" });
    });

    it("refuses a payload with no signature at all", async () => {
      const body = webhook();
      delete body.signature;
      await expect(
        new BobPayProvider(env()).verifyNotification(notify(body)),
      ).rejects.toMatchObject({ code: "unauthorized" });
    });

    it("signs values that need escaping the way Bob Pay does", async () => {
      // Spaces become "+", not "%20", and the URLs carry query strings. Getting this wrong
      // produces a mismatch on exactly the payloads that look most ordinary.
      const body = webhook({
        item_name: "Wallet top-up (urgent)",
        item_description: "R1 299,99 — thanks!",
        success_url: "https://dev.delicatecourier.co.za/portal/wallet?topup=ok&from=bobpay",
      });
      const verified = await new BobPayProvider(env()).verifyNotification(notify(body));
      expect(verified.status).toBe("complete");
    });

    it("refuses a body that is not JSON", async () => {
      await expect(
        new BobPayProvider(env()).verifyNotification({
          rawBody: "not json",
          params: {},
          headers: {},
          sourceIp: SANDBOX_IP,
        }),
      ).rejects.toMatchObject({ code: "bobpay_bad_payload" });
    });

    it("refuses a notification that carries no payment id", async () => {
      await expect(
        new BobPayProvider(env()).verifyNotification({
          rawBody: JSON.stringify({ amount: 10, status: "paid" }),
          params: {},
          headers: {},
          sourceIp: SANDBOX_IP,
        }),
      ).rejects.toMatchObject({ code: "bobpay_unknown_payment" });
    });

    it("refuses everything while it is unconfigured", async () => {
      await expect(
        new BobPayProvider({} as unknown as Env).verifyNotification(notify(webhook())),
      ).rejects.toMatchObject({ code: "unauthorized" });
    });
  });

  describe("status mapping", () => {
    const check = async (status: string) =>
      (await new BobPayProvider(env()).verifyNotification(notify(webhook({ status })))).status;

    it("credits only a paid intent", async () => {
      expect(await check("paid")).toBe("complete");
    });

    it("treats a cancelled or deleted intent as cancelled", async () => {
      expect(await check("canceled")).toBe("cancelled");
      expect(await check("deleted")).toBe("cancelled");
    });

    it("treats a failure or a chargeback as failed", async () => {
      expect(await check("failed")).toBe("failed");
      expect(await check("chargeback")).toBe("failed");
    });

    it("leaves an unpaid or refunding intent pending rather than acting on it", async () => {
      // A refund is money going back out. It is a finance action against the ledger, not
      // something a webhook should reverse on its own.
      expect(await check("unpaid")).toBe("pending");
      expect(await check("refunded")).toBe("pending");
      expect(await check("refund_pending")).toBe("pending");
      expect(await check("partially_refunded")).toBe("pending");
    });
  });

  describe("confirming with Bob Pay", () => {
    it("hands the payload back and credits only when Bob Pay agrees", async () => {
      const fetchMock = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValue(new Response("", { status: 200 }));
      const body = webhook();
      const verified = await new BobPayProvider(
        env({ BOBPAY_SKIP_VALIDATE: false }),
      ).verifyNotification(notify(body));

      expect(verified.status).toBe("complete");
      const [url, init] = fetchMock.mock.calls[0]!;
      expect(String(url)).toBe("https://api.sandbox.bobpay.co.za/v2/payments/intents/validate");
      // The exact bytes received, not a re-serialised copy.
      expect((init as RequestInit).body).toBe(JSON.stringify(body));
    });

    it("refuses when Bob Pay does not confirm it", async () => {
      // A signature proves the payload was not edited. Only this proves the payment happened,
      // and it is the check that still holds if the passphrase ever leaks.
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response("no such payment", { status: 404 }),
      );
      await expect(
        new BobPayProvider(env({ BOBPAY_SKIP_VALIDATE: false })).verifyNotification(
          notify(webhook()),
        ),
      ).rejects.toMatchObject({ code: "unauthorized" });
    });

    it("refuses rather than credits when Bob Pay cannot be reached", async () => {
      // Bob Pay retries anything that is not a 200, so refusing loses nothing. Crediting a
      // wallet on an unreachable validator is the alternative, and that is not a trade.
      vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("ECONNREFUSED"));
      await expect(
        new BobPayProvider(env({ BOBPAY_SKIP_VALIDATE: false })).verifyNotification(
          notify(webhook()),
        ),
      ).rejects.toMatchObject({ code: "bobpay_validate_unreachable" });
    });
  });

  describe("amounts", () => {
    it("converts rand back to whole cents without a float tail", async () => {
      // Rand has two decimals and that is what Bob Pay sends. These are the values where
      // multiplying by 100 in binary floating point lands just under the integer — 1.15 * 100
      // is 114.99999999999999 — and would truncate to a cent short if anyone reached for
      // Math.floor or a bare | 0.
      const cases: [number, number][] = [
        [1299.99, 129_999],
        [0.1, 10],
        [1.15, 115],
        [8.25, 825],
        [29.97, 2997],
        [250, 25_000],
        [10_000.5, 1_000_050],
      ];
      for (const [rand, cents] of cases) {
        const verified = await new BobPayProvider(env()).verifyNotification(
          notify(webhook({ amount: rand, paid_amount: rand })),
        );
        expect(verified.amountCents, `R${rand}`).toBe(cents);
      }
    });

    it("cannot silently credit the wrong amount even if a figure arrives oddly", async () => {
      // A third decimal is not a rand amount and Bob Pay does not send one, but if it ever
      // did, the conversion could be a cent out. That is caught rather than trusted: the
      // central handler compares this figure against the top-up row and refuses a mismatch,
      // so the failure mode is a refused notification, never a wrong balance.
      const verified = await new BobPayProvider(env()).verifyNotification(
        notify(webhook({ amount: 1.005, paid_amount: 1.005 })),
      );
      expect(verified.amountCents).not.toBe(129_999);
    });

    it("reports what was actually paid, not what was asked for", async () => {
      // Some payment methods allow a non-exact amount. The central handler compares this
      // against the top-up row and refuses a mismatch, so it must be the real figure.
      const body = webhook({ amount: 1299.99, paid_amount: 1000 });
      const verified = await new BobPayProvider(env()).verifyNotification(notify(body));
      expect(verified.amountCents).toBe(100_000);
    });
  });
});
