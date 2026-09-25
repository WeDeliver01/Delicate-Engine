import { Injectable } from "@nestjs/common";
import { and, eq, sql } from "drizzle-orm";
import type { Settlement, SettlementRules } from "@delicate/contracts";
import { bookings, settlements, shipments, type DbExecutor } from "@delicate/db";
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

  async settle(tx: DbExecutor, input: SettleInput): Promise<Settlement> {
    const existing = await tx.query.settlements.findFirst({
      where: eq(settlements.shipmentId, input.shipmentId),
    });
    if (existing) return toSettlement(existing);

    const s = await tx.query.shipments.findFirst({ where: eq(shipments.id, input.shipmentId) });
    if (!s) throw AppError.notFound("shipment");
    const booking = await tx.query.bookings.findFirst({ where: eq(bookings.id, s.bookingId) });
    if (!booking) throw AppError.notFound("booking");
    const rules = await this.settings.get("settlement.rules");

    const chargeable = input.outcome === "delivered" || rules.chargeFailedAttempts;
    const share = await this.share(tx, booking, s);
    const revenueCents = chargeable ? share.revenueCents : 0;
    const vatCents = chargeable ? share.vatCents : 0;
    const actualKm = Math.round(input.actualKm * 100) / 100;
    const fuelCostCents = Math.round(actualKm * rules.fuelCostPerKmCents);
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
        settledAt,
        rulesSnapshot: { rules, share, outcome: input.outcome } satisfies {
          rules: SettlementRules;
          share: unknown;
          outcome: string;
        },
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
    actualKm: Number(r.actualKm),
    journalId: r.journalId,
    settledAt: r.settledAt.toISOString(),
  };
}
