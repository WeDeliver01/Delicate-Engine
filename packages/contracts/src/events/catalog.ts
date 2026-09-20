import { z } from "zod";
import { defineEvent } from "./envelope.js";
import { Cents } from "../money.js";
import { AccountRole, AccountType, BillingMode } from "../enums.js";

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

export const DomainEvent = z.discriminatedUnion("type", [
  AccountCreated,
  MembershipGranted,
  MembershipRevoked,
  TopUpRequested,
  TopUpConfirmed,
  WalletAdjusted,
  CreditTermsChanged,
]);
export type DomainEvent = z.infer<typeof DomainEvent>;
export type DomainEventType = DomainEvent["type"];
export type DomainEventOf<T extends DomainEventType> = Extract<DomainEvent, { type: T }>;

export const DOMAIN_EVENT_TYPES: readonly DomainEventType[] = DomainEvent.options.map(
  (o) => o.shape.type.value,
);
