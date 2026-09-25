import { Injectable } from "@nestjs/common";
import { and, desc, eq, gte, ne, sql } from "drizzle-orm";
import type { LoyaltyAward, LoyaltyProgram, LoyaltyStatus, LoyaltyTier } from "@delicate/contracts";
import { bookings, loyaltyAwards, settlements, type DbExecutor } from "@delicate/db";
import { DbService } from "../../infra/db.module.js";
import { SettingsService } from "../../infra/settings.service.js";
import { AuditService } from "../../infra/audit.service.js";
import { Clock } from "../../infra/clock.js";
import { AppError } from "../../common/errors.js";
import { LedgerService, cr, dr } from "../ledger/ledger.service.js";
import { WalletService } from "../wallet/wallet.service.js";

/**
 * Loyalty (Phase 4E).
 *
 * Cashback is credited into the wallet, so the reward costs exactly what it says and the customer
 * can spend it on the next delivery. It is earned on `booking.charged` — money actually taken —
 * never on a booking merely made, because cashback on a booking that is later cancelled would be
 * a way to mint money.
 *
 * It is calculated on the charge **excluding VAT**: VAT is SARS's money passing through, not
 * revenue, and paying a percentage of it back would be paying out of our own pocket.
 */
@Injectable()
export class LoyaltyService {
  constructor(
    private readonly dbs: DbService,
    private readonly settings: SettingsService,
    private readonly ledger: LedgerService,
    private readonly wallet: WalletService,
    private readonly audit: AuditService,
    private readonly clock: Clock,
  ) {}

  async program(): Promise<LoyaltyProgram> {
    return this.settings.get("loyalty.program");
  }

  async setProgram(program: LoyaltyProgram): Promise<LoyaltyProgram> {
    const sorted = [...program.tiers].sort((a, b) => a.minSpendCents - b.minSpendCents);
    if (sorted[0]!.minSpendCents !== 0) {
      throw AppError.validation([
        { path: ["tiers"], message: "the first tier must start at 0, so every customer has one" },
      ]);
    }
    const codes = new Set(sorted.map((t) => t.code));
    if (codes.size !== sorted.length) {
      throw AppError.validation([{ path: ["tiers"], message: "tier codes must be unique" }]);
    }
    await this.settings.set("loyalty.program", { ...program, tiers: sorted });
    return { ...program, tiers: sorted };
  }

  // ── earning ───────────────────────────────────────────────────────────────────

  /**
   * Award cashback for a charged booking. Idempotent on the booking, so a redelivered
   * `booking.charged` cannot pay twice. Returns null when nothing was earned.
   */
  async awardForBooking(bookingId: string): Promise<LoyaltyAward | null> {
    const program = await this.program();
    if (!program.enabled) return null;

    return this.dbs.transaction(async (tx) => {
      const existing = await tx.query.loyaltyAwards.findFirst({
        where: eq(loyaltyAwards.bookingId, bookingId),
      });
      if (existing) return toAward(existing);

      const booking = await tx.query.bookings.findFirst({ where: eq(bookings.id, bookingId) });
      if (!booking) throw AppError.notFound("booking");

      // Excluding VAT: what the business actually earned on this booking.
      const [sum] = await tx
        .select({
          revenue: sql<string>`coalesce(sum(${settlements.revenueCents}), 0)::bigint`,
        })
        .from(settlements)
        .where(eq(settlements.bookingId, bookingId));
      const eligibleCents = Number(sum?.revenue ?? 0);
      if (eligibleCents <= 0) return null;

      const tier = await this.tierFor(tx, booking.accountId, program, bookingId);
      const amountCents = Math.floor((eligibleCents * tier.cashbackBps) / 10_000);
      if (amountCents < program.minAwardCents) return null;

      const entry = await this.wallet.post(tx, {
        accountId: booking.accountId,
        kind: "cashback",
        amountCents,
        description: `${tier.name} cashback on ${booking.reference}`,
        reference: booking.reference,
        idempotencyKey: `loyalty:${bookingId}`,
      });
      const journal = await this.ledger.post(tx, {
        kind: "cashback",
        refType: "booking",
        refId: bookingId,
        description: `Cashback on ${booking.reference}`,
        idempotencyKey: `loyalty:${bookingId}:posted`,
        lines: [
          dr("LOYALTY_EXPENSE", amountCents, { type: "company" }, booking.reference),
          cr(
            "CUSTOMER_PREPAID_LIABILITY",
            amountCents,
            { type: "account", id: booking.accountId },
            booking.reference,
          ),
        ],
      });

      const [row] = await tx
        .insert(loyaltyAwards)
        .values({
          accountId: booking.accountId,
          bookingId,
          reference: booking.reference,
          tierCode: tier.code,
          cashbackBps: tier.cashbackBps,
          eligibleCents,
          amountCents,
          walletEntryId: entry.id,
          journalId: journal.id,
        })
        .returning();
      await this.audit.record(tx, {
        action: "loyalty.award",
        entityType: "account",
        entityId: booking.accountId,
        after: { bookingId, tier: tier.code, amountCents },
      });
      return toAward(row!);
    });
  }

  // ── tiers ─────────────────────────────────────────────────────────────────────

  /**
   * Spend excluding VAT over the rolling window, which is what a tier is earned on.
   *
   * `excludeBookingId` leaves the booking being rewarded out of its own tier calculation. Its
   * settlements already exist by the time cashback is worked out, so without this one large
   * first booking would promote itself and earn the top rate on the very delivery that earned
   * the promotion. A tier is what you earned *before* this delivery; this delivery counts
   * towards the next one.
   */
  private async windowSpend(
    tx: DbExecutor,
    accountId: string,
    windowDays: number,
    excludeBookingId?: string,
  ): Promise<number> {
    const since = new Date(this.clock.now().getTime() - windowDays * 86_400_000);
    const [row] = await tx
      .select({ total: sql<string>`coalesce(sum(${settlements.revenueCents}), 0)::bigint` })
      .from(settlements)
      .where(
        and(
          eq(settlements.accountId, accountId),
          gte(settlements.settledAt, since),
          excludeBookingId ? ne(settlements.bookingId, excludeBookingId) : undefined,
        ),
      );
    return Number(row?.total ?? 0);
  }

  private async tierFor(
    tx: DbExecutor,
    accountId: string,
    program: LoyaltyProgram,
    excludeBookingId?: string,
  ): Promise<LoyaltyTier> {
    const spend = await this.windowSpend(tx, accountId, program.windowDays, excludeBookingId);
    return pickTier(program, spend);
  }

  // ── reads ─────────────────────────────────────────────────────────────────────

  async status(accountId: string): Promise<LoyaltyStatus> {
    const program = await this.program();
    const spend = await this.windowSpend(this.dbs.db, accountId, program.windowDays);
    const tier = pickTier(program, spend);
    const nextTier = program.tiers.find((t) => t.minSpendCents > tier.minSpendCents) ?? null;

    const rows = await this.dbs.db
      .select()
      .from(loyaltyAwards)
      .where(eq(loyaltyAwards.accountId, accountId))
      .orderBy(desc(loyaltyAwards.createdAt))
      .limit(20);

    const since = new Date(this.clock.now().getTime() - program.windowDays * 86_400_000);
    const [totals] = await this.dbs.db
      .select({
        all: sql<string>`coalesce(sum(${loyaltyAwards.amountCents}), 0)::bigint`,
        window: sql<string>`coalesce(sum(${loyaltyAwards.amountCents}) filter (where ${loyaltyAwards.createdAt} >= ${since}), 0)::bigint`,
      })
      .from(loyaltyAwards)
      .where(eq(loyaltyAwards.accountId, accountId));

    return {
      enabled: program.enabled,
      accountId,
      tier,
      nextTier,
      windowDays: program.windowDays,
      windowSpendCents: spend,
      toNextTierCents: nextTier ? Math.max(0, nextTier.minSpendCents - spend) : null,
      earnedAllTimeCents: Number(totals?.all ?? 0),
      earnedThisWindowCents: Number(totals?.window ?? 0),
      recent: rows.map(toAward),
    };
  }

  /** What loyalty has cost the business, for the finance view. */
  async costSummary(): Promise<{
    awards: number;
    totalCents: number;
    byTier: Record<string, number>;
  }> {
    const rows = await this.dbs.db
      .select({
        tierCode: loyaltyAwards.tierCode,
        n: sql<string>`count(*)::int`,
        total: sql<string>`coalesce(sum(${loyaltyAwards.amountCents}), 0)::bigint`,
      })
      .from(loyaltyAwards)
      .groupBy(loyaltyAwards.tierCode);
    return {
      awards: rows.reduce((s, r) => s + Number(r.n), 0),
      totalCents: rows.reduce((s, r) => s + Number(r.total), 0),
      byTier: Object.fromEntries(rows.map((r) => [r.tierCode, Number(r.total)])),
    };
  }
}

/** The highest tier the spend qualifies for. Tiers are stored sorted, so the last match wins. */
export function pickTier(program: LoyaltyProgram, spendCents: number): LoyaltyTier {
  let tier = program.tiers[0]!;
  for (const t of program.tiers) {
    if (spendCents >= t.minSpendCents) tier = t;
  }
  return tier;
}

function toAward(r: typeof loyaltyAwards.$inferSelect): LoyaltyAward {
  return {
    id: r.id,
    accountId: r.accountId,
    bookingId: r.bookingId,
    reference: r.reference,
    tierCode: r.tierCode,
    cashbackBps: r.cashbackBps,
    eligibleCents: r.eligibleCents,
    amountCents: r.amountCents,
    walletEntryId: r.walletEntryId,
    journalId: r.journalId,
    createdAt: r.createdAt.toISOString(),
  };
}
