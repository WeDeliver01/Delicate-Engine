import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { auditLog, outboxMessages, users } from "@delicate/db";
import { createHarness, USERS, type Harness } from "./harness.js";

describe("identity & accounts", () => {
  let h: Harness;
  let alice: string;
  let bob: string;

  beforeAll(async () => {
    h = await createHarness();
    alice = await h.tokenFor(USERS.alice);
    bob = await h.tokenFor(USERS.bob);
  });
  afterAll(() => h.close());
  beforeEach(() => h.reset());

  it("rejects requests without a token with the standard error shape", async () => {
    const res = await h.http().get("/v1/me");
    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ statusCode: 401, code: "unauthorized" });
    expect(res.headers["x-request-id"]).toBeTruthy();
  });

  it("provisions a user just-in-time on first request", async () => {
    const res = await h.http().get("/v1/me").set("Authorization", `Bearer ${alice}`);
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({
      id: USERS.alice.id,
      email: USERS.alice.email,
      platformRole: null,
    });
    expect(res.body.accounts).toEqual([]);
    const row = await h.db.db.query.users.findFirst({ where: eq(users.id, USERS.alice.id) });
    expect(row?.email).toBe(USERS.alice.email);
  });

  /*
    Sign-up carries a name: our own form passes one through Supabase's `signUp`, and Google
    supplies one from the profile. Both arrive as `user_metadata` on the token, and if nobody
    reads it the portal greets every new customer by email address forever.
  */
  it("takes the name from the token when it provisions a new user", async () => {
    const token = await h.tokenFor({ ...USERS.bob, fullName: "Thandi Mokoena" });
    const res = await h.http().get("/v1/me").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.user.fullName).toBe("Thandi Mokoena");
  });

  it("fills in a name it did not have, and then leaves it alone", async () => {
    // Provisioned before we read the claim, or signed up with a password and linked Google
    // later: either way the row has no name and the token does.
    await h.http().get("/v1/me").set("Authorization", `Bearer ${bob}`).expect(200);
    let row = await h.db.db.query.users.findFirst({ where: eq(users.id, USERS.bob.id) });
    expect(row?.fullName).toBeNull();

    const named = await h.tokenFor({ ...USERS.bob, fullName: "Thandi Mokoena" });
    await h.http().get("/v1/me").set("Authorization", `Bearer ${named}`).expect(200);
    row = await h.db.db.query.users.findFirst({ where: eq(users.id, USERS.bob.id) });
    expect(row?.fullName).toBe("Thandi Mokoena");

    // The profile is ours once it is set. A provider that changes its mind about someone's
    // name must not quietly overwrite what they typed on their own profile page.
    await h
      .http()
      .patch("/v1/me")
      .set("Authorization", `Bearer ${named}`)
      .send({ fullName: "T. Mokoena" })
      .expect(200);
    const renamed = await h.tokenFor({ ...USERS.bob, fullName: "Thandi Mokoena" });
    const after = await h.http().get("/v1/me").set("Authorization", `Bearer ${renamed}`);
    expect(after.body.user.fullName).toBe("T. Mokoena");
  });

  it("creates a business account with its organization, audit rows and outbox events atomically", async () => {
    const res = await h
      .http()
      .post("/v1/accounts")
      .set("Authorization", `Bearer ${alice}`)
      .send({
        name: "Honey Bee – Menlyn",
        type: "business",
        organization: { name: "Honey Bee Bakers" },
      });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      name: "Honey Bee – Menlyn",
      type: "business",
      role: "customer_owner",
    });
    expect(res.body.organizationId).toBeTruthy();

    const events = await h.db.db.select().from(outboxMessages);
    expect(events.map((e) => e.eventType).sort()).toEqual([
      "account.created",
      "membership.granted",
    ]);
    expect(events.every((e) => e.status === "pending")).toBe(true);

    const audits = await h.db.db.select().from(auditLog);
    expect(audits.map((a) => a.action).sort()).toEqual(["account.create", "organization.create"]);
    expect(audits[0]?.actorUserId).toBe(USERS.alice.id);
  });

  it("lets a business owner open a second account in the same organization, but not a stranger", async () => {
    const first = await h
      .http()
      .post("/v1/accounts")
      .set("Authorization", `Bearer ${alice}`)
      .send({ name: "Menlyn", type: "business", organization: { name: "Honey Bee Bakers" } });
    const orgId = first.body.organizationId;

    const second = await h
      .http()
      .post("/v1/accounts")
      .set("Authorization", `Bearer ${alice}`)
      .send({ name: "Centurion", type: "business", organization: { id: orgId } });
    expect(second.status).toBe(201);
    expect(second.body.organizationId).toBe(orgId);

    const me = await h.http().get("/v1/me").set("Authorization", `Bearer ${alice}`);
    expect(me.body.accounts).toHaveLength(2);

    const stranger = await h
      .http()
      .post("/v1/accounts")
      .set("Authorization", `Bearer ${bob}`)
      .send({ name: "Hijack", type: "business", organization: { id: orgId } });
    expect(stranger.status).toBe(403);
  });

  it("allows exactly one personal account per user", async () => {
    const ok = await h
      .http()
      .post("/v1/accounts")
      .set("Authorization", `Bearer ${bob}`)
      .send({ name: "Bob", type: "individual" });
    expect(ok.status).toBe(201);
    const dup = await h
      .http()
      .post("/v1/accounts")
      .set("Authorization", `Bearer ${bob}`)
      .send({ name: "Bob 2", type: "individual" });
    expect(dup.status).toBe(409);
    expect(dup.body.code).toBe("individual_account_exists");
  });

  it("returns 422 with issues for an invalid body", async () => {
    const res = await h
      .http()
      .post("/v1/accounts")
      .set("Authorization", `Bearer ${alice}`)
      .send({ name: "x", type: "nope" });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe("validation_failed");
    expect(Array.isArray(res.body.details)).toBe(true);
  });

  describe("active account & members", () => {
    let accountId: string;

    beforeEach(async () => {
      const res = await h
        .http()
        .post("/v1/accounts")
        .set("Authorization", `Bearer ${alice}`)
        .send({ name: "Menlyn", type: "business", organization: { name: "Honey Bee Bakers" } });
      accountId = res.body.id;
      // bob must exist (signed in once) before he can be added
      await h.http().get("/v1/me").set("Authorization", `Bearer ${bob}`);
    });

    it("requires X-Account-Id for account-scoped routes and enforces membership", async () => {
      const missing = await h.http().get("/v1/account").set("Authorization", `Bearer ${alice}`);
      expect(missing.status).toBe(403);

      const notMember = await h
        .http()
        .get("/v1/account")
        .set("Authorization", `Bearer ${bob}`)
        .set("X-Account-Id", accountId);
      expect(notMember.status).toBe(403);

      const ok = await h
        .http()
        .get("/v1/account")
        .set("Authorization", `Bearer ${alice}`)
        .set("X-Account-Id", accountId);
      expect(ok.status).toBe(200);
      expect(ok.body.id).toBe(accountId);
    });

    it("owner adds staff, staff cannot manage members, last owner cannot be removed", async () => {
      const add = await h
        .http()
        .post("/v1/account/members")
        .set("Authorization", `Bearer ${alice}`)
        .set("X-Account-Id", accountId)
        .send({ email: USERS.bob.email, role: "customer_staff" });
      expect(add.status).toBe(201);
      expect(add.body).toMatchObject({ userId: USERS.bob.id, role: "customer_staff" });

      const bobTries = await h
        .http()
        .post("/v1/account/members")
        .set("Authorization", `Bearer ${bob}`)
        .set("X-Account-Id", accountId)
        .send({ email: USERS.carol.email, role: "customer_staff" });
      expect(bobTries.status).toBe(403);

      const removeSelf = await h
        .http()
        .delete(`/v1/account/members/${USERS.alice.id}`)
        .set("Authorization", `Bearer ${alice}`)
        .set("X-Account-Id", accountId);
      expect(removeSelf.status).toBe(409);
      expect(removeSelf.body.code).toBe("last_owner");

      const removeBob = await h
        .http()
        .delete(`/v1/account/members/${USERS.bob.id}`)
        .set("Authorization", `Bearer ${alice}`)
        .set("X-Account-Id", accountId);
      expect(removeBob.status).toBe(204);

      const members = await h
        .http()
        .get("/v1/account/members")
        .set("Authorization", `Bearer ${alice}`)
        .set("X-Account-Id", accountId);
      expect(members.body).toHaveLength(1);
    });

    it("adding an unknown email says to sign up first", async () => {
      const res = await h
        .http()
        .post("/v1/account/members")
        .set("Authorization", `Bearer ${alice}`)
        .set("X-Account-Id", accountId)
        .send({ email: "nobody@test.local", role: "customer_staff" });
      expect(res.status).toBe(404);
      expect(res.body.details?.hint).toMatch(/sign up/);
    });
  });
});
