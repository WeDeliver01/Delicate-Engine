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

/** Reserved for Phase 1; declared now so the topic list is stable from day one. */
export const TopUpConfirmed = defineEvent(
  "wallet.topup_confirmed",
  z.object({ accountId: z.string().uuid(), topUpId: z.string().uuid(), amountCents: Cents }),
);

export const DomainEvent = z.discriminatedUnion("type", [
  AccountCreated,
  MembershipGranted,
  MembershipRevoked,
  TopUpConfirmed,
]);
export type DomainEvent = z.infer<typeof DomainEvent>;
export type DomainEventType = DomainEvent["type"];
export type DomainEventOf<T extends DomainEventType> = Extract<DomainEvent, { type: T }>;

export const DOMAIN_EVENT_TYPES: readonly DomainEventType[] = DomainEvent.options.map(
  (o) => o.shape.type.value,
);
