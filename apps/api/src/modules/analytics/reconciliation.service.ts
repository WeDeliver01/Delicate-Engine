import { Injectable } from "@nestjs/common";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import {
  accounts,
  allocationTransactions,
  allocationWallets,
  drivers,
  invoices,
  journalLines,
  loyaltyAwards,
  outboxMessages,
  paymentProposals,
  settlements,
  walletEntries,
  wallets,
} from "@delicate/db";
import { DbService } from "../../infra/db.module.js";

export interface CheckResult {
  key: string;
  /** What is being proved, in words rather than table names. */
  title: string;
  /** Why it matters — what would be wrong in the world if this failed. */
  why: string;
  ok: boolean;
  /** How far out it is, in cents. Zero when it passes. */
  differenceCents: number;
  detail: string;
  /** The rows that disagree, when any do. */
  offenders: { id: string; label: string; expectedCents: number; actualCents: number }[];
}

export interface ReconciliationReport {
  ranAt: string;
  ok: boolean;
  checks: CheckResult[];
}

/**
 * Reconciliation (Phase 5).
 *
 * Every invariant this engine claims is checkable, so this checks them — against the data, not
 * against the code that wrote it. Cached balances are compared to the append-only rows they
 * summarise, derived totals to the ledger, and money owed to money recorded as owed.
 *
 * It is read-only and repairs nothing on purpose. A drift is a bug with a cause, and a report
 * that quietly fixed what it found would hide the very thing worth knowing.
 */
@Injectable()
export class ReconciliationService {
  constructor(private readonly dbs: DbService) {}

  async run(): Promise<ReconciliationReport> {
    const checks = [
      await this.trialBalance(),
      await this.walletCaches(),
      await this.walletsAgainstLedger(),
      await this.treasuryCaches(),
      await this.marginAgainstAllocations(),
      await this.driverEarnings(),
      await this.fuelPayable(),
      await this.receivables(),
      await this.loyalty(),
      await this.undelivered(),
    ];
    return {
      ranAt: new Date().toISOString(),
      ok: checks.every((c) => c.ok),
      checks,
    };
  }

  /** The one that matters most: if this fails, nothing else can be trusted. */
  private async trialBalance(): Promise<CheckResult> {
    const [row] = await this.dbs.db
      .select({ total: sql<string>`coalesce(sum(${journalLines.amountCents}), 0)::bigint` })
      .from(journalLines);
    const total = Number(row?.total ?? 0);
    return {
      key: "trial-balance",
      title: "Every journal balances",
      why: "Double-entry only means anything if the books sum to zero. A non-zero total is money invented or destroyed.",
      ok: total === 0,
      differenceCents: total,
      detail:
        total === 0 ? "All ledger lines sum to zero." : `The ledger is out by ${total} cents.`,
      offenders: [],
    };
  }

  /** The cached wallet balance against the entries it summarises. */
  private async walletCaches(): Promise<CheckResult> {
    const cached = await this.dbs.db
      .select({ accountId: wallets.accountId, name: accounts.name, balance: wallets.balanceCents })
      .from(wallets)
      .innerJoin(accounts, eq(accounts.id, wallets.accountId));
    const actual = await this.sumBy(
      this.dbs.db
        .select({
          key: walletEntries.accountId,
          total: sql<string>`sum(${walletEntries.amountCents})`,
        })
        .from(walletEntries)
        .groupBy(walletEntries.accountId),
    );
    const offenders = cached
      .filter((w) => w.balance !== (actual.get(w.accountId) ?? 0))
      .map((w) => ({
        id: w.accountId,
        label: w.name,
        expectedCents: actual.get(w.accountId) ?? 0,
        actualCents: w.balance,
      }));
    return this.fromOffenders(
      "wallet-cache",
      "Wallet balances match their entries",
      "The balance shown to a customer is a cache of an append-only log. If they disagree, someone is being shown a number that is not theirs.",
      offenders,
      `${cached.length} wallet(s) checked.`,
    );
  }

  /** Customer money in the wallet against what the ledger says we owe them. */
  private async walletsAgainstLedger(): Promise<CheckResult> {
    const cached = await this.dbs.db
      .select({ accountId: wallets.accountId, name: accounts.name, balance: wallets.balanceCents })
      .from(wallets)
      .innerJoin(accounts, eq(accounts.id, wallets.accountId));
    const ledger = await this.ledgerByOwner("CUSTOMER_PREPAID_LIABILITY");
    // The liability is credit-normal, so what we owe is the negative of its balance.
    const offenders = cached
      .filter((w) => w.balance !== -(ledger.get(w.accountId) ?? 0))
      .map((w) => ({
        id: w.accountId,
        label: w.name,
        expectedCents: -(ledger.get(w.accountId) ?? 0),
        actualCents: w.balance,
      }));
    return this.fromOffenders(
      "wallet-ledger",
      "Wallets agree with the ledger",
      "A customer's wallet is a liability of the business. If the wallet and the books disagree, one of them is lying about what we owe.",
      offenders,
      `${cached.length} account(s) checked.`,
    );
  }

  /** Treasury wallet balances against their own append-only log. */
  private async treasuryCaches(): Promise<CheckResult> {
    const cached = await this.dbs.db
      .select({
        id: allocationWallets.id,
        slug: allocationWallets.slug,
        balance: allocationWallets.balanceCents,
      })
      .from(allocationWallets);
    const actual = await this.sumBy(
      this.dbs.db
        .select({
          key: allocationTransactions.walletId,
          total: sql<string>`sum(${allocationTransactions.amountCents})`,
        })
        .from(allocationTransactions)
        .groupBy(allocationTransactions.walletId),
    );
    const offenders = cached
      .filter((w) => w.balance !== (actual.get(w.id) ?? 0))
      .map((w) => ({
        id: w.id,
        label: w.slug,
        expectedCents: actual.get(w.id) ?? 0,
        actualCents: w.balance,
      }));
    return this.fromOffenders(
      "treasury-cache",
      "Treasury balances match their transactions",
      "The funding progress every allocation decision is based on comes from these balances.",
      offenders,
      `${cached.length} wallet(s) checked.`,
    );
  }

  /** Margin earned against margin earmarked — the treasury reconciliation rule, at scale. */
  private async marginAgainstAllocations(): Promise<CheckResult> {
    const [margin] = await this.dbs.db
      .select({ total: sql<string>`coalesce(sum(${settlements.marginCents}), 0)::bigint` })
      .from(settlements);
    const [allocated] = await this.dbs.db
      .select({
        total: sql<string>`coalesce(sum(${allocationTransactions.amountCents}), 0)::bigint`,
      })
      .from(allocationTransactions)
      .where(
        inArray(allocationTransactions.kind, ["allocation", "overflow", "adjustment", "reversal"]),
      );
    const difference = Number(allocated?.total ?? 0) - Number(margin?.total ?? 0);
    return {
      key: "margin-allocated",
      title: "Every rand of margin is earmarked somewhere",
      why: "Treasury promises that a settlement's allocation lines sum to its contribution margin. Across all settlements, the totals must match.",
      ok: difference === 0,
      differenceCents: difference,
      detail:
        difference === 0
          ? `${Number(margin?.total ?? 0)} cents of margin, all earmarked.`
          : `Earmarked is out by ${difference} cents against margin earned. A settlement whose event has not been delivered yet shows here until the worker catches up.`,
      offenders: [],
    };
  }

  /** What drivers have earned, less what has actually been paid. */
  private async driverEarnings(): Promise<CheckResult> {
    return this.driverPayable(
      "driver-earnings",
      "Drivers are owed exactly what they earned less what they were paid",
      "Underpaying a driver is the fastest way to lose one, and overpaying is money out the door with no record.",
      "DRIVER_EARNINGS_PAYABLE",
      "driver_earnings_payout",
      settlements.driverEarningCents,
    );
  }

  private async fuelPayable(): Promise<CheckResult> {
    return this.driverPayable(
      "fuel-payable",
      "Fuel cards are owed what was actually burned",
      "Fuel is recognised per delivered kilometre and settled by loading a card. The two must not drift apart.",
      "FUEL_PAYABLE",
      "driver_fuel_load",
      settlements.fuelCostCents,
    );
  }

  /** Earned − paid === owed, for whichever of the two driver payables is being checked. */
  private async driverPayable(
    key: string,
    title: string,
    why: string,
    account: string,
    proposalKind: "driver_earnings_payout" | "driver_fuel_load",
    column: PgColumn,
  ): Promise<CheckResult> {
    const people = await this.dbs.db
      .select({ id: drivers.id, name: drivers.fullName })
      .from(drivers);
    const earned = await this.sumBy(
      this.dbs.db
        .select({ key: settlements.driverId, total: sql<string>`sum(${column})` })
        .from(settlements)
        .groupBy(settlements.driverId),
    );
    const paid = await this.sumBy(
      this.dbs.db
        .select({
          key: paymentProposals.driverId,
          total: sql<string>`sum(${paymentProposals.amountCents})`,
        })
        .from(paymentProposals)
        .where(
          and(eq(paymentProposals.kind, proposalKind), eq(paymentProposals.status, "executed")),
        )
        .groupBy(paymentProposals.driverId),
    );
    const owed = await this.ledgerByOwner(account);

    const offenders = people
      .filter((d) => (earned.get(d.id) ?? 0) - (paid.get(d.id) ?? 0) !== -(owed.get(d.id) ?? 0))
      .map((d) => ({
        id: d.id,
        label: d.name,
        expectedCents: (earned.get(d.id) ?? 0) - (paid.get(d.id) ?? 0),
        actualCents: -(owed.get(d.id) ?? 0),
      }));
    return this.fromOffenders(key, title, why, offenders, `${people.length} driver(s) checked.`);
  }

  /** Outstanding invoices against the receivable the ledger carries. */
  private async receivables(): Promise<CheckResult> {
    const all = await this.dbs.db.select({ id: accounts.id, name: accounts.name }).from(accounts);
    const invoiced = await this.sumBy(
      this.dbs.db
        .select({ key: invoices.accountId, total: sql<string>`sum(${invoices.outstandingCents})` })
        .from(invoices)
        .groupBy(invoices.accountId),
    );
    const ledger = await this.ledgerByOwner("CUSTOMER_RECEIVABLE");
    const offenders = all
      .filter((a) => (invoiced.get(a.id) ?? 0) !== (ledger.get(a.id) ?? 0))
      .map((a) => ({
        id: a.id,
        label: a.name,
        expectedCents: invoiced.get(a.id) ?? 0,
        actualCents: ledger.get(a.id) ?? 0,
      }));
    return this.fromOffenders(
      "receivables",
      "What customers owe matches the invoices they owe it on",
      "The ageing report chases the ledger's receivable; if the invoices disagree, the wrong customer gets chased.",
      offenders,
      `${all.length} account(s) checked.`,
    );
  }

  private async loyalty(): Promise<CheckResult> {
    const [awarded] = await this.dbs.db
      .select({ total: sql<string>`coalesce(sum(${loyaltyAwards.amountCents}), 0)::bigint` })
      .from(loyaltyAwards);
    const [expensed] = await this.dbs.db
      .select({ total: sql<string>`coalesce(sum(${journalLines.amountCents}), 0)::bigint` })
      .from(journalLines)
      .where(eq(journalLines.account, "LOYALTY_EXPENSE"));
    const difference = Number(expensed?.total ?? 0) - Number(awarded?.total ?? 0);
    return {
      key: "loyalty",
      title: "Cashback paid out is cashback expensed",
      why: "Cashback is real money leaving margin. If the books do not carry it, the business looks more profitable than it is.",
      ok: difference === 0,
      differenceCents: difference,
      detail:
        difference === 0
          ? `${Number(awarded?.total ?? 0)} cents of cashback, all expensed.`
          : `Loyalty expense is out by ${difference} cents against awards made.`,
      offenders: [],
    };
  }

  /** Not a money check: events stuck in the outbox mean effects that never happened. */
  private async undelivered(): Promise<CheckResult> {
    const rows = await this.dbs.db
      .select({ status: outboxMessages.status, n: sql<string>`count(*)::int` })
      .from(outboxMessages)
      .where(inArray(outboxMessages.status, ["dead", "failed"]))
      .groupBy(outboxMessages.status);
    const dead = Number(rows.find((r) => r.status === "dead")?.n ?? 0);
    const failed = Number(rows.find((r) => r.status === "failed")?.n ?? 0);
    return {
      key: "outbox",
      title: "No event has given up",
      why: "A settlement can be perfect and its treasury allocation still never happen, if the event that carries it died. A dead event is work the business thinks it did.",
      ok: dead === 0,
      differenceCents: 0,
      detail:
        dead === 0
          ? failed > 0
            ? `${failed} event(s) are retrying; none have given up.`
            : "Nothing stuck."
          : `${dead} event(s) have given up and need requeueing from the Outbox page.`,
      offenders: [],
    };
  }

  /**
   * Run a grouped "sum by owner" query into a map.
   *
   * Deliberately two queries compared in TypeScript rather than one correlated subquery: the
   * subquery version was subtly wrong and gave a report that quietly disagreed with plain SQL,
   * which for a reconciliation tool is the worst possible failure. This is obvious instead.
   */
  private async sumBy(
    query: Promise<{ key: string | null; total: string | number | null }[]>,
  ): Promise<Map<string, number>> {
    const rows = await query;
    const out = new Map<string, number>();
    for (const r of rows) {
      if (r.key) out.set(r.key, Number(r.total ?? 0));
    }
    return out;
  }

  /** Signed ledger balance per owner for one account code. Debit positive, credit negative. */
  private async ledgerByOwner(account: string): Promise<Map<string, number>> {
    return this.sumBy(
      this.dbs.db
        .select({ key: journalLines.ownerId, total: sql<string>`sum(${journalLines.amountCents})` })
        .from(journalLines)
        .where(eq(journalLines.account, account))
        .groupBy(journalLines.ownerId),
    );
  }

  private fromOffenders(
    key: string,
    title: string,
    why: string,
    offenders: CheckResult["offenders"],
    detail: string,
  ): CheckResult {
    const difference = offenders.reduce((s, o) => s + (o.actualCents - o.expectedCents), 0);
    return {
      key,
      title,
      why,
      ok: offenders.length === 0,
      differenceCents: difference,
      detail:
        offenders.length === 0
          ? detail
          : `${offenders.length} row(s) disagree, out by ${difference} cents in total.`,
      offenders: offenders.slice(0, 20),
    };
  }
}
