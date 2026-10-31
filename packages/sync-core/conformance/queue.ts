import type { QueueRecord, QueueStore, SettledInfo } from '../src/index.ts';
import type { ConformanceTestApi } from './replica.ts';

/**
 * Executable contract of `QueueStore` (EVM-091, extracted in EVM-093). It runs on the reference fake in this package and MUST run on
 * every production adapter (SQLCipher, EVM-093): the queue engine relies on exactly this semantics. Only the port is used, plus two
 * optional observation hooks of the caller - no internals of the store.
 * `create` returns a store on an EMPTY queue.
 */
export interface QueueConformanceOptions {
  readonly create: () => QueueStore | Promise<QueueStore>;
  readonly test: ConformanceTestApi;
  /** Results handed to the consumer by `settle`, oldest first (the adapter's own read of its settled results). */
  readonly settledOf: (store: QueueStore) => Promise<readonly { readonly mutationId: string; readonly info: SettledInfo }[]>;
  /**
   * Arms a crash INSIDE the next `settle` of this store: after the removal and before the result is stored (adapters: through a hook of
   * the SQL driver, never through the store's internals). Without it the atomicity case is skipped (the fake is atomic by construction).
   */
  readonly injectSettleFailure?: (store: QueueStore) => void;
  /** Reopens the store on the same durable data ("restart"); defaults to the same instance. */
  readonly reopen?: (store: QueueStore) => QueueStore | Promise<QueueStore>;
}

const USER = '90000000-0000-4000-8000-0000000000aa';
const WORK_ORDER = '10000000-0000-4000-8000-000000000001';

const mutationId = (n: number): string => `0194c2a0-0000-7000-8000-${String(n).padStart(12, '0')}`;

const record = (n: number, patch: Partial<QueueRecord> = {}): QueueRecord => ({
  mutationId: mutationId(n),
  type: 'CreateNote',
  commandVersion: 1,
  payload: { id: `0194c2a0-0000-7000-8000-${String(n + 500).padStart(12, '0')}`, workOrderId: WORK_ORDER, body: `synthetic ${n}` },
  objectId: `0194c2a0-0000-7000-8000-${String(n + 500).padStart(12, '0')}`,
  orderingKey: WORK_ORDER,
  createdAt: 1_000 + n,
  ownerUserId: USER,
  state: 'pending',
  attempts: 0,
  ...patch,
});

const idsOf = (rows: readonly unknown[]): unknown[] => rows.map((row) => (row as { mutationId?: unknown }).mutationId);

export function queueStoreConformance(options: QueueConformanceOptions): void {
  const { describe, it, expect } = options.test;
  const reopen = async (store: QueueStore): Promise<QueueStore> => (options.reopen === undefined ? store : options.reopen(store));

  describe('QueueStore conformance (EVM-091, EVM-093)', () => {
    it('EVM-093 AC3: readAll returns the records in insertion order, as stored (deep copy, not the caller objects)', async () => {
      const store = await options.create();
      const first = record(1);
      await store.append(first);
      await store.append(record(2, { parentMutationId: mutationId(1) }));
      await store.append(record(3, { state: 'needs_attention', attempts: 4, lastCode: 'forbidden' }));
      const rows = await store.readAll();
      expect(idsOf(rows)).toEqual([mutationId(1), mutationId(2), mutationId(3)]);
      expect(rows[0]).toEqual(first);
      expect(rows[1]).toEqual(record(2, { parentMutationId: mutationId(1) }));
      expect(rows[2]).toEqual(record(3, { state: 'needs_attention', attempts: 4, lastCode: 'forbidden' }));
      (rows[0] as { attempts: number }).attempts = 99;
      expect(((await store.readAll())[0] as QueueRecord).attempts).toBe(0);
    });

    it('EVM-093 AC3: an empty queue reads as an empty list', async () => {
      const store = await options.create();
      expect(await store.readAll()).toEqual([]);
    });

    it('EVM-093 AC3: update patches state and attempts, sets the optional fields and removes them when they are undefined', async () => {
      const store = await options.create();
      await store.append(record(1));
      await store.update(mutationId(1), { state: 'retrying', attempts: 2, lastCode: 'network', nextAttemptAt: 5_000 });
      expect((await store.readAll())[0]).toEqual(record(1, { state: 'retrying', attempts: 2, lastCode: 'network', nextAttemptAt: 5_000 }));
      await store.update(mutationId(1), { state: 'pending', attempts: 3 });
      const after = (await store.readAll())[0] as Record<string, unknown>;
      expect(after).toEqual(record(1, { state: 'pending', attempts: 3 }));
      expect('lastCode' in after).toBe(false);
      expect('nextAttemptAt' in after).toBe(false);
    });

    it('EVM-093 AC3: update keeps the position of the record in the queue', async () => {
      const store = await options.create();
      for (const n of [1, 2, 3]) await store.append(record(n));
      await store.update(mutationId(1), { state: 'needs_attention', attempts: 1, lastCode: 'forbidden' });
      expect(idsOf(await store.readAll())).toEqual([mutationId(1), mutationId(2), mutationId(3)]);
    });

    it('EVM-093 AC3: update of a record that is not in the queue is a no-op (nothing is created)', async () => {
      const store = await options.create();
      await store.append(record(1));
      await store.update(mutationId(9), { state: 'retrying', attempts: 1 });
      expect(idsOf(await store.readAll())).toEqual([mutationId(1)]);
    });

    it('EVM-093 AC3: settle removes the mutation and hands its result over; the rest keeps its order', async () => {
      const store = await options.create();
      for (const n of [1, 2, 3]) await store.append(record(n));
      const info: SettledInfo = { outcome: 'applied', warnings: ['synthetic_warning'], workOrderNumber: 'ZL-000001' };
      await store.settle(mutationId(2), info);
      expect(idsOf(await store.readAll())).toEqual([mutationId(1), mutationId(3)]);
      expect(await options.settledOf(store)).toEqual([{ mutationId: mutationId(2), info }]);
    });

    it('EVM-093 AC3: the records and their order survive a restart of the store', async () => {
      const store = await options.create();
      for (let n = 1; n <= 20; n += 1) await store.append(record(n));
      await store.update(mutationId(5), { state: 'retrying', attempts: 1, nextAttemptAt: 9_000 });
      await store.settle(mutationId(7), { outcome: 'duplicate', warnings: [] });
      const again = await reopen(store);
      const rows = await again.readAll();
      expect(rows.length).toBe(19);
      expect(idsOf(rows)).toEqual(
        Array.from({ length: 20 }, (_, i) => i + 1)
          .filter((n) => n !== 7)
          .map(mutationId),
      );
      expect(rows[4]).toEqual(record(5, { state: 'retrying', attempts: 1, nextAttemptAt: 9_000 }));
    });

    it('EVM-093 AC3: a record appended after a settle goes to the end (positions are never reused)', async () => {
      const store = await options.create();
      for (const n of [1, 2]) await store.append(record(n));
      await store.settle(mutationId(2), { outcome: 'applied', warnings: [] });
      await store.append(record(3));
      expect(idsOf(await store.readAll())).toEqual([mutationId(1), mutationId(3)]);
    });

    if (options.injectSettleFailure !== undefined) {
      const inject = options.injectSettleFailure;
      it('EVM-093 AC3: a crash inside settle leaves the mutation either in the queue or settled - never both, never neither', async () => {
        const store = await options.create();
        for (const n of [1, 2]) await store.append(record(n));
        inject(store);
        // async wrapper: a store may also throw synchronously
        const failed = await (async () => store.settle(mutationId(1), { outcome: 'applied', warnings: [] }))().then(
          () => false,
          () => true,
        );
        expect(failed).toBe(true);
        const again = await reopen(store);
        const inQueue = idsOf(await again.readAll()).includes(mutationId(1));
        const settled = (await options.settledOf(again)).some((s) => s.mutationId === mutationId(1));
        expect(inQueue !== settled).toBe(true);
        // and the store keeps working after the failed transaction
        await again.settle(mutationId(1), { outcome: 'applied', warnings: [] });
        expect(idsOf(await again.readAll())).toEqual([mutationId(2)]);
      });
    }
  });
}
