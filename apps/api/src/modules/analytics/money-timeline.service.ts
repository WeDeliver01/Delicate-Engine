import { Injectable } from "@nestjs/common";
import { and, desc, eq, gte, lt, sql } from "drizzle-orm";
import {
  rangeToInstants,
  resolvePeriod,
  type DateRange,
  type PeriodKey,
} from "@delicate/contracts";
import { invoices, loyaltyAwards, walletEntries, walletHolds } from "@delicate/db";
import { DbService } from "../../infra/db.module.js";
import { Clock } from "../../infra/clock.js";

/**
 * Every time money moved on an account, in one list.
 *
 * The pieces already exist — wallet entries, invoices, top-ups, cashback — but each on its own
 * page, which means answering "where did R4,000 go last month" involves three tabs and a
 * subtraction. This merges them into one timeline in date order, which is how the question is
 * actually asked.
 *
 * Read-only and derived: nothing here is a source of truth. The wallet ledger remains the only
 * account of the balance, and this never adds up to a different answer because it does not add
 * up at all — it lists.
 */

export type MoneyEventKind =
  | "topup"
  | "charge"
  | "refund"
  | "adjustment"
  | "cashback"
  | "statement_payment"
  | "invoice"
  | "hold"
  | "hold_released";

export interface MoneyEvent {
  id: string;
  kind: MoneyEventKind;
  at: string;
  description: string;
  reference: string | null;
  /** Positive is money towards the customer, negative is money away from them. */
  amountCents: number;
  /** The wallet balance immediately after, where the event touched the wallet. */
  balanceAfterCents: number | null;
  status: string | null;
  /** Where to go for the detail, relative to the portal. */
  href: string | null;
}

@Injectable()
export class MoneyTimelineService {
  constructor(
    private readonly dbs: DbService,
    private readonly clock: Clock,
  ) {}

  async forAccount(
    accountId: string,
    period: PeriodKey,
    from?: string,
    to?: string,
  ): Promise<{
    range: DateRange;
    totals: {
      inCents: number;
      outCents: number;
      cashbackCents: number;
      invoicedCents: number;
      heldCents: number;
    };
    events: MoneyEvent[];
  }> {
    const range = resolvePeriod(period, {
      now: this.clock.now(),
      from: from ?? null,
      to: to ?? null,
    });
    const { from: start, toExclusive } = rangeToInstants(range);

    const [entries, issued, holds, awards] = await Promise.all([
      this.dbs.db
        .select()
        .from(walletEntries)
        .where(
          and(
            eq(walletEntries.accountId, accountId),
            gte(walletEntries.createdAt, start),
            lt(walletEntries.createdAt, toExclusive),
          ),
        )
        .orderBy(desc(walletEntries.createdAt))
        .limit(500),
      this.dbs.db
        .select()
        .from(invoices)
        .where(
          and(
            eq(invoices.accountId, accountId),
            // By issue date, not creation: a draft is not a thing that happened to anyone.
            sql`${invoices.issuedAt} IS NOT NULL`,
            gte(invoices.issuedAt, start),
            lt(invoices.issuedAt, toExclusive),
          ),
        )
        .orderBy(desc(invoices.issuedAt))
        .limit(200),
      this.dbs.db
        .select()
        .from(walletHolds)
        .where(
          and(
            eq(walletHolds.accountId, accountId),
            gte(walletHolds.createdAt, start),
            lt(walletHolds.createdAt, toExclusive),
          ),
        )
        .orderBy(desc(walletHolds.createdAt))
        .limit(200),
      this.dbs.db
        .select()
        .from(loyaltyAwards)
        .where(
          and(
            eq(loyaltyAwards.accountId, accountId),
            gte(loyaltyAwards.createdAt, start),
            lt(loyaltyAwards.createdAt, toExclusive),
          ),
        )
        .limit(200),
    ]);

    const events: MoneyEvent[] = [];

    for (const e of entries) {
      events.push({
        id: e.id,
        kind: e.kind,
        at: e.createdAt.toISOString(),
        description: e.description,
        reference: e.reference,
        amountCents: e.amountCents,
        balanceAfterCents: e.balanceAfterCents,
        status: null,
        href: e.kind === "topup" ? "/portal/wallet" : null,
      });
    }

    for (const inv of issued) {
      events.push({
        id: inv.id,
        kind: "invoice",
        at: inv.issuedAt!.toISOString(),
        description: `${inv.kind === "credit_note" ? "Credit note" : "Invoice"} ${inv.number}`,
        reference: inv.number,
        // A credit note returns money, an invoice claims it. The sign says which without
        // anyone having to know what "kind" means.
        amountCents: inv.kind === "credit_note" ? inv.totalCents : -inv.totalCents,
        balanceAfterCents: null,
        status: inv.outstandingCents > 0 ? "unpaid" : inv.status,
        href: "/portal/invoices",
      });
    }

    for (const h of holds) {
      // A hold is not a charge — the money is still theirs until the parcel is delivered — so
      // it is listed for the explanation it gives, with the amount shown as reserved.
      events.push({
        id: h.id,
        kind: h.status === "active" ? "hold" : "hold_released",
        at: h.createdAt.toISOString(),
        description:
          h.status === "active"
            ? `Reserved for ${h.reference ?? "a booking"}`
            : h.status === "captured"
              ? `Charged from the reservation for ${h.reference ?? "a booking"}`
              : `Reservation released for ${h.reference ?? "a booking"}`,
        reference: h.reference,
        amountCents: 0,
        balanceAfterCents: null,
        status: h.status,
        href: null,
      });
    }

    events.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));

    const sum = (predicate: (e: MoneyEvent) => boolean) =>
      events.filter(predicate).reduce((n, e) => n + Math.abs(e.amountCents), 0);

    return {
      range,
      totals: {
        inCents: sum((e) => e.amountCents > 0 && e.kind !== "invoice"),
        outCents: sum((e) => e.amountCents < 0 && e.kind !== "invoice"),
        cashbackCents: awards.reduce((n, a) => n + a.amountCents, 0),
        invoicedCents: issued
          .filter((i) => i.kind !== "credit_note")
          .reduce((n, i) => n + i.totalCents, 0),
        heldCents: holds
          .filter((h) => h.status === "active")
          .reduce((n, h) => n + h.amountCents, 0),
      },
      events,
    };
  }
}
