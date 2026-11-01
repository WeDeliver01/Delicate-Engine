import { Injectable } from "@nestjs/common";
import { and, desc, eq, inArray } from "drizzle-orm";
import type { Membership, MembershipPlan, StartMembershipRequest } from "@delicate/contracts";
import { accountMemberships, membershipPlans, type DbExecutor } from "@delicate/db";
import { AppError } from "../../common/errors.js";
import { AuditService } from "../../infra/audit.service.js";
import { Clock } from "../../infra/clock.js";
import { DbService } from "../../infra/db.module.js";

/** Statuses that still buy you something. `past_due` keeps benefits through the grace period. */
const LIVE = ["active", "past_due"] as const;

/**
 * Paid membership: who is on a plan, what it costs them, and what it buys.
 *
 * Charging and renewal are not here — those are money moving on a timer and belong with the
 * scheduler. This service answers the questions pricing and the console ask dozens of times a
 * day, and starting or stopping a membership is the whole of what it writes.
 */
@Injectable()
export class MembershipService {
  constructor(
    private readonly dbs: DbService,
    private readonly audit: AuditService,
    private readonly clock: Clock,
  ) {}

  /**
   * The discount to price this account's deliveries at, in basis points.
   *
   * On the hot path: every quote asks. Returns zero rather than throwing for an account with
   * no membership, because that is the ordinary case and not an error.
   */
  async discountBpsFor(accountId: string, tx?: DbExecutor): Promise<number> {
    const row = await (tx ?? this.dbs.db).query.accountMemberships.findFirst({
      where: and(
        eq(accountMemberships.accountId, accountId),
        inArray(accountMemberships.status, [...LIVE]),
      ),
      columns: { discountBps: true },
    });
    return row?.discountBps ?? 0;
  }

  /** The live membership for an account, or null. */
  async forAccount(accountId: string, tx?: DbExecutor): Promise<Membership | null> {
    const db = tx ?? this.dbs.db;
    const row = await db.query.accountMemberships.findFirst({
      where: and(
        eq(accountMemberships.accountId, accountId),
        inArray(accountMemberships.status, [...LIVE]),
      ),
    });
    if (!row) return null;
    const plan = await db.query.membershipPlans.findFirst({
      where: eq(membershipPlans.id, row.planId),
    });
    return plan ? toMembership(row, plan) : null;
  }

  async plans(includeInactive = false): Promise<MembershipPlan[]> {
    const rows = await this.dbs.db
      .select()
      .from(membershipPlans)
      .orderBy(membershipPlans.sortOrder, membershipPlans.priceCents);
    return rows.filter((p) => includeInactive || p.active).map(toPlan);
  }

  /**
   * Put an account on a plan.
   *
   * The price and discount are copied onto the membership rather than read through the plan
   * for ever after, so raising the price of Growth does not silently raise it for everyone
   * already on it. An account already on a plan is moved rather than given a second one: the
   * old row is closed and a new one opened, so "what were they paying in March" still has an
   * answer.
   */
  async start(accountId: string, input: StartMembershipRequest): Promise<Membership> {
    return this.dbs.transaction(async (tx) => {
      const plan = await tx.query.membershipPlans.findFirst({
        where: eq(membershipPlans.code, input.planCode),
      });
      if (!plan || !plan.active) throw AppError.notFound("membership plan");

      const existing = await tx.query.accountMemberships.findFirst({
        where: and(
          eq(accountMemberships.accountId, accountId),
          inArray(accountMemberships.status, [...LIVE]),
        ),
      });
      if (existing?.planId === plan.id) return toMembership(existing, plan);
      if (existing) {
        await tx
          .update(accountMemberships)
          .set({ status: "cancelled", cancelledAt: this.clock.now() })
          .where(eq(accountMemberships.id, existing.id));
      }

      const start = this.clock.now();
      const [row] = await tx
        .insert(accountMemberships)
        .values({
          accountId,
          planId: plan.id,
          collection: input.collection,
          priceCents: plan.priceCents,
          discountBps: plan.discountBps,
          startedAt: start,
          currentPeriodStart: start,
          currentPeriodEnd: addMonth(start),
        })
        .returning();

      await this.audit.record(tx, {
        action: existing ? "membership.change" : "membership.start",
        entityType: "account",
        entityId: accountId,
        before: existing ? { planId: existing.planId } : null,
        after: { planId: plan.id, code: plan.code, priceCents: plan.priceCents },
      });
      return toMembership(row!, plan);
    });
  }

  /**
   * Stop a membership.
   *
   * Ends at the period they have already paid for rather than immediately, unless somebody
   * asks for it to stop now — taking benefits away from a customer mid-month who has paid for
   * the month is the kind of thing that generates a phone call we would deserve.
   */
  async cancel(accountId: string, immediate = false): Promise<Membership | null> {
    return this.dbs.transaction(async (tx) => {
      const row = await tx.query.accountMemberships.findFirst({
        where: and(
          eq(accountMemberships.accountId, accountId),
          inArray(accountMemberships.status, [...LIVE]),
        ),
      });
      if (!row) return null;
      const [updated] = await tx
        .update(accountMemberships)
        .set(
          immediate
            ? { status: "cancelled", cancelledAt: this.clock.now(), cancelAtPeriodEnd: false }
            : { cancelAtPeriodEnd: true },
        )
        .where(eq(accountMemberships.id, row.id))
        .returning();
      await this.audit.record(tx, {
        action: "membership.cancel",
        entityType: "account",
        entityId: accountId,
        before: { status: row.status, cancelAtPeriodEnd: row.cancelAtPeriodEnd },
        after: { immediate },
      });
      const plan = await tx.query.membershipPlans.findFirst({
        where: eq(membershipPlans.id, row.planId),
      });
      return plan ? toMembership(updated!, plan) : null;
    });
  }

  /** Every membership this account has ever had, newest first. */
  async history(accountId: string): Promise<Membership[]> {
    const rows = await this.dbs.db
      .select()
      .from(accountMemberships)
      .innerJoin(membershipPlans, eq(membershipPlans.id, accountMemberships.planId))
      .where(eq(accountMemberships.accountId, accountId))
      .orderBy(desc(accountMemberships.startedAt));
    return rows.map((r) => toMembership(r.account_memberships, r.membership_plans));
  }
}

/** One month on, clamped so the 31st of a short month does not overflow into the next one. */
export function addMonth(from: Date): Date {
  const d = new Date(from);
  const day = d.getUTCDate();
  d.setUTCMonth(d.getUTCMonth() + 1);
  if (d.getUTCDate() < day) d.setUTCDate(0);
  return d;
}

function toPlan(p: typeof membershipPlans.$inferSelect): MembershipPlan {
  return {
    id: p.id,
    code: p.code,
    name: p.name,
    priceCents: p.priceCents,
    discountBps: p.discountBps,
    suitedFromDeliveries: p.suitedFromDeliveries,
    freeShipmentsPerPeriod: p.freeShipmentsPerPeriod,
    waivesHolidaySurcharge: p.waivesHolidaySurcharge,
    waivesAllSurcharges: p.waivesAllSurcharges,
    includesApiAccess: p.includesApiAccess,
    prioritySupport: p.prioritySupport,
    dedicatedManager: p.dedicatedManager,
    sortOrder: p.sortOrder,
    active: p.active,
  };
}

function toMembership(
  m: typeof accountMemberships.$inferSelect,
  plan: typeof membershipPlans.$inferSelect,
): Membership {
  return {
    id: m.id,
    accountId: m.accountId,
    plan: toPlan(plan),
    status: m.status,
    collection: m.collection,
    priceCents: m.priceCents,
    discountBps: m.discountBps,
    startedAt: m.startedAt.toISOString(),
    currentPeriodStart: m.currentPeriodStart.toISOString(),
    currentPeriodEnd: m.currentPeriodEnd.toISOString(),
    cancelAtPeriodEnd: m.cancelAtPeriodEnd,
    cancelledAt: m.cancelledAt?.toISOString() ?? null,
    freeShipmentsUsed: m.freeShipmentsUsed,
    freeShipmentsLeft:
      plan.freeShipmentsPerPeriod > 0
        ? Math.max(0, plan.freeShipmentsPerPeriod - m.freeShipmentsUsed)
        : null,
  };
}
