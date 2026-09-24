import { Injectable } from "@nestjs/common";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import {
  allocate,
  urgencyBps,
  type AllocationLine,
  type AllocationResult,
  type AllocationTransaction,
  type AllocationWallet,
  type AllocationWalletInput,
  type TreasuryDashboard,
  type TreasuryPolicy,
  type UpsertWalletRequest,
  type WalletForecast,
} from "@delicate/contracts";
import { allocationTransactions, allocationWallets, type DbExecutor } from "@delicate/db";
import { DbService } from "../../infra/db.module.js";
import { OutboxService } from "../../infra/outbox.service.js";
import { SettingsService } from "../../infra/settings.service.js";
import { AuditService } from "../../infra/audit.service.js";
import { Clock } from "../../infra/clock.js";
import { AppError } from "../../common/errors.js";

export interface AllocateInput {
  /** What produced the margin, e.g. `shipment:<uuid>`. Unique per business fact. */
  reference: string;
  marginCents: number;
  shipmentId?: string | null;
  memo?: string;
  /** Overrides the clock; used when back-filling a settlement into its own period. */
  at?: Date;
}

/**
 * Treasury (Phase 3A). Turns every settled delivery's contribution margin into earmarks across
 * the allocation wallets, using the pure `allocate()` engine so the split is reproducible.
 *
 * Reconciliation rule — the treasury equivalent of "journals balance":
 *
 *     sum(allocation_transactions where reference = R) === margin of R
 *
 * Guaranteed because retained earnings is an unbounded sink that absorbs the remainder, and
 * because a negative margin (a loss-making drop) is booked straight against that sink.
 *
 * Idempotent: every row carries `idempotencyKey`, and a replayed `settlement.posted` finds the
 * reference already allocated and returns the stored result rather than double-counting.
 *
 * This service never moves money. A funded wallet becomes a *payment proposal* for a human to
 * execute (invariant #7).
 */
@Injectable()
export class TreasuryService {
  constructor(
    private readonly dbs: DbService,
    private readonly outbox: OutboxService,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
    private readonly clock: Clock,
  ) {}

  // ── allocation ────────────────────────────────────────────────────────────────

  /**
   * Earmark `marginCents` across the wallets. Must be called inside the caller's transaction so
   * the allocation commits with whatever produced it.
   */
  async allocateMargin(tx: DbExecutor, input: AllocateInput): Promise<AllocationResult> {
    const at = input.at ?? this.clock.now();
    const period = periodOf(at);

    const already = await tx
      .select()
      .from(allocationTransactions)
      .where(eq(allocationTransactions.reference, input.reference));
    if (already.length > 0) return this.resultFrom(tx, input.reference, already);

    // Lock every wallet in a stable order so concurrent settlements cannot interleave balances.
    const wallets = await tx
      .select()
      .from(allocationWallets)
      .where(eq(allocationWallets.active, true))
      .orderBy(allocationWallets.id)
      .for("update");
    if (wallets.length === 0)
      throw new AppError("treasury_unconfigured", "no allocation wallets", 500);

    const funded = await this.fundedThisPeriod(tx, period);
    const policy = await this.settings.get("treasury.policy", tx);
    const daysInMonth = daysInMonthOf(at.getUTCFullYear(), at.getUTCMonth() + 1);

    const lines =
      input.marginCents >= 0
        ? allocate({
            marginCents: input.marginCents,
            wallets: wallets.map((w) => toAllocationInput(w, funded.get(w.id) ?? 0)),
            policy,
            dayOfMonth: at.getUTCDate(),
            daysInMonth,
          })
        : lossLine(wallets, input.marginCents);

    const written = await this.write(tx, lines, {
      reference: input.reference,
      period,
      memo: input.memo,
    });

    const total = written.reduce((s, l) => s + l.amountCents, 0);
    if (total !== input.marginCents) {
      // Belt and braces: the engine guarantees this, so a mismatch is a bug worth failing on.
      throw new AppError(
        "allocation_unbalanced",
        `allocation for ${input.reference} totals ${total}, expected ${input.marginCents}`,
        500,
      );
    }

    await this.outbox.emit(
      tx,
      "treasury.allocated",
      {
        settlementRef: input.reference,
        shipmentId: input.shipmentId ?? null,
        period,
        marginCents: input.marginCents,
        lines: written.map((l) => ({
          walletId: l.walletId,
          walletSlug: l.walletSlug,
          amountCents: l.amountCents,
        })),
      },
      { dedupeKey: `treasury:${input.reference}:allocated` },
    );

    return {
      settlementRef: input.reference,
      marginCents: input.marginCents,
      period,
      lines: written.map((l) => ({
        walletSlug: l.walletSlug,
        name: l.name,
        amountCents: l.amountCents,
        kind: l.kind,
      })),
    };
  }

  /**
   * Undo an allocation with mirror rows (append-only: nothing is deleted). Used when a
   * settlement is reversed.
   */
  async reverse(tx: DbExecutor, reference: string, memo: string): Promise<AllocationResult> {
    const rows = await tx
      .select()
      .from(allocationTransactions)
      .where(eq(allocationTransactions.reference, reference));
    const forward = rows.filter((r) => r.kind !== "reversal");
    if (forward.length === 0) throw AppError.notFound("allocation");
    if (rows.some((r) => r.kind === "reversal")) {
      return this.resultFrom(tx, reference, rows);
    }

    const ids = [...new Set(forward.map((r) => r.walletId))];
    const wallets = await tx
      .select()
      .from(allocationWallets)
      .where(inArray(allocationWallets.id, ids))
      .orderBy(allocationWallets.id)
      .for("update");

    const lines: AllocationLine[] = forward.map((r) => {
      const w = wallets.find((x) => x.id === r.walletId)!;
      return {
        walletId: w.id,
        walletSlug: w.slug,
        name: w.name,
        amountCents: -r.amountCents,
        kind: "reversal" as const,
      };
    });
    const period = forward[0]!.period;
    await this.write(tx, lines, {
      reference,
      period,
      memo,
      // One mirror per forward row: a wallet may hold both an allocation and an overflow line.
      keyOf: (_l, i) => `allocation:${reference}:reversal:${forward[i]!.id}`,
    });
    await this.audit.record(tx, {
      action: "treasury.reverse",
      entityType: "allocation",
      entityId: reference,
      before: { lines: forward.map((r) => ({ walletId: r.walletId, amountCents: r.amountCents })) },
      after: { reversed: true, memo },
    });

    const after = await tx
      .select()
      .from(allocationTransactions)
      .where(eq(allocationTransactions.reference, reference));
    return this.resultFrom(tx, reference, after);
  }

  /** Insert the lines and move the denormalised balances. Returns what was written. */
  private async write(
    tx: DbExecutor,
    lines: AllocationLine[],
    ctx: {
      reference: string;
      period: string;
      memo?: string;
      keyOf?: (line: AllocationLine, index: number) => string;
    },
  ): Promise<AllocationLine[]> {
    const written: AllocationLine[] = [];
    for (const [index, line] of lines.entries()) {
      if (line.amountCents === 0) continue;
      const [updated] = await tx
        .update(allocationWallets)
        .set({ balanceCents: sql`${allocationWallets.balanceCents} + ${line.amountCents}` })
        .where(eq(allocationWallets.id, line.walletId))
        .returning({ balanceCents: allocationWallets.balanceCents });

      const key =
        ctx.keyOf?.(line, index) ??
        ["allocation", ctx.reference, line.walletId, line.kind].join(":");
      const inserted = await tx
        .insert(allocationTransactions)
        .values({
          walletId: line.walletId,
          kind: line.kind,
          amountCents: line.amountCents,
          balanceAfterCents: updated!.balanceCents,
          reference: ctx.reference,
          period: ctx.period,
          idempotencyKey: key,
          memo: ctx.memo ?? null,
        })
        .onConflictDoNothing({ target: allocationTransactions.idempotencyKey })
        .returning({ id: allocationTransactions.id });
      if (inserted.length === 0) {
        // Lost a race with a concurrent replay: undo the balance move and skip the line.
        await tx
          .update(allocationWallets)
          .set({ balanceCents: sql`${allocationWallets.balanceCents} - ${line.amountCents}` })
          .where(eq(allocationWallets.id, line.walletId));
        continue;
      }
      written.push(line);
    }
    return written;
  }

  /** How much each wallet received in `period` — what "funding progress" means. */
  private async fundedThisPeriod(tx: DbExecutor, period: string): Promise<Map<string, number>> {
    const rows = await tx
      .select({
        walletId: allocationTransactions.walletId,
        total: sql<string>`coalesce(sum(${allocationTransactions.amountCents}), 0)::bigint`,
      })
      .from(allocationTransactions)
      .where(eq(allocationTransactions.period, period))
      .groupBy(allocationTransactions.walletId);
    return new Map(rows.map((r) => [r.walletId, Number(r.total)]));
  }

  private async resultFrom(
    tx: DbExecutor,
    reference: string,
    rows: (typeof allocationTransactions.$inferSelect)[],
  ): Promise<AllocationResult> {
    const wallets = await tx.select().from(allocationWallets);
    const byId = new Map(wallets.map((w) => [w.id, w]));
    return {
      settlementRef: reference,
      marginCents: rows.reduce((s, r) => s + r.amountCents, 0),
      period: rows[0]?.period ?? periodOf(this.clock.now()),
      lines: rows.map((r) => ({
        walletSlug: byId.get(r.walletId)?.slug ?? "unknown",
        name: byId.get(r.walletId)?.name ?? "unknown",
        amountCents: r.amountCents,
        kind: r.kind,
      })),
    };
  }

  // ── reads ─────────────────────────────────────────────────────────────────────

  async listWallets(): Promise<AllocationWallet[]> {
    const rows = await this.dbs.db
      .select()
      .from(allocationWallets)
      .orderBy(allocationWallets.category, allocationWallets.priority);
    return rows.map(toWallet);
  }

  async transactions(opts: { walletId?: string; period?: string; limit?: number } = {}) {
    const where = [
      opts.walletId ? eq(allocationTransactions.walletId, opts.walletId) : undefined,
      opts.period ? eq(allocationTransactions.period, opts.period) : undefined,
    ].filter(Boolean);
    const rows = await this.dbs.db
      .select()
      .from(allocationTransactions)
      .where(where.length ? and(...where) : undefined)
      .orderBy(desc(allocationTransactions.createdAt))
      .limit(Math.min(opts.limit ?? 50, 200));
    const wallets = await this.dbs.db.select().from(allocationWallets);
    const byId = new Map(wallets.map((w) => [w.id, w]));
    return rows.map((r) => toTransaction(r, byId.get(r.walletId)?.slug ?? "unknown"));
  }

  /** The treasury dashboard: funding progress, what is at risk, and what is due next. */
  async dashboard(period?: string): Promise<TreasuryDashboard> {
    const now = this.clock.now();
    const p = period ?? periodOf(now);
    const current = p === periodOf(now);
    const dayOfMonth = current ? now.getUTCDate() : 1;
    const daysInMonth = daysInMonthOf(Number(p.slice(0, 4)), Number(p.slice(5, 7)));

    const wallets = await this.dbs.db
      .select()
      .from(allocationWallets)
      .where(eq(allocationWallets.active, true))
      .orderBy(allocationWallets.priority);
    const funded = await this.fundedThisPeriod(this.dbs.db, p);
    const policy = await this.settings.get("treasury.policy");

    const forecasts = wallets.map((w) =>
      forecastFor(w, funded.get(w.id) ?? 0, dayOfMonth, daysInMonth),
    );
    const operating = forecasts.filter((f) => f.category === "operating_expense");
    const obligationsTotalCents = operating.reduce((s, f) => s + f.targetCents, 0);
    const obligationsFundedCents = operating.reduce(
      (s, f) => s + Math.min(f.fundedCents, f.targetCents),
      0,
    );
    const projected = operating.reduce((s, f) => s + Math.min(f.projectedCents, f.targetCents), 0);

    const marginThisPeriodCents = [...funded.values()].reduce((s, v) => s + v, 0);

    return {
      period: p,
      healthScore: healthScore(operating, policy, dayOfMonth, daysInMonth),
      marginThisPeriodCents,
      obligationsTotalCents,
      obligationsFundedCents,
      projectedCoverageBps:
        obligationsTotalCents > 0
          ? Math.min(10_000, Math.round((projected / obligationsTotalCents) * 10_000))
          : 10_000,
      shortfallCents: Math.max(0, obligationsTotalCents - obligationsFundedCents),
      operating,
      reserves: forecasts.filter((f) => f.category === "reserve"),
      capital: forecasts.filter((f) => f.category === "capital"),
      availableOperatingCashCents: wallets
        .filter((w) => w.category === "operating_expense")
        .reduce((s, w) => s + w.balanceCents, 0),
      upcomingDebitOrders: wallets
        .filter((w) => w.dueDay !== null && (w.obligationAmountCents ?? 0) > 0)
        .sort(
          (a, b) =>
            daysUntil(a.dueDay!, dayOfMonth, daysInMonth) -
            daysUntil(b.dueDay!, dayOfMonth, daysInMonth),
        )
        .map((w) => ({
          slug: w.slug,
          name: w.name,
          vendor: w.vendor ?? "",
          amountCents: w.obligationAmountCents ?? 0,
          dueDay: w.dueDay!,
          fundedCents: funded.get(w.id) ?? 0,
          covered: (funded.get(w.id) ?? 0) >= (w.obligationAmountCents ?? 0),
        })),
      recent: await this.transactions({ period: p, limit: 25 }),
    };
  }

  // ── admin ─────────────────────────────────────────────────────────────────────

  async upsertWallet(slug: string, body: UpsertWalletRequest): Promise<AllocationWallet> {
    return this.dbs.transaction(async (tx) => {
      const before = await tx.query.allocationWallets.findFirst({
        where: eq(allocationWallets.slug, slug),
      });
      const values = {
        slug,
        name: body.name,
        category: body.category,
        priority: body.priority ?? 10,
        active: body.active ?? true,
        vendor: body.obligation?.vendor ?? null,
        obligationAmountCents: body.obligation?.monthlyAmountCents ?? null,
        dueDay: body.obligation?.dueDay ?? null,
        monthlyTargetCents: body.monthlyTargetCents ?? null,
      };
      const [row] = await tx
        .insert(allocationWallets)
        .values(values)
        .onConflictDoUpdate({ target: allocationWallets.slug, set: values })
        .returning();
      await this.audit.record(tx, {
        action: before ? "treasury.wallet.update" : "treasury.wallet.create",
        entityType: "allocation_wallet",
        entityId: row!.id,
        before: before ?? null,
        after: row!,
      });
      return toWallet(row!);
    });
  }

  async policy(): Promise<TreasuryPolicy> {
    return this.settings.get("treasury.policy");
  }

  async setPolicy(policy: TreasuryPolicy): Promise<TreasuryPolicy> {
    await this.settings.set("treasury.policy", policy);
    return policy;
  }
}

// ── helpers ─────────────────────────────────────────────────────────────────────

/** YYYY-MM. Funding progress is per calendar month, so a new month starts everything at zero. */
export function periodOf(at: Date): string {
  return `${at.getUTCFullYear()}-${String(at.getUTCMonth() + 1).padStart(2, "0")}`;
}

/**
 * Days in a 1-indexed month. Built in UTC on purpose: `new Date(y, m, 0)` builds a *local*
 * midnight, which in SAST reports 29 days for September and would drag debit orders into the
 * urgency window a day early.
 */
function daysInMonthOf(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function daysUntil(dueDay: number, dayOfMonth: number, daysInMonth: number): number {
  return dueDay >= dayOfMonth ? dueDay - dayOfMonth : daysInMonth - dayOfMonth + dueDay;
}

/** A loss-making drop is booked straight against the sink, so the reconciliation rule holds. */
function lossLine(
  wallets: (typeof allocationWallets.$inferSelect)[],
  marginCents: number,
): AllocationLine[] {
  const sink = wallets.find((w) => w.isRetainedEarnings);
  if (!sink) throw new AppError("treasury_unconfigured", "no retained-earnings wallet", 500);
  return [
    {
      walletId: sink.id,
      walletSlug: sink.slug,
      name: sink.name,
      amountCents: marginCents,
      kind: "adjustment",
    },
  ];
}

function toAllocationInput(
  w: typeof allocationWallets.$inferSelect,
  fundedCents: number,
): AllocationWalletInput {
  return {
    id: w.id,
    slug: w.slug,
    name: w.name,
    category: w.category,
    priority: w.priority,
    isRetainedEarnings: w.isRetainedEarnings,
    targetCents:
      w.category === "operating_expense"
        ? (w.obligationAmountCents ?? 0)
        : (w.monthlyTargetCents ?? 0),
    fundedCents: Math.max(0, fundedCents),
    dueDay: w.dueDay,
  };
}

function forecastFor(
  w: typeof allocationWallets.$inferSelect,
  fundedCents: number,
  dayOfMonth: number,
  daysInMonth: number,
): WalletForecast {
  const targetCents =
    w.category === "operating_expense"
      ? (w.obligationAmountCents ?? 0)
      : (w.monthlyTargetCents ?? 0);
  const remainingCents = Math.max(0, targetCents - fundedCents);
  // Straight-line run rate: what this month ends at if the rest of it looks like the days so far.
  const projectedCents = Math.round((fundedCents / Math.max(1, dayOfMonth)) * daysInMonth);
  const until = w.dueDay !== null ? daysUntil(w.dueDay, dayOfMonth, daysInMonth) : null;
  const projectedByDue =
    until !== null
      ? Math.round((fundedCents / Math.max(1, dayOfMonth)) * (dayOfMonth + until))
      : projectedCents;
  return {
    walletId: w.id,
    slug: w.slug,
    name: w.name,
    category: w.category,
    targetCents,
    fundedCents,
    remainingCents,
    progressBps:
      targetCents > 0 ? Math.min(10_000, Math.round((fundedCents / targetCents) * 10_000)) : 10_000,
    dueDay: w.dueDay,
    daysUntilDue: until,
    projectedCents,
    atRisk: targetCents > 0 && remainingCents > 0 && projectedByDue < targetCents,
  };
}

/**
 * 0–100. Each obligation contributes its funding progress, weighted by urgency — a rent bill due
 * tomorrow and unfunded drags the score far harder than one due in three weeks.
 */
function healthScore(
  operating: WalletForecast[],
  policy: TreasuryPolicy,
  dayOfMonth: number,
  daysInMonth: number,
): number {
  const rows = operating.filter((f) => f.targetCents > 0);
  if (rows.length === 0) return 100;
  let weighted = 0;
  let weights = 0;
  for (const f of rows) {
    const urgency = f.dueDay ? urgencyBps(f.dueDay, dayOfMonth, daysInMonth, policy) : 10_000;
    const weight = f.targetCents * urgency;
    weighted += weight * (f.progressBps / 10_000);
    weights += weight;
  }
  return Math.round((weighted / weights) * 100);
}

function toWallet(r: typeof allocationWallets.$inferSelect): AllocationWallet {
  return {
    id: r.id,
    slug: r.slug,
    name: r.name,
    category: r.category,
    priority: r.priority,
    balanceCents: r.balanceCents,
    active: r.active,
    obligation:
      r.obligationAmountCents !== null && r.dueDay !== null
        ? { vendor: r.vendor ?? "", monthlyAmountCents: r.obligationAmountCents, dueDay: r.dueDay }
        : null,
    monthlyTargetCents: r.monthlyTargetCents,
    isRetainedEarnings: r.isRetainedEarnings,
  };
}

function toTransaction(
  r: typeof allocationTransactions.$inferSelect,
  walletSlug: string,
): AllocationTransaction {
  return {
    id: r.id,
    walletId: r.walletId,
    walletSlug,
    kind: r.kind,
    amountCents: r.amountCents,
    balanceAfterCents: r.balanceAfterCents,
    reference: r.reference,
    period: r.period,
    createdAt: r.createdAt.toISOString(),
  };
}
