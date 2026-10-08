import { describe, expect, it } from 'vitest';
import {
  WorkOrderCompositionRegistry,
  type WorkOrderCompositionContributor,
} from '../../src/modules/work-orders/composition-contributor.ts';

const contributor = (name: string, order: number): WorkOrderCompositionContributor => ({
  name,
  order,
  contribute: () => Promise.resolve(),
});

describe('the registry of the composition contributors (EVM-022 AC6; SR-API-06)', () => {
  it('EVM-022 AC6 there is none at the start: the creation composes the order, its scope and the coordinator only', () => {
    expect(new WorkOrderCompositionRegistry().ordered()).toEqual([]);
  });

  it('EVM-022 AC6 the order is fixed: ascending `order`, then the name — whatever the order of the registration', () => {
    const registry = new WorkOrderCompositionRegistry();
    for (const entry of [contributor('payments', 20), contributor('procedures', 10), contributor('audit-extra', 10)])
      registry.register(entry);
    expect(registry.ordered().map((entry) => entry.name)).toEqual(['audit-extra', 'procedures', 'payments']);
  });

  it('EVM-022 AC6 two contributors cannot share a name', () => {
    const registry = new WorkOrderCompositionRegistry();
    registry.register(contributor('procedures', 10));
    expect(() => {
      registry.register(contributor('procedures', 11));
    }).toThrow('composition contributor procedures is already registered');
  });
});
