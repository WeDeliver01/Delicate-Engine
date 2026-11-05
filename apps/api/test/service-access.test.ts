import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";
import { eq } from "drizzle-orm";
import { accounts, auditLog, blackoutDates, bookings, quotes, users } from "@delicate/db";
import type {
  Booking,
  CatalogResponse,
  ServiceBookingResponse,
  ServiceClientWithSecret,
} from "@delicate/contracts";
import { createHarness, USERS, type Harness } from "./harness.js";
import { WalletService } from "../src/modules/wallet/wallet.service.js";
import { Clock } from "../src/infra/clock.js";

const MENLYN = { lat: -25.7826, lng: 28.2755 };
const CENTURION = { lat: -25.8603, lng: 28.1894 };
const addr = (formatted: string, location: { lat: number; lng: number }, suburb = "Centurion") => ({
  formatted,
  line1: null,
  suburb,
  city: "Pretoria",
  postalCode: null,
  country: "ZA",
  location,
  placeId: null,
});

const SLOT = { date: "2026-09-24", windowKey: "std_morning" };

describe("service access", () => {
  let h: Harness;
  let wallet: WalletService;
  let owner: string;
  let admin: string;
  let accountId: string;
  let otherAccountId: string;
  let cakeId: string;

  beforeAll(async () => {
    h = await createHarness();
    wallet = h.app.get(WalletService);
    h.app.get(Clock).now = () => new Date("2026-09-23T07:00:00Z");
    owner = await h.tokenFor(USERS.alice);
    admin = await h.tokenFor(USERS.admin);
  });
  afterAll(() => h.close());

  beforeEach(async () => {
    await h.reset();
    await h.db.db.insert(users).values({ ...USERS.admin, platformRole: "super_admin" });
    accountId = await newAccount("Honey Bee", owner);
    otherAccountId = await newAccount("Someone Else", await h.tokenFor(USERS.bob));
    await wallet.adjust(accountId, 500_000, "test funds");
    cakeId = ((await h.http().get("/v1/public/catalog")).body as CatalogResponse).packageTypes.find(
      (p) => p.code === "cake_single",
    )!.id;
  });

  async function newAccount(name: string, token: string): Promise<string> {
    const res = await h
      .http()
      .post("/v1/accounts")
      .set("Authorization", `Bearer ${token}`)
      .send({ name, type: "business", organization: { name: `${name} Pty` } });
    expect(res.status).toBe(201);
    return res.body.id as string;
  }

  const asAdmin = () => ({ Authorization: `Bearer ${admin}` });

  /** The short code the engine issued this account, e.g. "HON001". */
  async function codeOf(id: string): Promise<string> {
    const row = await h.db.db.query.accounts.findFirst({
      where: eq(accounts.id, id),
      columns: { code: true },
    });
    return row!.code;
  }

  async function newClient(
    overrides: Partial<{ slug: string; scopes: string[]; accountIds: string[] }> = {},
  ): Promise<ServiceClientWithSecret> {
    const res = await h
      .http()
      .post("/v1/admin/service-clients")
      .set(asAdmin())
      .send({
        name: "Courier API",
        slug: overrides.slug ?? "courier-api",
        scopes: overrides.scopes ?? [
          "quotes:write",
          "bookings:write",
          "bookings:read",
          "bookings:cancel",
          "shipments:read",
        ],
        accountIds: overrides.accountIds ?? [accountId],
      });
    expect(res.status).toBe(201);
    return res.body as ServiceClientWithSecret;
  }

  const asService = (secret: string, account = accountId) => ({
    Authorization: `Bearer ${secret}`,
    "X-Account-Id": account,
  });

  function bookingBody(overrides: Record<string, unknown> = {}) {
    return {
      serviceLevelCode: "standard",
      collection: {
        address: addr("Honey Bee, Menlyn", MENLYN, "Menlyn"),
        contact: { name: "Baker", phone: "0821111111", email: null },
        instructions: null,
      },
      drops: [
        {
          address: addr("12 Oak St, Centurion", CENTURION),
          recipient: { name: "Jane", phone: "0821234567", email: null },
          instructions: null,
          parcels: [{ packageTypeId: cakeId, quantity: 1, weightKg: 4, description: "Cake" }],
        },
      ],
      options: {},
      slot: SLOT,
      idempotencyKey: "WC-49905",
      customerReference: "WC-49905",
      ...overrides,
    };
  }

  // ── issuing credentials ─────────────────────────────────────────────────────

  describe("issuing", () => {
    it("shows the secret once, stores only a hash, and audits the issue", async () => {
      const client = await newClient();
      expect(client.secret).toMatch(/^dsk_[0-9a-f]{16}_/);
      expect(client.secretHint).toBe(client.secret.slice(-4));

      // Nothing readable afterwards carries the secret.
      const listed = await h.http().get("/v1/admin/service-clients").set(asAdmin());
      expect(listed.body.items[0]).not.toHaveProperty("secret");
      expect(listed.body.items[0].keyId).toBe(client.keyId);

      const rows = await h.db.db
        .select()
        .from(auditLog)
        .where(eq(auditLog.action, "service_client.create"));
      expect(rows).toHaveLength(1);
      expect(rows[0]!.actorUserId).toBe(USERS.admin.id);
      expect(JSON.stringify(rows[0]!.after)).not.toContain(client.secret);
    });

    it("is super_admin only — finance and dispatch cannot let a system in", async () => {
      await h.db.db
        .update(users)
        .set({ platformRole: "finance" })
        .where(eq(users.id, USERS.admin.id));
      const res = await h
        .http()
        .post("/v1/admin/service-clients")
        .set(asAdmin())
        .send({ name: "X", slug: "x-api", scopes: ["bookings:write"], accountIds: [] });
      expect(res.status).toBe(403);
    });

    it("refuses a duplicate slug", async () => {
      await newClient();
      const res = await h
        .http()
        .post("/v1/admin/service-clients")
        .set(asAdmin())
        .send({ name: "Another", slug: "courier-api", scopes: ["bookings:write"], accountIds: [] });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe("slug_taken");
    });
  });

  // ── authentication ──────────────────────────────────────────────────────────

  describe("authentication", () => {
    it("accepts a valid credential and books for the granted account", async () => {
      const client = await newClient();
      const res = await h
        .http()
        .post("/v1/service/bookings")
        .set(asService(client.secret))
        .send(bookingBody());
      expect(res.status).toBe(201);
      expect((res.body as ServiceBookingResponse).booking.accountId).toBe(accountId);
    });

    /*
      A real integration failed on exactly this for every order it ever sent.

      The caller is a .NET service, and its serialiser writes a nullable property with no value
      as an explicit `null` rather than leaving the key out. `z.optional()` accepts only a
      missing key, so `"slot": null` -- which means the same thing -- was a 422. Every booking
      from that plugin was refused, and the only clue downstream was the string "request failed
      validation", because the caller logged the message and discarded the issue list.
    */
    it("treats an explicitly null optional field as absent, the way other languages send it", async () => {
      const client = await newClient();
      const res = await h
        .http()
        .post("/v1/service/bookings")
        .set(asService(client.secret))
        .send({
          ...bookingBody(),
          // On-demand needs no slot, and this caller says so with a null rather than a gap.
          serviceLevelCode: "on_demand",
          slot: null,
          maxTotalCents: null,
          quoteId: null,
          customerReference: null,
          options: null,
        });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
    });

    it("still enforces a price ceiling that was actually given", async () => {
      // The null handling must not quietly disable the guard when a number is sent.
      const client = await newClient();
      const res = await h
        .http()
        .post("/v1/service/bookings")
        .set(asService(client.secret))
        .send({ ...bookingBody(), maxTotalCents: 1 });
      expect(res.status).toBe(409);
    });

    it("books a standard delivery from a date and a time, without knowing our window names", async () => {
      // What a checkout actually has. Requiring `windowKey` makes every caller hard-code our
      // window names and break when we add one.
      const client = await newClient();
      const res = await h
        .http()
        .post("/v1/service/bookings")
        .set(asService(client.secret))
        .send({ ...bookingBody(), slot: { date: SLOT.date, time: "09:30" } });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      // 09:30 sits in the morning band, not the late one: the earliest match wins.
      expect((res.body as ServiceBookingResponse).booking.slotWindowKey).toBe("std_morning");
    });

    it("says which windows exist when the time falls outside all of them", async () => {
      const client = await newClient();
      const res = await h
        .http()
        .post("/v1/service/bookings")
        .set(asService(client.secret))
        .send({ ...bookingBody(), slot: { date: SLOT.date, time: "23:30" } });
      expect(res.status).toBe(422);
      // Naming the windows is the point: the caller cannot guess, and silently moving the
      // delivery to a time nobody asked for is worse than refusing.
      expect(JSON.stringify(res.body.details)).toContain("outside every standard window");
    });

    it("takes an already-sold order into a window that is full", async () => {
      // A checkout has taken the customer's money before we hear about it. Refusing leaves
      // somebody else to explain a cancellation we caused.
      const client = await newClient();
      const capacity = 6;
      for (let i = 0; i < capacity; i += 1) {
        const fill = await h
          .http()
          .post("/v1/service/bookings")
          .set(asService(client.secret))
          .send({ ...bookingBody(), idempotencyKey: `FILL-${i}-0000`, slot: SLOT });
        expect(fill.status, JSON.stringify(fill.body)).toBe(201);
      }

      const overflow = await h
        .http()
        .post("/v1/service/bookings")
        .set(asService(client.secret))
        .send({ ...bookingBody(), idempotencyKey: "OVERFLOW-0001", slot: SLOT });
      expect(overflow.status, JSON.stringify(overflow.body)).toBe(201);
    });

    it("still refuses a day we are closed, which overbooking cannot solve", async () => {
      const client = await newClient();
      await h.db.db.insert(blackoutDates).values({ date: SLOT.date, reason: "public holiday" });
      const res = await h
        .http()
        .post("/v1/service/bookings")
        .set(asService(client.secret))
        .send({ ...bookingBody(), idempotencyKey: "CLOSED-0001", slot: SLOT });
      expect(res.status).toBe(409);
      expect(res.body.details.reason).toBe("blackout");
    });

    it("rejects a wrong secret the same way as an unknown key", async () => {
      const client = await newClient();
      const tampered = `${client.secret.slice(0, -4)}zzzz`;
      const wrong = await h
        .http()
        .post("/v1/service/bookings")
        .set(asService(tampered))
        .send(bookingBody());
      const unknown = await h
        .http()
        .post("/v1/service/bookings")
        .set(asService("dsk_0123456789abcdef_" + "a".repeat(43)))
        .send(bookingBody());
      expect(wrong.status).toBe(401);
      expect(unknown.status).toBe(401);
      expect(wrong.body.message).toBe(unknown.body.message);
    });

    it("stops working the moment the credential is revoked", async () => {
      const client = await newClient();
      await h
        .http()
        .post(`/v1/admin/service-clients/${client.id}/revoke`)
        .set(asAdmin())
        .expect(201);
      const res = await h
        .http()
        .post("/v1/service/bookings")
        .set(asService(client.secret))
        .send(bookingBody());
      expect(res.status).toBe(401);
    });

    it("rotating issues a new secret and kills the old one", async () => {
      const client = await newClient();
      const rotated = await h
        .http()
        .post(`/v1/admin/service-clients/${client.id}/rotate`)
        .set(asAdmin());
      const next = rotated.body as ServiceClientWithSecret;
      expect(next.secret).not.toBe(client.secret);

      const old = await h
        .http()
        .post("/v1/service/bookings")
        .set(asService(client.secret))
        .send(bookingBody());
      expect(old.status).toBe(401);

      const fresh = await h
        .http()
        .post("/v1/service/bookings")
        .set(asService(next.secret))
        .send(bookingBody());
      expect(fresh.status).toBe(201);
    });

    it("refuses an account it was never granted", async () => {
      const client = await newClient();
      const res = await h
        .http()
        .post("/v1/service/bookings")
        .set(asService(client.secret, otherAccountId))
        .send(bookingBody());
      expect(res.status).toBe(403);
    });

    it("cannot reach a route that does not name scopes, even holding every scope", async () => {
      const client = await newClient();
      // A portal route and an admin route: neither was written for machine callers.
      const portal = await h.http().get("/v1/account/bookings").set(asService(client.secret));
      const adminRoute = await h.http().get("/v1/admin/accounts").set(asService(client.secret));
      expect(portal.status).toBe(403);
      expect(adminRoute.status).toBe(403);
    });

    it("enforces scopes per route", async () => {
      const client = await newClient({ scopes: ["quotes:write"] });
      const quoted = await h
        .http()
        .post("/v1/service/quotes")
        .set(asService(client.secret))
        .send({ ...bookingBody(), slot: undefined, idempotencyKey: undefined });
      expect(quoted.status).toBe(201);

      const booked = await h
        .http()
        .post("/v1/service/bookings")
        .set(asService(client.secret))
        .send(bookingBody());
      expect(booked.status).toBe(403);
      expect(booked.body.details.missing).toEqual(["bookings:write"]);
    });

    it("attributes the booking and its audit row to the credential, not to a person", async () => {
      const client = await newClient();
      await h
        .http()
        .post("/v1/service/bookings")
        .set(asService(client.secret))
        .send(bookingBody())
        .expect(201);

      const [row] = await h.db.db.select().from(bookings).where(eq(bookings.accountId, accountId));
      expect(row!.createdByServiceClientId).toBe(client.id);
      expect(row!.createdByUserId).toBeNull();

      const [entry] = await h.db.db
        .select()
        .from(auditLog)
        .where(eq(auditLog.action, "booking.create"));
      expect(entry!.actorServiceClientId).toBe(client.id);
      expect(entry!.actorUserId).toBeNull();
    });
  });

  // ── account mapping ─────────────────────────────────────────────────────────

  describe("account references", () => {
    it("resolves the caller's own identifier to an account", async () => {
      const client = await newClient();
      await h
        .http()
        .post("/v1/admin/account-external-refs")
        .set(asAdmin())
        .send({ accountId, system: "courier-api", externalId: "store-42" })
        .expect(201);

      const res = await h
        .http()
        .post("/v1/service/bookings")
        .set({ Authorization: `Bearer ${client.secret}`, "X-Account-Ref": "store-42" })
        .send(bookingBody());
      expect(res.status).toBe(201);
      expect((res.body as ServiceBookingResponse).booking.accountId).toBe(accountId);
    });

    it("will not resolve a reference belonging to another system's namespace", async () => {
      const client = await newClient({ slug: "courier-api" });
      await h
        .http()
        .post("/v1/admin/account-external-refs")
        .set(asAdmin())
        .send({ accountId, system: "some-other-system", externalId: "store-42" })
        .expect(201);

      const res = await h
        .http()
        .post("/v1/service/bookings")
        .set({ Authorization: `Bearer ${client.secret}`, "X-Account-Ref": "store-42" })
        .send(bookingBody());
      expect(res.status).toBe(403);
    });

    it("resolves an account by its own code, with nothing mapped at all", async () => {
      // The whole point: onboarding a merchant should not need a row written by hand.
      const client = await newClient();
      const res = await h
        .http()
        .post("/v1/service/bookings")
        .set({ Authorization: `Bearer ${client.secret}`, "X-Account-Ref": await codeOf(accountId) })
        .send(bookingBody());
      expect(res.status).toBe(201);
      expect((res.body as ServiceBookingResponse).booking.accountId).toBe(accountId);
    });

    it("understands a code whatever case it arrives in", async () => {
      const client = await newClient();
      const res = await h
        .http()
        .post("/v1/service/bookings")
        .set({
          Authorization: `Bearer ${client.secret}`,
          "X-Account-Ref": (await codeOf(accountId)).toLowerCase(),
        })
        .send(bookingBody());
      expect(res.status).toBe(201);
    });

    it("still refuses a code the credential was never granted", async () => {
      // Codes are short and guessable, which is fine: naming an account is not being allowed
      // to use it. If this ever goes green, resolving by code has become an authorisation
      // hole and the grant check is no longer doing its job.
      const client = await newClient({ accountIds: [accountId] });
      const res = await h
        .http()
        .post("/v1/service/bookings")
        .set({
          Authorization: `Bearer ${client.secret}`,
          "X-Account-Ref": await codeOf(otherAccountId),
        })
        .send(bookingBody());
      expect(res.status).toBe(403);
    });

    it("lets a registered mapping win over a code it collides with", async () => {
      const borrowed = await codeOf(otherAccountId);
      await h
        .http()
        .post("/v1/admin/account-external-refs")
        .set(asAdmin())
        .send({ accountId, system: "courier-api", externalId: borrowed })
        .expect(201);

      const client = await newClient({ accountIds: [accountId, otherAccountId] });
      const res = await h
        .http()
        .post("/v1/service/bookings")
        .set({ Authorization: `Bearer ${client.secret}`, "X-Account-Ref": borrowed })
        .send(bookingBody());
      expect(res.status).toBe(201);
      // The mapping, not the account that happens to wear that code.
      expect((res.body as ServiceBookingResponse).booking.accountId).toBe(accountId);
    });

    it("refuses to point one reference at two accounts", async () => {
      await h
        .http()
        .post("/v1/admin/account-external-refs")
        .set(asAdmin())
        .send({ accountId, system: "courier-api", externalId: "store-42" })
        .expect(201);
      const res = await h
        .http()
        .post("/v1/admin/account-external-refs")
        .set(asAdmin())
        .send({ accountId: otherAccountId, system: "courier-api", externalId: "store-42" });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe("external_ref_taken");
    });
  });

  // ── granting from the account side ──────────────────────────────────────────

  describe("integration access per account", () => {
    it("reports the code and who may act for the account", async () => {
      const client = await newClient({ accountIds: [] });
      const res = await h
        .http()
        .get(`/v1/admin/accounts/${accountId}/integration`)
        .set(asAdmin())
        .expect(200);
      expect(res.body.code).toBe(await codeOf(accountId));
      const svc = res.body.services.find((x: { id: string }) => x.id === client.id);
      expect(svc.granted).toBe(false);
    });

    it("grants one account without disturbing the others", async () => {
      // The whole reason this exists: PATCH accountIds replaces the list, so adding the
      // second merchant through it silently revokes the first.
      const client = await newClient({ accountIds: [otherAccountId] });
      await h
        .http()
        .put(`/v1/admin/accounts/${accountId}/integration/${client.id}`)
        .set(asAdmin())
        .send({ granted: true })
        .expect(200);

      const after = await h.http().get(`/v1/admin/service-clients/${client.id}`).set(asAdmin());
      expect([...(after.body.accountIds as string[])].sort()).toEqual(
        [accountId, otherAccountId].sort(),
      );
    });

    it("revokes just as narrowly, and is safe to repeat", async () => {
      const client = await newClient({ accountIds: [accountId, otherAccountId] });
      const url = `/v1/admin/accounts/${accountId}/integration/${client.id}`;
      await h.http().put(url).set(asAdmin()).send({ granted: false }).expect(200);
      await h.http().put(url).set(asAdmin()).send({ granted: false }).expect(200);

      const after = await h.http().get(`/v1/admin/service-clients/${client.id}`).set(asAdmin());
      expect(after.body.accountIds).toEqual([otherAccountId]);
    });

    it("takes effect on the next call, not the next deploy", async () => {
      const client = await newClient({ accountIds: [] });
      const ref = {
        Authorization: `Bearer ${client.secret}`,
        "X-Account-Ref": await codeOf(accountId),
      };

      const before = await h.http().post("/v1/service/bookings").set(ref).send(bookingBody());
      expect(before.status).toBe(403);

      await h
        .http()
        .put(`/v1/admin/accounts/${accountId}/integration/${client.id}`)
        .set(asAdmin())
        .send({ granted: true })
        .expect(200);

      const after = await h.http().post("/v1/service/bookings").set(ref).send(bookingBody());
      expect(after.status).toBe(201);
    });

    it("records who opened the door", async () => {
      const client = await newClient({ accountIds: [] });
      await h
        .http()
        .put(`/v1/admin/accounts/${accountId}/integration/${client.id}`)
        .set(asAdmin())
        .send({ granted: true })
        .expect(200);

      const [entry] = await h.db.db
        .select()
        .from(auditLog)
        .where(eq(auditLog.action, "service_client.account_grant"));
      expect(entry!.entityId).toBe(accountId);
      expect(entry!.actorUserId).toBe(USERS.admin.id);
    });

    it("will not let finance or dispatch change it", async () => {
      const client = await newClient({ accountIds: [] });
      const res = await h
        .http()
        .put(`/v1/admin/accounts/${accountId}/integration/${client.id}`)
        .set({ Authorization: `Bearer ${owner}` })
        .send({ granted: true });
      expect(res.status).toBe(403);
    });
  });

  // ── the retry semantics that the whole adapter exists for ───────────────────

  describe("booking in one call", () => {
    it("quotes and books in one request, against a real persisted quote", async () => {
      const client = await newClient();
      const res = await h
        .http()
        .post("/v1/service/bookings")
        .set(asService(client.secret))
        .send(bookingBody());
      expect(res.status).toBe(201);
      const body = res.body as ServiceBookingResponse;
      expect(body.replayed).toBe(false);
      expect(body.booking.status).toBe("confirmed");
      expect(body.booking.shipments).toHaveLength(1);
      expect(body.booking.customerReference).toBe("WC-49905");
      expect(body.quote.breakdown.totalCents).toBe(body.booking.totalCents);

      const stored = await h.db.db.select().from(quotes).where(eq(quotes.id, body.quote.id));
      expect(stored[0]!.status).toBe("booked");
    });

    it("returns the same booking on a retry instead of booking twice", async () => {
      const client = await newClient();
      const first = await h
        .http()
        .post("/v1/service/bookings")
        .set(asService(client.secret))
        .send(bookingBody());
      const second = await h
        .http()
        .post("/v1/service/bookings")
        .set(asService(client.secret))
        .send(bookingBody());

      expect(first.status).toBe(201);
      expect(second.status).toBe(201);
      expect((second.body as ServiceBookingResponse).replayed).toBe(true);
      expect((second.body as ServiceBookingResponse).booking.id).toBe(
        (first.body as ServiceBookingResponse).booking.id,
      );

      const rows = await h.db.db.select().from(bookings).where(eq(bookings.accountId, accountId));
      expect(rows).toHaveLength(1);
    });

    it("does not pay for a quote on a retry it is only going to discard", async () => {
      const client = await newClient();
      await h
        .http()
        .post("/v1/service/bookings")
        .set(asService(client.secret))
        .send(bookingBody())
        .expect(201);
      const afterFirst = await h.db.db.select().from(quotes);

      await h
        .http()
        .post("/v1/service/bookings")
        .set(asService(client.secret))
        .send(bookingBody())
        .expect(201);
      const afterSecond = await h.db.db.select().from(quotes);
      expect(afterSecond).toHaveLength(afterFirst.length);
    });

    it("books the quote the caller showed its customer, at that price", async () => {
      const client = await newClient();
      const quoted = await h
        .http()
        .post("/v1/service/quotes")
        .set(asService(client.secret))
        .send({ ...bookingBody(), slot: undefined, idempotencyKey: undefined });
      expect(quoted.status).toBe(201);

      const res = await h
        .http()
        .post("/v1/service/bookings")
        .set(asService(client.secret))
        .send(bookingBody({ quoteId: quoted.body.id }));
      expect(res.status).toBe(201);
      const body = res.body as ServiceBookingResponse;
      expect(body.quote.id).toBe(quoted.body.id);
      expect(body.booking.totalCents).toBe(quoted.body.breakdown.totalCents);
    });

    it("re-prices instead of failing when the caller's quote has expired", async () => {
      const client = await newClient();
      const clock = h.app.get(Clock);
      const start = new Date("2026-09-23T07:00:00Z");

      // Price it, then let a day pass before it is booked — which is what a job retrying
      // across 24 hours does on almost every attempt.
      const quoted = await h
        .http()
        .post("/v1/service/quotes")
        .set(asService(client.secret))
        .send({ ...bookingBody(), slot: undefined, idempotencyKey: undefined });
      expect(quoted.status).toBe(201);
      clock.now = () => new Date(start.getTime() + 25 * 60 * 60 * 1000);

      const res = await h
        .http()
        .post("/v1/service/bookings")
        .set(asService(client.secret))
        .send(
          bookingBody({
            quoteId: quoted.body.id,
            slot: { date: "2026-09-25", windowKey: "std_morning" },
          }),
        );
      clock.now = () => start;

      expect(res.status).toBe(201);
      const body = res.body as ServiceBookingResponse;
      expect(body.booking.status).toBe("confirmed");
      // A new quote, priced now — the expired one is never revived in place.
      expect(body.quote.id).not.toBe(quoted.body.id);

      // And no rejection row: this was re-priced, not turned away.
      const rows = await h.db.db.select().from(bookings).where(eq(bookings.accountId, accountId));
      expect(rows.map((r) => r.status)).toEqual(["confirmed"]);
    });

    it("returns the existing booking when the caller's quote was already used", async () => {
      const client = await newClient();
      const quoted = await h
        .http()
        .post("/v1/service/quotes")
        .set(asService(client.secret))
        .send({ ...bookingBody(), slot: undefined, idempotencyKey: undefined });

      const first = await h
        .http()
        .post("/v1/account/bookings")
        .set({ Authorization: `Bearer ${owner}`, "X-Account-Id": accountId })
        .send({ quoteId: quoted.body.id, slot: SLOT, idempotencyKey: "booked-elsewhere" });
      expect(first.status).toBe(201);

      // Same quote, different idempotency key: the quote is gone but the work is done.
      const res = await h
        .http()
        .post("/v1/service/bookings")
        .set(asService(client.secret))
        .send(bookingBody({ quoteId: quoted.body.id }));
      expect(res.status).toBe(201);
      const body = res.body as ServiceBookingResponse;
      expect(body.replayed).toBe(true);
      expect(body.booking.id).toBe((first.body as Booking).id);

      const rows = await h.db.db.select().from(bookings).where(eq(bookings.accountId, accountId));
      expect(rows).toHaveLength(1);
    });

    it("refuses when the price has risen above what the caller said it could accept", async () => {
      const client = await newClient();
      const res = await h
        .http()
        .post("/v1/service/bookings")
        .set(asService(client.secret))
        .send(bookingBody({ maxTotalCents: 1 }));
      expect(res.status).toBe(409);
      expect(res.body.code).toBe("price_above_limit");

      const rows = await h.db.db.select().from(bookings).where(eq(bookings.accountId, accountId));
      expect(rows).toHaveLength(0);
    });

    it("finds a booking again by the caller's own reference, exactly", async () => {
      const client = await newClient();
      const made = await h
        .http()
        .post("/v1/service/bookings")
        .set(asService(client.secret))
        .send(bookingBody())
        .expect(201);

      const found = await h
        .http()
        .get("/v1/service/bookings/by-customer-reference?customerReference=WC-49905")
        .set(asService(client.secret));
      expect(found.status).toBe(200);
      expect((found.body as Booking).id).toBe((made.body as ServiceBookingResponse).booking.id);

      // A near miss is a miss: a prefix must not attach somebody else's delivery to an order.
      const near = await h
        .http()
        .get("/v1/service/bookings/by-customer-reference?customerReference=WC-4990")
        .set(asService(client.secret));
      expect(near.status).toBe(404);
    });

    it("will not find another account's booking by reference", async () => {
      const client = await newClient({ accountIds: [accountId, otherAccountId] });
      await h
        .http()
        .post("/v1/service/bookings")
        .set(asService(client.secret))
        .send(bookingBody())
        .expect(201);

      const res = await h
        .http()
        .get("/v1/service/bookings/by-customer-reference?customerReference=WC-49905")
        .set(asService(client.secret, otherAccountId));
      expect(res.status).toBe(404);
    });
  });

  describe("labels", () => {
    it("serves the waybill to a credential holding labels:read, and not otherwise", async () => {
      const withLabels = await newClient({
        slug: "with-labels",
        scopes: ["bookings:write", "labels:read"],
      });
      const made = await h
        .http()
        .post("/v1/service/bookings")
        .set(asService(withLabels.secret))
        .send(bookingBody())
        .expect(201);
      const shipmentId = (made.body as ServiceBookingResponse).booking.shipments[0]!.id;

      const ok = await h
        .http()
        .get(`/v1/service/shipments/${shipmentId}/waybill`)
        .set(asService(withLabels.secret));
      expect(ok.status).toBe(200);
      expect(ok.body.waybill).toMatch(/^[A-Z2-9]{6}$/);

      const without = await newClient({ slug: "no-labels", scopes: ["bookings:read"] });
      const denied = await h
        .http()
        .get(`/v1/service/shipments/${shipmentId}/waybill`)
        .set(asService(without.secret));
      expect(denied.status).toBe(403);
    });
  });

  describe("telling another system what happened", () => {
    /** Stands in for the merchant's own endpoint, and records what arrived at it. */
    function receiver(respondWith = 200) {
      const calls: { body: string; headers: Record<string, string> }[] = [];
      const fetchMock = vi.fn(async (_url: unknown, init: RequestInit) => {
        calls.push({
          body: String(init.body),
          headers: init.headers as Record<string, string>,
        });
        return new Response("", { status: respondWith });
      });
      vi.spyOn(globalThis, "fetch").mockImplementation(fetchMock as unknown as typeof fetch);
      return calls;
    }

    async function subscribe(serviceClientId: string, eventTypes: string[] = []) {
      const res = await h
        .http()
        .post("/v1/admin/webhook-subscriptions")
        .set(asAdmin())
        .send({ serviceClientId, url: "https://merchant.example/hooks/delicate", eventTypes });
      expect(res.status).toBe(201);
      return res.body as { id: string; secret: string };
    }

    /** Book, then move the shipment on, then let the outbox run. */
    async function bookAndAdvance(secret: string, to = "collected") {
      const made = await h
        .http()
        .post("/v1/service/bookings")
        .set(asService(secret))
        .send(bookingBody())
        .expect(201);
      const shipmentId = (made.body as ServiceBookingResponse).booking.shipments[0]!.id;

      await h
        .http()
        .post(`/v1/admin/dispatch/shipments/${shipmentId}/status`)
        .set(asAdmin())
        .send({ status: to })
        .expect(201);

      await h.dispatcher.tick();
      return shipmentId;
    }

    afterEach(() => vi.restoreAllMocks());

    it("posts a signed delivery when a shipment moves", async () => {
      const client = await newClient();
      const subscription = await subscribe(client.id);
      const calls = receiver();

      const shipmentId = await bookAndAdvance(client.secret);

      const call = calls.find((c) => c.body.includes("shipment.status_changed"));
      expect(call).toBeTruthy();

      const body = JSON.parse(call!.body);
      expect(body.type).toBe("shipment.status_changed");
      expect(body.data.shipmentId).toBe(shipmentId);
      expect(body.data.to).toBe("collected");
      expect(body.accountId).toBe(accountId);
      expect(body.id).toMatch(/^[0-9a-f-]{36}$/);

      // Signed over the exact bytes, so the receiver can verify what it actually got.
      const expected = createHmac("sha256", subscription.secret)
        .update(call!.body)
        .digest("base64");
      expect(call!.headers["x-delicate-signature"]).toBe(expected);
      expect(call!.headers["x-delicate-delivery"]).toBe(body.id);
      expect(call!.headers["x-delicate-event"]).toBe("shipment.status_changed");
    });

    it("sends nothing to a subscription that did not ask for this event", async () => {
      const client = await newClient();
      await subscribe(client.id, ["delivery.completed"]);
      const calls = receiver();

      await bookAndAdvance(client.secret);

      expect(calls.filter((c) => c.body.includes("shipment.status_changed"))).toHaveLength(0);
    });

    it("records the failure when a receiver refuses, and keeps the subscription", async () => {
      const client = await newClient();
      await subscribe(client.id);
      receiver(500);

      await bookAndAdvance(client.secret);

      const listed = await h.http().get("/v1/admin/webhook-subscriptions").set(asAdmin());
      const subscription = listed.body.items[0];
      expect(subscription.consecutiveFailures).toBeGreaterThan(0);
      expect(subscription.lastFailureReason).toContain("500");
      // One bad delivery is a bad moment, not a reason to stop telling them anything.
      expect(subscription.status).toBe("active");
    });

    it("never leaks the signing secret back out of the admin list", async () => {
      const client = await newClient();
      const created = await subscribe(client.id);
      const listed = await h.http().get("/v1/admin/webhook-subscriptions").set(asAdmin());

      expect(created.secret).toMatch(/^whsec_/);
      expect(listed.body.items[0]).not.toHaveProperty("secret");
      expect(JSON.stringify(listed.body)).not.toContain(created.secret);
    });
  });

  describe("a quote is used once", () => {
    it("refuses a second booking of the same quote with quote_used", async () => {
      const client = await newClient();
      const quoted = await h
        .http()
        .post("/v1/service/quotes")
        .set(asService(client.secret))
        .send({ ...bookingBody(), slot: undefined, idempotencyKey: undefined });

      const first = await h
        .http()
        .post("/v1/account/bookings")
        .set({ Authorization: `Bearer ${owner}`, "X-Account-Id": accountId })
        .send({ quoteId: quoted.body.id, slot: SLOT, idempotencyKey: "first-attempt" });
      expect(first.status).toBe(201);

      const second = await h
        .http()
        .post("/v1/account/bookings")
        .set({ Authorization: `Bearer ${owner}`, "X-Account-Id": accountId })
        .send({ quoteId: quoted.body.id, slot: SLOT, idempotencyKey: "second-attempt" });
      expect(second.status).toBe(409);
      expect(second.body.code).toBe("quote_used");
    });
  });
});
