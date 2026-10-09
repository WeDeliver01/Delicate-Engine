import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { desc, eq } from "drizzle-orm";
import { auditLog, users, wallets } from "@delicate/db";
import type { Booking, CatalogResponse, Quote, WalletSummary } from "@delicate/contracts";
import { createHarness, USERS, type Harness } from "./harness.js";
import { WalletService } from "../src/modules/wallet/wallet.service.js";
import { Clock } from "../src/infra/clock.js";

const MENLYN = { lat: -25.7826, lng: 28.2755 };
const CENTURION = { lat: -25.8603, lng: 28.1894 };
const addr = (formatted: string, location: { lat: number; lng: number }) => ({
  formatted,
  line1: null,
  suburb: "Centurion",
  city: "Pretoria",
  postalCode: null,
  country: "ZA",
  location,
  placeId: null,
});

/**
 * Staff acting on a customer's account.
 *
 * Two capabilities that look like one: reaching into an account you do not belong to, and
 * booking past what its wallet can cover. Both are legitimate — support cannot help with a
 * booking it cannot see, and the owner may choose to extend credit — and both are the kind of
 * power that has to leave a trail, so that is mostly what these tests are about.
 */
describe("acting on a customer's account", () => {
  let h: Harness;
  let wallet: WalletService;
  let owner: string;
  let superAdmin: string;
  let dispatcher: string;
  let accountId: string;
  let cakeId: string;
  const SLOT = { date: "2026-09-24", windowKey: "morning" };

  beforeAll(async () => {
    h = await createHarness();
    wallet = h.app.get(WalletService);
    h.app.get(Clock).now = () => new Date("2026-09-23T07:00:00Z");
    owner = await h.tokenFor(USERS.alice);
    superAdmin = await h.tokenFor(USERS.admin);
    dispatcher = await h.tokenFor(USERS.carol);
  });
  afterAll(() => h.close());

  beforeEach(async () => {
    await h.reset();
    await h.db.db.insert(users).values([
      { ...USERS.admin, platformRole: "super_admin" },
      { ...USERS.carol, platformRole: "dispatcher" },
    ]);
    const acc = await h
      .http()
      .post("/v1/accounts")
      .set("Authorization", `Bearer ${owner}`)
      .send({ name: "Ash Bakes", type: "business", organization: { name: "Ash Bakes" } });
    accountId = acc.body.id;
    cakeId = ((await h.http().get("/v1/public/catalog")).body as CatalogResponse).packageTypes.find(
      (p) => p.code === "cake_single",
    )!.id;
  });

  const asCustomer = () => ({ Authorization: `Bearer ${owner}`, "X-Account-Id": accountId });
  const asSuperAdmin = () => ({ Authorization: `Bearer ${superAdmin}`, "X-Account-Id": accountId });

  async function quote(headers: Record<string, string>): Promise<Quote> {
    const res = await h
      .http()
      .post("/v1/account/quotes")
      .set(headers)
      .send({
        serviceLevelCode: "standard",
        collection: {
          address: addr("Honey Bee, Menlyn", MENLYN),
          contact: { name: "Baker", phone: "0821111111", altPhone: null, email: null },
        },
        drops: [
          {
            address: addr("12 Oak St, Centurion", CENTURION),
            recipient: { name: "Jane", phone: "0821234567", email: null },
            parcels: [{ packageTypeId: cakeId, quantity: 1, weightKg: 2, description: null }],
          },
        ],
      });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body as Quote;
  }

  // ── reaching into someone else's account ──────────────────────────────────

  describe("reaching in", () => {
    it("lets a super admin read an account they do not belong to", async () => {
      const res = await h.http().get("/v1/account/wallet").set(asSuperAdmin());
      expect(res.status).toBe(200);
      expect((res.body as WalletSummary).accountId).toBe(accountId);
    });

    /*
      The portal has to be told, or it cannot put the banner up. It cannot ask with the
      account header either: the id comes out of a browser's localStorage, and a stale one
      would 403 the single request that tells the page who the user is -- locking somebody
      out of the app with no way back. So /v1/me takes the account as a query parameter and
      answers carefully.
    */
    it("tells a super admin whose account they are standing in", async () => {
      const res = await h
        .http()
        .get(`/v1/me?actingAs=${accountId}`)
        .set("Authorization", `Bearer ${superAdmin}`);
      expect(res.status).toBe(200);
      expect(res.body.actingAs).toMatchObject({ id: accountId, name: "Ash Bakes" });
      // Still not theirs, whatever they are doing inside it.
      expect(res.body.accounts).toEqual([]);
    });

    it("does not tell a customer the name of an account they can name", async () => {
      // Otherwise the parameter is a way to read any account's name out of a guessed id.
      const stranger = await h.tokenFor(USERS.bob);
      const res = await h
        .http()
        .get(`/v1/me?actingAs=${accountId}`)
        .set("Authorization", `Bearer ${stranger}`);
      expect(res.status).toBe(200);
      expect(res.body.actingAs).toBeNull();
    });

    it("says nothing when the account is the caller's own", async () => {
      // Acting as yourself is not acting as anyone, and a banner here would teach people to
      // ignore the banner that matters.
      const res = await h
        .http()
        .get(`/v1/me?actingAs=${accountId}`)
        .set("Authorization", `Bearer ${owner}`);
      expect(res.status).toBe(200);
      expect(res.body.actingAs).toBeNull();
      expect(res.body.accounts).toHaveLength(1);
    });

    it("shrugs off an account id that no longer exists", async () => {
      // A console left open while an account was closed. It must not break the page.
      const res = await h
        .http()
        .get("/v1/me?actingAs=00000000-0000-4000-8000-0000000000ff")
        .set("Authorization", `Bearer ${superAdmin}`);
      expect(res.status).toBe(200);
      expect(res.body.actingAs).toBeNull();
    });

    it("still refuses a customer who is not a member", async () => {
      // The staff bypass must not become a general one.
      const stranger = await h.tokenFor(USERS.bob);
      const res = await h
        .http()
        .get("/v1/account/wallet")
        .set({ Authorization: `Bearer ${stranger}`, "X-Account-Id": accountId });
      expect(res.status).toBe(403);
    });

    it("finds an account by name, because that is all ops are told on the phone", async () => {
      const other = await h.tokenFor(USERS.bob);
      await h
        .http()
        .post("/v1/accounts")
        .set("Authorization", `Bearer ${other}`)
        .send({
          name: "Honey Bee Patisserie",
          type: "business",
          organization: { name: "Honey Bee" },
        })
        .expect(201);

      const hit = await h
        .http()
        .get("/v1/admin/accounts?q=honey")
        .set("Authorization", `Bearer ${superAdmin}`)
        .expect(200);
      expect(hit.body.items.map((a: { name: string }) => a.name)).toEqual(["Honey Bee Patisserie"]);

      const miss = await h
        .http()
        .get("/v1/admin/accounts?q=%25")
        .set("Authorization", `Bearer ${superAdmin}`)
        .expect(200);
      // A bare wildcard is a name, not a query for everything.
      expect(miss.body.items).toEqual([]);
    });

    it("marks what staff write as done on the customer's behalf", async () => {
      // The question a disputed charge turns on: did the customer do this, or did we do it
      // for them? It is asked long after the request is gone, so it is stored.
      await wallet.adjust(accountId, 1_000_000, "funds");
      const q = await quote(asSuperAdmin());
      await h
        .http()
        .post("/v1/account/bookings")
        .set(asSuperAdmin())
        .send({ quoteId: q.id, slot: SLOT })
        .expect(201);

      const [row] = await h.db.db
        .select()
        .from(auditLog)
        .where(eq(auditLog.action, "booking.create"))
        .orderBy(desc(auditLog.createdAt))
        .limit(1);
      expect(row!.impersonated).toBe(true);
      expect(row!.actorUserId).toBe(USERS.admin.id);
      expect(row!.actorAccountId).toBe(accountId);
    });

    it("does not mark the customer's own actions", async () => {
      await wallet.adjust(accountId, 1_000_000, "funds");
      const q = await quote(asCustomer());
      await h
        .http()
        .post("/v1/account/bookings")
        .set(asCustomer())
        .send({ quoteId: q.id, slot: SLOT })
        .expect(201);

      const [row] = await h.db.db
        .select()
        .from(auditLog)
        .where(eq(auditLog.action, "booking.create"))
        .orderBy(desc(auditLog.createdAt))
        .limit(1);
      expect(row!.impersonated).toBe(false);
      expect(row!.actorUserId).toBe(USERS.alice.id);
    });
  });

  // ── booking past what the wallet holds ────────────────────────────────────

  describe("booking past the balance", () => {
    it("still refuses an ordinary booking the wallet cannot cover", async () => {
      const q = await quote(asCustomer());
      const res = await h
        .http()
        .post("/v1/account/bookings")
        .set(asCustomer())
        .send({ quoteId: q.id, slot: SLOT });
      expect(res.status).toBe(402);
      expect(res.body.code).toBe("insufficient_funds");
    });

    it("lets a super admin book anyway, taking the wallet negative", async () => {
      const q = await quote(asSuperAdmin());
      const res = await h
        .http()
        .post("/v1/account/bookings")
        .set(asSuperAdmin())
        .send({ quoteId: q.id, slot: SLOT, allowNegativeBalance: true });

      expect(res.status, JSON.stringify(res.body)).toBe(201);
      const booking = res.body as Booking;
      expect(booking.status).toBe("confirmed");

      // The money is held even though there was none, which is what going negative means.
      const summary = (await h.http().get("/v1/account/wallet").set(asSuperAdmin()))
        .body as WalletSummary;
      expect(summary.heldCents).toBe(booking.totalCents);
      expect(summary.availableCents).toBeLessThan(0);
    });

    it("refuses the override for a dispatcher rather than ignoring it", async () => {
      // Quietly dropping the flag is how somebody believes an order went through on credit
      // when it did not. It is a 403, not a silent 402.
      const q = await quote(asSuperAdmin());
      const res = await h
        .http()
        .post("/v1/account/bookings")
        .set({ Authorization: `Bearer ${dispatcher}`, "X-Account-Id": accountId })
        .send({ quoteId: q.id, slot: SLOT, allowNegativeBalance: true });

      expect(res.status).toBe(403);
    });

    it("refuses the override for the customer themselves", async () => {
      const q = await quote(asCustomer());
      const res = await h
        .http()
        .post("/v1/account/bookings")
        .set(asCustomer())
        .send({ quoteId: q.id, slot: SLOT, allowNegativeBalance: true });
      expect(res.status).toBe(403);
    });
  });

  // ── prepaid and postpaid ──────────────────────────────────────────────────

  describe("credit terms", () => {
    it("lets a postpaid account spend down to its credit limit without an override", async () => {
      // This is the ordinary way a balance goes negative: terms the business agreed, not an
      // override somebody reached for.
      await h
        .http()
        .put(`/v1/admin/accounts/${accountId}/credit-terms`)
        .set("Authorization", `Bearer ${superAdmin}`)
        .send({ billingMode: "postpaid", creditLimitCents: 500_000 })
        .expect(200);

      const q = await quote(asCustomer());
      await h
        .http()
        .post("/v1/account/bookings")
        .set(asCustomer())
        .send({ quoteId: q.id, slot: SLOT })
        .expect(201);

      const [w] = await h.db.db.select().from(wallets).where(eq(wallets.accountId, accountId));
      expect(w!.creditLimitCents).toBe(500_000);
      const summary = (await h.http().get("/v1/account/wallet").set(asCustomer()))
        .body as WalletSummary;
      expect(summary.billingMode).toBe("postpaid");
    });
  });
});
