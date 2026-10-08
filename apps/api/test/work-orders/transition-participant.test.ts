import type { Kysely } from 'kysely';
import { describe, expect, it } from 'vitest';
import {
  WorkOrderTransitionRegistry,
  type TransitionContext,
  type WorkOrderTransitionParticipant,
} from '../../src/modules/work-orders/transition-participant.ts';
import type { Database } from '../../src/platform/database/database.ts';

const participant = (name: string, order: number, code?: string): WorkOrderTransitionParticipant => ({
  name,
  order,
  check: () => Promise.resolve(code),
  apply: () => Promise.resolve(),
});
const tx = {} as Kysely<Database>;
const context: TransitionContext = {
  workOrderId: '0198b0a0-0000-7000-8000-000000000001',
  from: 'completed',
  to: 'settled',
  principal: {} as never,
  now: new Date('2026-10-08T08:00:00Z'),
};

describe('the registry of the transition participants (EVM-030 AC5; SR-API-06, SR-API-07)', () => {
  it('EVM-030 AC5 there is none at the start: with no participant every condition is met', async () => {
    const registry = new WorkOrderTransitionRegistry();
    expect(registry.ordered()).toEqual([]);
    expect(await registry.unmetConditions(tx, context)).toEqual([]);
  });

  it('EVM-030 AC5 the order is fixed: ascending `order`, then the name — whatever the order of the registration', () => {
    const registry = new WorkOrderTransitionRegistry();
    for (const entry of [participant('payments', 20), participant('procedures', 10), participant('audit-extra', 10)])
      registry.register(entry);
    expect(registry.ordered().map((entry) => entry.name)).toEqual(['audit-extra', 'procedures', 'payments']);
  });

  it('EVM-030 AC5 two participants cannot share a name', () => {
    const registry = new WorkOrderTransitionRegistry();
    registry.register(participant('payments', 10));
    expect(() => {
      registry.register(participant('payments', 11));
    }).toThrow('transition participant payments is already registered');
  });

  it('EVM-030 AC5 every unmet condition is collected, in the order of the participants, without repeats', async () => {
    const registry = new WorkOrderTransitionRegistry();
    registry.register(participant('second', 2, 'unpaid_milestones'));
    registry.register(participant('first', 1, 'open_stages'));
    registry.register(participant('met', 3));
    registry.register(participant('again', 4, 'open_stages'));
    expect(await registry.unmetConditions(tx, context)).toEqual(['open_stages', 'unpaid_milestones']);
  });

  it('EVM-030 AC5 a code that is not a stable machine code is a defect of the participant (500), never a message to the user', async () => {
    for (const code of ['Unpaid milestones', 'zaległe płatności', '', 'a'.repeat(65)]) {
      const registry = new WorkOrderTransitionRegistry();
      registry.register(participant('payments', 1, code));
      await expect(registry.unmetConditions(tx, context), code).rejects.toThrow(
        'transition participant payments returned an invalid reason code',
      );
    }
  });

  it('EVM-030 AC5 the effects run in the order of the participants, with the same context', async () => {
    const registry = new WorkOrderTransitionRegistry();
    const calls: string[] = [];
    const effect = (name: string, order: number): WorkOrderTransitionParticipant => ({
      name,
      order,
      check: () => Promise.resolve(undefined),
      apply: (_tx, seen) => {
        calls.push(`${name}:${seen.workOrderId}`);
        return Promise.resolve();
      },
    });
    registry.register(effect('b', 2));
    registry.register(effect('a', 1));
    await registry.applyAll(tx, context);
    expect(calls).toEqual([`a:${context.workOrderId}`, `b:${context.workOrderId}`]);
  });
});
