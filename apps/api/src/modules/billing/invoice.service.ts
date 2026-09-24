import { Injectable } from "@nestjs/common";
import { and, asc, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import type {
  AgeingBucket,
  CompanyTaxProfile,
  CreditNoteRequest,
  DocumentKind,
  Invoice,
  InvoiceLine,
  InvoiceStatus,
  RecordInvoicePaymentRequest,
  Statement,
  StatementLine,
} from "@delicate/contracts";
import {
  accounts,
  bookings,
  invoiceCounters,
  invoiceLines,
  invoicePayments,
  invoices,
  organizations,
  settlements,
  shipments,
  walletEntries,
  wallets,
  type DbExecutor,
} from "@delicate/db";
import { DbService } from "../../infra/db.module.js";
import { AuditService } from "../../infra/audit.service.js";
import { SettingsService } from "../../infra/settings.service.js";
import { Clock } from "../../infra/clock.js";
import { AppError } from "../../common/errors.js";
import { LedgerService, cr, dr } from "../ledger/ledger.service.js";
import { WalletService } from "../wallet/wallet.service.js";

/**
 * Invoicing (Phase 3C).
 *
 * Two shapes, because the two billing modes are genuinely different transactions:
 *
 *   prepaid   the wallet was already charged when the deliveries settled, so the invoice is a
 *             *document* of something that already happened. It posts no journal — revenue and
 *             VAT were recognised at settlement, and recognising them again would double the
 *             books. It is born paid, outstanding zero.
 *
 *   postpaid  the month's deliveries are consolidated into one invoice, and that invoice is what
 *             reclassifies the usage from "drawn against their wallet" into a formal receivable:
 *               Dr CUSTOMER_RECEIVABLE(account)   Cr CUSTOMER_PREPAID_LIABILITY(account)
 *             Payment against it is recorded separately, when the money actually arrives.
 *
 * An issued document is immutable. Corrections are credit notes, because the customer may
 * already have claimed the VAT on the original.
 */
@Injectable()
export class InvoiceService {
  constructor(
    private readonly dbs: DbService,
    private readonly ledger: LedgerService,
    private readonly wallet: WalletService,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
    private readonly clock: Clock,
  ) {}

  // ── issuing ───────────────────────────────────────────────────────────────────

  /**
   * Invoice one charged booking. Called from the `booking.charged` handler, so it is idempotent
   * on the booking and safe to redeliver.
   */
  async issueForBooking(bookingId: string): Promise<Invoice | null> {
    return this.dbs.transaction(async (tx) => {
      const existing = await tx.query.invoices.findFirst({
        where: and(
          eq(invoices.bookingId, bookingId),
          inArray(invoices.kind, ["tax_invoice", "invoice"]),
        ),
      });
      if (existing) return this.hydrate(tx, existing);

      const booking = await tx.query.bookings.findFirst({ where: eq(bookings.id, bookingId) });
      if (!booking) throw AppError.notFound("booking");
      const account = await tx.query.accounts.findFirst({
        where: eq(accounts.id, booking.accountId),
      });
      if (!account) throw AppError.notFound("account");
      // Postpaid accounts are billed monthly; one invoice per booking would defeat the terms.
      if (account.billingMode === "postpaid") return null;

      const rows = await tx
        .select({
          shipmentId: settlements.shipmentId,
          waybill: shipments.waybill,
          suburb: sql<string>`coalesce(${shipments.deliveryAddress} ->> 'suburb', ${shipments.deliveryAddress} ->> 'city')`,
          netCents: settlements.revenueCents,
          vatCents: settlements.vatCents,
        })
        .from(settlements)
        .innerJoin(shipments, eq(shipments.id, settlements.shipmentId))
        .where(eq(settlements.bookingId, bookingId))
        .orderBy(shipments.sequence);
      if (rows.length === 0) return null;

      const vatBps = await this.settings.vatBps();
      const lines: InvoiceLine[] = rows.map((r) => ({
        description: `Same-day delivery to ${r.suburb ?? "destination"}`,
        waybill: r.waybill,
        shipmentId: r.shipmentId,
        quantity: 1,
        unitAmountCents: r.netCents,
        netCents: r.netCents,
        vatBps,
        vatCents: r.vatCents,
        grossCents: r.netCents + r.vatCents,
      }));

      return this.write(tx, {
        accountId: booking.accountId,
        bookingId,
        period: null,
        lines,
        // Already paid out of the wallet when the deliveries settled.
        outstandingCents: 0,
        dueAt: null,
        idempotencyKey: `invoice:booking:${bookingId}`,
        note: `Booking ${booking.reference}`,
      });
    });
  }

  /**
   * Consolidate a month of deliveries into one invoice per postpaid account, and turn the usage
   * into a formal receivable.
   */
  async issueMonthly(period: string, accountId?: string): Promise<Invoice[]> {
    const [year, month] = period.split("-").map(Number);
    const from = new Date(Date.UTC(year!, month! - 1, 1));
    const to = new Date(Date.UTC(year!, month!, 1));

    const targets = await this.dbs.db
      .select()
      .from(accounts)
      .where(
        and(
          eq(accounts.billingMode, "postpaid"),
          accountId ? eq(accounts.id, accountId) : undefined,
        ),
      );

    const out: Invoice[] = [];
    for (const account of targets) {
      const invoice = await this.dbs.transaction(async (tx) => {
        const existing = await tx.query.invoices.findFirst({
          where: and(eq(invoices.accountId, account.id), eq(invoices.period, period)),
        });
        if (existing) return this.hydrate(tx, existing);

        const rows = await tx
          .select({
            shipmentId: settlements.shipmentId,
            waybill: shipments.waybill,
            suburb: sql<string>`coalesce(${shipments.deliveryAddress} ->> 'suburb', ${shipments.deliveryAddress} ->> 'city')`,
            netCents: settlements.revenueCents,
            vatCents: settlements.vatCents,
            settledAt: settlements.settledAt,
          })
          .from(settlements)
          .innerJoin(shipments, eq(shipments.id, settlements.shipmentId))
          .where(
            and(
              eq(settlements.accountId, account.id),
              gte(settlements.settledAt, from),
              lte(settlements.settledAt, to),
            ),
          )
          .orderBy(asc(settlements.settledAt));
        if (rows.length === 0) return null;

        const vatBps = await this.settings.vatBps();
        const lines: InvoiceLine[] = rows.map((r) => ({
          description: `${r.waybill} — delivery to ${r.suburb ?? "destination"}`,
          waybill: r.waybill,
          shipmentId: r.shipmentId,
          quantity: 1,
          unitAmountCents: r.netCents,
          netCents: r.netCents,
          vatBps,
          vatCents: r.vatCents,
          grossCents: r.netCents + r.vatCents,
        }));

        const terms = await tx.query.wallets.findFirst({
          where: eq(wallets.accountId, account.id),
        });
        const total = lines.reduce((s, l) => s + l.grossCents, 0);
        const dueAt = new Date(to);
        dueAt.setUTCDate(dueAt.getUTCDate() + (terms?.paymentTermsDays ?? 30));

        const invoice = await this.write(tx, {
          accountId: account.id,
          bookingId: null,
          period,
          lines,
          outstandingCents: total,
          dueAt,
          idempotencyKey: `invoice:monthly:${account.id}:${period}`,
          note: `Deliveries for ${period}`,
        });

        // The usage was drawn against their wallet as it happened; the invoice is what turns it
        // into a receivable we can age and chase.
        const journal = await this.ledger.post(tx, {
          kind: "adjustment",
          refType: "invoice",
          refId: invoice.id,
          description: `Invoice ${invoice.number} raised`,
          idempotencyKey: `invoice:${invoice.id}:raised`,
          lines: [
            dr("CUSTOMER_RECEIVABLE", total, { type: "account", id: account.id }, invoice.number),
            cr(
              "CUSTOMER_PREPAID_LIABILITY",
              total,
              { type: "account", id: account.id },
              invoice.number,
            ),
          ],
        });
        // Bring the wallet back to zero: the debt now lives on the invoice, not the wallet.
        await this.wallet.post(tx, {
          accountId: account.id,
          kind: "statement_payment",
          amountCents: total,
          description: `Invoiced ${invoice.number}`,
          reference: invoice.number,
          idempotencyKey: `invoice:${invoice.id}:wallet`,
        });
        await tx.update(invoices).set({ journalId: journal.id }).where(eq(invoices.id, invoice.id));
        return { ...invoice, journalId: journal.id };
      });
      if (invoice) out.push(invoice);
    }
    return out;
  }

  /** Reverse an issued document. Never edits the original — the customer may already have it. */
  async creditNote(invoiceId: string, body: CreditNoteRequest): Promise<Invoice> {
    return this.dbs.transaction(async (tx) => {
      const [original] = await tx
        .select()
        .from(invoices)
        .where(eq(invoices.id, invoiceId))
        .for("update");
      if (!original) throw AppError.notFound("invoice");
      if (original.kind === "credit_note") {
        throw AppError.conflict("not_creditable", "a credit note cannot be credited");
      }
      if (original.status === "draft") {
        throw AppError.conflict("not_issued", "only an issued invoice can be credited");
      }
      if (original.creditedByInvoiceId) {
        throw AppError.conflict("already_credited", "this invoice already has a credit note");
      }

      const lines = await tx
        .select()
        .from(invoiceLines)
        .where(eq(invoiceLines.invoiceId, invoiceId))
        .orderBy(invoiceLines.sequence);
      const full = body.amountCents === undefined || body.amountCents >= original.totalCents;
      const vatBps = lines[0]?.vatBps ?? (await this.settings.vatBps());

      const creditLines: InvoiceLine[] = full
        ? lines.map((l) => ({
            description: l.description,
            waybill: l.waybill,
            shipmentId: l.shipmentId,
            quantity: l.quantity,
            unitAmountCents: -l.unitAmountCents,
            netCents: -l.netCents,
            vatBps: l.vatBps,
            vatCents: -l.vatCents,
            grossCents: -l.grossCents,
          }))
        : [creditPortion(body.amountCents!, vatBps, body.reason)];

      const note = await this.write(tx, {
        accountId: original.accountId,
        bookingId: original.bookingId,
        period: original.period,
        lines: creditLines,
        outstandingCents: 0,
        dueAt: null,
        kind: "credit_note",
        creditsInvoiceId: original.id,
        idempotencyKey: `credit_note:${original.id}`,
        note: body.reason,
      });

      const credited = Math.abs(creditLines.reduce((s, l) => s + l.grossCents, 0));
      await tx
        .update(invoices)
        .set({
          creditedByInvoiceId: note.id,
          status: full ? "void" : original.status,
          outstandingCents: Math.max(0, original.outstandingCents - credited),
        })
        .where(eq(invoices.id, original.id));

      // Reverse the revenue the original recognised, so the books follow the document.
      const net = Math.abs(creditLines.reduce((s, l) => s + l.netCents, 0));
      const vat = Math.abs(creditLines.reduce((s, l) => s + l.vatCents, 0));
      const journal = await this.ledger.post(tx, {
        kind: "reversal",
        refType: "invoice",
        refId: note.id,
        description: `Credit note ${note.number} against ${original.number}`,
        idempotencyKey: `credit_note:${note.id}:posted`,
        lines: [
          dr("REVENUE", net, { type: "company" }, note.number),
          dr("VAT_OUTPUT", vat, { type: "company" }, note.number),
          cr(
            original.period ? "CUSTOMER_RECEIVABLE" : "CUSTOMER_PREPAID_LIABILITY",
            net + vat,
            { type: "account", id: original.accountId },
            note.number,
          ),
        ],
      });
      // A prepaid customer gets the money back in their wallet.
      if (!original.period) {
        await this.wallet.post(tx, {
          accountId: original.accountId,
          kind: "refund",
          amountCents: net + vat,
          description: `Credit note ${note.number}`,
          reference: note.number,
          idempotencyKey: `credit_note:${note.id}:refund`,
        });
      }
      await tx.update(invoices).set({ journalId: journal.id }).where(eq(invoices.id, note.id));

      await this.audit.record(tx, {
        action: "invoice.credit_note",
        entityType: "invoice",
        entityId: original.id,
        before: { status: original.status, outstandingCents: original.outstandingCents },
        after: { creditNote: note.number, amountCents: credited, reason: body.reason },
      });
      return { ...note, journalId: journal.id };
    });
  }

  /** Money received against a postpaid invoice. Recorded by a human, like every other receipt. */
  async recordPayment(invoiceId: string, body: RecordInvoicePaymentRequest): Promise<Invoice> {
    return this.dbs.transaction(async (tx) => {
      const [invoice] = await tx
        .select()
        .from(invoices)
        .where(eq(invoices.id, invoiceId))
        .for("update");
      if (!invoice) throw AppError.notFound("invoice");
      if (invoice.outstandingCents <= 0) {
        throw AppError.conflict("nothing_outstanding", "this invoice has nothing outstanding");
      }
      if (body.amountCents > invoice.outstandingCents) {
        throw AppError.conflict(
          "overpayment",
          `invoice ${invoice.number} has only ${invoice.outstandingCents}c outstanding`,
          { outstandingCents: invoice.outstandingCents },
        );
      }
      const paidAt = body.paidAt ? new Date(body.paidAt) : this.clock.now();
      const journal = await this.ledger.post(tx, {
        kind: "topup",
        refType: "invoice",
        refId: invoice.id,
        description: `Payment ${body.reference} for ${invoice.number}`,
        idempotencyKey: `invoice_payment:${invoice.id}:${body.reference}`,
        occurredAt: paidAt,
        lines: [
          dr("CASH_CLEARING", body.amountCents, { type: "company" }, body.reference),
          cr(
            "CUSTOMER_RECEIVABLE",
            body.amountCents,
            { type: "account", id: invoice.accountId },
            invoice.number,
          ),
        ],
      });
      await tx.insert(invoicePayments).values({
        invoiceId: invoice.id,
        amountCents: body.amountCents,
        reference: body.reference,
        journalId: journal.id,
        paidAt,
        idempotencyKey: `invoice_payment:${invoice.id}:${body.reference}`,
      });
      const outstanding = invoice.outstandingCents - body.amountCents;
      const [updated] = await tx
        .update(invoices)
        .set({ outstandingCents: outstanding, status: outstanding === 0 ? "paid" : invoice.status })
        .where(eq(invoices.id, invoice.id))
        .returning();
      await this.audit.record(tx, {
        action: "invoice.payment",
        entityType: "invoice",
        entityId: invoice.id,
        after: { amountCents: body.amountCents, reference: body.reference, outstanding },
      });
      return this.hydrate(tx, updated!);
    });
  }

  // ── writing ───────────────────────────────────────────────────────────────────

  private async write(
    tx: DbExecutor,
    v: {
      accountId: string;
      bookingId: string | null;
      period: string | null;
      lines: InvoiceLine[];
      outstandingCents: number;
      dueAt: Date | null;
      idempotencyKey: string;
      note: string;
      kind?: DocumentKind;
      creditsInvoiceId?: string;
    },
  ): Promise<Invoice> {
    const supplier = await this.supplier();
    const vatRegistered = await this.settings.get("company.vat_registered");
    const kind: DocumentKind =
      v.kind ?? (vatRegistered && supplier.vatNumber ? "tax_invoice" : "invoice");
    const issuedAt = this.clock.now();
    const number = await this.nextNumber(tx, kind, issuedAt);

    const net = v.lines.reduce((s, l) => s + l.netCents, 0);
    const vat = v.lines.reduce((s, l) => s + l.vatCents, 0);
    const total = net + vat;

    const account = await tx.query.accounts.findFirst({ where: eq(accounts.id, v.accountId) });
    const org = account?.organizationId
      ? await tx.query.organizations.findFirst({
          where: eq(organizations.id, account.organizationId),
        })
      : null;

    const [row] = await tx
      .insert(invoices)
      .values({
        number,
        kind,
        status: "issued",
        accountId: v.accountId,
        bookingId: v.bookingId,
        period: v.period,
        issuedAt,
        dueAt: v.dueAt,
        netCents: net,
        vatCents: vat,
        totalCents: total,
        outstandingCents: v.outstandingCents,
        supplier,
        billTo: {
          accountName: account?.name ?? "Customer",
          legalName: org?.name ?? null,
          vatNumber: org?.vatNumber ?? null,
          address: account?.billingAddress ?? null,
          email: account?.billingEmail ?? null,
        },
        creditsInvoiceId: v.creditsInvoiceId ?? null,
        note: v.note,
        idempotencyKey: v.idempotencyKey,
      })
      .returning();

    await tx.insert(invoiceLines).values(
      v.lines.map((l, i) => ({
        invoiceId: row!.id,
        sequence: i,
        description: l.description,
        waybill: l.waybill,
        shipmentId: l.shipmentId,
        quantity: l.quantity,
        unitAmountCents: l.unitAmountCents,
        netCents: l.netCents,
        vatBps: l.vatBps,
        vatCents: l.vatCents,
        grossCents: l.grossCents,
      })),
    );
    await this.audit.record(tx, {
      action: "invoice.issue",
      entityType: "invoice",
      entityId: row!.id,
      after: { number, kind, totalCents: total, accountId: v.accountId },
    });
    return toInvoice(row!, v.lines);
  }

  private async nextNumber(tx: DbExecutor, kind: DocumentKind, at: Date): Promise<string> {
    const prefix = kind === "credit_note" ? "CN" : "INV";
    const yymm = `${String(at.getUTCFullYear()).slice(2)}${String(at.getUTCMonth() + 1).padStart(2, "0")}`;
    const scope = `${prefix}-${yymm}`;
    await tx.insert(invoiceCounters).values({ scope }).onConflictDoNothing();
    const [row] = await tx
      .update(invoiceCounters)
      .set({ next: sql`${invoiceCounters.next} + 1` })
      .where(eq(invoiceCounters.scope, scope))
      .returning({ next: invoiceCounters.next });
    return `${scope}-${String(row!.next - 1).padStart(4, "0")}`;
  }

  private async supplier(): Promise<CompanyTaxProfile> {
    return this.settings.get("company.tax_profile");
  }

  // ── reads ─────────────────────────────────────────────────────────────────────

  async get(id: string, accountId?: string): Promise<Invoice> {
    const row = await this.dbs.db.query.invoices.findFirst({ where: eq(invoices.id, id) });
    if (!row) throw AppError.notFound("invoice");
    if (accountId && row.accountId !== accountId) throw AppError.notFound("invoice");
    return this.hydrate(this.dbs.db, row);
  }

  async list(opts: {
    accountId?: string;
    status?: InvoiceStatus;
    period?: string;
    limit?: number;
  }): Promise<Invoice[]> {
    const rows = await this.dbs.db
      .select()
      .from(invoices)
      .where(
        and(
          opts.accountId ? eq(invoices.accountId, opts.accountId) : undefined,
          opts.status ? eq(invoices.status, opts.status) : undefined,
          opts.period ? eq(invoices.period, opts.period) : undefined,
        ),
      )
      .orderBy(desc(invoices.createdAt))
      .limit(Math.min(opts.limit ?? 50, 200));
    return Promise.all(rows.map((r) => this.hydrate(this.dbs.db, r)));
  }

  private async hydrate(db: DbExecutor, row: typeof invoices.$inferSelect): Promise<Invoice> {
    const lines = await db
      .select()
      .from(invoiceLines)
      .where(eq(invoiceLines.invoiceId, row.id))
      .orderBy(invoiceLines.sequence);
    return toInvoice(
      row,
      lines.map((l) => ({
        description: l.description,
        waybill: l.waybill,
        shipmentId: l.shipmentId,
        quantity: l.quantity,
        unitAmountCents: l.unitAmountCents,
        netCents: l.netCents,
        vatBps: l.vatBps,
        vatCents: l.vatCents,
        grossCents: l.grossCents,
      })),
    );
  }

  /**
   * A statement is recomputed from the append-only wallet entries every time it is asked for —
   * opening balance, movements, closing balance — so it can never drift from the entries.
   */
  async statement(accountId: string, from: string, to: string): Promise<Statement> {
    const account = await this.dbs.db.query.accounts.findFirst({
      where: eq(accounts.id, accountId),
    });
    if (!account) throw AppError.notFound("account");
    const start = new Date(`${from}T00:00:00.000Z`);
    const end = new Date(`${to}T23:59:59.999Z`);

    const [before] = await this.dbs.db
      .select({ total: sql<string>`coalesce(sum(${walletEntries.amountCents}), 0)::bigint` })
      .from(walletEntries)
      .where(
        and(eq(walletEntries.accountId, accountId), sql`${walletEntries.createdAt} < ${start}`),
      );
    const opening = Number(before?.total ?? 0);

    const rows = await this.dbs.db
      .select()
      .from(walletEntries)
      .where(
        and(
          eq(walletEntries.accountId, accountId),
          gte(walletEntries.createdAt, start),
          lte(walletEntries.createdAt, end),
        ),
      )
      .orderBy(asc(walletEntries.createdAt));

    let running = opening;
    const lines: StatementLine[] = rows.map((r) => {
      running += r.amountCents;
      return {
        at: r.createdAt.toISOString(),
        kind: r.kind,
        description: r.description,
        reference: r.reference,
        amountCents: r.amountCents,
        balanceAfterCents: running,
      };
    });

    const invoiceRows = await this.dbs.db
      .select()
      .from(invoices)
      .where(
        and(
          eq(invoices.accountId, accountId),
          gte(invoices.issuedAt, start),
          lte(invoices.issuedAt, end),
        ),
      )
      .orderBy(asc(invoices.issuedAt));

    const [deliveries] = await this.dbs.db
      .select({ n: sql<string>`count(*)::int` })
      .from(settlements)
      .where(
        and(
          eq(settlements.accountId, accountId),
          gte(settlements.settledAt, start),
          lte(settlements.settledAt, end),
        ),
      );

    return {
      accountId,
      accountName: account.name,
      from,
      to,
      openingBalanceCents: opening,
      closingBalanceCents: running,
      toppedUpCents: rows.filter((r) => r.amountCents > 0).reduce((s, r) => s + r.amountCents, 0),
      chargedCents: -rows.filter((r) => r.amountCents < 0).reduce((s, r) => s + r.amountCents, 0),
      deliveries: Number(deliveries?.n ?? 0),
      lines,
      invoices: invoiceRows.map((i) => ({
        id: i.id,
        number: i.number,
        issuedAt: i.issuedAt?.toISOString() ?? null,
        dueAt: i.dueAt?.toISOString() ?? null,
        totalCents: i.totalCents,
        outstandingCents: i.outstandingCents,
        status: i.status,
      })),
      outstandingCents: await this.ledger.balance("CUSTOMER_RECEIVABLE", "account", accountId),
    };
  }

  /** What customers owe us, bucketed by how late it is. */
  async ageing(): Promise<AgeingBucket[]> {
    const rows = await this.dbs.db
      .select()
      .from(invoices)
      .where(
        and(inArray(invoices.status, ["issued", "paid"]), sql`${invoices.outstandingCents} > 0`),
      );
    const accountRows = await this.dbs.db.select().from(accounts);
    const walletRows = await this.dbs.db.select().from(wallets);
    const now = this.clock.now();

    const byAccount = new Map<string, AgeingBucket>();
    for (const inv of rows) {
      const account = accountRows.find((a) => a.id === inv.accountId);
      const bucket =
        byAccount.get(inv.accountId) ??
        ({
          accountId: inv.accountId,
          accountName: account?.name ?? "Account",
          currentCents: 0,
          days30Cents: 0,
          days60Cents: 0,
          days90PlusCents: 0,
          totalCents: 0,
          creditLimitCents:
            walletRows.find((w) => w.accountId === inv.accountId)?.creditLimitCents ?? 0,
          overLimit: false,
        } satisfies AgeingBucket);
      const daysLate = inv.dueAt
        ? Math.floor((now.getTime() - inv.dueAt.getTime()) / 86_400_000)
        : 0;
      if (daysLate <= 0) bucket.currentCents += inv.outstandingCents;
      else if (daysLate <= 30) bucket.days30Cents += inv.outstandingCents;
      else if (daysLate <= 60) bucket.days60Cents += inv.outstandingCents;
      else bucket.days90PlusCents += inv.outstandingCents;
      bucket.totalCents += inv.outstandingCents;
      bucket.overLimit = bucket.totalCents > bucket.creditLimitCents;
      byAccount.set(inv.accountId, bucket);
    }
    return [...byAccount.values()].sort((a, b) => b.totalCents - a.totalCents);
  }
}

/** Split a partial credit amount back into net and VAT so the reversal stays balanced. */
function creditPortion(grossCents: number, vatBps: number, reason: string): InvoiceLine {
  const net = Math.round((grossCents * 10_000) / (10_000 + vatBps));
  const vat = grossCents - net;
  return {
    description: `Credit: ${reason}`,
    waybill: null,
    shipmentId: null,
    quantity: 1,
    unitAmountCents: -net,
    netCents: -net,
    vatBps,
    vatCents: -vat,
    grossCents: -grossCents,
  };
}

function toInvoice(r: typeof invoices.$inferSelect, lines: InvoiceLine[]): Invoice {
  return {
    id: r.id,
    number: r.number,
    kind: r.kind,
    status: r.status,
    accountId: r.accountId,
    bookingId: r.bookingId,
    period: r.period,
    issuedAt: r.issuedAt?.toISOString() ?? null,
    dueAt: r.dueAt?.toISOString() ?? null,
    netCents: r.netCents,
    vatCents: r.vatCents,
    totalCents: r.totalCents,
    outstandingCents: r.outstandingCents,
    currency: "ZAR",
    lines,
    supplier: r.supplier as Invoice["supplier"],
    billTo: r.billTo as Invoice["billTo"],
    creditsInvoiceId: r.creditsInvoiceId,
    creditedByInvoiceId: r.creditedByInvoiceId,
    note: r.note,
    journalId: r.journalId,
    createdAt: r.createdAt.toISOString(),
  };
}
