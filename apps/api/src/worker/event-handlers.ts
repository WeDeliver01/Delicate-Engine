import { Injectable } from "@nestjs/common";
import { PinoLogger } from "nestjs-pino";
import type { DomainEvent, DomainEventType } from "@delicate/contracts";

export type EventHandler<T extends DomainEventType = DomainEventType> = (
  event: Extract<DomainEvent, { type: T }>,
) => Promise<void>;

/**
 * Registry of outbox consumers keyed by event type. Handlers MUST be idempotent: the dispatcher
 * guarantees at-least-once delivery, not exactly-once. Modules register handlers at boot.
 *
 * Phase 0 ships logging handlers only; Phase 1+ replaces them with real consumers
 * (notifications, loyalty, treasury...). An event with no handler is delivered as a no-op so
 * nothing is ever lost while a consumer is not yet built.
 */
@Injectable()
export class EventHandlerRegistry {
  private readonly handlers = new Map<DomainEventType, EventHandler[]>();

  constructor(private readonly logger: PinoLogger) {
    this.logger.setContext(EventHandlerRegistry.name);
  }

  register<T extends DomainEventType>(type: T, handler: EventHandler<T>): void {
    const list = this.handlers.get(type) ?? [];
    list.push(handler as unknown as EventHandler);
    this.handlers.set(type, list);
  }

  async dispatch(event: DomainEvent): Promise<void> {
    const list = this.handlers.get(event.type);
    if (!list || list.length === 0) {
      this.logger.debug({ type: event.type, id: event.id }, "no handler registered; acknowledged");
      return;
    }
    for (const handler of list) {
      await handler(event);
    }
  }
}
