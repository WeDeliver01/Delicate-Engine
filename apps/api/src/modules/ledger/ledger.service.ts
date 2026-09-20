import { Injectable } from "@nestjs/common";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import type {
  AccountBalance,
  Journal,
  JournalKind,
  JournalLine,
  LedgerAccount,
  OwnerType,
} from "@delicate/contracts";
import { journalLines, journals, type DbExecutor } from "@delicate/db";
import { DbService } from "../../infra/db.module.js";
import { AppError } from "../../common/errors.js";

export interface PostJournalInput {
  kind: JournalKind;
  refType?: string | null;
  refId?: string | null;
  description: string;
  idempotencyKey: string;
  occurredAt?: Date;
  lines: JournalLine[];
}

/**
 * The only writer of the double-entry ledger (invariant #3). A journal is accepted only if its
 * lines sum to zero; it is idempotent on its key so redelivered events cannot double-post.
 * Balances are derived by summing lines — never cached here.
 */
@Injectable()
export class LedgerService {
  constructor(private readonly dbs: DbService) {}

  async post(tx: DbExecutor, input: PostJournalInput): Promise<Journal> {
    const lines = input.lines.filter((l) => l.amountCents !== 0);
    if (lines.length < 2)
      throw new AppError("journal_invalid", "a journal needs at least two non-zero lines", 500);
    const sum = lines.reduce((s, l) => s + l.amountCents, 0);
    if (sum !== 0) {
      throw new AppError("journal_unbalanced", `journal does not balance (sum ${sum})`, 500, {
        lines,
      });
    }
    for (const l of lines) {
      if (!Number.isInteger(l.amountCents))
        throw new AppError("journal_invalid", "amounts must be integer cents", 500);
      if (l.ownerType !== "company" && !l.ownerId)
        throw new AppError("journal_invalid", `${l.account} needs an owner id`, 500);
    }

    const existing = await tx.query.journals.findFirst({
      where: eq(journals.idempotencyKey, input.idempotencyKey),
    });
    if (existing) return this.get(existing.id, tx);

    const [j] = await tx
      .insert(journals)
      .values({
        kind: input.kind,
        refType: input.refType ?? null,
        refId: input.refId ?? null,
        description: input.description,
        idempotencyKey: input.idempotencyKey,
        occurredAt: input.occurredAt ?? new Date(),
      })
      .returning();
    await tx.insert(journalLines).values(
      lines.map((l) => ({
        journalId: j!.id,
        account: l.account,
        ownerType: l.ownerType,
        ownerId: l.ownerType === "company" ? null : l.ownerId,
        amountCents: l.amountCents,
        memo: l.memo ?? null,
      })),
    );
    return { ...toJournal(j!), lines };
  }

  async get(id: string, tx?: DbExecutor): Promise<Journal> {
    const db = tx ?? this.dbs.db;
    const j = await db.query.journals.findFirst({ where: eq(journals.id, id) });
    if (!j) throw AppError.notFound("journal");
    const lines = await db.select().from(journalLines).where(eq(journalLines.journalId, id));
    return {
      ...toJournal(j),
      lines: lines.map((l) => ({
        account: l.account as LedgerAccount,
        ownerType: l.ownerType,
        ownerId: l.ownerId,
        amountCents: l.amountCents,
        memo: l.memo,
      })),
    };
  }

  async balance(
    account: LedgerAccount,
    ownerType: OwnerType,
    ownerId: string | null,
    tx?: DbExecutor,
  ): Promise<number> {
    const db = tx ?? this.dbs.db;
    const [r] = await db
      .select({ total: sql<number>`coalesce(sum(${journalLines.amountCents}), 0)::bigint` })
      .from(journalLines)
      .where(
        and(
          eq(journalLines.account, account),
          eq(journalLines.ownerType, ownerType),
          ownerId ? eq(journalLines.ownerId, ownerId) : isNull(journalLines.ownerId),
        ),
      );
    return Number(r?.total ?? 0);
  }

  /** Trial balance: every account/owner with a non-zero balance. Must sum to zero overall. */
  async trialBalance(): Promise<{ rows: AccountBalance[]; totalCents: number }> {
    const rows = await this.dbs.db
      .select({
        account: journalLines.account,
        ownerType: journalLines.ownerType,
        ownerId: journalLines.ownerId,
        balance: sql<number>`sum(${journalLines.amountCents})::bigint`,
      })
      .from(journalLines)
      .groupBy(journalLines.account, journalLines.ownerType, journalLines.ownerId)
      .orderBy(journalLines.account);
    const out = rows
      .map((r) => ({
        account: r.account as LedgerAccount,
        ownerType: r.ownerType,
        ownerId: r.ownerId,
        balanceCents: Number(r.balance),
      }))
      .filter((r) => r.balanceCents !== 0);
    return { rows: out, totalCents: out.reduce((s, r) => s + r.balanceCents, 0) };
  }

  async listJournals(opts: { limit: number; cursor?: string; kind?: JournalKind; refId?: string }) {
    const cursorDate = opts.cursor ? new Date(opts.cursor) : null;
    const rows = await this.dbs.db
      .select()
      .from(journals)
      .where(
        and(
          opts.kind ? eq(journals.kind, opts.kind) : undefined,
          opts.refId ? eq(journals.refId, opts.refId) : undefined,
          cursorDate ? sql`${journals.createdAt} < ${cursorDate}` : undefined,
        ),
      )
      .orderBy(desc(journals.createdAt))
      .limit(opts.limit + 1);
    const page = rows.slice(0, opts.limit);
    const items = await Promise.all(page.map((j) => this.get(j.id)));
    return {
      items,
      nextCursor: rows.length > opts.limit ? page[page.length - 1]!.createdAt.toISOString() : null,
    };
  }
}

function toJournal(j: typeof journals.$inferSelect): Omit<Journal, "lines"> {
  return {
    id: j.id,
    kind: j.kind,
    refType: j.refType,
    refId: j.refId,
    description: j.description,
    occurredAt: j.occurredAt.toISOString(),
  };
}

/** Helpers to write lines without sign mistakes: debit positive, credit negative. */
export const dr = (
  account: LedgerAccount,
  amountCents: number,
  owner: { type: OwnerType; id?: string | null } = { type: "company" },
  memo: string | null = null,
): JournalLine => ({
  account,
  ownerType: owner.type,
  ownerId: owner.id ?? null,
  amountCents: Math.abs(amountCents),
  memo,
});
export const cr = (
  account: LedgerAccount,
  amountCents: number,
  owner: { type: OwnerType; id?: string | null } = { type: "company" },
  memo: string | null = null,
): JournalLine => ({
  account,
  ownerType: owner.type,
  ownerId: owner.id ?? null,
  amountCents: -Math.abs(amountCents),
  memo,
});
