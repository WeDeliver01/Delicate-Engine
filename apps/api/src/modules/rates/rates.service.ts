import { Injectable } from "@nestjs/common";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import type {
  AccountRateAssignment,
  AccountRateResolution,
  RateCard,
  RateGroup,
  RateRulesRequest,
  UpsertRateCardRequest,
  UpsertRateGroupRequest,
} from "@delicate/contracts";
import {
  accountRateCards,
  accounts,
  rateCards,
  rateGroupMembers,
  rateGroups,
  type DbExecutor,
} from "@delicate/db";
import { AppError } from "../../common/errors.js";
import { AuditService } from "../../infra/audit.service.js";
import { DbService } from "../../infra/db.module.js";

/**
 * Rates: the house rate cards, the groups of accounts priced by their own rules, and the
 * cards written for a single customer.
 *
 * Everything here answers one question — which numbers price this booking — and the answer is
 * a rate card. The ordering is in `rateCardFor`; the rest is the paperwork around writing a
 * card and deciding who it reaches. Every write is audited, because these numbers are what
 * the business charges and "who changed the margin" gets asked after the invoice, not before.
 */
@Injectable()
export class RatesService {
  constructor(
    private readonly dbs: DbService,
    private readonly audit: AuditService,
  ) {}

  // ── resolution ─────────────────────────────────────────────────────────────

  /**
   * The card that prices a booking for this account, in order of how specific the deal is:
   * the account's own card, then its group's live card, then the house default.
   *
   * Each step requires the card to be active, so retiring a card is enough to fall through to
   * the next answer — there is no second switch to remember. A public estimate has no account
   * and goes straight to the default.
   */
  async rateCardFor(accountId: string | null, tx?: DbExecutor): Promise<RateCard> {
    return (await this.resolve(accountId, tx)).rateCard;
  }

  /** The same answer with its reasoning attached, for the console and for the tests. */
  async resolutionFor(accountId: string): Promise<AccountRateResolution> {
    const r = await this.resolve(accountId);
    return {
      accountId,
      source: r.source,
      rateCard: r.rateCard,
      groupId: r.group?.id ?? null,
      groupName: r.group?.name ?? null,
    };
  }

  private async resolve(
    accountId: string | null,
    tx?: DbExecutor,
  ): Promise<{
    source: AccountRateResolution["source"];
    rateCard: RateCard;
    group?: { id: string; name: string };
  }> {
    const db = tx ?? this.dbs.db;
    if (accountId) {
      const assigned = await db.query.accountRateCards.findFirst({
        where: eq(accountRateCards.accountId, accountId),
      });
      if (assigned) {
        const card = await db.query.rateCards.findFirst({
          where: and(eq(rateCards.id, assigned.rateCardId), eq(rateCards.active, true)),
        });
        if (card) return { source: "account", rateCard: toRateCard(card) };
      }

      const membership = await db.query.rateGroupMembers.findFirst({
        where: eq(rateGroupMembers.accountId, accountId),
      });
      if (membership) {
        const group = await db.query.rateGroups.findFirst({
          where: and(eq(rateGroups.id, membership.groupId), eq(rateGroups.active, true)),
        });
        if (group) {
          const card = await db.query.rateCards.findFirst({
            where: and(eq(rateCards.groupId, group.id), eq(rateCards.active, true)),
          });
          // An active group with nothing published is one somebody is still setting up. It
          // charges the default rather than nothing, which is the safe way round.
          if (card)
            return {
              source: "group",
              rateCard: toRateCard(card),
              group: { id: group.id, name: group.name },
            };
        }
      }
    }
    const def = await db.query.rateCards.findFirst({
      where: and(eq(rateCards.isDefault, true), eq(rateCards.active, true)),
    });
    if (!def)
      throw new AppError("no_default_rate_card", "no active default rate card is configured", 500);
    return { source: "default", rateCard: toRateCard(def) };
  }

  // ── platform cards: the current rate setup ────────────────────────────────

  /** The house rates. Group and account cards are reached through their owner, not this list. */
  async listPlatformRateCards(): Promise<RateCard[]> {
    const rows = await this.dbs.db.query.rateCards.findMany({
      where: eq(rateCards.scope, "platform"),
      orderBy: [desc(rateCards.isDefault), asc(rateCards.name)],
    });
    return rows.map(toRateCard);
  }

  async upsertPlatformRateCard(id: string | null, input: UpsertRateCardRequest): Promise<RateCard> {
    return this.dbs.transaction(async (tx) => {
      const before = id
        ? await tx.query.rateCards.findFirst({ where: eq(rateCards.id, id) })
        : null;
      if (id && !before) throw AppError.notFound("rate card");
      // A negotiated card is edited through its group or its account, where the rules about
      // going live and about who it reaches are enforced.
      if (before && before.scope !== "platform")
        throw AppError.conflict(
          "rate_card_not_platform",
          "this card belongs to a rate group or an account; edit it there",
          { scope: before.scope },
        );
      if (input.isDefault) {
        // exactly one default: demote the current one first
        await tx.update(rateCards).set({ isDefault: false }).where(eq(rateCards.isDefault, true));
      }
      const [row] = id
        ? await tx.update(rateCards).set(input).where(eq(rateCards.id, id)).returning()
        : await tx
            .insert(rateCards)
            .values({ ...input, scope: "platform", isDefault: input.isDefault ?? false })
            .returning();
      await this.audit.record(tx, {
        action: id ? "rate_card.update" : "rate_card.create",
        entityType: "rate_card",
        entityId: row!.id,
        before,
        after: row,
      });
      return toRateCard(row!);
    });
  }

  // ── groups ───────────────────────────────────────────────────────────────

  async listGroups(): Promise<RateGroup[]> {
    const [groups, members, cards] = await Promise.all([
      this.dbs.db.query.rateGroups.findMany({ orderBy: [asc(rateGroups.name)] }),
      this.dbs.db
        .select({
          groupId: rateGroupMembers.groupId,
          accountId: rateGroupMembers.accountId,
          accountName: accounts.name,
          accountCode: accounts.code,
          addedAt: rateGroupMembers.createdAt,
        })
        .from(rateGroupMembers)
        .innerJoin(accounts, eq(accounts.id, rateGroupMembers.accountId))
        .orderBy(asc(accounts.name)),
      this.dbs.db.query.rateCards.findMany({
        where: eq(rateCards.scope, "group"),
        orderBy: [desc(rateCards.createdAt)],
      }),
    ]);
    return groups.map((g) => {
      const own = cards.filter((c) => c.groupId === g.id);
      const live = own.find((c) => c.active) ?? null;
      return {
        id: g.id,
        name: g.name,
        description: g.description,
        active: g.active,
        members: members
          .filter((m) => m.groupId === g.id)
          .map((m) => ({
            accountId: m.accountId,
            accountName: m.accountName,
            accountCode: m.accountCode,
            addedAt: m.addedAt.toISOString(),
          })),
        liveRateCard: live ? toRateCard(live) : null,
        draftRateCards: own.filter((c) => !c.active).map(toRateCard),
        createdAt: g.createdAt.toISOString(),
        updatedAt: g.updatedAt.toISOString(),
      };
    });
  }

  /**
   * A new group starts switched off and with no rates. Nothing it does can change a price
   * until somebody publishes a card and turns the group on, which is two deliberate acts.
   */
  async upsertGroup(id: string | null, input: UpsertRateGroupRequest): Promise<RateGroup> {
    const groupId = await this.dbs.transaction(async (tx) => {
      const before = id ? await groupOrThrow(tx, id) : null;
      // Said plainly rather than as a constraint violation: two groups called "Franchises" is
      // somebody opening the form twice, and the answer is to name this one something else.
      const clash = await tx.query.rateGroups.findFirst({
        where: eq(rateGroups.name, input.name),
      });
      if (clash && clash.id !== id)
        throw AppError.conflict("rate_group_name_taken", "a rate group already has that name");
      const [row] = id
        ? await tx.update(rateGroups).set(input).where(eq(rateGroups.id, id)).returning()
        : await tx
            .insert(rateGroups)
            .values({ ...input, active: false })
            .returning();
      await this.audit.record(tx, {
        action: id ? "rate_group.update" : "rate_group.create",
        entityType: "rate_group",
        entityId: row!.id,
        before,
        after: row,
      });
      return row!.id;
    });
    return this.groupView(groupId);
  }

  /**
   * The brake. Off sends every member back to the default card and leaves the group, its
   * membership and its rates exactly where they are, so switching it on again restores the
   * deal rather than rebuilding it.
   */
  async setGroupActive(id: string, active: boolean): Promise<RateGroup> {
    await this.dbs.transaction(async (tx) => {
      const before = await groupOrThrow(tx, id);
      if (active) {
        const live = await tx.query.rateCards.findFirst({
          where: and(eq(rateCards.groupId, id), eq(rateCards.active, true)),
        });
        // Switching on a group with nothing published changes no price, and the operator
        // would reasonably read the switch as the deal being in force.
        if (!live)
          throw AppError.conflict(
            "rate_group_has_no_live_card",
            "publish rates for this group before switching it on",
          );
      }
      const [row] = await tx
        .update(rateGroups)
        .set({ active })
        .where(eq(rateGroups.id, id))
        .returning();
      await this.audit.record(tx, {
        action: active ? "rate_group.activate" : "rate_group.deactivate",
        entityType: "rate_group",
        entityId: id,
        before,
        after: row,
      });
    });
    return this.groupView(id);
  }

  /**
   * Put accounts in the group, moving any that are in another one.
   *
   * Exclusive membership is what makes the ordering in `rateCardFor` a single answer, so a
   * move is the only sane reading of adding an account that is already somewhere else; the
   * audit entry records where it came from.
   */
  async addMembers(id: string, accountIds: string[]): Promise<RateGroup> {
    await this.dbs.transaction(async (tx) => {
      await groupOrThrow(tx, id);
      const unique = [...new Set(accountIds)];
      const found = await tx
        .select({ id: accounts.id })
        .from(accounts)
        .where(inArray(accounts.id, unique));
      if (found.length !== unique.length) throw AppError.notFound("account");

      const before = await tx.query.rateGroupMembers.findMany({
        where: inArray(rateGroupMembers.accountId, unique),
      });
      for (const accountId of unique) {
        await tx
          .insert(rateGroupMembers)
          .values({ accountId, groupId: id })
          .onConflictDoUpdate({ target: rateGroupMembers.accountId, set: { groupId: id } });
      }
      await this.audit.record(tx, {
        action: "rate_group.members.add",
        entityType: "rate_group",
        entityId: id,
        before: { moved: before.filter((m) => m.groupId !== id) },
        after: { accountIds: unique },
      });
    });
    return this.groupView(id);
  }

  /** Out of the group and back on the default card, unless the account has one of its own. */
  async removeMember(id: string, accountId: string): Promise<RateGroup> {
    await this.dbs.transaction(async (tx) => {
      await groupOrThrow(tx, id);
      const before = await tx.query.rateGroupMembers.findFirst({
        where: and(eq(rateGroupMembers.accountId, accountId), eq(rateGroupMembers.groupId, id)),
      });
      if (!before) throw AppError.notFound("rate group member");
      await tx.delete(rateGroupMembers).where(eq(rateGroupMembers.accountId, accountId));
      await this.audit.record(tx, {
        action: "rate_group.members.remove",
        entityType: "rate_group",
        entityId: id,
        before,
        after: null,
      });
    });
    return this.groupView(id);
  }

  /**
   * Draft rates for a group. Created inactive: they price nobody until published, which is
   * what lets a negotiation be typed in on Tuesday and start on the first of the month.
   */
  async createGroupRates(id: string, rules: RateRulesRequest): Promise<RateCard> {
    return this.dbs.transaction(async (tx) => {
      const group = await groupOrThrow(tx, id);
      const { name, ...levers } = rules;
      const [row] = await tx
        .insert(rateCards)
        .values({
          ...levers,
          name: await uniqueCardName(tx, name ?? `${group.name} rates`),
          scope: "group",
          groupId: id,
          isDefault: false,
          active: false,
        })
        .returning();
      await this.audit.record(tx, {
        action: "rate_group.rates.draft",
        entityType: "rate_card",
        entityId: row!.id,
        after: row,
      });
      return toRateCard(row!);
    });
  }

  /** Edit a group's rates. Editing the live card is a price change, and is audited as one. */
  async updateGroupRates(id: string, cardId: string, rules: RateRulesRequest): Promise<RateCard> {
    return this.dbs.transaction(async (tx) => {
      await groupOrThrow(tx, id);
      const before = await tx.query.rateCards.findFirst({
        where: and(eq(rateCards.id, cardId), eq(rateCards.groupId, id)),
      });
      if (!before) throw AppError.notFound("rate card");
      const { name, ...levers } = rules;
      const [row] = await tx
        .update(rateCards)
        .set({ ...levers, ...(name ? { name } : {}) })
        .where(eq(rateCards.id, cardId))
        .returning();
      await this.audit.record(tx, {
        action: before.active ? "rate_group.rates.update_live" : "rate_group.rates.update_draft",
        entityType: "rate_card",
        entityId: cardId,
        before,
        after: row,
      });
      return toRateCard(row!);
    });
  }

  /**
   * Go live: this card becomes the group's rules and the one it replaces is retired.
   *
   * The card it replaces is kept rather than overwritten, because a quote priced last week
   * snapshots the card it used and the row it points at should still be there to read.
   */
  async publishGroupRates(id: string, cardId: string): Promise<RateGroup> {
    await this.dbs.transaction(async (tx) => {
      await groupOrThrow(tx, id);
      const card = await tx.query.rateCards.findFirst({
        where: and(eq(rateCards.id, cardId), eq(rateCards.groupId, id)),
      });
      if (!card) throw AppError.notFound("rate card");
      const retired = await tx
        .update(rateCards)
        .set({ active: false })
        .where(and(eq(rateCards.groupId, id), eq(rateCards.active, true)))
        .returning({ id: rateCards.id });
      await tx.update(rateCards).set({ active: true }).where(eq(rateCards.id, cardId));
      await this.audit.record(tx, {
        action: "rate_group.rates.publish",
        entityType: "rate_group",
        entityId: id,
        before: { liveRateCardId: retired[0]?.id ?? null },
        after: { liveRateCardId: cardId },
      });
    });
    return this.groupView(id);
  }

  private async groupView(id: string): Promise<RateGroup> {
    const found = (await this.listGroups()).find((g) => g.id === id);
    if (!found) throw AppError.notFound("rate group");
    return found;
  }

  // ── one account's own card ───────────────────────────────────────────────

  async listAccountAssignments(): Promise<AccountRateAssignment[]> {
    const rows = await this.dbs.db
      .select({
        accountId: accountRateCards.accountId,
        accountName: accounts.name,
        accountCode: accounts.code,
        assignedAt: accountRateCards.updatedAt,
        card: rateCards,
      })
      .from(accountRateCards)
      .innerJoin(accounts, eq(accounts.id, accountRateCards.accountId))
      .innerJoin(rateCards, eq(rateCards.id, accountRateCards.rateCardId))
      .orderBy(asc(accounts.name));
    return rows.map((r) => ({
      accountId: r.accountId,
      accountName: r.accountName,
      accountCode: r.accountCode,
      rateCard: toRateCard(r.card),
      assignedAt: r.assignedAt.toISOString(),
    }));
  }

  /**
   * Rates for one customer, live the moment they are saved.
   *
   * No draft step here: a card written for a single account is the deal just agreed on the
   * phone, and assigning it is the decision. Replacing one retires the card it replaces
   * rather than editing it, so the old numbers stay readable next to the quotes they priced.
   */
  async createAccountRates(accountId: string, rules: RateRulesRequest): Promise<RateCard> {
    return this.dbs.transaction(async (tx) => {
      const account = await tx.query.accounts.findFirst({ where: eq(accounts.id, accountId) });
      if (!account) throw AppError.notFound("account");
      const previous = await tx.query.accountRateCards.findFirst({
        where: eq(accountRateCards.accountId, accountId),
      });
      const { name, ...levers } = rules;
      const [row] = await tx
        .insert(rateCards)
        .values({
          ...levers,
          name: await uniqueCardName(tx, name ?? `${account.name} rates`),
          scope: "account",
          accountId,
          isDefault: false,
          active: true,
        })
        .returning();
      await tx
        .insert(accountRateCards)
        .values({ accountId, rateCardId: row!.id })
        .onConflictDoUpdate({
          target: accountRateCards.accountId,
          set: { rateCardId: row!.id, updatedAt: new Date() },
        });
      // Only ever a card written for this one account: a platform card that happened to be
      // assigned here belongs to other customers too, and retiring it would reprice them.
      if (previous)
        await tx
          .update(rateCards)
          .set({ active: false })
          .where(
            and(
              eq(rateCards.id, previous.rateCardId),
              eq(rateCards.scope, "account"),
              eq(rateCards.accountId, accountId),
            ),
          );
      await this.audit.record(tx, {
        action: "account.rates.create",
        entityType: "account",
        entityId: accountId,
        before: { rateCardId: previous?.rateCardId ?? null },
        after: { rateCardId: row!.id },
      });
      return toRateCard(row!);
    });
  }

  /** Put an existing card on an account, or — with null — take the override off. */
  async assignRateCard(accountId: string, rateCardId: string | null): Promise<void> {
    await this.dbs.transaction(async (tx) => {
      const before = await tx.query.accountRateCards.findFirst({
        where: eq(accountRateCards.accountId, accountId),
      });
      if (rateCardId) {
        const card = await tx.query.rateCards.findFirst({ where: eq(rateCards.id, rateCardId) });
        if (!card) throw AppError.notFound("rate card");
        // Somebody else's negotiated card is not a card to hand out.
        if (card.scope === "account" && card.accountId !== accountId)
          throw AppError.conflict(
            "rate_card_belongs_to_another_account",
            "that card was written for a different account",
          );
        if (card.scope === "group")
          throw AppError.conflict(
            "rate_card_belongs_to_group",
            "a group's card applies through the group; add the account to the group instead",
          );
        await tx
          .insert(accountRateCards)
          .values({ accountId, rateCardId })
          .onConflictDoUpdate({
            target: accountRateCards.accountId,
            set: { rateCardId, updatedAt: new Date() },
          });
      } else {
        await tx.delete(accountRateCards).where(eq(accountRateCards.accountId, accountId));
        // The cards it pointed at were written for this account; nothing else can reach them.
        await tx
          .update(rateCards)
          .set({ active: false })
          .where(and(eq(rateCards.scope, "account"), eq(rateCards.accountId, accountId)));
      }
      await this.audit.record(tx, {
        action: "account.rate_card.assign",
        entityType: "account",
        entityId: accountId,
        before,
        after: { rateCardId },
      });
    });
  }
}

async function groupOrThrow(tx: DbExecutor, id: string) {
  const row = await tx.query.rateGroups.findFirst({ where: eq(rateGroups.id, id) });
  if (!row) throw AppError.notFound("rate group");
  return row;
}

/**
 * Card names are unique across the platform, and "Honey Bee rates" is the obvious name for
 * the second draft as much as the first. Suffix rather than refuse: the operator is naming a
 * negotiation, not maintaining a key space.
 */
async function uniqueCardName(tx: DbExecutor, wanted: string): Promise<string> {
  const taken = await tx
    .select({ name: rateCards.name })
    .from(rateCards)
    .where(sql`${rateCards.name} = ${wanted} or ${rateCards.name} like ${`${wanted} (%)`}`);
  if (!taken.some((r) => r.name === wanted)) return wanted;
  for (let n = 2; n < 1_000; n++) {
    const candidate = `${wanted} (${n})`;
    if (!taken.some((r) => r.name === candidate)) return candidate;
  }
  throw AppError.conflict("rate_card_name_taken", "pick a name for this card");
}

export function toRateCard(r: typeof rateCards.$inferSelect): RateCard {
  return {
    id: r.id,
    name: r.name,
    isDefault: r.isDefault,
    active: r.active,
    scope: r.scope,
    groupId: r.groupId,
    accountId: r.accountId,
    costPerKmCents: r.costPerKmCents,
    marginBps: r.marginBps,
    fuelSurchargeBps: r.fuelSurchargeBps,
    minFeeCents: r.minFeeCents,
    extraDropFeeCents: r.extraDropFeeCents,
    extraDropKmFactorBps: r.extraDropKmFactorBps,
    liabilityCoverBps: r.liabilityCoverBps,
    liabilityCoverMinCents: r.liabilityCoverMinCents,
    orderValueFeeBps: r.orderValueFeeBps,
    earlyCollectionFeeCents: r.earlyCollectionFeeCents,
    signatureFeeCents: r.signatureFeeCents,
    weddingVenueFeeCents: r.weddingVenueFeeCents,
    weekendSurchargeBps: r.weekendSurchargeBps,
    weekendSurchargeCents: r.weekendSurchargeCents,
    publicHolidaySurchargeBps: r.publicHolidaySurchargeBps,
    publicHolidaySurchargeCents: r.publicHolidaySurchargeCents,
    timedWindowSurchargeBps: r.timedWindowSurchargeBps,
    timedWindowSurchargeCents: r.timedWindowSurchargeCents,
    roadFactorBps: r.roadFactorBps,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}
