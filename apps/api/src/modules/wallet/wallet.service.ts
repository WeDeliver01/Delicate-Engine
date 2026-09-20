import { Injectable } from "@nestjs/common";
import { and, desc, eq, lt, sql } from "drizzle-orm";
import type {
  CreditTermsRequest,
  WalletEntry,
  WalletEntryKind,
  WalletHold,
  WalletSummary,
} from "@delicate/contracts";
import { accounts, walletEntries, walletHolds, wallets, type DbExecutor } from "@delicate/db";
import { DbService } from "../../infra/db.module.js";
import { AuditService } from "../../infra/audit.service.js";
import { OutboxService } from "../../infra/outbox.service.js";
import { AppError } from "../../common/errors.js";
import { requestContext } from "../../common/request-context.js";

export interface MovementInput {
  accountId: string;
  amountCents: number; // signed
  kind: WalletEntryKind;
  reference?: string | null;
  description: string;
  /** Unique per business fact; a replay returns the original entry instead of double-posting. */
  idempotencyKey: string;
}

export interface HoldInput {
  accountId: string;
  amountCents: number;
  reference?: string | null;
  idempotencyKey: string;
}

/**
 * The only writer of wallet_entries / wallet_holds. Every method that moves money takes the
 * caller's transaction and locks the wallet row first, so concurrent bookings on the same
 * account serialise and the cached balance can never drift from the entries.
 */
@Injectable()
export class WalletService {
  constructor(
    private readonly dbs: DbService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  /** Create the wallet row if missing. Called on account creation and lazily on first use. */
  async ensure(tx: DbExecutor, accountId: string): Promise<void> {
    await tx.insert(wallets).values({ accountId }).onConflictDoNothing();
  }

  /** Lock and return the wallet row; the lock is held until the caller's transaction ends. */
  private async lock(tx: DbExecutor, accountId: string) {
    await this.ensure(tx, accountId);
    const [row] = await tx
      .select()
      .from(wallets)
      .where(eq(wallets.accountId, accountId))
      .for("update");
    if (!row) throw AppError.notFound("wallet");
    return row;
  }

  private async activeHoldsCents(tx: DbExecutor, accountId: string): Promise<number> {
    const [r] = await tx
      .select({ total: sql<number>`coalesce(sum(${walletHolds.amountCents}), 0)::bigint` })
      .from(walletHolds)
      .where(and(eq(walletHolds.accountId, accountId), eq(walletHolds.status, "active")));
    return Number(r?.total ?? 0);
  }

  /** Post a signed movement. Idempotent on `idempotencyKey`. */
  async post(tx: DbExecutor, input: MovementInput): Promise<WalletEntry> {
    if (!Number.isInteger(input.amountCents) || input.amountCents === 0) {
      throw AppError.validation([{ path: ["amountCents"], message: "must be a non-zero integer" }]);
    }
    const existing = await tx.query.walletEntries.findFirst({
      where: eq(walletEntries.idempotencyKey, input.idempotencyKey),
    });
    if (existing) return toEntry(existing);

    const wallet = await this.lock(tx, input.accountId);
    const balanceAfter = wallet.balanceCents + input.amountCents;
    const [entry] = await tx
      .insert(walletEntries)
      .values({
        accountId: input.accountId,
        kind: input.kind,
        amountCents: input.amountCents,
        balanceAfterCents: balanceAfter,
        reference: input.reference ?? null,
        description: input.description,
        idempotencyKey: input.idempotencyKey,
        createdByUserId: requestContext.get()?.userId ?? null,
      })
      .returning();
    await tx
      .update(wallets)
      .set({ balanceCents: balanceAfter })
      .where(eq(wallets.accountId, input.accountId));
    return toEntry(entry!);
  }

  /**
   * Reserve funds for a booking. Fails with 402 `insufficient_funds` when
   * balance + credit − active holds < amount. Idempotent on `idempotencyKey`.
   */
  async placeHold(tx: DbExecutor, input: HoldInput): Promise<WalletHold> {
    if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) {
      throw AppError.validation([{ path: ["amountCents"], message: "must be a positive integer" }]);
    }
    const existing = await tx.query.walletHolds.findFirst({
      where: eq(walletHolds.idempotencyKey, input.idempotencyKey),
    });
    if (existing) return toHold(existing);

    const wallet = await this.lock(tx, input.accountId);
    const held = await this.activeHoldsCents(tx, input.accountId);
    const available = wallet.balanceCents + wallet.creditLimitCents - held;
    if (available < input.amountCents) {
      throw new AppError("insufficient_funds", "insufficient funds for this booking", 402, {
        availableCents: available,
        requiredCents: input.amountCents,
        shortfallCents: input.amountCents - available,
      });
    }
    const [hold] = await tx
      .insert(walletHolds)
      .values({
        accountId: input.accountId,
        amountCents: input.amountCents,
        reference: input.reference ?? null,
        idempotencyKey: input.idempotencyKey,
      })
      .returning();
    return toHold(hold!);
  }

  /** Convert an active hold into a charge (optionally for a different final amount). */
  async captureHold(
    tx: DbExecutor,
    holdId: string,
    opts: { amountCents?: number; description: string },
  ): Promise<WalletEntry> {
    const hold = await tx.query.walletHolds.findFirst({ where: eq(walletHolds.id, holdId) });
    if (!hold) throw AppError.notFound("hold");
    if (hold.status === "captured") {
      const entry = await tx.query.walletEntries.findFirst({
        where: eq(walletEntries.idempotencyKey, `charge:${holdId}`),
      });
      if (entry) return toEntry(entry);
    }
    if (hold.status !== "active")
      throw AppError.conflict("hold_not_active", `hold is ${hold.status}`);

    const amount = opts.amountCents ?? hold.amountCents;
    // Release the hold before posting so the availability check inside `post` is not needed:
    // capturing never fails for funds because the hold already reserved them.
    await tx
      .update(walletHolds)
      .set({ status: "captured", resolvedAt: new Date() })
      .where(eq(walletHolds.id, holdId));
    return this.post(tx, {
      accountId: hold.accountId,
      amountCents: -amount,
      kind: "charge",
      reference: hold.reference,
      description: opts.description,
      idempotencyKey: `charge:${holdId}`,
    });
  }

  async releaseHold(tx: DbExecutor, holdId: string): Promise<WalletHold> {
    const hold = await tx.query.walletHolds.findFirst({ where: eq(walletHolds.id, holdId) });
    if (!hold) throw AppError.notFound("hold");
    if (hold.status === "released") return toHold(hold);
    if (hold.status !== "active")
      throw AppError.conflict("hold_not_active", `hold is ${hold.status}`);
    await this.lock(tx, hold.accountId);
    const [row] = await tx
      .update(walletHolds)
      .set({ status: "released", resolvedAt: new Date() })
      .where(eq(walletHolds.id, holdId))
      .returning();
    return toHold(row!);
  }

  async summary(accountId: string, tx?: DbExecutor): Promise<WalletSummary> {
    const db = tx ?? this.dbs.db;
    await this.ensure(db, accountId);
    const [wallet, account, held] = await Promise.all([
      db.query.wallets.findFirst({ where: eq(wallets.accountId, accountId) }),
      db.query.accounts.findFirst({
        where: eq(accounts.id, accountId),
        columns: { billingMode: true },
      }),
      this.activeHoldsCents(db, accountId),
    ]);
    if (!wallet || !account) throw AppError.notFound("wallet");
    return {
      accountId,
      billingMode: account.billingMode,
      balanceCents: wallet.balanceCents,
      creditLimitCents: wallet.creditLimitCents,
      heldCents: held,
      availableCents: wallet.balanceCents + wallet.creditLimitCents - held,
      currency: "ZAR",
    };
  }

  async entries(
    accountId: string,
    limit: number,
    cursor?: string,
  ): Promise<{ items: WalletEntry[]; nextCursor: string | null }> {
    const cursorDate = cursor ? new Date(cursor) : null;
    const rows = await this.dbs.db
      .select()
      .from(walletEntries)
      .where(
        and(
          eq(walletEntries.accountId, accountId),
          cursorDate ? lt(walletEntries.createdAt, cursorDate) : undefined,
        ),
      )
      .orderBy(desc(walletEntries.createdAt))
      .limit(limit + 1);
    const items = rows.slice(0, limit).map(toEntry);
    return { items, nextCursor: rows.length > limit ? items[items.length - 1]!.createdAt : null };
  }

  /** Reconciliation: the cached balance must equal the sum of entries. */
  async verify(
    accountId: string,
  ): Promise<{ ok: boolean; cachedCents: number; derivedCents: number }> {
    const [w] = await this.dbs.db
      .select({ balance: wallets.balanceCents })
      .from(wallets)
      .where(eq(wallets.accountId, accountId));
    const [d] = await this.dbs.db
      .select({ total: sql<number>`coalesce(sum(${walletEntries.amountCents}), 0)::bigint` })
      .from(walletEntries)
      .where(eq(walletEntries.accountId, accountId));
    const cachedCents = Number(w?.balance ?? 0);
    const derivedCents = Number(d?.total ?? 0);
    return { ok: cachedCents === derivedCents, cachedCents, derivedCents };
  }

  // ── finance operations (audited, evented) ─────────────────────────────────

  async adjust(accountId: string, amountCents: number, reason: string): Promise<WalletEntry> {
    return this.dbs.transaction(async (tx) => {
      const entry = await this.post(tx, {
        accountId,
        amountCents,
        kind: "adjustment",
        description: `Adjustment: ${reason}`,
        idempotencyKey: `adjust:${requestContext.get()?.requestId ?? crypto.randomUUID()}`,
      });
      await this.audit.record(tx, {
        action: "wallet.adjust",
        entityType: "wallet",
        entityId: accountId,
        after: { amountCents, reason, entryId: entry.id },
      });
      await this.outbox.emit(
        tx,
        "wallet.adjusted",
        { accountId, entryId: entry.id, amountCents, reason },
        { dedupeKey: `wallet:adjust:${entry.id}` },
      );
      return entry;
    });
  }

  async setCreditTerms(accountId: string, input: CreditTermsRequest): Promise<WalletSummary> {
    return this.dbs.transaction(async (tx) => {
      const before = await this.lock(tx, accountId);
      const account = await tx.query.accounts.findFirst({ where: eq(accounts.id, accountId) });
      if (!account) throw AppError.notFound("account");
      const creditLimitCents = input.billingMode === "postpaid" ? input.creditLimitCents : 0;
      await tx
        .update(wallets)
        .set({
          creditLimitCents,
          statementDay: input.statementDay,
          paymentTermsDays: input.paymentTermsDays,
        })
        .where(eq(wallets.accountId, accountId));
      await tx
        .update(accounts)
        .set({ billingMode: input.billingMode })
        .where(eq(accounts.id, accountId));
      await this.audit.record(tx, {
        action: "account.credit_terms",
        entityType: "account",
        entityId: accountId,
        before: {
          billingMode: account.billingMode,
          creditLimitCents: before.creditLimitCents,
          statementDay: before.statementDay,
          paymentTermsDays: before.paymentTermsDays,
        },
        after: { ...input, creditLimitCents },
      });
      await this.outbox.emit(
        tx,
        "account.credit_terms_changed",
        { accountId, billingMode: input.billingMode, creditLimitCents },
        { dedupeKey: `credit_terms:${accountId}:${Date.now()}` },
      );
      return this.summary(accountId, tx);
    });
  }
}

export function toEntry(r: typeof walletEntries.$inferSelect): WalletEntry {
  return {
    id: r.id,
    accountId: r.accountId,
    kind: r.kind,
    amountCents: r.amountCents,
    balanceAfterCents: r.balanceAfterCents,
    reference: r.reference,
    description: r.description,
    createdAt: r.createdAt.toISOString(),
  };
}

export function toHold(r: typeof walletHolds.$inferSelect): WalletHold {
  return {
    id: r.id,
    accountId: r.accountId,
    amountCents: r.amountCents,
    status: r.status,
    reference: r.reference,
    createdAt: r.createdAt.toISOString(),
    resolvedAt: r.resolvedAt?.toISOString() ?? null,
  };
}
