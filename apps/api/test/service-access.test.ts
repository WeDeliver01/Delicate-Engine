import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { auditLog, bookings, quotes, users } from "@delicate/db";
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

const SLOT = { date: "2026-09-24", windowKey: "morning" };

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
            slot: { date: "2026-09-25", windowKey: "morning" },
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
      expect(ok.body.waybill).toMatch(/^DC-/);

      const without = await newClient({ slug: "no-labels", scopes: ["bookings:read"] });
      const denied = await h
        .http()
        .get(`/v1/service/shipments/${shipmentId}/waybill`)
        .set(asService(without.secret));
      expect(denied.status).toBe(403);
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
