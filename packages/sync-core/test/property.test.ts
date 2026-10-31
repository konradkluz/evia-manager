import { describe, expect, it } from 'vitest';
import type { SyncRequest, TransportResponse } from '../src/index.ts';
import { FakeClock, FakeServer, InMemoryQueueStore, makeCore, seededRandom } from './helpers.ts';

const key = (n: number): string => `0194c2a0-0000-7000-8000-${String(n).padStart(12, '0')}`;

/** Own property loop with a seed (no extra dependency, SR-SUPPLY-06): random faults, restarts and enqueues while flushing. */
describe('nothing is lost, nothing is applied twice, order holds (EVM-091 AC1, AC2, AC3, AC4)', () => {
  for (let seed = 1; seed <= 60; seed += 1) {
    it(`EVM-091 AC3: seed ${seed} - random network faults, lost responses, 5xx, 429 and restarts end with every mutation applied exactly once in per-object order`, async () => {
      const dice = seededRandom(seed * 7919);
      const roll = (n: number): number => (dice.getRandomValues(new Uint8Array(1))[0] ?? 0) % n;
      const store = new InMemoryQueueStore();
      const server = new FakeServer();
      let epoch = 0;
      const clock = new FakeClock();
      const build = () => makeCore({ store, server, clock, seed: seed * 31 + ++epoch, options: { maxBatchSize: 1 + roll(7) } });
      let current = build();
      const enqueued: { id: string; key: string }[] = [];

      const faulty = (request: SyncRequest): TransportResponse | Promise<TransportResponse> => {
        const fault = roll(6);
        if (fault === 0) return { kind: 'network' };
        if (fault === 1) return { kind: 'http', status: 503 };
        if (fault === 2) return { kind: 'http', status: 429, retryAfter: String(1 + roll(3)) };
        const results = request.mutations.map((m) => {
          const seen = server.applied.has(m.mutationId);
          if (!seen) {
            server.applied.set(m.mutationId, 'x');
            server.appliedOrder.push(m.mutationId);
          }
          return { mutationId: m.mutationId, outcome: seen ? 'duplicate' : 'applied' };
        });
        if (fault === 3) return { kind: 'network' };
        return { kind: 'ok', body: { results } };
      };

      for (let step = 0; step < 40; step += 1) {
        const action = roll(5);
        if (action <= 1) {
          const k = key(1 + roll(4));
          const record = await current.core.queue.enqueue({
            type: 'CreateNote',
            commandVersion: 1,
            orderingKey: k,
            payload: { id: `0194c2a0-0000-7000-8000-${String(step + 1000).padStart(12, '0')}`, workOrderId: k, n: step },
          });
          enqueued.push({ id: record.mutationId, key: k });
        } else if (action === 4) {
          current = build();
        } else {
          for (let i = 0; i < 3; i += 1) server.script.push(faulty);
          await current.core.engine.flush();
          clock.advance(1000 + roll(120_000));
        }
      }
      // heal the network and drain
      for (let i = 0; i < 200 && store.records().length > 0; i += 1) {
        server.script.length = 0;
        clock.advance(10 * 60_000);
        await current.core.engine.flush();
      }
      expect(store.records()).toHaveLength(0);
      expect(server.applied.size).toBe(enqueued.length);
      for (const { id } of enqueued) expect(server.applied.has(id), id).toBe(true);
      for (const k of new Set(enqueued.map((e) => e.key))) {
        const expected = enqueued.filter((e) => e.key === k).map((e) => e.id);
        expect(server.appliedOrder.filter((id) => expected.includes(id))).toEqual(expected);
      }
    });
  }
});
