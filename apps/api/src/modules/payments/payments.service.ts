import { Injectable } from "@nestjs/common";
import { and, desc, eq, inArray, isNotNull, lte, sql } from "drizzle-orm";
import type {
  BankSweepRequest,
  ExecuteProposalRequest,
  PayablesSummary,
  PaymentProposal,
  PayoutMethod,
  PrepareRunRequest,
  ProposalBasis,
  ProposalKind,
  ProposalStatus,
} from "@delicate/contracts";
import {
  allocationWallets,
  drivers,
  paymentCounters,
  paymentProposals,
  settlements,
  shipments,
  type DbExecutor,
} from "@delicate/db";
import { DbService } from "../../infra/db.module.js";
import { AuditService } from "../../infra/audit.service.js";
import { OutboxService } from "../../infra/outbox.service.js";
import { Clock } from "../../infra/clock.js";
import { AppError } from "../../common/errors.js";
import { requestContext } from "../../common/request-context.js";
import { LedgerService, cr, dr } from "../ledger/ledger.service.js";
import { TreasuryService, periodOf } from "../treasury/treasury.service.js";

/** Statuses that still lay claim to cash: they count against what finance can commit. */
const OPEN: ProposalStatus[] = ["proposed", "approved", "failed"];

/**
 * Payments (Phase 3B). **The engine proposes, a human executes** (invariant #7).
 *
 * `prepare` reads what the ledger says is owed and writes proposals. `approve` is a human
 * decision. `execute` is a human asserting the money left, with the proof — and only then is the
 * journal posted:
 *
 *   driver_earnings_payout  Dr DRIVER_EARNINGS_PAYABLE(driver)  Cr BANK
 *   driver_fuel_load        Dr FUEL_PAYABLE(driver)             Cr BANK
 *   vendor_payment          Dr OPERATING_EXPENSE                Cr BANK
 *
 * A vendor payment also draws its treasury wallet down, so a bill cannot be funded twice.
 *
 * There is deliberately no code path anywhere in this service that calls a bank or a card
 * provider. The PayCentral adapter produces instructions for a person, nothing more.
 */
@Injectable()
export class PaymentsService {
  constructor(
    private readonly dbs: DbService,
    private readonly ledger: LedgerService,
    private readonly treasury: TreasuryService,
    private readonly outbox: OutboxService,
    private readonly audit: AuditService,
    private readonly clock: Clock,
  ) {}

  // ── proposing ─────────────────────────────────────────────────────────────────

  async prepare(req: PrepareRunRequest): Promise<PaymentProposal[]> {
    // No cutoff unless the caller asks for one: settled rows are stamped by the database, and
    // comparing them against this process's clock only invites skew.
    const upTo = req.upTo ? new Date(`${req.upTo}T23:59:59.999Z`) : null;
    const minimum = req.minimumCents ?? 0;
    return this.dbs.transaction(async (tx) => {
      const made =
        req.kind === "vendor_payment"
          ? await this.prepareVendorPayments(tx, req, upTo, minimum)
          : await this.prepareDriverPayments(tx, req, upTo, minimum);
      for (const p of made) {
        await this.outbox.emit(
          tx,
          "payment.proposed",
          {
            proposalId: p.id,
            reference: p.reference,
            kind: p.kind,
            amountCents: p.amountCents,
            driverId: p.driverId,
            vendorName: p.vendorName,
            period: p.period,
          },
          { dedupeKey: `payment:${p.id}:proposed` },
        );
      }
      return made;
    });
  }

  private async prepareDriverPayments(
    tx: DbExecutor,
    req: PrepareRunRequest,
    upTo: Date | null,
    minimum: number,
  ): Promise<PaymentProposal[]> {
    const fuel = req.kind === "driver_fuel_load";
    const account = fuel ? "FUEL_PAYABLE" : "DRIVER_EARNINGS_PAYABLE";
    const rows = await tx
      .select()
      .from(drivers)
      .where(req.driverId ? eq(drivers.id, req.driverId) : undefined);

    const out: PaymentProposal[] = [];
    for (const d of rows) {
      // Payables are credit-normal, so the balance is negative; what we owe is its magnitude.
      const owed = -(await this.ledger.balance(account, "driver", d.id, tx));
      const open = await this.openTotal(tx, req.kind, { driverId: d.id });
      const amount = owed - open;
      if (amount < Math.max(1, minimum)) continue;

      const basis = await this.driverBasis(tx, d.id, fuel, upTo, owed);
      out.push(
        await this.insert(tx, {
          kind: req.kind,
          amountCents: amount,
          method: fuel ? "paycentral" : "eft",
          driverId: d.id,
          vendorName: null,
          walletId: null,
          basis,
        }),
      );
    }
    return out;
  }

  private async prepareVendorPayments(
    tx: DbExecutor,
    req: PrepareRunRequest,
    upTo: Date | null,
    minimum: number,
  ): Promise<PaymentProposal[]> {
    const wallets = await tx
      .select()
      .from(allocationWallets)
      .where(
        and(
          eq(allocationWallets.active, true),
          eq(allocationWallets.category, "operating_expense"),
          isNotNull(allocationWallets.obligationAmountCents),
          req.walletSlug ? eq(allocationWallets.slug, req.walletSlug) : undefined,
        ),
      )
      .orderBy(allocationWallets.priority)
      .for("update");

    const out: PaymentProposal[] = [];
    for (const w of wallets) {
      const amount = w.obligationAmountCents ?? 0;
      if (amount < Math.max(1, minimum)) continue;
      const open = await this.openTotal(tx, "vendor_payment", { walletId: w.id });
      if (open > 0) continue; // already proposed for this period
      // Only propose a bill the wallet has actually saved up for: this is the whole point of
      // treasury. An underfunded bill is surfaced on the dashboard, not paid out of thin air.
      if (w.balanceCents < amount) continue;

      out.push(
        await this.insert(tx, {
          kind: "vendor_payment",
          amountCents: amount,
          method: "eft",
          driverId: null,
          vendorName: w.vendor ?? w.name,
          walletId: w.id,
          basis: {
            payableBalanceCents: w.balanceCents,
            upTo: upTo?.toISOString() ?? null,
            items: [],
            walletSlug: w.slug,
            note: `Funded ${w.balanceCents} of ${amount} by ${w.name}`,
          },
        }),
      );
    }
    return out;
  }

  /** The settlements that produced what a driver is owed, as evidence on the proposal. */
  private async driverBasis(
    tx: DbExecutor,
    driverId: string,
    fuel: boolean,
    upTo: Date | null,
    owed: number,
  ): Promise<ProposalBasis> {
    const [last] = await tx
      .select({ executedAt: paymentProposals.executedAt })
      .from(paymentProposals)
      .where(
        and(
          eq(paymentProposals.driverId, driverId),
          eq(paymentProposals.kind, fuel ? "driver_fuel_load" : "driver_earnings_payout"),
          eq(paymentProposals.status, "executed"),
        ),
      )
      .orderBy(desc(paymentProposals.executedAt))
      .limit(1);

    const rows = await tx
      .select({
        shipmentId: settlements.shipmentId,
        waybill: shipments.waybill,
        settledAt: settlements.settledAt,
        amount: fuel ? settlements.fuelCostCents : settlements.driverEarningCents,
      })
      .from(settlements)
      .innerJoin(shipments, eq(shipments.id, settlements.shipmentId))
      .where(
        and(
          eq(settlements.driverId, driverId),
          upTo ? lte(settlements.settledAt, upTo) : undefined,
          last?.executedAt ? sql`${settlements.settledAt} > ${last.executedAt}` : undefined,
        ),
      )
      .orderBy(settlements.settledAt);

    const items = rows
      .filter((r) => r.amount !== 0)
      .map((r) => ({
        shipmentId: r.shipmentId,
        waybill: r.waybill,
        amountCents: r.amount,
        settledAt: r.settledAt.toISOString(),
      }));
    const listed = items.reduce((s, i) => s + i.amountCents, 0);
    return {
      payableBalanceCents: owed,
      upTo: upTo?.toISOString() ?? null,
      items,
      walletSlug: null,
      note:
        listed === owed
          ? null
          : `Ledger owes ${owed}c; the listed deliveries account for ${listed}c. The difference is prior adjustments — the ledger balance is authoritative.`,
    };
  }

  private async insert(
    tx: DbExecutor,
    v: {
      kind: ProposalKind;
      amountCents: number;
      method: PayoutMethod;
      driverId: string | null;
      vendorName: string | null;
      walletId: string | null;
      basis: ProposalBasis;
    },
  ): Promise<PaymentProposal> {
    const period = periodOf(this.clock.now());
    const reference = await this.nextReference(tx, period);
    const [row] = await tx
      .insert(paymentProposals)
      .values({
        reference,
        kind: v.kind,
        amountCents: v.amountCents,
        method: v.method,
        driverId: v.driverId,
        vendorName: v.vendorName,
        walletId: v.walletId,
        period,
        basis: v.basis,
        // Unique per row. Duplicate proposals are prevented by the partial unique indexes on
        // (kind, payee, period) for open statuses, which release once a proposal is cancelled.
        idempotencyKey: `proposal:${reference}`,
      })
      .returning();
    await this.audit.record(tx, {
      action: "payment.propose",
      entityType: "payment_proposal",
      entityId: row!.id,
      after: { reference, kind: v.kind, amountCents: v.amountCents },
    });
    return toProposal(row!);
  }

  private async nextReference(tx: DbExecutor, period: string): Promise<string> {
    await tx.insert(paymentCounters).values({ period }).onConflictDoNothing();
    const [row] = await tx
      .update(paymentCounters)
      .set({ next: sql`${paymentCounters.next} + 1` })
      .where(eq(paymentCounters.period, period))
      .returning({ next: paymentCounters.next });
    return `PAY-${period.replace("-", "").slice(2)}-${String(row!.next - 1).padStart(4, "0")}`;
  }

  private async openTotal(
    tx: DbExecutor,
    kind: ProposalKind,
    who: { driverId?: string; walletId?: string },
  ): Promise<number> {
    const [row] = await tx
      .select({ total: sql<string>`coalesce(sum(${paymentProposals.amountCents}), 0)::bigint` })
      .from(paymentProposals)
      .where(
        and(
          eq(paymentProposals.kind, kind),
          inArray(paymentProposals.status, OPEN),
          who.driverId ? eq(paymentProposals.driverId, who.driverId) : undefined,
          who.walletId ? eq(paymentProposals.walletId, who.walletId) : undefined,
        ),
      );
    return Number(row?.total ?? 0);
  }

  // ── deciding ──────────────────────────────────────────────────────────────────

  async approve(id: string, note?: string): Promise<PaymentProposal> {
    return this.transition(id, ["proposed"], async (tx, row) => {
      const userId = requestContext.get()?.userId ?? null;
      const [updated] = await tx
        .update(paymentProposals)
        .set({
          status: "approved",
          approvedByUserId: userId,
          approvedAt: this.clock.now(),
          decisionNote: note ?? null,
        })
        .where(eq(paymentProposals.id, id))
        .returning();
      await this.outbox.emit(
        tx,
        "payment.approved",
        {
          proposalId: id,
          reference: row.reference,
          amountCents: row.amountCents,
          approvedByUserId: userId,
        },
        { dedupeKey: `payment:${id}:approved` },
      );
      return updated!;
    });
  }

  async reject(id: string, note?: string): Promise<PaymentProposal> {
    return this.transition(id, ["proposed", "approved"], async (tx, _row) => {
      const [updated] = await tx
        .update(paymentProposals)
        .set({
          status: "rejected",
          decisionNote: note ?? null,
          approvedByUserId: requestContext.get()?.userId ?? null,
          approvedAt: this.clock.now(),
        })
        .where(eq(paymentProposals.id, id))
        .returning();
      return updated!;
    });
  }

  async cancel(id: string, note?: string): Promise<PaymentProposal> {
    return this.transition(id, ["proposed", "approved", "failed"], async (tx) => {
      const [updated] = await tx
        .update(paymentProposals)
        .set({ status: "cancelled", decisionNote: note ?? null })
        .where(eq(paymentProposals.id, id))
        .returning();
      return updated!;
    });
  }

  async fail(id: string, reason: string): Promise<PaymentProposal> {
    return this.transition(id, ["approved"], async (tx) => {
      const [updated] = await tx
        .update(paymentProposals)
        .set({ status: "failed", decisionNote: reason })
        .where(eq(paymentProposals.id, id))
        .returning();
      return updated!;
    });
  }

  /**
   * A human has paid it. Post the journal, draw the treasury wallet down for a vendor bill, and
   * record who said so with what proof.
   */
  async execute(id: string, body: ExecuteProposalRequest): Promise<PaymentProposal> {
    return this.transition(id, ["approved", "failed"], async (tx, row) => {
      const occurredAt = body.paidAt ? new Date(body.paidAt) : this.clock.now();
      const lines =
        row.kind === "driver_earnings_payout"
          ? [
              dr(
                "DRIVER_EARNINGS_PAYABLE",
                row.amountCents,
                { type: "driver", id: row.driverId! },
                `${row.reference} payout`,
              ),
              cr("BANK", row.amountCents, { type: "company" }, `${row.reference} payout`),
            ]
          : row.kind === "driver_fuel_load"
            ? [
                dr(
                  "FUEL_PAYABLE",
                  row.amountCents,
                  { type: "driver", id: row.driverId! },
                  `${row.reference} fuel load`,
                ),
                cr("BANK", row.amountCents, { type: "company" }, `${row.reference} fuel load`),
              ]
            : [
                dr(
                  "OPERATING_EXPENSE",
                  row.amountCents,
                  { type: "company" },
                  `${row.reference} ${row.vendorName ?? "vendor"}`,
                ),
                cr("BANK", row.amountCents, { type: "company" }, `${row.reference} payment`),
              ];

      const journal = await this.ledger.post(tx, {
        kind:
          row.kind === "vendor_payment"
            ? "vendor_payment"
            : row.kind === "driver_fuel_load"
              ? "fuel_load"
              : "payout",
        refType: "payment_proposal",
        refId: row.id,
        description: `${row.reference} executed (${body.externalReference})`,
        idempotencyKey: `payment:${row.id}:executed`,
        occurredAt,
        lines,
      });

      if (row.kind === "vendor_payment" && row.walletId) {
        await this.treasury.recordPayment(tx, {
          walletId: row.walletId,
          amountCents: -row.amountCents,
          reference: `payment:${row.id}`,
          memo: `${row.reference} paid to ${row.vendorName ?? "vendor"}`,
          at: occurredAt,
        });
      }

      const [updated] = await tx
        .update(paymentProposals)
        .set({
          status: "executed",
          method: body.method ?? row.method,
          executedByUserId: requestContext.get()?.userId ?? null,
          executedAt: occurredAt,
          externalReference: body.externalReference,
          journalId: journal.id,
          decisionNote: body.note ?? row.decisionNote,
        })
        .where(eq(paymentProposals.id, id))
        .returning();

      await this.outbox.emit(
        tx,
        "payment.executed",
        {
          proposalId: id,
          reference: row.reference,
          kind: row.kind,
          amountCents: row.amountCents,
          driverId: row.driverId,
          externalReference: body.externalReference,
          journalId: journal.id,
        },
        { dedupeKey: `payment:${id}:executed` },
      );
      return updated!;
    });
  }

  /** One guarded state change, audited, with the row locked for the duration. */
  private async transition(
    id: string,
    from: ProposalStatus[],
    fn: (
      tx: DbExecutor,
      row: typeof paymentProposals.$inferSelect,
    ) => Promise<typeof paymentProposals.$inferSelect>,
  ): Promise<PaymentProposal> {
    return this.dbs.transaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(paymentProposals)
        .where(eq(paymentProposals.id, id))
        .for("update");
      if (!row) throw AppError.notFound("payment proposal");
      if (!from.includes(row.status)) {
        throw AppError.conflict(
          "proposal_state_invalid",
          `a ${row.status} proposal cannot move from here`,
          { status: row.status, allowedFrom: from },
        );
      }
      const updated = await fn(tx, row);
      await this.audit.record(tx, {
        action: `payment.${updated.status}`,
        entityType: "payment_proposal",
        entityId: id,
        before: { status: row.status },
        after: {
          status: updated.status,
          externalReference: updated.externalReference,
          journalId: updated.journalId,
        },
      });
      return toProposal(updated);
    });
  }

  // ── bank ──────────────────────────────────────────────────────────────────────

  /**
   * Record cash arriving in the bank from the clearing account. Customer top-ups land in
   * CASH_CLEARING; this is finance saying "the provider settled, it is really in the bank now".
   */
  async bankSweep(body: BankSweepRequest) {
    return this.dbs.transaction(async (tx) => {
      const clearing = await this.ledger.balance("CASH_CLEARING", "company", null, tx);
      if (body.amountCents > clearing) {
        throw AppError.conflict(
          "sweep_exceeds_clearing",
          `cash clearing holds ${clearing}c; cannot sweep ${body.amountCents}c`,
          { clearingCents: clearing },
        );
      }
      const journal = await this.ledger.post(tx, {
        kind: "bank_sweep",
        refType: "bank_sweep",
        refId: body.reference,
        description: `Bank sweep ${body.reference}`,
        idempotencyKey: `bank_sweep:${body.reference}`,
        occurredAt: body.occurredAt ? new Date(body.occurredAt) : this.clock.now(),
        lines: [
          dr("BANK", body.amountCents, { type: "company" }, body.note ?? null),
          cr("CASH_CLEARING", body.amountCents, { type: "company" }, body.reference),
        ],
      });
      await this.audit.record(tx, {
        action: "payment.bank_sweep",
        entityType: "journal",
        entityId: journal.id,
        after: { amountCents: body.amountCents, reference: body.reference },
      });
      return journal;
    });
  }

  // ── reads ─────────────────────────────────────────────────────────────────────

  async list(opts: { status?: ProposalStatus; kind?: ProposalKind; limit?: number } = {}) {
    const rows = await this.dbs.db
      .select()
      .from(paymentProposals)
      .where(
        and(
          opts.status ? eq(paymentProposals.status, opts.status) : undefined,
          opts.kind ? eq(paymentProposals.kind, opts.kind) : undefined,
        ),
      )
      .orderBy(desc(paymentProposals.createdAt))
      .limit(Math.min(opts.limit ?? 50, 200));
    return this.withNames(rows);
  }

  async get(id: string): Promise<PaymentProposal> {
    const row = await this.dbs.db.query.paymentProposals.findFirst({
      where: eq(paymentProposals.id, id),
    });
    if (!row) throw AppError.notFound("payment proposal");
    return (await this.withNames([row]))[0]!;
  }

  private async withNames(
    rows: (typeof paymentProposals.$inferSelect)[],
  ): Promise<PaymentProposal[]> {
    const ids = rows.map((r) => r.driverId).filter((x): x is string => !!x);
    const names = ids.length
      ? await this.dbs.db
          .select({ id: drivers.id, fullName: drivers.fullName })
          .from(drivers)
          .where(inArray(drivers.id, ids))
      : [];
    const byId = new Map(names.map((d) => [d.id, d.fullName]));
    return rows.map((r) => toProposal(r, r.driverId ? (byId.get(r.driverId) ?? null) : null));
  }

  /** What finance needs on one screen before approving anything. */
  async payables(): Promise<PayablesSummary> {
    const all = await this.dbs.db.select().from(drivers);
    const rows = [];
    for (const d of all) {
      const earnings = -(await this.ledger.balance("DRIVER_EARNINGS_PAYABLE", "driver", d.id));
      const fuel = -(await this.ledger.balance("FUEL_PAYABLE", "driver", d.id));
      const [open] = await this.dbs.db
        .select({ total: sql<string>`coalesce(sum(${paymentProposals.amountCents}), 0)::bigint` })
        .from(paymentProposals)
        .where(and(eq(paymentProposals.driverId, d.id), inArray(paymentProposals.status, OPEN)));
      if (earnings === 0 && fuel === 0 && Number(open?.total ?? 0) === 0) continue;
      rows.push({
        driverId: d.id,
        name: d.fullName,
        earningsOwedCents: earnings,
        fuelOwedCents: fuel,
        openProposalCents: Number(open?.total ?? 0),
      });
    }

    const wallets = await this.dbs.db
      .select()
      .from(allocationWallets)
      .where(
        and(
          eq(allocationWallets.active, true),
          eq(allocationWallets.category, "operating_expense"),
          isNotNull(allocationWallets.obligationAmountCents),
        ),
      )
      .orderBy(allocationWallets.priority);

    const [committed] = await this.dbs.db
      .select({ total: sql<string>`coalesce(sum(${paymentProposals.amountCents}), 0)::bigint` })
      .from(paymentProposals)
      .where(inArray(paymentProposals.status, OPEN));

    return {
      bankBalanceCents: await this.ledger.balance("BANK", "company", null),
      cashClearingCents: await this.ledger.balance("CASH_CLEARING", "company", null),
      driverEarningsOwedCents: rows.reduce((s, r) => s + r.earningsOwedCents, 0),
      fuelCardOwedCents: rows.reduce((s, r) => s + r.fuelOwedCents, 0),
      committedCents: Number(committed?.total ?? 0),
      drivers: rows,
      vendors: wallets.map((w) => ({
        walletSlug: w.slug,
        name: w.name,
        vendor: w.vendor ?? "",
        dueDay: w.dueDay ?? 0,
        amountCents: w.obligationAmountCents ?? 0,
        fundedCents: w.balanceCents,
        payable: w.balanceCents >= (w.obligationAmountCents ?? 0),
      })),
    };
  }
}

export function toProposal(
  r: typeof paymentProposals.$inferSelect,
  driverName: string | null = null,
): PaymentProposal {
  return {
    id: r.id,
    reference: r.reference,
    kind: r.kind,
    status: r.status,
    amountCents: r.amountCents,
    currency: "ZAR",
    method: r.method,
    driverId: r.driverId,
    driverName,
    vendorName: r.vendorName,
    walletId: r.walletId,
    period: r.period,
    basis: r.basis as ProposalBasis,
    approvedByUserId: r.approvedByUserId,
    approvedAt: r.approvedAt?.toISOString() ?? null,
    decisionNote: r.decisionNote,
    executedByUserId: r.executedByUserId,
    executedAt: r.executedAt?.toISOString() ?? null,
    externalReference: r.externalReference,
    journalId: r.journalId,
    createdAt: r.createdAt.toISOString(),
  };
}
