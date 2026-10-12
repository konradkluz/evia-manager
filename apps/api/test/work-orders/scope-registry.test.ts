import { describe, expect, it } from 'vitest';
import {
  ScopeLimitError,
  WorkOrderScopeRegistry,
  type WorkOrderScopeParticipant,
} from '../../src/modules/work-orders/scope-participant.ts';

const participant = (name: string, order: number): WorkOrderScopeParticipant => ({
  name,
  order,
  addProcedures: () => Promise.resolve([]),
  procedureCodesOf: () => Promise.resolve([]),
});

describe('the registry of the participants of the scope (EVM-035 AC2; SR-API-06)', () => {
  it('EVM-035 AC2 the participants run in the fixed order: ascending order, then name', () => {
    const registry = new WorkOrderScopeRegistry();
    registry.register(participant('payments', 200));
    registry.register(participant('procedures', 100));
    registry.register(participant('alpha', 100));
    expect(registry.ordered().map((item) => item.name)).toEqual(['alpha', 'procedures', 'payments']);
  });

  it('EVM-035 AC2 participants of the same order run by name, whatever the order they were registered in', () => {
    const forward = new WorkOrderScopeRegistry();
    for (const name of ['a', 'b', 'c']) forward.register(participant(name, 100));
    const backward = new WorkOrderScopeRegistry();
    for (const name of ['c', 'b', 'a']) backward.register(participant(name, 100));
    expect(forward.ordered().map((item) => item.name)).toEqual(['a', 'b', 'c']);
    expect(backward.ordered().map((item) => item.name)).toEqual(['a', 'b', 'c']);
  });

  it('EVM-035 AC2 two participants cannot share a name', () => {
    const registry = new WorkOrderScopeRegistry();
    registry.register(participant('procedures', 100));
    expect(() => {
      registry.register(participant('procedures', 300));
    }).toThrow(/already registered/);
  });

  it('EVM-035 AC5 the limit error names a pointer and a code and nothing else', () => {
    const error = new ScopeLimitError('/procedureCodes', 'too_many_procedures');
    expect(error).toMatchObject({ pointer: '/procedureCodes', code: 'too_many_procedures', name: 'ScopeLimitError' });
    expect(error.message).toBe('a limit of the scope was exceeded (too_many_procedures)');
  });
});
