import { Injectable } from "@nestjs/common";
import { and, eq, sql } from "drizzle-orm";
import {
  fuelCostCentsPerKm,
  type FailureCharge,
  type Settlement,
  type SettlementRules,
} from "@delicate/contracts";
import { bookings, quotes, settlements, shipments, type DbExecutor } from "@delicate/db";
import { DbService } from "../../infra/db.module.js";
import { OutboxService } from "../../infra/outbox.service.js";
import { SettingsService } from "../../infra/settings.service.js";
import { AppError } from "../../common/errors.js";
import { WalletService } from "../wallet/wallet.service.js";
import { LedgerService, cr, dr } from "../ledger/ledger.service.js";
import { Clock } from "../../infra/clock.js";

export interface SettleInput {
  shipmentId: string;
  driverId: string | null;
  shiftId: string | null;
  actualKm: number;
  plannedKm: number;
  outcome: "delivered" | "failed";
  /** Why it failed, which decides whether the customer keeps paying for it. */
  failureReason?: string | null;
}

export interface PresettleInput {
  shipmentId: string;
}

/**
 * Settlement (invariants #3, #8): one immutable row and one balanced journal per shipment,
 * computed from the booking's quoted price and the ACTUAL distance.
 *
 *   revenue_i   = booking subtotal (ex VAT) ÷ live drops   (remainder to the last drop)
 *   vat_i       = booking VAT ÷ live drops                 (same rounding)
 *   fuel        = actualKm × fuelCostPerKm
 *   earning     = perDrop + actualKm × perKm
 *   margin      = revenue − fuel − earning
 *
 * Journal (debit +, credit −):
 *   Dr CUSTOMER_PREPAID_LIABILITY(account)  revenue + vat   ← customer's wallet share
 *   Cr REVENUE                              revenue
 *   Cr VAT_OUTPUT                           vat
 *   Dr FUEL_EXPENSE                         fuel
 *   Cr FUEL_PAYABLE(driver)                 fuel            ← what the fuel card must be loaded
 *   Dr DRIVER_EARNINGS_EXPENSE              earning
 *   Cr DRIVER_EARNINGS_PAYABLE(driver)      earning         ← owed to the driver
 *
 * When every live shipment of the booking is settled, the booking's wallet hold is captured
 * for the booking total, which equals the sum of the liability debits above.
 */
@Injectable()
export class SettlementService {
  constructor(
    private readonly dbs: DbService,
    private readonly outbox: OutboxService,
    private readonly settings: SettingsService,
    private readonly wallet: WalletService,
    private readonly ledger: LedgerService,
    private readonly clock: Clock,
  ) {}

  /**
   * Move the money the day the booking is paid for, not the day the van arrives.
   *
   * The cash is in the bank immediately, so this recognises it immediately: revenue against
   * the customer's prepaid balance, and the fuel and driver cost the job is going to incur
   * against an unassigned pool. The pool is deliberate — there is no driver on a booking five
   * months out, and owing money to nobody in particular is more honest than owing it to
   * whoever happens to be free today. The true-up at delivery moves it to the real driver.
   *
   * Priced on planned kilometres, because that is all that is known. Delivery corrects it.
   */
  async presettle(tx: DbExecutor, input: PresettleInput): Promise<Settlement> {
    const existing = await tx.query.settlements.findFirst({
      where: eq(settlements.shipmentId, input.shipmentId),
    });
    if (existing) return toSettlement(existing);

    const s = await tx.query.shipments.findFirst({ where: eq(shipments.id, input.shipmentId) });
    if (!s) throw AppError.notFound("shipment");
    const booking = await tx.query.bookings.findFirst({ where: eq(bookings.id, s.bookingId) });
    if (!booking) throw AppError.notFound("booking");

    const rules = await this.settings.get("settlement.rules");
    const costModel = await this.settings.get("pricing.cost_model");
    const share = await this.share(tx, booking, s);
    const plannedKm = await this.plannedShare(tx, booking, s);
    const fuelCostCents = Math.round(plannedKm * fuelCostCentsPerKm(costModel));
    const driverEarningCents =
      rules.driverEarningPerDropCents + Math.round(plannedKm * rules.driverEarningPerKmCents);
    const marginCents = share.revenueCents - fuelCostCents - driverEarningCents;

    const journal = await this.ledger.post(tx, {
      kind: "settlement",
      refType: "shipment",
      refId: s.id,
      description: `Pre-settle ${s.waybill} (booked)`,
      idempotencyKey: `presettlement:${s.id}`,
      occurredAt: this.clock.now(),
      lines: [
        dr(
          "CUSTOMER_PREPAID_LIABILITY",
          share.revenueCents + share.vatCents,
          { type: "account", id: s.accountId },
          `${s.waybill} charge`,
        ),
        cr("REVENUE", share.revenueCents, { type: "company" }, `${s.waybill} revenue`),
        cr("VAT_OUTPUT", share.vatCents, { type: "company" }, `${s.waybill} VAT`),
        dr(
          "FUEL_EXPENSE",
          fuelCostCents,
          { type: "company" },
          `${s.waybill} fuel ${plannedKm} km (planned)`,
        ),
        cr("FUEL_PAYABLE", fuelCostCents, { type: "company" }, `${s.waybill} fuel (unassigned)`),
        dr(
          "DRIVER_EARNINGS_EXPENSE",
          driverEarningCents,
          { type: "company" },
          `${s.waybill} earning`,
        ),
        cr(
          "DRIVER_EARNINGS_PAYABLE",
          driverEarningCents,
          { type: "company" },
          `${s.waybill} earning (unassigned)`,
        ),
      ],
    });

    const [row] = await tx
      .insert(settlements)
      .values({
        shipmentId: s.id,
        bookingId: s.bookingId,
        accountId: s.accountId,
        driverId: null,
        shiftId: null,
        revenueCents: share.revenueCents,
        vatCents: share.vatCents,
        fuelCostCents,
        driverEarningCents,
        marginCents,
        plannedKm: String(plannedKm),
        actualKm: null,
        journalId: journal.id,
        outcome: null,
        presettledAt: this.clock.now(),
        settledAt: null,
        rulesSnapshot: { rules, costModel, share, stage: "presettled" },
      })
      .returning();

    await this.outbox.emit(
      tx,
      "settlement.posted",
      {
        shipmentId: s.id,
        bookingId: s.bookingId,
        accountId: s.accountId,
        driverId: null,
        journalId: journal.id,
        revenueCents: share.revenueCents,
        vatCents: share.vatCents,
        fuelCostCents,
        driverEarningCents,
        marginCents,
        actualKm: plannedKm,
      },
      { dedupeKey: `settlement:${s.id}:posted` },
    );

    await this.captureIfComplete(tx, booking.id);
    return toSettlement(row!);
  }

  async settle(tx: DbExecutor, input: SettleInput): Promise<Settlement> {
    const existing = await tx.query.settlements.findFirst({
      where: eq(settlements.shipmentId, input.shipmentId),
    });
    // Pre-settled at booking: delivery only corrects the estimate and names the driver.
    if (existing?.settledAt) return toSettlement(existing);
    if (existing) return this.trueUp(tx, existing, input);

    const s = await tx.query.shipments.findFirst({ where: eq(shipments.id, input.shipmentId) });
    if (!s) throw AppError.notFound("shipment");
    const booking = await tx.query.bookings.findFirst({ where: eq(bookings.id, s.bookingId) });
    if (!booking) throw AppError.notFound("booking");
    const rules = await this.settings.get("settlement.rules");

    const costModel = await this.settings.get("pricing.cost_model");
    const chargeable =
      input.outcome === "delivered" || chargeOnFailure(rules, input.failureReason) !== "refund";
    const share = await this.share(tx, booking, s);
    const revenueCents = chargeable ? share.revenueCents : 0;
    const vatCents = chargeable ? share.vatCents : 0;
    const actualKm = Math.round(input.actualKm * 100) / 100;
    const fuelCostCents = Math.round(actualKm * fuelCostCentsPerKm(costModel));
    const driverEarningCents =
      input.driverId && chargeable
        ? rules.driverEarningPerDropCents + Math.round(actualKm * rules.driverEarningPerKmCents)
        : 0;
    const marginCents = revenueCents - fuelCostCents - driverEarningCents;

    const lines = [
      dr(
        "CUSTOMER_PREPAID_LIABILITY",
        revenueCents + vatCents,
        { type: "account", id: s.accountId },
        `${s.waybill} charge`,
      ),
      cr("REVENUE", revenueCents, { type: "company" }, `${s.waybill} revenue`),
      cr("VAT_OUTPUT", vatCents, { type: "company" }, `${s.waybill} VAT`),
    ];
    if (input.driverId) {
      lines.push(
        dr("FUEL_EXPENSE", fuelCostCents, { type: "company" }, `${s.waybill} fuel ${actualKm} km`),
        cr(
          "FUEL_PAYABLE",
          fuelCostCents,
          { type: "driver", id: input.driverId },
          `${s.waybill} fuel`,
        ),
        dr(
          "DRIVER_EARNINGS_EXPENSE",
          driverEarningCents,
          { type: "company" },
          `${s.waybill} earning`,
        ),
        cr(
          "DRIVER_EARNINGS_PAYABLE",
          driverEarningCents,
          { type: "driver", id: input.driverId },
          `${s.waybill} earning`,
        ),
      );
    }
    const settledAt = this.clock.now();
    const journal = await this.ledger.post(tx, {
      kind: "settlement",
      refType: "shipment",
      refId: s.id,
      description: `Settle ${s.waybill} (${input.outcome})`,
      idempotencyKey: `settlement:${s.id}`,
      occurredAt: settledAt,
      lines,
    });

    const [row] = await tx
      .insert(settlements)
      .values({
        shipmentId: s.id,
        bookingId: s.bookingId,
        accountId: s.accountId,
        driverId: input.driverId,
        shiftId: input.shiftId,
        revenueCents,
        vatCents,
        fuelCostCents,
        driverEarningCents,
        marginCents,
        plannedKm: String(input.plannedKm),
        actualKm: String(actualKm),
        journalId: journal.id,
        outcome: input.outcome,
        presettledAt: settledAt,
        settledAt,
        rulesSnapshot: { rules, costModel, share, outcome: input.outcome, stage: "settled" },
      })
      .returning();

    await this.outbox.emit(
      tx,
      "settlement.posted",
      {
        shipmentId: s.id,
        bookingId: s.bookingId,
        accountId: s.accountId,
        driverId: input.driverId,
        journalId: journal.id,
        revenueCents,
        vatCents,
        fuelCostCents,
        driverEarningCents,
        marginCents,
        actualKm,
      },
      { dedupeKey: `settlement:${s.id}:posted` },
    );

    await this.captureIfComplete(tx, booking.id);
    return toSettlement(row!);
  }

  /**
   * Undo a pre-settlement, because the delivery is never going to happen.
   *
   * Recognising money at booking means a cancellation has to give it back — the journal, the
   * earmarked cost, and the cash. Without this a cancelled booking would leave revenue on the
   * books for a van that never left, which is the one way this scheme can quietly go wrong.
   *
   * Does nothing to a shipment that was already trued up: by then it has been delivered, and
   * a delivered shipment is not cancellable.
   */
  async reverse(tx: DbExecutor, shipmentId: string, reason: string): Promise<void> {
    const row = await tx.query.settlements.findFirst({
      where: eq(settlements.shipmentId, shipmentId),
    });
    if (!row || row.reversedAt || row.settledAt) return;

    const s = await tx.query.shipments.findFirst({ where: eq(shipments.id, shipmentId) });
    if (!s) return;

    const journal = await this.ledger.post(tx, {
      kind: "settlement",
      refType: "shipment",
      refId: s.id,
      description: `Reverse ${s.waybill} (${reason})`,
      idempotencyKey: `presettlement:${s.id}:reversal`,
      occurredAt: this.clock.now(),
      lines: [
        cr(
          "CUSTOMER_PREPAID_LIABILITY",
          row.revenueCents + row.vatCents,
          { type: "account", id: s.accountId },
          `${s.waybill} reversal`,
        ),
        dr("REVENUE", row.revenueCents, { type: "company" }, `${s.waybill} reversal`),
        dr("VAT_OUTPUT", row.vatCents, { type: "company" }, `${s.waybill} reversal VAT`),
        cr("FUEL_EXPENSE", row.fuelCostCents, { type: "company" }, `${s.waybill} fuel reversal`),
        dr("FUEL_PAYABLE", row.fuelCostCents, { type: "company" }, `${s.waybill} fuel reversal`),
        cr(
          "DRIVER_EARNINGS_EXPENSE",
          row.driverEarningCents,
          { type: "company" },
          `${s.waybill} earning reversal`,
        ),
        dr(
          "DRIVER_EARNINGS_PAYABLE",
          row.driverEarningCents,
          { type: "company" },
          `${s.waybill} earning reversal`,
        ),
      ],
    });

    await tx
      .update(settlements)
      .set({ reversedAt: this.clock.now(), reversalJournalId: journal.id })
      .where(eq(settlements.shipmentId, s.id));
  }

  /**
   * Correct a pre-settled shipment once it has actually happened.
   *
   * Two jobs in one journal. It moves the fuel and earning out of the unassigned pool and onto
   * the driver who did the work, and it adjusts for the difference between the kilometres we
   * planned and the ones that were driven. Revenue is already recognised and is not touched
   * unless the failure was our fault, in which case it is given back.
   */
  private async trueUp(
    tx: DbExecutor,
    existing: typeof settlements.$inferSelect,
    input: SettleInput,
  ): Promise<Settlement> {
    const s = await tx.query.shipments.findFirst({ where: eq(shipments.id, input.shipmentId) });
    if (!s) throw AppError.notFound("shipment");
    const rules = await this.settings.get("settlement.rules");
    const costModel = await this.settings.get("pricing.cost_model");

    const actualKm = Math.round(input.actualKm * 100) / 100;
    const verdict =
      input.outcome === "delivered" ? "charge" : chargeOnFailure(rules, input.failureReason);
    const refunding = verdict === "refund";

    const estFuel = existing.fuelCostCents;
    const estEarning = existing.driverEarningCents;
    const actualFuel = Math.round(actualKm * fuelCostCentsPerKm(costModel));
    // A driver who drove to a door nobody opened is still owed for the trip; one we never
    // sent is not. The earning follows the work, not the outcome.
    const actualEarning = input.driverId
      ? rules.driverEarningPerDropCents + Math.round(actualKm * rules.driverEarningPerKmCents)
      : 0;

    const owner = input.driverId
      ? ({ type: "driver", id: input.driverId } as const)
      : ({ type: "company" } as const);

    const lines = [
      // Clear the pool, then owe the real amount to the real driver.
      dr("FUEL_PAYABLE", estFuel, { type: "company" }, `${s.waybill} fuel (release pool)`),
      cr("FUEL_PAYABLE", actualFuel, owner, `${s.waybill} fuel ${actualKm} km`),
      dr(
        "DRIVER_EARNINGS_PAYABLE",
        estEarning,
        { type: "company" },
        `${s.waybill} earning (release pool)`,
      ),
      cr("DRIVER_EARNINGS_PAYABLE", actualEarning, owner, `${s.waybill} earning`),
    ];
    // The expense moves by the difference, in whichever direction the day went.
    const fuelDelta = actualFuel - estFuel;
    const earningDelta = actualEarning - estEarning;
    if (fuelDelta !== 0) {
      lines.push(
        fuelDelta > 0
          ? dr("FUEL_EXPENSE", fuelDelta, { type: "company" }, `${s.waybill} fuel true-up`)
          : cr("FUEL_EXPENSE", -fuelDelta, { type: "company" }, `${s.waybill} fuel true-up`),
      );
    }
    if (earningDelta !== 0) {
      lines.push(
        earningDelta > 0
          ? dr(
              "DRIVER_EARNINGS_EXPENSE",
              earningDelta,
              { type: "company" },
              `${s.waybill} earning true-up`,
            )
          : cr(
              "DRIVER_EARNINGS_EXPENSE",
              -earningDelta,
              { type: "company" },
              `${s.waybill} earning true-up`,
            ),
      );
    }
    if (refunding) {
      // Our mistake: the customer gets the money back. The driving still cost us, and that
      // cost stays on the books rather than being quietly written off.
      lines.push(
        dr("REVENUE", existing.revenueCents, { type: "company" }, `${s.waybill} refund`),
        dr("VAT_OUTPUT", existing.vatCents, { type: "company" }, `${s.waybill} refund VAT`),
        cr(
          "CUSTOMER_PREPAID_LIABILITY",
          existing.revenueCents + existing.vatCents,
          { type: "account", id: s.accountId },
          `${s.waybill} refund`,
        ),
      );
    }

    const settledAt = this.clock.now();
    const journal = await this.ledger.post(tx, {
      kind: "settlement",
      refType: "shipment",
      refId: s.id,
      description: `True up ${s.waybill} (${input.outcome}${refunding ? ", refunded" : ""})`,
      idempotencyKey: `settlement:${s.id}:trueup`,
      occurredAt: settledAt,
      lines,
    });

    if (refunding) {
      await this.wallet.adjust(
        s.accountId,
        existing.revenueCents + existing.vatCents,
        `Refund ${s.waybill}`,
      );
    }

    const revenueCents = refunding ? 0 : existing.revenueCents;
    const vatCents = refunding ? 0 : existing.vatCents;
    const [row] = await tx
      .update(settlements)
      .set({
        driverId: input.driverId,
        shiftId: input.shiftId,
        revenueCents,
        vatCents,
        fuelCostCents: actualFuel,
        driverEarningCents: actualEarning,
        marginCents: revenueCents - actualFuel - actualEarning,
        actualKm: String(actualKm),
        trueUpJournalId: journal.id,
        outcome: input.outcome,
        settledAt,
        rulesSnapshot: {
          rules,
          costModel,
          outcome: input.outcome,
          failureReason: input.failureReason ?? null,
          verdict,
          stage: "settled",
        },
      })
      .where(eq(settlements.shipmentId, s.id))
      .returning();

    await this.outbox.emit(
      tx,
      "settlement.trued_up",
      {
        shipmentId: s.id,
        bookingId: s.bookingId,
        accountId: s.accountId,
        driverId: input.driverId,
        journalId: journal.id,
        revenueCents,
        vatCents,
        fuelCostCents: actualFuel,
        driverEarningCents: actualEarning,
        marginCents: revenueCents - actualFuel - actualEarning,
        actualKm,
      },
      { dedupeKey: `settlement:${s.id}:trued-up` },
    );
    return toSettlement(row!);
  }

  /**
   * This shipment's share of the kilometres the booking will drive.
   *
   * Read off the quote, not the booking. The booking carries the customer-facing breakdown,
   * which has the kilometres stripped out on purpose -- distance plus price is our rate per
   * km, and that is the one number a competitor would want. The quote keeps the full version.
   *
   * Taken from there rather than asking the router again: the loop was measured when the price
   * was worked out, and re-routing every drop at booking would pay a geocoding bill twice for
   * the same answer. Split in proportion to each drop's own distance so the parts add up to
   * the loop that actually gets driven.
   */
  private async plannedShare(
    tx: DbExecutor,
    booking: typeof bookings.$inferSelect,
    s: typeof shipments.$inferSelect,
  ): Promise<number> {
    const quote = await tx.query.quotes.findFirst({ where: eq(quotes.id, booking.quoteId) });
    const breakdown = (quote?.breakdown ?? {}) as { distanceKm?: number; dropKm?: number[] };
    const total = breakdown.distanceKm ?? 0;
    const live = await tx
      .select({ id: shipments.id })
      .from(shipments)
      .where(and(eq(shipments.bookingId, booking.id), sql`${shipments.status} <> 'cancelled'`))
      .orderBy(shipments.sequence);
    const index = live.findIndex((row) => row.id === s.id);
    const dropKm = breakdown.dropKm ?? [];
    const weights = live.map((_, i) => dropKm[i] ?? 0);
    const sum = weights.reduce((a, b) => a + b, 0);
    const share = sum > 0 ? (weights[index] ?? 0) / sum : 1 / Math.max(1, live.length);
    return Math.round(total * share * 100) / 100;
  }

  /** Split the booking's subtotal/VAT across live drops; the last drop absorbs rounding. */
  private async share(
    tx: DbExecutor,
    booking: typeof bookings.$inferSelect,
    s: typeof shipments.$inferSelect,
  ) {
    const breakdown = booking.breakdown as { subtotalCents: number; vatCents: number };
    const live = await tx
      .select({ id: shipments.id, sequence: shipments.sequence })
      .from(shipments)
      .where(and(eq(shipments.bookingId, booking.id), sql`${shipments.status} <> 'cancelled'`))
      .orderBy(shipments.sequence);
    const n = Math.max(1, live.length);
    const isLast = live[live.length - 1]?.id === s.id;
    const base = (total: number) =>
      isLast ? total - Math.floor(total / n) * (n - 1) : Math.floor(total / n);
    return {
      revenueCents: base(breakdown.subtotalCents),
      vatCents: base(breakdown.vatCents),
      drops: n,
    };
  }

  /** All live shipments settled → capture the hold for the booking total (one wallet charge). */
  private async captureIfComplete(tx: DbExecutor, bookingId: string): Promise<void> {
    const [booking] = await tx
      .select()
      .from(bookings)
      .where(eq(bookings.id, bookingId))
      .for("update");
    if (!booking?.holdId) return;
    const live = await tx
      .select({ id: shipments.id })
      .from(shipments)
      .where(and(eq(shipments.bookingId, bookingId), sql`${shipments.status} <> 'cancelled'`));
    const settled = await tx.$count(settlements, eq(settlements.bookingId, bookingId));
    if (settled < live.length) return;

    const [sum] = await tx
      .select({
        total: sql<number>`coalesce(sum(${settlements.revenueCents} + ${settlements.vatCents}), 0)::bigint`,
      })
      .from(settlements)
      .where(eq(settlements.bookingId, bookingId));
    const amount = Number(sum?.total ?? 0);
    const entry = await this.wallet.captureHold(tx, booking.holdId, {
      amountCents: amount,
      description: `Delivery ${booking.reference}`,
    });
    await this.outbox.emit(
      tx,
      "booking.charged",
      {
        bookingId,
        accountId: booking.accountId,
        reference: booking.reference,
        amountCents: amount,
        walletEntryId: entry.id,
      },
      { dedupeKey: `booking:${bookingId}:charged` },
    );
  }

  async forShipment(shipmentId: string): Promise<Settlement | null> {
    const row = await this.dbs.db.query.settlements.findFirst({
      where: eq(settlements.shipmentId, shipmentId),
    });
    return row ? toSettlement(row) : null;
  }

  async forBooking(bookingId: string): Promise<Settlement[]> {
    const rows = await this.dbs.db
      .select()
      .from(settlements)
      .where(eq(settlements.bookingId, bookingId));
    return rows.map(toSettlement);
  }
}

export function toSettlement(r: typeof settlements.$inferSelect): Settlement {
  return {
    shipmentId: r.shipmentId,
    bookingId: r.bookingId,
    driverId: r.driverId,
    revenueCents: r.revenueCents,
    vatCents: r.vatCents,
    fuelCostCents: r.fuelCostCents,
    driverEarningCents: r.driverEarningCents,
    marginCents: r.marginCents,
    plannedKm: Number(r.plannedKm),
    actualKm: r.actualKm === null ? null : Number(r.actualKm),
    journalId: r.journalId,
    presettledAt: r.presettledAt.toISOString(),
    settledAt: r.settledAt?.toISOString() ?? null,
    outcome: (r.outcome as "delivered" | "failed" | null) ?? null,
    reversedAt: r.reversedAt?.toISOString() ?? null,
  };
}

/**
 * What happens to the money on a failed delivery, from the reason the driver gave.
 *
 * An unknown reason is held for review rather than guessed at, and review keeps the charge
 * as it stands -- undoing a charge nobody has looked at is the one outcome that cannot be
 * undone again without the customer noticing.
 */
function chargeOnFailure(rules: SettlementRules, reason: string | null | undefined): FailureCharge {
  const policy = rules.failurePolicy as Record<string, FailureCharge | undefined>;
  return (reason && policy[reason]) || "review";
}
