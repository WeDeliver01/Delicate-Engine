import { Injectable } from "@nestjs/common";
import { and, eq, gte, lte, sql } from "drizzle-orm";
import {
  accounts,
  allocationTransactions,
  bookings,
  drivers,
  invoices,
  journalLines,
  journals,
  settlements,
  shipments,
} from "@delicate/db";
import { DbService } from "../../infra/db.module.js";
import { Clock } from "../../infra/clock.js";
import { AppError } from "../../common/errors.js";
import { toCsv } from "../address-book/csv.js";

export interface Overview {
  from: string;
  to: string;
  deliveries: number;
  failed: number;
  bookings: number;
  revenueCents: number;
  vatCents: number;
  fuelCents: number;
  driverEarningsCents: number;
  marginCents: number;
  /** Margin as a share of revenue, in basis points. */
  marginBps: number;
  averageOrderCents: number;
  averageKm: number;
  totalKm: number;
  activeAccounts: number;
  newAccounts: number;
}

export interface DailyPoint {
  date: string;
  deliveries: number;
  revenueCents: number;
  marginCents: number;
}

export type ExportKind = "settlements" | "journals" | "invoices" | "bookings" | "allocations";

/**
 * Reporting (Phase 4F).
 *
 * Everything here is derived from the same append-only rows the money is made of — settlements,
 * journals, allocations — never from a separate summary table that could drift. A dashboard that
 * disagrees with the ledger is worse than no dashboard, so there is nothing to disagree with.
 *
 * Exports are plain CSV: the file goes into a spreadsheet or to an accountant, and both of those
 * read CSV without being asked to install anything.
 */
@Injectable()
export class AnalyticsService {
  constructor(
    private readonly dbs: DbService,
    private readonly clock: Clock,
  ) {}

  private range(from?: string, to?: string): { start: Date; end: Date } {
    const end = to ? new Date(`${to}T23:59:59.999Z`) : this.clock.now();
    const start = from
      ? new Date(`${from}T00:00:00.000Z`)
      : new Date(end.getTime() - 29 * 86_400_000);
    if (start > end) {
      throw AppError.validation([{ path: ["from"], message: "the start is after the end" }]);
    }
    return { start, end };
  }

  async overview(from?: string, to?: string): Promise<Overview> {
    const { start, end } = this.range(from, to);
    const within = and(gte(settlements.settledAt, start), lte(settlements.settledAt, end));

    const [money] = await this.dbs.db
      .select({
        n: sql<string>`count(*)::int`,
        revenue: sql<string>`coalesce(sum(${settlements.revenueCents}), 0)::bigint`,
        vat: sql<string>`coalesce(sum(${settlements.vatCents}), 0)::bigint`,
        fuel: sql<string>`coalesce(sum(${settlements.fuelCostCents}), 0)::bigint`,
        earnings: sql<string>`coalesce(sum(${settlements.driverEarningCents}), 0)::bigint`,
        margin: sql<string>`coalesce(sum(${settlements.marginCents}), 0)::bigint`,
        km: sql<string>`coalesce(sum(${settlements.actualKm}), 0)::numeric`,
        accounts: sql<string>`count(distinct ${settlements.accountId})::int`,
      })
      .from(settlements)
      .where(within);

    const [failed] = await this.dbs.db
      .select({ n: sql<string>`count(*)::int` })
      .from(shipments)
      .where(
        and(
          eq(shipments.status, "failed"),
          gte(shipments.updatedAt, start),
          lte(shipments.updatedAt, end),
        ),
      );

    const [booked] = await this.dbs.db
      .select({ n: sql<string>`count(*)::int` })
      .from(bookings)
      .where(and(gte(bookings.createdAt, start), lte(bookings.createdAt, end)));

    const [fresh] = await this.dbs.db
      .select({ n: sql<string>`count(*)::int` })
      .from(accounts)
      .where(and(gte(accounts.createdAt, start), lte(accounts.createdAt, end)));

    const deliveries = Number(money?.n ?? 0);
    const revenueCents = Number(money?.revenue ?? 0);
    const marginCents = Number(money?.margin ?? 0);
    const totalKm = Math.round(Number(money?.km ?? 0) * 100) / 100;

    return {
      from: start.toISOString().slice(0, 10),
      to: end.toISOString().slice(0, 10),
      deliveries,
      failed: Number(failed?.n ?? 0),
      bookings: Number(booked?.n ?? 0),
      revenueCents,
      vatCents: Number(money?.vat ?? 0),
      fuelCents: Number(money?.fuel ?? 0),
      driverEarningsCents: Number(money?.earnings ?? 0),
      marginCents,
      marginBps: revenueCents > 0 ? Math.round((marginCents / revenueCents) * 10_000) : 0,
      averageOrderCents: deliveries > 0 ? Math.round(revenueCents / deliveries) : 0,
      averageKm: deliveries > 0 ? Math.round((totalKm / deliveries) * 100) / 100 : 0,
      totalKm,
      activeAccounts: Number(money?.accounts ?? 0),
      newAccounts: Number(fresh?.n ?? 0),
    };
  }

  /** One row per day, zero-filled, so a gap in trading reads as a gap rather than vanishing. */
  async daily(from?: string, to?: string): Promise<DailyPoint[]> {
    const { start, end } = this.range(from, to);
    const rows = await this.dbs.db
      .select({
        date: sql<string>`to_char(${settlements.settledAt}, 'YYYY-MM-DD')`,
        n: sql<string>`count(*)::int`,
        revenue: sql<string>`coalesce(sum(${settlements.revenueCents}), 0)::bigint`,
        margin: sql<string>`coalesce(sum(${settlements.marginCents}), 0)::bigint`,
      })
      .from(settlements)
      .where(and(gte(settlements.settledAt, start), lte(settlements.settledAt, end)))
      .groupBy(sql`1`)
      .orderBy(sql`1`);

    const byDate = new Map(rows.map((r) => [r.date, r]));
    const out: DailyPoint[] = [];
    for (let d = new Date(start); d <= end; d = new Date(d.getTime() + 86_400_000)) {
      const key = d.toISOString().slice(0, 10);
      const row = byDate.get(key);
      out.push({
        date: key,
        deliveries: Number(row?.n ?? 0),
        revenueCents: Number(row?.revenue ?? 0),
        marginCents: Number(row?.margin ?? 0),
      });
      if (out.length > 400) break; // a sane ceiling on a hand-typed range
    }
    return out;
  }

  /** Who the business actually runs on. */
  async topAccounts(from?: string, to?: string, limit = 10) {
    const { start, end } = this.range(from, to);
    const rows = await this.dbs.db
      .select({
        accountId: settlements.accountId,
        name: accounts.name,
        deliveries: sql<string>`count(*)::int`,
        revenue: sql<string>`coalesce(sum(${settlements.revenueCents}), 0)::bigint`,
        margin: sql<string>`coalesce(sum(${settlements.marginCents}), 0)::bigint`,
      })
      .from(settlements)
      .innerJoin(accounts, eq(accounts.id, settlements.accountId))
      .where(and(gte(settlements.settledAt, start), lte(settlements.settledAt, end)))
      .groupBy(settlements.accountId, accounts.name)
      .orderBy(sql`3 desc`)
      .limit(limit);
    return rows.map((r) => ({
      accountId: r.accountId,
      name: r.name,
      deliveries: Number(r.deliveries),
      revenueCents: Number(r.revenue),
      marginCents: Number(r.margin),
    }));
  }

  /** Per driver: what they delivered, what it cost, and what it earned. */
  async driverPerformance(from?: string, to?: string) {
    const { start, end } = this.range(from, to);
    const rows = await this.dbs.db
      .select({
        driverId: settlements.driverId,
        name: drivers.fullName,
        deliveries: sql<string>`count(*)::int`,
        km: sql<string>`coalesce(sum(${settlements.actualKm}), 0)::numeric`,
        earnings: sql<string>`coalesce(sum(${settlements.driverEarningCents}), 0)::bigint`,
        fuel: sql<string>`coalesce(sum(${settlements.fuelCostCents}), 0)::bigint`,
        margin: sql<string>`coalesce(sum(${settlements.marginCents}), 0)::bigint`,
      })
      .from(settlements)
      .innerJoin(drivers, eq(drivers.id, settlements.driverId))
      .where(and(gte(settlements.settledAt, start), lte(settlements.settledAt, end)))
      .groupBy(settlements.driverId, drivers.fullName)
      .orderBy(sql`3 desc`);
    return rows.map((r) => ({
      driverId: r.driverId!,
      name: r.name,
      deliveries: Number(r.deliveries),
      km: Math.round(Number(r.km) * 100) / 100,
      earningsCents: Number(r.earnings),
      fuelCents: Number(r.fuel),
      marginCents: Number(r.margin),
    }));
  }

  // ── exports ───────────────────────────────────────────────────────────────────

  async exportCsv(kind: ExportKind, from?: string, to?: string): Promise<string> {
    const { start, end } = this.range(from, to);

    if (kind === "settlements") {
      const rows = await this.dbs.db
        .select({
          waybill: shipments.waybill,
          settledAt: settlements.settledAt,
          account: accounts.name,
          driver: drivers.fullName,
          revenue: settlements.revenueCents,
          vat: settlements.vatCents,
          fuel: settlements.fuelCostCents,
          earnings: settlements.driverEarningCents,
          margin: settlements.marginCents,
          plannedKm: settlements.plannedKm,
          actualKm: settlements.actualKm,
        })
        .from(settlements)
        .innerJoin(shipments, eq(shipments.id, settlements.shipmentId))
        .innerJoin(accounts, eq(accounts.id, settlements.accountId))
        .leftJoin(drivers, eq(drivers.id, settlements.driverId))
        .where(and(gte(settlements.settledAt, start), lte(settlements.settledAt, end)))
        .orderBy(settlements.settledAt);
      return toCsv(
        [
          "waybill",
          "settled_at",
          "account",
          "driver",
          "revenue_ex_vat",
          "vat",
          "fuel_cost",
          "driver_earning",
          "margin",
          "planned_km",
          "actual_km",
        ],
        rows.map((r) => [
          r.waybill,
          r.settledAt.toISOString(),
          r.account,
          r.driver ?? "",
          money(r.revenue),
          money(r.vat),
          money(r.fuel),
          money(r.earnings),
          money(r.margin),
          r.plannedKm,
          r.actualKm,
        ]),
      );
    }

    if (kind === "journals") {
      const rows = await this.dbs.db
        .select({
          occurredAt: journals.occurredAt,
          kind: journals.kind,
          description: journals.description,
          refType: journals.refType,
          refId: journals.refId,
          account: journalLines.account,
          ownerType: journalLines.ownerType,
          ownerId: journalLines.ownerId,
          amount: journalLines.amountCents,
          memo: journalLines.memo,
        })
        .from(journalLines)
        .innerJoin(journals, eq(journals.id, journalLines.journalId))
        .where(and(gte(journals.occurredAt, start), lte(journals.occurredAt, end)))
        .orderBy(journals.occurredAt);
      return toCsv(
        [
          "occurred_at",
          "journal_kind",
          "description",
          "ref_type",
          "ref_id",
          "account",
          "owner_type",
          "owner_id",
          "debit",
          "credit",
          "memo",
        ],
        // Debits and credits in their own columns: that is the shape a bookkeeper expects.
        rows.map((r) => [
          r.occurredAt.toISOString(),
          r.kind,
          r.description,
          r.refType ?? "",
          r.refId ?? "",
          r.account,
          r.ownerType,
          r.ownerId ?? "",
          r.amount > 0 ? money(r.amount) : "",
          r.amount < 0 ? money(-r.amount) : "",
          r.memo ?? "",
        ]),
      );
    }

    if (kind === "invoices") {
      const rows = await this.dbs.db
        .select({
          number: invoices.number,
          kind: invoices.kind,
          status: invoices.status,
          account: accounts.name,
          issuedAt: invoices.issuedAt,
          dueAt: invoices.dueAt,
          net: invoices.netCents,
          vat: invoices.vatCents,
          total: invoices.totalCents,
          outstanding: invoices.outstandingCents,
        })
        .from(invoices)
        .innerJoin(accounts, eq(accounts.id, invoices.accountId))
        .where(and(gte(invoices.issuedAt, start), lte(invoices.issuedAt, end)))
        .orderBy(invoices.issuedAt);
      return toCsv(
        [
          "number",
          "kind",
          "status",
          "account",
          "issued_at",
          "due_at",
          "net",
          "vat",
          "total",
          "outstanding",
        ],
        rows.map((r) => [
          r.number,
          r.kind,
          r.status,
          r.account,
          r.issuedAt?.toISOString() ?? "",
          r.dueAt?.toISOString() ?? "",
          money(r.net),
          money(r.vat),
          money(r.total),
          money(r.outstanding),
        ]),
      );
    }

    if (kind === "bookings") {
      const rows = await this.dbs.db
        .select({
          reference: bookings.reference,
          createdAt: bookings.createdAt,
          account: accounts.name,
          status: bookings.status,
          slotDate: bookings.slotDate,
          total: bookings.totalCents,
        })
        .from(bookings)
        .innerJoin(accounts, eq(accounts.id, bookings.accountId))
        .where(and(gte(bookings.createdAt, start), lte(bookings.createdAt, end)))
        .orderBy(bookings.createdAt);
      return toCsv(
        ["reference", "created_at", "account", "status", "slot_date", "total"],
        rows.map((r) => [
          r.reference,
          r.createdAt.toISOString(),
          r.account,
          r.status,
          r.slotDate ?? "",
          money(r.total),
        ]),
      );
    }

    const rows = await this.dbs.db
      .select()
      .from(allocationTransactions)
      .where(
        and(
          gte(allocationTransactions.createdAt, start),
          lte(allocationTransactions.createdAt, end),
        ),
      )
      .orderBy(allocationTransactions.createdAt);
    return toCsv(
      ["created_at", "period", "wallet_id", "kind", "amount", "balance_after", "reference", "memo"],
      rows.map((r) => [
        r.createdAt.toISOString(),
        r.period,
        r.walletId,
        r.kind,
        money(r.amountCents),
        money(r.balanceAfterCents),
        r.reference ?? "",
        r.memo ?? "",
      ]),
    );
  }
}

/** Rands with two decimals: what a spreadsheet and an accountant both expect. */
function money(cents: number): string {
  return (cents / 100).toFixed(2);
}
