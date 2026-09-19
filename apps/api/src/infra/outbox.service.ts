import { Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { DomainEvent, type DomainEventOf, type DomainEventType } from "@delicate/contracts";
import { outboxMessages, type DbExecutor } from "@delicate/db";
import { requestContext } from "../common/request-context.js";
import { AppError } from "../common/errors.js";

export const EVENT_SOURCE = "delicate-engine";

export interface EmitOptions {
  /** Unique per business fact. Required: it is what makes consumption idempotent. */
  dedupeKey: string;
  occurredAt?: Date;
  correlationId?: string;
}

/**
 * Transactional outbox producer (invariant #6). `emit` must be called with the same `tx` that
 * writes the state change, so the change and its event commit or roll back together. The
 * worker delivers the row later; this service never talks to the network.
 */
@Injectable()
export class OutboxService {
  async emit<T extends DomainEventType>(
    tx: DbExecutor,
    type: T,
    payload: DomainEventOf<T>["payload"],
    opts: EmitOptions,
  ): Promise<DomainEventOf<T>> {
    const ctx = requestContext.get();
    const candidate = {
      id: randomUUID(),
      type,
      version: 1,
      source: EVENT_SOURCE,
      dedupeKey: opts.dedupeKey,
      occurredAt: (opts.occurredAt ?? new Date()).toISOString(),
      actor: { userId: ctx?.userId ?? null, accountId: ctx?.accountId ?? null },
      correlationId: opts.correlationId ?? ctx?.requestId,
      payload,
    };
    // Validate against the catalog before it can ever reach the table.
    const event = DomainEvent.parse(candidate) as DomainEventOf<T>;

    const inserted = await tx
      .insert(outboxMessages)
      .values({
        eventId: event.id,
        eventType: event.type,
        dedupeKey: event.dedupeKey,
        envelope: event,
      })
      .onConflictDoNothing({ target: outboxMessages.dedupeKey })
      .returning({ id: outboxMessages.id });

    if (inserted.length === 0) {
      // The same business fact was already recorded. Callers that reach this point have a
      // bug in their own idempotency handling, so surface it loudly rather than swallow it.
      throw AppError.conflict("duplicate_event", `event for '${opts.dedupeKey}' already exists`, {
        type,
      });
    }
    return event;
  }
}
