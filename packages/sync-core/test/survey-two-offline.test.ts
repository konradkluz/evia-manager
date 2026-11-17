import { describe, expect, it } from 'vitest';
import { FakeServer, InMemoryQueueStore, makeCore } from './helpers.ts';

const surveyOf = (workOrderId: string, siteId: string) => ({
  type: 'CreateSiteSurvey',
  commandVersion: 1,
  payload: {
    workOrderId,
    newSite: {
      id: siteId,
      siteType: 'other',
      street: 'ul. Fikcyjna',
      buildingNumber: '5',
      postalCode: '05-500',
      city: 'Piaseczno',
    },
  },
});

const ORDER_A = '0194c2a0-0000-7000-8000-0000000000a1';
const ORDER_B = '0194c2a0-0000-7000-8000-0000000000b1';

describe('two site surveys saved offline one after another (EVM-137 AC2, AC6)', () => {
  it('EVM-137 AC2: both go out exactly once after a kill, each under its own key (no duplicate, no merge)', async () => {
    const store = new InMemoryQueueStore();
    const server = new FakeServer();
    const first = makeCore({ store, server });
    const a = await first.core.queue.enqueue(surveyOf(ORDER_A, '0194c2a0-0000-7000-8000-0000000000a2'));
    const b = await first.core.queue.enqueue(surveyOf(ORDER_B, '0194c2a0-0000-7000-8000-0000000000b2'));
    expect(a.orderingKey).toBe(ORDER_A);
    expect(b.orderingKey).toBe(ORDER_B);
    const again = makeCore({ store, server });
    await again.core.engine.flush();
    await again.core.engine.flush();
    expect([...server.appliedOrder].sort()).toEqual([a.mutationId, b.mutationId].sort());
    expect(store.records()).toHaveLength(0);
  });

  it('EVM-137 AC6: a rejected survey does not hold back the next one - only the rejected needs attention', async () => {
    const { core, store, server } = makeCore();
    const a = await core.queue.enqueue(surveyOf(ORDER_A, '0194c2a0-0000-7000-8000-0000000000a2'));
    const b = await core.queue.enqueue(surveyOf(ORDER_B, '0194c2a0-0000-7000-8000-0000000000b2'));
    server.rejectCodes.set(a.mutationId, 'validation_failed');
    await core.engine.flush();
    expect(server.appliedOrder).toEqual([b.mutationId]);
    expect(store.records().map((r) => [r.mutationId, r.state])).toEqual([[a.mutationId, 'needs_attention']]);
  });
});
