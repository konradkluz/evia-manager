import type { Kysely } from 'kysely';
import { describe, expect, it, vi } from 'vitest';
import type { Database } from '../../src/platform/database/database.ts';
import { EventBus, type DomainEvent, type EventContext } from '../../src/platform/events/event-bus.ts';

const tx = {} as Kysely<Database>;
const context: EventContext = { origin: 'cli', traceId: 'a'.repeat(32) };

describe('in-process event bus (EVM-016 AC7, W1)', () => {
  it('EVM-016 AC7 handlers of the event type run in order with the same transaction and context', async () => {
    const bus = new EventBus();
    const calls: string[] = [];
    bus.subscribe<DomainEvent>('thing.happened', (received, event, ctx) => {
      expect(received).toBe(tx);
      expect(ctx).toBe(context);
      calls.push(`first:${event.type}`);
      return Promise.resolve();
    });
    bus.subscribe<DomainEvent>('thing.happened', () => {
      calls.push('second');
      return Promise.resolve();
    });
    await bus.publish(tx, { type: 'thing.happened' }, context);
    expect(calls).toEqual(['first:thing.happened', 'second']);
  });

  it('EVM-016 AC7 an event nobody handles is an error (an audited action must not skip audit silently)', async () => {
    await expect(new EventBus().publish(tx, { type: 'unhandled.thing' }, context)).rejects.toThrow(
      'No handler subscribed to event unhandled.thing',
    );
  });

  it('EVM-016 AC7 a failing handler fails the publish, so the transaction of the change rolls back', async () => {
    const bus = new EventBus();
    const later = vi.fn(() => Promise.resolve());
    bus.subscribe<DomainEvent>('thing.happened', () => Promise.reject(new Error('audit write failed')));
    bus.subscribe<DomainEvent>('thing.happened', later);
    await expect(bus.publish(tx, { type: 'thing.happened' }, context)).rejects.toThrow('audit write failed');
    expect(later).not.toHaveBeenCalled();
  });
});
