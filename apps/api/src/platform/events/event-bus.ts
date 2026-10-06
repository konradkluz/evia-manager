/**
 * Minimal synchronous in-process event dispatcher (ADR-0001 rule 4; EVM-016 W1). A module publishes its domain events
 * inside the transaction of the change; subscribers (audit now, timeline later) write with the same transaction, so
 * a failing handler rolls the whole change back. The publisher never imports the subscriber — the dependency points
 * from the subscriber to the exported event types of the publisher.
 *
 * Fail closed: publishing an event nobody handles is an error (an audited action must not silently skip audit).
 */
import type { Kysely } from 'kysely';
import type { Database } from '../database/database.ts';

export interface DomainEvent {
  readonly type: string;
}

/** Explicit request context handed to use cases and events (never read from ambient state by the publisher). */
export interface EventContext {
  readonly origin: 'web' | 'cli';
  readonly traceId: string;
  /** Full client address — held in memory only; the subscriber decides what to persist (audit keeps /24 and /48). */
  readonly ip?: string | undefined;
  readonly sessionId?: string | undefined;
}

export type EventHandler<E extends DomainEvent> = (tx: Kysely<Database>, event: E, context: EventContext) => Promise<void>;

export class EventBus {
  readonly #handlers = new Map<string, Array<EventHandler<never>>>();

  subscribe<E extends DomainEvent>(type: E['type'], handler: EventHandler<E>): void {
    const handlers = this.#handlers.get(type) ?? [];
    handlers.push(handler);
    this.#handlers.set(type, handlers);
  }

  async publish(tx: Kysely<Database>, event: DomainEvent, context: EventContext): Promise<void> {
    const handlers = this.#handlers.get(event.type) ?? [];
    if (handlers.length === 0) throw new Error(`No handler subscribed to event ${event.type}`);
    for (const handler of handlers) await (handler as EventHandler<DomainEvent>)(tx, event, context);
  }
}
