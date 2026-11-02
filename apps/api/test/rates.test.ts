import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { auditLog, users } from "@delicate/db";
import type {
  AccountRateAssignment,
  AccountRateResolution,
  RateCard,
  RateGroup,
} from "@delicate/contracts";
import { createHarness, USERS, type Harness } from "./harness.js";
import { RatesService } from "../src/modules/rates/rates.service.js";

/**
 * Rates: who is priced on what.
 *
 * The thing worth testing is not that a form saves — it is the fallback chain, because that
 * is what decides an invoice. An account's own card beats its group, its group beats the
 * house default, and switching a group off has to put its members back on the default
 * without losing the deal.
 */
describe("rates", () => {
  let h: Harness;
  let rates: RatesService;
  let admin: string;
  let owner: string;
  let bobToken: string;
  let accountId: string;
  let otherAccountId: string;
  let defaultCard: RateCard;

  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  beforeAll(async () => {
    h = await createHarness();
    rates = h.app.get(RatesService);
    admin = await h.tokenFor(USERS.admin);
    owner = await h.tokenFor(USERS.alice);
    bobToken = await h.tokenFor(USERS.bob);
  });
  afterAll(() => h.close());

  beforeEach(async () => {
    await h.reset();
    await h.db.db.insert(users).values({ ...USERS.admin, platformRole: "super_admin" });
    const mk = async (token: string, name: string) =>
      (
        await h
          .http()
          .post("/v1/accounts")
          .set(auth(token))
          .send({ name, type: "business", organization: { name } })
      ).body.id as string;
    accountId = await mk(owner, "Honey Bee");
    otherAccountId = await mk(bobToken, "Sugar Rush");
    const cards = (await h.http().get("/v1/admin/rates/cards").set(auth(admin))).body as RateCard[];
    defaultCard = cards.find((c) => c.isDefault)!;
  });

  /**
   * A negotiated card is a whole card, so the request is a whole set of levers -- which is
   * also what the console sends: its form opens on the default card's numbers and the operator
   * changes the two or three that were actually negotiated.
   */
  const rules = (over: Partial<RateCard> = {}) => {
    const {
      id,
      name,
      isDefault,
      active,
      scope,
      groupId,
      accountId,
      createdAt,
      updatedAt,
      ...levers
    } = defaultCard;
    return { ...levers, ...over };
  };

  const group = async (name: string): Promise<RateGroup> =>
    (
      await h
        .http()
        .post("/v1/admin/rates/groups")
        .set(auth(admin))
        .send({ name, description: null })
    ).body as RateGroup;

  it("keeps the whole section to super admins", async () => {
    await h.db.db
      .update(users)
      .set({ platformRole: "finance" })
      .where(eq(users.id, USERS.admin.id));
    const financeToken = await h.tokenFor(USERS.admin);

    for (const path of ["/v1/admin/rates/cards", "/v1/admin/rates/groups"]) {
      expect((await h.http().get(path).set(auth(financeToken))).status).toBe(403);
      expect((await h.http().get(path).set(auth(owner))).status).toBe(403);
      expect((await h.http().get(path)).status).toBe(401);
    }
  });

  it("lists only the house cards, not the ones written for a group or an account", async () => {
    const g = await group("Franchises");
    await h.http().post(`/v1/admin/rates/groups/${g.id}/cards`).set(auth(admin)).send(rules());
    await h
      .http()
      .post(`/v1/admin/rates/accounts/${accountId}/card`)
      .set(auth(admin))
      .send(rules());

    const cards = (await h.http().get("/v1/admin/rates/cards").set(auth(admin))).body as RateCard[];
    expect(cards.every((c) => c.scope === "platform")).toBe(true);
    expect(cards.map((c) => c.id)).toContain(defaultCard.id);
  });

  it("starts a group switched off, and will not switch one on with nothing published", async () => {
    const g = await group("Franchises");
    expect(g.active).toBe(false);
    expect(g.liveRateCard).toBeNull();

    const refused = await h
      .http()
      .put(`/v1/admin/rates/groups/${g.id}/active`)
      .set(auth(admin))
      .send({ active: true });
    expect(refused.status).toBe(409);
    expect(refused.body.code).toBe("rate_group_has_no_live_card");
  });

  it("drafts group rates that charge nobody until they are published", async () => {
    const g = await group("Franchises");
    await h
      .http()
      .post(`/v1/admin/rates/groups/${g.id}/members`)
      .set(auth(admin))
      .send({ accountIds: [accountId] });
    const draft = (
      await h.http().post(`/v1/admin/rates/groups/${g.id}/cards`).set(auth(admin)).send(rules())
    ).body as RateCard;
    expect(draft.active).toBe(false);
    expect(draft.scope).toBe("group");
    expect(draft.name).toBe("Franchises rates");

    // A member of a group with nothing live is still on the house card.
    expect((await rates.resolutionFor(accountId)).source).toBe("default");

    const published = (
      await h
        .http()
        .post(`/v1/admin/rates/groups/${g.id}/cards/${draft.id}/publish`)
        .set(auth(admin))
    ).body as RateGroup;
    expect(published.liveRateCard?.id).toBe(draft.id);
    expect(published.draftRateCards).toHaveLength(0);

    // Published but the group is still off, so it prices nothing yet. Two deliberate acts.
    expect((await rates.resolutionFor(accountId)).source).toBe("default");

    await h
      .http()
      .put(`/v1/admin/rates/groups/${g.id}/active`)
      .set(auth(admin))
      .send({ active: true });
    const live = await rates.resolutionFor(accountId);
    expect(live.source).toBe("group");
    expect(live.rateCard.id).toBe(draft.id);
    expect(live.groupName).toBe("Franchises");
    // Nobody outside the group moved.
    expect((await rates.resolutionFor(otherAccountId)).source).toBe("default");
  });

  it("retires the card it replaces when the next one goes live", async () => {
    const g = await group("Franchises");
    const first = (
      await h.http().post(`/v1/admin/rates/groups/${g.id}/cards`).set(auth(admin)).send(rules())
    ).body as RateCard;
    await h
      .http()
      .post(`/v1/admin/rates/groups/${g.id}/cards/${first.id}/publish`)
      .set(auth(admin));
    const second = (
      await h
        .http()
        .post(`/v1/admin/rates/groups/${g.id}/cards`)
        .set(auth(admin))
        .send(rules({ minFeeCents: 12_500 }))
    ).body as RateCard;
    const after = (
      await h
        .http()
        .post(`/v1/admin/rates/groups/${g.id}/cards/${second.id}/publish`)
        .set(auth(admin))
    ).body as RateGroup;

    expect(after.liveRateCard?.id).toBe(second.id);
    // Kept, not overwritten: a quote priced last week points at the row it used.
    expect(after.draftRateCards.map((c) => c.id)).toContain(first.id);
    expect(second.name).toBe("Franchises rates (2)");
  });

  it("switches a group off without losing its rates or its members", async () => {
    const g = await group("Franchises");
    await h
      .http()
      .post(`/v1/admin/rates/groups/${g.id}/members`)
      .set(auth(admin))
      .send({ accountIds: [accountId] });
    const card = (
      await h.http().post(`/v1/admin/rates/groups/${g.id}/cards`).set(auth(admin)).send(rules())
    ).body as RateCard;
    await h.http().post(`/v1/admin/rates/groups/${g.id}/cards/${card.id}/publish`).set(auth(admin));
    await h
      .http()
      .put(`/v1/admin/rates/groups/${g.id}/active`)
      .set(auth(admin))
      .send({ active: true });
    expect((await rates.resolutionFor(accountId)).source).toBe("group");

    const off = (
      await h
        .http()
        .put(`/v1/admin/rates/groups/${g.id}/active`)
        .set(auth(admin))
        .send({ active: false })
    ).body as RateGroup;
    expect(off.active).toBe(false);
    expect(off.members).toHaveLength(1);
    expect(off.liveRateCard?.id).toBe(card.id);
    expect((await rates.resolutionFor(accountId)).source).toBe("default");

    // And back on again restores the deal rather than rebuilding it.
    await h
      .http()
      .put(`/v1/admin/rates/groups/${g.id}/active`)
      .set(auth(admin))
      .send({ active: true });
    expect((await rates.resolutionFor(accountId)).rateCard.id).toBe(card.id);
  });

  it("moves an account that is already in another group", async () => {
    const a = await group("Franchises");
    const b = await group("Resellers");
    await h
      .http()
      .post(`/v1/admin/rates/groups/${a.id}/members`)
      .set(auth(admin))
      .send({ accountIds: [accountId] });
    const moved = (
      await h
        .http()
        .post(`/v1/admin/rates/groups/${b.id}/members`)
        .set(auth(admin))
        .send({ accountIds: [accountId] })
    ).body as RateGroup;

    expect(moved.members.map((m) => m.accountId)).toEqual([accountId]);
    const groups = (await h.http().get("/v1/admin/rates/groups").set(auth(admin)))
      .body as RateGroup[];
    expect(groups.find((g) => g.id === a.id)!.members).toHaveLength(0);
  });

  it("puts a removed member back on the house card", async () => {
    const g = await group("Franchises");
    const card = (
      await h.http().post(`/v1/admin/rates/groups/${g.id}/cards`).set(auth(admin)).send(rules())
    ).body as RateCard;
    await h.http().post(`/v1/admin/rates/groups/${g.id}/cards/${card.id}/publish`).set(auth(admin));
    await h
      .http()
      .put(`/v1/admin/rates/groups/${g.id}/active`)
      .set(auth(admin))
      .send({ active: true });
    await h
      .http()
      .post(`/v1/admin/rates/groups/${g.id}/members`)
      .set(auth(admin))
      .send({ accountIds: [accountId] });
    expect((await rates.resolutionFor(accountId)).source).toBe("group");

    await h.http().delete(`/v1/admin/rates/groups/${g.id}/members/${accountId}`).set(auth(admin));
    expect((await rates.resolutionFor(accountId)).source).toBe("default");
  });

  it("lets one account's own card beat its group, and falls back when it is taken off", async () => {
    const g = await group("Franchises");
    const groupCard = (
      await h.http().post(`/v1/admin/rates/groups/${g.id}/cards`).set(auth(admin)).send(rules())
    ).body as RateCard;
    await h
      .http()
      .post(`/v1/admin/rates/groups/${g.id}/cards/${groupCard.id}/publish`)
      .set(auth(admin));
    await h
      .http()
      .put(`/v1/admin/rates/groups/${g.id}/active`)
      .set(auth(admin))
      .send({ active: true });
    await h
      .http()
      .post(`/v1/admin/rates/groups/${g.id}/members`)
      .set(auth(admin))
      .send({ accountIds: [accountId] });

    const own = (
      await h
        .http()
        .post(`/v1/admin/rates/accounts/${accountId}/card`)
        .set(auth(admin))
        .send(rules({ minFeeCents: 7_500 }))
    ).body as RateCard;
    expect(own.scope).toBe("account");
    expect(own.active).toBe(true);
    expect(own.name).toBe("Honey Bee rates");

    const resolved = (await h.http().get(`/v1/admin/rates/accounts/${accountId}`).set(auth(admin)))
      .body as AccountRateResolution;
    expect(resolved.source).toBe("account");
    expect(resolved.rateCard.id).toBe(own.id);

    const assignments = (await h.http().get("/v1/admin/rates/accounts").set(auth(admin)))
      .body as AccountRateAssignment[];
    expect(assignments.map((a) => a.accountId)).toEqual([accountId]);

    // Taken off, it is back to the group rather than straight to the default.
    const cleared = (
      await h.http().delete(`/v1/admin/rates/accounts/${accountId}/card`).set(auth(admin))
    ).body as AccountRateResolution;
    expect(cleared.source).toBe("group");
    expect(cleared.rateCard.id).toBe(groupCard.id);
  });

  it("retires the card it replaces when an account's rates are rewritten", async () => {
    const first = (
      await h
        .http()
        .post(`/v1/admin/rates/accounts/${accountId}/card`)
        .set(auth(admin))
        .send(rules())
    ).body as RateCard;
    const second = (
      await h
        .http()
        .post(`/v1/admin/rates/accounts/${accountId}/card`)
        .set(auth(admin))
        .send(rules({ minFeeCents: 11_000 }))
    ).body as RateCard;

    expect(second.id).not.toBe(first.id);
    expect((await rates.resolutionFor(accountId)).rateCard.id).toBe(second.id);
    const assignments = (await h.http().get("/v1/admin/rates/accounts").set(auth(admin)))
      .body as AccountRateAssignment[];
    expect(assignments).toHaveLength(1);
    expect(assignments[0]!.rateCard.id).toBe(second.id);
  });

  it("refuses to hand a group's card or another account's card to an account", async () => {
    const g = await group("Franchises");
    const groupCard = (
      await h.http().post(`/v1/admin/rates/groups/${g.id}/cards`).set(auth(admin)).send(rules())
    ).body as RateCard;
    const theirs = (
      await h
        .http()
        .post(`/v1/admin/rates/accounts/${otherAccountId}/card`)
        .set(auth(admin))
        .send(rules())
    ).body as RateCard;

    const a = await h
      .http()
      .put(`/v1/admin/rates/accounts/${accountId}/card`)
      .set(auth(admin))
      .send({ rateCardId: groupCard.id });
    expect(a.status).toBe(409);
    expect(a.body.code).toBe("rate_card_belongs_to_group");

    const b = await h
      .http()
      .put(`/v1/admin/rates/accounts/${accountId}/card`)
      .set(auth(admin))
      .send({ rateCardId: theirs.id });
    expect(b.status).toBe(409);
    expect(b.body.code).toBe("rate_card_belongs_to_another_account");

    // A house card is fair game: that is the ordinary "put them on Standard 2027" case.
    const ok = await h
      .http()
      .put(`/v1/admin/rates/accounts/${accountId}/card`)
      .set(auth(admin))
      .send({ rateCardId: defaultCard.id });
    expect(ok.status).toBe(200);
    expect(ok.body.source).toBe("account");
  });

  it("refuses to edit a negotiated card as if it were a house card", async () => {
    const g = await group("Franchises");
    const groupCard = (
      await h.http().post(`/v1/admin/rates/groups/${g.id}/cards`).set(auth(admin)).send(rules())
    ).body as RateCard;
    const res = await h
      .http()
      .put(`/v1/admin/rates/cards/${groupCard.id}`)
      .set(auth(admin))
      .send({ ...groupCard, minFeeCents: 100 });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("rate_card_not_platform");
  });

  it("audits every rate change, because the margin is somebody's invoice", async () => {
    const g = await group("Franchises");
    const card = (
      await h.http().post(`/v1/admin/rates/groups/${g.id}/cards`).set(auth(admin)).send(rules())
    ).body as RateCard;
    await h.http().post(`/v1/admin/rates/groups/${g.id}/cards/${card.id}/publish`).set(auth(admin));
    await h
      .http()
      .put(`/v1/admin/rates/groups/${g.id}/active`)
      .set(auth(admin))
      .send({ active: true });
    await h
      .http()
      .post(`/v1/admin/rates/groups/${g.id}/members`)
      .set(auth(admin))
      .send({ accountIds: [accountId] });

    const entries = (await h.db.db.select().from(auditLog)).filter((e) =>
      e.action.startsWith("rate_group."),
    );
    expect(entries.map((e) => e.action)).toEqual(
      expect.arrayContaining([
        "rate_group.create",
        "rate_group.rates.draft",
        "rate_group.rates.publish",
        "rate_group.activate",
        "rate_group.members.add",
      ]),
    );
    // Whose hand it was, not just that it happened.
    expect(entries.every((e) => e.actorUserId === USERS.admin.id)).toBe(true);
  });

  it("prices a quote on the group's card once the group is live", async () => {
    const g = await group("Franchises");
    // Deliberately cheaper than the seeded default so the number itself proves which card ran.
    const card = (
      await h
        .http()
        .post(`/v1/admin/rates/groups/${g.id}/cards`)
        .set(auth(admin))
        .send(rules({ costPerKmCents: 100, marginBps: 1_000, minFeeCents: 5_000 }))
    ).body as RateCard;
    await h.http().post(`/v1/admin/rates/groups/${g.id}/cards/${card.id}/publish`).set(auth(admin));
    await h
      .http()
      .put(`/v1/admin/rates/groups/${g.id}/active`)
      .set(auth(admin))
      .send({ active: true });
    await h
      .http()
      .post(`/v1/admin/rates/groups/${g.id}/members`)
      .set(auth(admin))
      .send({ accountIds: [accountId] });

    const quote = await h
      .http()
      .post("/v1/account/quotes")
      .set(auth(owner))
      .set("X-Account-Id", accountId)
      .send({
        serviceLevelCode: "standard",
        collection: {
          address: address("Honey Bee, Menlyn", { lat: -25.7826, lng: 28.2755 }),
        },
        drops: [address("12 Oak St, Centurion", { lat: -25.8603, lng: 28.1894 })].map((a) => ({
          address: a,
        })),
      });
    expect(quote.status, JSON.stringify(quote.body)).toBe(201);
    // The quote names the card it was priced on, which is what makes a charged price
    // explainable a year later -- and here, proof that the group's card is what ran.
    expect(quote.body.breakdown.totalCents).toBeGreaterThan(0);
    expect(quote.body.rateCardId).toBe(card.id);
  });
});

const address = (formatted: string, location: { lat: number; lng: number }) => ({
  formatted,
  line1: null,
  suburb: null,
  city: "Pretoria",
  postalCode: null,
  country: "ZA",
  location,
  placeId: null,
});
