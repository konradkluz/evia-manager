import type { Kysely } from 'kysely';
import { describe, expect, it } from 'vitest';
import {
  WorkOrderDeletionRegistry,
  type DeletionContext,
  type WorkOrderDeletionParticipant,
} from '../../src/modules/work-orders/deletion-participant.ts';
import { decideDeletion, type DeletionAssessment } from '../../src/modules/work-orders/domain/work-order-deletion.ts';
import type { Database } from '../../src/platform/database/database.ts';

const NOTHING: DeletionAssessment = { blocked: false, stepUpRequired: false };
const STEP_UP: DeletionAssessment = { blocked: false, stepUpRequired: true };
const BLOCKED: DeletionAssessment = { blocked: true, stepUpRequired: false };

describe('the rule of the deletion of a work order (EVM-060 AC1-AC3; SR-AUTHZ-10, SR-SESS-08, SR-ERR-01)', () => {
  it('EVM-060 AC1 dependents that need nothing allow the deletion, with or without a fresh step-up', () => {
    expect(decideDeletion([NOTHING], false)).toBe('allow');
    expect(decideDeletion([NOTHING, NOTHING], true)).toBe('allow');
  });

  it('EVM-060 AC2 a blocking dependent is blocked, whatever the freshness of the step-up', () => {
    expect(decideDeletion([BLOCKED], true)).toBe('blocked');
    expect(decideDeletion([BLOCKED], false)).toBe('blocked');
  });

  it('EVM-060 AC2 AC3 the block has precedence over the step-up: invoiced and paid together is blocked, not a request for a step-up', () => {
    expect(decideDeletion([STEP_UP, BLOCKED], false)).toBe('blocked');
    expect(decideDeletion([{ blocked: true, stepUpRequired: true }], true)).toBe('blocked');
  });

  it('EVM-060 AC3 a dependent that needs a step-up asks for it, and with a fresh one the deletion is allowed', () => {
    expect(decideDeletion([STEP_UP], false)).toBe('step_up_required');
    expect(decideDeletion([NOTHING, STEP_UP], false)).toBe('step_up_required');
    expect(decideDeletion([STEP_UP], true)).toBe('allow');
  });

  it('EVM-060 AC2 SR-ERR-01 fail closed: no answer at all is blocked, never allowed', () => {
    expect(decideDeletion([], true)).toBe('blocked');
    expect(decideDeletion([], false)).toBe('blocked');
  });
});

const tx = {} as Kysely<Database>;
const context: DeletionContext = {
  workOrderId: '0198b0a0-0000-7000-8000-000000000001',
  principal: {} as never,
  now: new Date('2026-10-16T08:00:00Z'),
  request: { origin: 'web', traceId: '4bf92f3577b34da6a3ce929d0e0e4736' },
};
const participant = (name: string, order: number, answer: () => unknown): WorkOrderDeletionParticipant => ({
  name,
  order,
  assess: () => Promise.resolve(answer() as DeletionAssessment),
});

describe('the registry of the deletion participants (EVM-060 AC2, AC3; SR-ERR-01, SR-API-06)', () => {
  it('EVM-060 AC2 SR-ERR-01 an empty registry fails closed: the deletion is not decided, it is not allowed', async () => {
    await expect(new WorkOrderDeletionRegistry().assessAll(tx, context)).rejects.toThrow('no deletion participant is registered');
  });

  it('EVM-060 AC2 the order is fixed: ascending `order`, then the name — and two participants cannot share a name', () => {
    const registry = new WorkOrderDeletionRegistry();
    for (const entry of [
      participant('payments', 20, () => NOTHING),
      participant('b', 10, () => NOTHING),
      participant('a', 10, () => NOTHING),
    ])
      registry.register(entry);
    expect(registry.names()).toEqual(['a', 'b', 'payments']);
    expect(() => {
      registry.register(participant('payments', 30, () => NOTHING));
    }).toThrow('deletion participant payments is already registered');
  });

  it('EVM-060 AC3 the answers of all participants are returned in order', async () => {
    const registry = new WorkOrderDeletionRegistry();
    registry.register(participant('second', 2, () => STEP_UP));
    registry.register(participant('first', 1, () => BLOCKED));
    expect(await registry.assessAll(tx, context)).toEqual([BLOCKED, STEP_UP]);
  });

  it('EVM-060 AC2 SR-ERR-01 a participant that throws ends the command with its error (nothing is decided)', async () => {
    const registry = new WorkOrderDeletionRegistry();
    registry.register(
      participant('payments', 1, () => {
        throw new Error('database unavailable');
      }),
    );
    await expect(registry.assessAll(tx, context)).rejects.toThrow('database unavailable');
  });

  it('EVM-060 AC2 SR-ERR-01 an answer that is not two booleans is refused, so a defective participant cannot allow a deletion', async () => {
    for (const answer of [{}, { blocked: false }, { blocked: 'no', stepUpRequired: false }, { blocked: false, stepUpRequired: 0 }]) {
      const registry = new WorkOrderDeletionRegistry();
      registry.register(participant('payments', 1, () => answer));
      await expect(registry.assessAll(tx, context), JSON.stringify(answer)).rejects.toThrow('returned an invalid assessment');
    }
  });
});
