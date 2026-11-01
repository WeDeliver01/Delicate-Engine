import { Injectable } from "@nestjs/common";
import { and, desc, eq, inArray, lt, lte, sql } from "drizzle-orm";
import {
  NO_MEMBERSHIP,
  type Membership,
  type MembershipPlan,
  type MembershipPricing,
  type StartMembershipRequest,
} from "@delicate/contracts";
import {
  accountMemberships,
  membershipCharges,
  membershipPlans,
  type DbExecutor,
} from "@delicate/db";
import { AppError } from "../../common/errors.js";
import { AuditService } from "../../infra/audit.service.js";
import { Clock } from "../../infra/clock.js";
import { DbService } from "../../infra/db.module.js";
import { WalletService } from "../wallet/wallet.service.js";
import { PinoLogger } from "nestjs-pino";

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
    private readonly wallet: WalletService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(MembershipService.name);
  }

  /**
   * What this account's membership buys them, for pricing.
   *
   * On the hot path: every quote asks. Returns the no-membership shape rather than throwing
   * for an account without one, because that is the ordinary case and not an error.
   */
  async pricingFor(accountId: string, tx?: DbExecutor): Promise<MembershipPricing> {
    const db = tx ?? this.dbs.db;
    const row = await db.query.accountMemberships.findFirst({
      where: and(
        eq(accountMemberships.accountId, accountId),
        inArray(accountMemberships.status, [...LIVE]),
      ),
      columns: { discountBps: true, planId: true },
    });
    if (!row) return NO_MEMBERSHIP;
    const plan = await db.query.membershipPlans.findFirst({
      where: eq(membershipPlans.id, row.planId),
      columns: { waivesHolidaySurcharge: true, waivesAllSurcharges: true },
    });
    return {
      discountBps: row.discountBps,
      waivesHolidaySurcharge: plan?.waivesHolidaySurcharge ?? false,
      waivesAllSurcharges: plan?.waivesAllSurcharges ?? false,
    };
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

  /**
   * Everyone on a plan, optionally narrowed to renewals coming up.
   *
   * `dueWithinDays` is what the renewals board runs on: somebody has to be able to see what
   * is about to fall due, and what already has.
   */
  async list(dueWithinDays: number | null): Promise<Membership[]> {
    const cutoff =
      dueWithinDays === null
        ? null
        : new Date(this.clock.now().getTime() + dueWithinDays * 86_400_000);
    const rows = await this.dbs.db
      .select()
      .from(accountMemberships)
      .innerJoin(membershipPlans, eq(membershipPlans.id, accountMemberships.planId))
      .where(
        and(
          inArray(accountMemberships.status, [...LIVE]),
          cutoff ? lte(accountMemberships.currentPeriodEnd, cutoff) : undefined,
        ),
      )
      .orderBy(accountMemberships.currentPeriodEnd);
    return rows.map((r) => toMembership(r.account_memberships, r.membership_plans));
  }

  /** Renew one account by hand: the collection that failed, chased. */
  async renewByAccount(accountId: string): Promise<Membership | null> {
    const row = await this.dbs.db.query.accountMemberships.findFirst({
      where: and(
        eq(accountMemberships.accountId, accountId),
        inArray(accountMemberships.status, [...LIVE]),
      ),
    });
    if (!row) throw AppError.notFound("membership");
    return this.renew(row.id);
  }

  /**
   * Every membership whose period has run out. Returns how many were dealt with.
   *
   * Driven by the scheduler, but safe to run by hand and safe to run twice: the charge row is
   * unique per membership and period, so a repeated renewal cannot bill a second time.
   */
  async renewDue(limit = 100): Promise<number> {
    const due = await this.dbs.db
      .select({ id: accountMemberships.id })
      .from(accountMemberships)
      .where(
        and(
          inArray(accountMemberships.status, [...LIVE]),
          lte(accountMemberships.currentPeriodEnd, this.clock.now()),
        ),
      )
      .limit(limit);
    for (const row of due) await this.renew(row.id);
    return due.length;
  }

  /**
   * Roll one membership into its next period and collect the fee.
   *
   * The three ways of collecting are not variations on a theme: a wallet debit moves money
   * now and can fail for want of funds, an invoice is a promise to pay later, and manual is
   * somebody handling it outside the system entirely. Only the first can leave a membership
   * past due, because only the first has actually tried and failed.
   *
   * A membership that has been asked to stop ends here instead of being charged again.
   */
  async renew(membershipId: string): Promise<Membership | null> {
    const outcome = await this.dbs.transaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(accountMemberships)
        .where(eq(accountMemberships.id, membershipId))
        .for("update");
      if (!row) throw AppError.notFound("membership");
      const plan = await tx.query.membershipPlans.findFirst({
        where: eq(membershipPlans.id, row.planId),
      });
      if (!plan) throw AppError.notFound("membership plan");

      if (row.cancelAtPeriodEnd) {
        const [ended] = await tx
          .update(accountMemberships)
          .set({ status: "cancelled", cancelledAt: this.clock.now() })
          .where(eq(accountMemberships.id, row.id))
          .returning();
        return { membership: toMembership(ended!, plan), debit: null };
      }

      const periodStart = row.currentPeriodEnd;
      const periodEnd = addMonth(periodStart);

      // Unique on (membership, periodStart): a replayed renewal lands here and stops.
      const inserted = await tx
        .insert(membershipCharges)
        .values({
          membershipId: row.id,
          accountId: row.accountId,
          amountCents: row.priceCents,
          collection: row.collection,
          periodStart,
          periodEnd,
          status: row.collection === "wallet" ? "pending" : "due",
        })
        .onConflictDoNothing()
        .returning();
      if (inserted.length === 0) return { membership: toMembership(row, plan), debit: null };

      const [updated] = await tx
        .update(accountMemberships)
        .set({
          currentPeriodStart: periodStart,
          currentPeriodEnd: periodEnd,
          freeShipmentsUsed: 0,
          // An invoiced or manual plan is not past due for not having been collected yet:
          // somebody is going to do that, and it is not this function doing it.
          status: row.collection === "wallet" ? row.status : "active",
        })
        .where(eq(accountMemberships.id, row.id))
        .returning();

      await this.audit.record(tx, {
        action: "membership.renew",
        entityType: "account",
        entityId: row.accountId,
        before: { periodEnd: row.currentPeriodEnd.toISOString() },
        after: { periodEnd: periodEnd.toISOString(), collection: row.collection },
      });

      return {
        membership: toMembership(updated!, plan),
        debit:
          row.collection === "wallet"
            ? { chargeId: inserted[0]!.id, accountId: row.accountId, amountCents: row.priceCents }
            : null,
      };
    });

    /*
      The wallet debit runs after the period has rolled, in its own transaction, because
      `adjust` opens one of its own.

      A failure marks the membership past due rather than unwinding the renewal: the customer
      keeps their benefits through the grace period and somebody chases the money. Losing the
      benefits the instant a wallet ran a few rand short would be a worse answer than letting
      a human look at it.
    */
    if (outcome.debit) {
      const { chargeId, accountId, amountCents } = outcome.debit;
      try {
        /*
          Check there is money there before taking it.

          `adjust` is the admin override and does not refuse an overdraft -- it is used to
          correct balances in both directions, so guarding it would break that. Which means a
          renewal against an empty wallet would quietly push the customer into the negative
          instead of failing, and nobody would find out until they tried to book. So the
          check belongs here, where "cannot collect" is a real outcome with somewhere to go.
        */
        const summary = await this.wallet.summary(accountId);
        if (summary.availableCents < amountCents) {
          throw new Error(`wallet has ${summary.availableCents} available, needs ${amountCents}`);
        }
        const entry = await this.wallet.adjust(
          accountId,
          -amountCents,
          `Membership ${outcome.membership?.plan.name ?? ""}`.trim(),
        );
        await this.dbs.db
          .update(membershipCharges)
          .set({ status: "paid", walletEntryId: entry.id })
          .where(eq(membershipCharges.id, chargeId));
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        await this.dbs.db
          .update(membershipCharges)
          .set({ status: "failed", detail: detail.slice(0, 300) })
          .where(eq(membershipCharges.id, chargeId));
        await this.dbs.db
          .update(accountMemberships)
          .set({ status: "past_due" })
          .where(eq(accountMemberships.id, membershipId));
        this.logger.warn({ membershipId, detail }, "membership renewal could not be collected");
      }
    }
    return outcome.membership;
  }

  /**
   * Spend one of this period's included shipments, if any are left.
   *
   * Conditional in SQL rather than read-then-write: two bookings placed at the same moment
   * would both see the same count and both believe they were the free one.
   */
  async useFreeShipment(accountId: string, tx: DbExecutor): Promise<boolean> {
    const row = await tx.query.accountMemberships.findFirst({
      where: and(
        eq(accountMemberships.accountId, accountId),
        inArray(accountMemberships.status, [...LIVE]),
      ),
      columns: { id: true, planId: true },
    });
    if (!row) return false;
    const plan = await tx.query.membershipPlans.findFirst({
      where: eq(membershipPlans.id, row.planId),
      columns: { freeShipmentsPerPeriod: true },
    });
    const allowance = plan?.freeShipmentsPerPeriod ?? 0;
    if (allowance <= 0) return false;
    const claimed = await tx
      .update(accountMemberships)
      .set({ freeShipmentsUsed: sql`${accountMemberships.freeShipmentsUsed} + 1` })
      .where(
        and(eq(accountMemberships.id, row.id), lt(accountMemberships.freeShipmentsUsed, allowance)),
      )
      .returning({ id: accountMemberships.id });
    return claimed.length > 0;
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
