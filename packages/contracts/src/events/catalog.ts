import { z } from "zod";
import { defineEvent } from "./envelope.js";
import { Cents } from "../money.js";
import { AccountRole, AccountType, BillingMode } from "../enums.js";
import { ShipmentStatus } from "../dto/bookings.js";

/**
 * The event catalog. Every event the engine emits is declared here so producers (API) and
 * consumers (worker, other services) share one definition. Later phases append entries;
 * existing entries are versioned, never edited in place.
 */

export const AccountCreated = defineEvent(
  "account.created",
  z.object({
    accountId: z.string().uuid(),
    organizationId: z.string().uuid().nullable(),
    type: AccountType,
    billingMode: BillingMode,
    name: z.string(),
  }),
);

export const MembershipGranted = defineEvent(
  "membership.granted",
  z.object({
    accountId: z.string().uuid(),
    userId: z.string().uuid(),
    role: AccountRole,
  }),
);

export const MembershipRevoked = defineEvent(
  "membership.revoked",
  z.object({ accountId: z.string().uuid(), userId: z.string().uuid() }),
);

export const TopUpRequested = defineEvent(
  "wallet.topup_requested",
  z.object({
    accountId: z.string().uuid(),
    topUpId: z.string().uuid(),
    provider: z.string(),
    amountCents: Cents,
  }),
);

export const TopUpConfirmed = defineEvent(
  "wallet.topup_confirmed",
  z.object({
    accountId: z.string().uuid(),
    topUpId: z.string().uuid(),
    provider: z.string(),
    amountCents: Cents,
    balanceAfterCents: Cents,
  }),
);

export const WalletAdjusted = defineEvent(
  "wallet.adjusted",
  z.object({
    accountId: z.string().uuid(),
    entryId: z.string().uuid(),
    amountCents: Cents,
    reason: z.string(),
  }),
);

export const CreditTermsChanged = defineEvent(
  "account.credit_terms_changed",
  z.object({
    accountId: z.string().uuid(),
    billingMode: BillingMode,
    creditLimitCents: Cents,
  }),
);

export const BookingConfirmed = defineEvent(
  "booking.confirmed",
  z.object({
    bookingId: z.string().uuid(),
    accountId: z.string().uuid(),
    reference: z.string(),
    serviceLevelCode: z.string(),
    slotDate: z.string().nullable(),
    slotWindowKey: z.string().nullable(),
    totalCents: Cents,
    holdId: z.string().uuid(),
    shipments: z.array(z.object({ shipmentId: z.string().uuid(), waybill: z.string() })),
  }),
);

export const BookingRejected = defineEvent(
  "booking.rejected",
  z.object({
    bookingId: z.string().uuid(),
    accountId: z.string().uuid(),
    quoteId: z.string().uuid(),
    reason: z.string(),
    totalCents: Cents,
  }),
);

export const BookingCancelled = defineEvent(
  "booking.cancelled",
  z.object({
    bookingId: z.string().uuid(),
    accountId: z.string().uuid(),
    reference: z.string(),
    reason: z.string(),
    holdReleased: z.boolean(),
  }),
);

export const ShipmentStatusChanged = defineEvent(
  "shipment.status_changed",
  z.object({
    shipmentId: z.string().uuid(),
    bookingId: z.string().uuid(),
    accountId: z.string().uuid(),
    waybill: z.string(),
    from: ShipmentStatus,
    to: ShipmentStatus,
    note: z.string().nullable(),
  }),
);

export const ShipmentAssigned = defineEvent(
  "shipment.assigned",
  z.object({
    shipmentId: z.string().uuid(),
    bookingId: z.string().uuid(),
    accountId: z.string().uuid(),
    waybill: z.string(),
    driverId: z.string().uuid(),
    previousDriverId: z.string().uuid().nullable(),
    source: z.enum(["auto", "dispatcher"]),
    plannedKm: z.number().nonnegative(),
  }),
);

export const ShipmentUnassigned = defineEvent(
  "shipment.unassigned",
  z.object({
    shipmentId: z.string().uuid(),
    waybill: z.string(),
    driverId: z.string().uuid(),
    reason: z.string(),
  }),
);

export const ShiftStarted = defineEvent(
  "shift.started",
  z.object({
    shiftId: z.string().uuid(),
    driverId: z.string().uuid(),
    date: z.string(),
    odometerKm: z.number(),
  }),
);

export const ShiftEnded = defineEvent(
  "shift.ended",
  z.object({
    shiftId: z.string().uuid(),
    driverId: z.string().uuid(),
    date: z.string(),
    odometerKm: z.number(),
    distanceKm: z.number(),
  }),
);

export const CollectionCompleted = defineEvent(
  "collection.completed",
  z.object({
    bookingId: z.string().uuid(),
    driverId: z.string().uuid(),
    shipmentIds: z.array(z.string().uuid()),
  }),
);

/** The only settlement trigger. Carries the ACTUAL distance the optimizer/app measured. */
export const DeliveryCompleted = defineEvent(
  "delivery.completed",
  z.object({
    shipmentId: z.string().uuid(),
    bookingId: z.string().uuid(),
    accountId: z.string().uuid(),
    waybill: z.string(),
    driverId: z.string().uuid(),
    actualKm: z.number().nonnegative(),
    plannedKm: z.number().nonnegative(),
    receivedBy: z.string(),
  }),
);

export const DeliveryFailed = defineEvent(
  "delivery.failed",
  z.object({
    shipmentId: z.string().uuid(),
    bookingId: z.string().uuid(),
    waybill: z.string(),
    driverId: z.string().uuid(),
    reason: z.string(),
  }),
);

export const FuelLogged = defineEvent(
  "fuel.logged",
  z.object({
    fuelLogId: z.string().uuid(),
    driverId: z.string().uuid(),
    litres: z.number(),
    amountCents: Cents,
  }),
);

export const SettlementPosted = defineEvent(
  "settlement.posted",
  z.object({
    shipmentId: z.string().uuid(),
    bookingId: z.string().uuid(),
    accountId: z.string().uuid(),
    driverId: z.string().uuid().nullable(),
    journalId: z.string().uuid(),
    revenueCents: Cents,
    vatCents: Cents,
    fuelCostCents: Cents,
    driverEarningCents: Cents,
    marginCents: Cents,
    actualKm: z.number(),
  }),
);

export const BookingCharged = defineEvent(
  "booking.charged",
  z.object({
    bookingId: z.string().uuid(),
    accountId: z.string().uuid(),
    reference: z.string(),
    amountCents: Cents,
    walletEntryId: z.string().uuid(),
  }),
);

/** Treasury earmarked a settlement's contribution margin across the allocation wallets. */
export const TreasuryAllocated = defineEvent(
  "treasury.allocated",
  z.object({
    settlementRef: z.string(),
    shipmentId: z.string().uuid().nullable(),
    period: z.string(),
    marginCents: Cents,
    lines: z.array(
      z.object({ walletId: z.string().uuid(), walletSlug: z.string(), amountCents: Cents }),
    ),
  }),
);

/** A money movement the engine wants a human to make. Nothing is paid until it is executed. */
export const PaymentProposed = defineEvent(
  "payment.proposed",
  z.object({
    proposalId: z.string().uuid(),
    reference: z.string(),
    kind: z.enum(["driver_earnings_payout", "driver_fuel_load", "vendor_payment"]),
    amountCents: Cents,
    driverId: z.string().uuid().nullable(),
    vendorName: z.string().nullable(),
    period: z.string(),
  }),
);

export const PaymentApproved = defineEvent(
  "payment.approved",
  z.object({
    proposalId: z.string().uuid(),
    reference: z.string(),
    amountCents: Cents,
    approvedByUserId: z.string().uuid().nullable(),
  }),
);

/** The money has actually left. Recorded by the human who moved it, with their proof. */
export const PaymentExecuted = defineEvent(
  "payment.executed",
  z.object({
    proposalId: z.string().uuid(),
    reference: z.string(),
    kind: z.enum(["driver_earnings_payout", "driver_fuel_load", "vendor_payment"]),
    amountCents: Cents,
    driverId: z.string().uuid().nullable(),
    externalReference: z.string(),
    journalId: z.string().uuid(),
  }),
);

export const DomainEvent = z.discriminatedUnion("type", [
  AccountCreated,
  MembershipGranted,
  MembershipRevoked,
  TopUpRequested,
  TopUpConfirmed,
  WalletAdjusted,
  CreditTermsChanged,
  BookingConfirmed,
  BookingRejected,
  BookingCancelled,
  ShipmentStatusChanged,
  ShipmentAssigned,
  ShipmentUnassigned,
  ShiftStarted,
  ShiftEnded,
  CollectionCompleted,
  DeliveryCompleted,
  DeliveryFailed,
  FuelLogged,
  SettlementPosted,
  BookingCharged,
  TreasuryAllocated,
  PaymentProposed,
  PaymentApproved,
  PaymentExecuted,
]);
export type DomainEvent = z.infer<typeof DomainEvent>;
export type DomainEventType = DomainEvent["type"];
export type DomainEventOf<T extends DomainEventType> = Extract<DomainEvent, { type: T }>;

export const DOMAIN_EVENT_TYPES: readonly DomainEventType[] = DomainEvent.options.map(
  (o) => o.shape.type.value,
);
