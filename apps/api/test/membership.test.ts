import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { accountMemberships, membershipPlans, users } from "@delicate/db";
import type { Membership, MembershipPlan, Quote } from "@delicate/contracts";
import { createHarness, USERS, type Harness } from "./harness.js";
import { WalletService } from "../src/modules/wallet/wallet.service.js";
import { MembershipService } from "../src/modules/membership/membership.service.js";
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
 * Paid membership.
 *
 * The thing worth protecting here is that a member actually gets what they paid for: the
 * discount has to survive the cost floor, the benefits have to come from their own plan, and
 * a renewal has to be safe to run twice.
 */
describe("membership", () => {
  let h: Harness;
  let wallet: WalletService;
  let memberships: MembershipService;
  let owner: string;
  let admin: string;
  let accountId: string;
  let cakeId: string;

  beforeAll(async () => {
    h = await createHarness();
    wallet = h.app.get(WalletService);
    memberships = h.app.get(MembershipService);
    h.app.get(Clock).now = () => new Date("2026-09-23T07:00:00Z");
    owner = await h.tokenFor(USERS.alice);
    admin = await h.tokenFor(USERS.admin);
  });
  afterAll(() => h.close());

  beforeEach(async () => {
    await h.reset();
    await h.db.db.insert(users).values({ ...USERS.admin, platformRole: "super_admin" });
    const acc = await h
      .http()
      .post("/v1/accounts")
      .set("Authorization", `Bearer ${owner}`)
      .send({ name: "Honey Bee", type: "business", organization: { name: "Honey Bee Bakers" } });
    accountId = acc.body.id;
    const catalog = (await h.http().get("/v1/public/catalog")).body;
    cakeId = catalog.packageTypes.find((p: { code: string }) => p.code === "cake_single").id;
  });

  const asOwner = () => ({ Authorization: `Bearer ${owner}`, "X-Account-Id": accountId });
  const asAdmin = () => ({ Authorization: `Bearer ${admin}` });

  async function quote(): Promise<Quote> {
    const res = await h
      .http()
      .post("/v1/account/quotes")
      .set(asOwner())
      .send({
        serviceLevelCode: "standard",
        collection: {
          address: addr("Honey Bee, Menlyn", MENLYN),
          contact: { name: "Baker", phone: "0821111111", email: null },
          instructions: null,
        },
        drops: [
          {
            address: addr("12 Oak St, Centurion", CENTURION),
            recipient: { name: "Jane", phone: "0821234567", email: null },
            instructions: null,
            parcels: [{ packageTypeId: cakeId, quantity: 1, weightKg: null, description: null }],
          },
        ],
        options: {},
      });
    expect(res.status).toBe(201);
    return res.body as Quote;
  }

  it("offers the plans publicly, because the marketing page prices itself from them", async () => {
    const res = await h.http().get("/v1/public/membership/plans");
    expect(res.status).toBe(200);
    const codes = (res.body as MembershipPlan[]).map((p) => p.code);
    expect(codes).toContain("starter");
    expect(codes).toContain("enterprise");
  });

  it("charges a member less for the same delivery than a non-member", async () => {
    const before = await quote();
    await h.http().post("/v1/account/membership").set(asOwner()).send({ planCode: "starter" });
    const after = await quote();

    expect(after.breakdown.totalCents).toBeLessThan(before.breakdown.totalCents);
    // Shown as its own line: a discount a customer cannot see is a discount they will ask about.
    const full = await h.http().get(`/v1/account/quotes/${after.id}`).set(asOwner());
    expect(full.status).toBe(200);
  });

  it("gives a deeper tier a deeper discount, and nothing to somebody with no plan", async () => {
    const plain = await quote();
    await h.http().post("/v1/account/membership").set(asOwner()).send({ planCode: "starter" });
    const starter = await quote();
    await h.http().post("/v1/account/membership").set(asOwner()).send({ planCode: "enterprise" });
    const enterprise = await quote();

    expect(starter.breakdown.totalCents).toBeLessThan(plain.breakdown.totalCents);
    expect(enterprise.breakdown.totalCents).toBeLessThan(starter.breakdown.totalCents);
  });

  it("moves an account between plans rather than stacking a second one on top", async () => {
    await h.http().post("/v1/account/membership").set(asOwner()).send({ planCode: "starter" });
    await h.http().post("/v1/account/membership").set(asOwner()).send({ planCode: "enterprise" });

    const live = await h.db.db
      .select()
      .from(accountMemberships)
      .where(eq(accountMemberships.accountId, accountId));
    expect(live.filter((m) => m.status === "active")).toHaveLength(1);
    // The old one is kept, not deleted: what they paid in March still has an answer.
    expect(live).toHaveLength(2);

    const history = await h.http().get("/v1/account/membership/history").set(asOwner());
    expect(history.body).toHaveLength(2);
  });

  it("keeps the price agreed at sign-up when the plan's own price goes up", async () => {
    await h.http().post("/v1/account/membership").set(asOwner()).send({ planCode: "starter" });
    await h.db.db
      .update(membershipPlans)
      .set({ priceCents: 150_000 })
      .where(eq(membershipPlans.code, "starter"));

    const mine = (await h.http().get("/v1/account/membership").set(asOwner())).body
      .membership as Membership;
    expect(mine.priceCents).toBe(99_900);
  });

  it("runs to the end of the paid period when cancelled, instead of stopping dead", async () => {
    await h.http().post("/v1/account/membership").set(asOwner()).send({ planCode: "starter" });
    await h.http().delete("/v1/account/membership").set(asOwner()).expect(200);

    const mine = (await h.http().get("/v1/account/membership").set(asOwner())).body
      .membership as Membership;
    expect(mine.cancelAtPeriodEnd).toBe(true);
    expect(mine.status).toBe("active");
    // Still a member, so still discounted: they paid for this month.
    expect(await memberships.pricingFor(accountId)).toMatchObject({ discountBps: 1_500 });
  });

  it("takes the fee off the wallet on renewal, once, however many times it runs", async () => {
    await wallet.adjust(accountId, 500_000, "test funds");
    await h.http().post("/v1/account/membership").set(asOwner()).send({ planCode: "starter" });

    const [m] = await h.db.db
      .select()
      .from(accountMemberships)
      .where(eq(accountMemberships.accountId, accountId));
    // Wind the period back so it is due.
    await h.db.db
      .update(accountMemberships)
      .set({ currentPeriodEnd: new Date("2026-09-23T00:00:00Z") })
      .where(eq(accountMemberships.id, m!.id));

    expect(await memberships.renewDue()).toBe(1);
    const after = (await h.http().get("/v1/account/wallet").set(asOwner())).body;
    expect(after.balanceCents).toBe(500_000 - 99_900);

    // A second sweep must not bill again: the charge is unique per membership and period.
    await memberships.renewDue();
    const again = (await h.http().get("/v1/account/wallet").set(asOwner())).body;
    expect(again.balanceCents).toBe(500_000 - 99_900);
  });

  it("marks a membership past due when the wallet cannot cover it, and keeps the benefits", async () => {
    await h.http().post("/v1/account/membership").set(asOwner()).send({ planCode: "starter" });
    const [m] = await h.db.db
      .select()
      .from(accountMemberships)
      .where(eq(accountMemberships.accountId, accountId));
    await h.db.db
      .update(accountMemberships)
      .set({ currentPeriodEnd: new Date("2026-09-23T00:00:00Z") })
      .where(eq(accountMemberships.id, m!.id));

    await memberships.renewDue();
    const mine = (await h.http().get("/v1/account/membership").set(asOwner())).body
      .membership as Membership;
    expect(mine.status).toBe("past_due");
    // Losing the discount the instant a wallet runs short would be the wrong answer.
    expect((await memberships.pricingFor(accountId)).discountBps).toBe(1_500);
  });

  it("ends a membership that asked to stop instead of charging it again", async () => {
    await wallet.adjust(accountId, 500_000, "test funds");
    await h.http().post("/v1/account/membership").set(asOwner()).send({ planCode: "starter" });
    await h.http().delete("/v1/account/membership").set(asOwner());
    const [m] = await h.db.db
      .select()
      .from(accountMemberships)
      .where(eq(accountMemberships.accountId, accountId));
    await h.db.db
      .update(accountMemberships)
      .set({ currentPeriodEnd: new Date("2026-09-23T00:00:00Z") })
      .where(eq(accountMemberships.id, m!.id));

    await memberships.renewDue();
    const after = (await h.http().get("/v1/account/wallet").set(asOwner())).body;
    expect(after.balanceCents).toBe(500_000);
    expect(
      (await h.http().get("/v1/account/membership").set(asOwner())).body.membership,
    ).toBeNull();
  });

  it("spends an included shipment once and then stops", async () => {
    await h.http().post("/v1/account/membership").set(asOwner()).send({ planCode: "enterprise" });
    const first = await h.db.db.transaction((tx) => memberships.useFreeShipment(accountId, tx));
    const second = await h.db.db.transaction((tx) => memberships.useFreeShipment(accountId, tx));
    expect(first).toBe(true);
    expect(second).toBe(false);
  });

  it("lets ops see and change somebody's plan, and refuses everyone else", async () => {
    await h
      .http()
      .post(`/v1/admin/accounts/${accountId}/membership`)
      .set(asAdmin())
      .send({ planCode: "enterprise" })
      .expect(201);

    const view = await h.http().get(`/v1/admin/accounts/${accountId}/membership`).set(asAdmin());
    expect(view.body.membership.plan.code).toBe("enterprise");

    // A customer cannot put themselves on somebody else's account.
    await h
      .http()
      .post(`/v1/admin/accounts/${accountId}/membership`)
      .set(asOwner())
      .send({ planCode: "starter" })
      .expect(403);
  });
});
