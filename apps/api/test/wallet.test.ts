import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { outboxMessages, users, walletEntries } from "@delicate/db";
import type { CreateTopUpResponse, WalletSummary } from "@delicate/contracts";
import { createHarness, USERS, type Harness } from "./harness.js";
import { WalletService } from "../src/modules/wallet/wallet.service.js";
import { signature } from "../src/modules/wallet/payments/payfast.provider.js";

describe("wallet & top-ups", () => {
  let h: Harness;
  let wallet: WalletService;
  let owner: string;
  let finance: string;
  let accountId: string;

  beforeAll(async () => {
    process.env["EFT_BANK_NAME"] = "Test Bank";
    process.env["EFT_ACCOUNT_NUMBER"] = "1234567890";
    process.env["EFT_BRANCH_CODE"] = "250655";
    process.env["PAYFAST_MERCHANT_ID"] = "10000100";
    process.env["PAYFAST_MERCHANT_KEY"] = "46f0cd694581a";
    process.env["PAYFAST_PASSPHRASE"] = "jt7NOE43FZPn";
    process.env["PAYFAST_SANDBOX"] = "1";
    process.env["PAYFAST_SKIP_VALIDATE"] = "1";
    h = await createHarness();
    wallet = h.app.get(WalletService);
    owner = await h.tokenFor(USERS.alice);
    finance = await h.tokenFor(USERS.admin);
  });
  afterAll(() => h.close());
  beforeEach(async () => {
    await h.reset();
    await h.db.db.insert(users).values({ ...USERS.admin, platformRole: "finance" });
    const res = await h
      .http()
      .post("/v1/accounts")
      .set("Authorization", `Bearer ${owner}`)
      .send({ name: "Honey Bee", type: "business", organization: { name: "Honey Bee Bakers" } });
    accountId = res.body.id;
  });

  const asOwner = () => ({ Authorization: `Bearer ${owner}`, "X-Account-Id": accountId });
  const summary = async () =>
    (await h.http().get("/v1/account/wallet").set(asOwner())).body as WalletSummary;

  it("starts at zero with a wallet created alongside the account", async () => {
    const s = await summary();
    expect(s).toMatchObject({
      balanceCents: 0,
      creditLimitCents: 0,
      heldCents: 0,
      availableCents: 0,
      billingMode: "prepaid",
    });
  });

  it("manual EFT: pending until finance confirms, then credits exactly once", async () => {
    const created = await h
      .http()
      .post("/v1/account/wallet/top-ups")
      .set(asOwner())
      .send({ provider: "manual_eft", amountCents: 50_000 });
    expect(created.status).toBe(201);
    const body = created.body as CreateTopUpResponse;
    expect(body.topUp.status).toBe("pending");
    expect(body.instructions.type).toBe("eft");
    expect(body.topUp.reference).toMatch(/^DC-[A-Z2-9]{8}$/);
    expect((await summary()).balanceCents).toBe(0);

    const pending = await h
      .http()
      .get("/v1/admin/top-ups/pending")
      .set("Authorization", `Bearer ${finance}`);
    expect(pending.body.items.map((t: { id: string }) => t.id)).toContain(body.topUp.id);

    const confirm = await h
      .http()
      .post(`/v1/admin/top-ups/${body.topUp.id}/confirm`)
      .set("Authorization", `Bearer ${finance}`)
      .send({ bankReference: "FNB-88213" });
    expect(confirm.status).toBe(201);
    expect(confirm.body.status).toBe("confirmed");
    expect((await summary()).balanceCents).toBe(50_000);

    // idempotent: confirming again changes nothing
    const again = await h
      .http()
      .post(`/v1/admin/top-ups/${body.topUp.id}/confirm`)
      .set("Authorization", `Bearer ${finance}`)
      .send({});
    expect(again.status).toBe(201);
    expect((await summary()).balanceCents).toBe(50_000);
    expect(await h.db.db.$count(walletEntries, eq(walletEntries.accountId, accountId))).toBe(1);

    const events = (await h.db.db.select().from(outboxMessages)).map((e) => e.eventType);
    expect(events).toContain("wallet.topup_requested");
    expect(events).toContain("wallet.topup_confirmed");

    // customers cannot confirm their own top-ups
    const denied = await h
      .http()
      .post(`/v1/admin/top-ups/${body.topUp.id}/confirm`)
      .set(asOwner())
      .send({});
    expect(denied.status).toBe(403);
  });

  it("PayFast: credits only on a correctly signed ITN with the matching amount, once", async () => {
    const created = (
      await h
        .http()
        .post("/v1/account/wallet/top-ups")
        .set(asOwner())
        .send({ provider: "payfast", amountCents: 25_000 })
    ).body as CreateTopUpResponse;
    expect(created.instructions.type).toBe("redirect");

    const itn = (overrides: Record<string, string> = {}) => {
      const fields: Record<string, string> = {
        m_payment_id: created.topUp.id,
        pf_payment_id: "1089250",
        payment_status: "COMPLETE",
        item_name: "x",
        amount_gross: "250.00",
        amount_fee: "-5.75",
        amount_net: "244.25",
        merchant_id: "10000100",
        ...overrides,
      };
      return { ...fields, signature: signature(fields, "jt7NOE43FZPn") };
    };

    const bad = await h
      .http()
      .post("/v1/webhooks/payfast")
      .type("form")
      .send({ ...itn(), signature: "deadbeef" });
    expect(bad.status).toBe(401);
    expect((await summary()).balanceCents).toBe(0);

    const wrongAmount = await h
      .http()
      .post("/v1/webhooks/payfast")
      .type("form")
      .send(itn({ amount_gross: "10.00" }));
    expect(wrongAmount.status).toBe(400);
    expect((await summary()).balanceCents).toBe(0);

    const ok = await h.http().post("/v1/webhooks/payfast").type("form").send(itn());
    expect(ok.status).toBe(200);
    expect(ok.body).toEqual({ duplicate: false, status: "complete" });
    expect((await summary()).balanceCents).toBe(25_000);

    const replay = await h.http().post("/v1/webhooks/payfast").type("form").send(itn());
    expect(replay.body).toEqual({ duplicate: true, status: "complete" });
    expect((await summary()).balanceCents).toBe(25_000);
  });

  it("holds gate on balance + credit and serialise under concurrency", async () => {
    await wallet.adjust(accountId, 10_000, "seed for test");
    await h.db.transaction((tx) =>
      wallet.placeHold(tx, { accountId, amountCents: 4_000, idempotencyKey: "hold:a" }),
    );
    expect(await summary()).toMatchObject({
      balanceCents: 10_000,
      heldCents: 4_000,
      availableCents: 6_000,
    });

    // two racers for the last R60: exactly one wins
    const results = await Promise.allSettled([
      h.db.transaction((tx) =>
        wallet.placeHold(tx, { accountId, amountCents: 6_000, idempotencyKey: "hold:b" }),
      ),
      h.db.transaction((tx) =>
        wallet.placeHold(tx, { accountId, amountCents: 6_000, idempotencyKey: "hold:c" }),
      ),
    ]);
    const won = results.filter((r) => r.status === "fulfilled");
    const lost = results.filter((r) => r.status === "rejected");
    expect(won).toHaveLength(1);
    expect(lost).toHaveLength(1);
    expect((lost[0] as PromiseRejectedResult).reason).toMatchObject({
      code: "insufficient_funds",
      statusCode: 402,
    });
    expect((await summary()).availableCents).toBe(0);

    // postpaid credit extends what can be held
    const terms = await h
      .http()
      .put(`/v1/admin/accounts/${accountId}/credit-terms`)
      .set("Authorization", `Bearer ${finance}`)
      .send({ billingMode: "postpaid", creditLimitCents: 100_000 });
    expect(terms.status).toBe(200);
    expect(terms.body).toMatchObject({
      billingMode: "postpaid",
      creditLimitCents: 100_000,
      availableCents: 100_000,
    });
    await h.db.transaction((tx) =>
      wallet.placeHold(tx, { accountId, amountCents: 30_000, idempotencyKey: "hold:d" }),
    );
    expect((await summary()).availableCents).toBe(70_000);
  });

  it("capturing a hold posts the charge; releasing frees the funds; the ledger reconciles", async () => {
    await wallet.adjust(accountId, 20_000, "seed for test");
    const hold = await h.db.transaction((tx) =>
      wallet.placeHold(tx, {
        accountId,
        amountCents: 15_000,
        reference: "booking:1",
        idempotencyKey: "hold:x",
      }),
    );
    const other = await h.db.transaction((tx) =>
      wallet.placeHold(tx, { accountId, amountCents: 5_000, idempotencyKey: "hold:y" }),
    );

    const charge = await h.db.transaction((tx) =>
      wallet.captureHold(tx, hold.id, { amountCents: 14_500, description: "Booking 1" }),
    );
    expect(charge).toMatchObject({
      kind: "charge",
      amountCents: -14_500,
      balanceAfterCents: 5_500,
    });
    await h.db.transaction((tx) => wallet.releaseHold(tx, other.id));
    expect(await summary()).toMatchObject({
      balanceCents: 5_500,
      heldCents: 0,
      availableCents: 5_500,
    });

    // capture is idempotent and cannot double-charge
    const again = await h.db.transaction((tx) =>
      wallet.captureHold(tx, hold.id, { description: "Booking 1" }),
    );
    expect(again.id).toBe(charge.id);

    const entries = await h.http().get("/v1/account/wallet/entries").set(asOwner());
    expect(entries.body.items.map((e: { kind: string }) => e.kind)).toEqual([
      "charge",
      "adjustment",
    ]);
    const verify = await h
      .http()
      .get(`/v1/admin/accounts/${accountId}/wallet/verify`)
      .set("Authorization", `Bearer ${finance}`);
    expect(verify.body).toEqual({ ok: true, cachedCents: 5_500, derivedCents: 5_500 });
  });
});
