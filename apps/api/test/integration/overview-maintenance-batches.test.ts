import type { Kysely } from 'kysely';
import { describe, expect, it } from 'vitest';
import { ProjectionMaintenance } from '../../src/modules/overview/application/projection-maintenance.ts';
import type { ProjectionRecomputer } from '../../src/modules/overview/application/projection-recomputer.ts';
import type { WorkOrderProjectionSource } from '../../src/modules/work-orders/system-ports.ts';
import type { Clock } from '../../src/platform/clock/clock.ts';
import type { Database } from '../../src/platform/database/database.ts';
import { MetricsRegistry } from '../../src/platform/metrics/metrics.ts';

const id = (n: number): string => `01a13115-0000-7000-8000-${String(n).padStart(12, '0')}`;
const clock: Clock = { now: () => new Date('2026-10-03T08:00:00.000Z') };
const foreignKey = (): Error => Object.assign(new Error('purged'), { code: '23503' });

/** A database whose transactions just run the callback (the recomputer is a fake, so no query is ever sent). */
const db = {
  transaction: () => {
    const builder = { setIsolationLevel: () => builder, execute: <T>(work: (tx: unknown) => Promise<T>) => work({}) };
    return builder;
  },
} as unknown as Kysely<Database>;

function setup(options: { allIds?: string[]; failing?: (ids: readonly string[]) => unknown } = {}) {
  const batches: string[][] = [];
  const recomputer = {
    recompute: (_tx: unknown, ids: Iterable<string>) => {
      const list = [...ids];
      batches.push(list);
      const failure = options.failing?.(list);
      // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- the test needs a rejection that is not an object
      return failure === undefined ? Promise.resolve(list) : Promise.reject(failure);
    },
  } as unknown as ProjectionRecomputer;
  const all = options.allIds ?? [];
  const orders = {
    keysOf: () => Promise.resolve([]),
    idsAfter: (_tx: unknown, after: string | undefined, limit: number) =>
      Promise.resolve(all.filter((value) => after === undefined || value > after).slice(0, limit)),
  } as unknown as WorkOrderProjectionSource;
  const maintenance = new ProjectionMaintenance(db, recomputer, orders, clock, new MetricsRegistry());
  return { maintenance, batches };
}

describe('rebuild in batches (EVM-034 AC6; ADR-0017 W11, T7)', () => {
  it('EVM-034 AC6 all orders are walked in ascending order of the identifier, one batch of the given size after another', async () => {
    const { maintenance, batches } = setup({ allIds: [id(5), id(1), id(3), id(2), id(4)].sort() });
    expect(await maintenance.rebuild({ batchSize: 2 })).toEqual({ rebuilt: 5, batches: 3, skipped: 0 });
    expect(batches).toEqual([[id(1), id(2)], [id(3), id(4)], [id(5)]]);
  });

  it('EVM-034 AC6 a page that is exactly full is followed by one more read that finds nothing', async () => {
    const { maintenance, batches } = setup({ allIds: [id(1), id(2)] });
    expect(await maintenance.rebuild({ batchSize: 2 })).toEqual({ rebuilt: 2, batches: 1, skipped: 0 });
    expect(batches).toEqual([[id(1), id(2)]]);
  });

  it('EVM-034 AC6 named orders are de-duplicated, sorted and cut into batches', async () => {
    const { maintenance, batches } = setup();
    await maintenance.rebuild({ only: [id(3), id(1), id(3), id(2)], batchSize: 2 });
    expect(batches).toEqual([[id(1), id(2)], [id(3)]]);
  });

  it('EVM-034 AC6 a batch interrupted by a foreign-key error (a purge meanwhile) is repeated order by order and the order that is gone is skipped', async () => {
    const { maintenance, batches } = setup({
      allIds: [id(1), id(2), id(3)],
      failing: (ids) => (ids.length > 1 || ids[0] === id(2) ? foreignKey() : undefined),
    });
    expect(await maintenance.rebuild()).toEqual({ rebuilt: 2, batches: 1, skipped: 1 });
    expect(batches).toEqual([[id(1), id(2), id(3)], [id(1)], [id(2)], [id(3)]]);
  });

  it('EVM-034 AC6 any other error ends the rebuild (a batch is never silently dropped), in the batch and in the repetition', async () => {
    const outage = Object.assign(new Error('connection lost'), { code: '57P01' });
    const first = setup({ allIds: [id(1)], failing: () => outage });
    await expect(first.maintenance.rebuild()).rejects.toThrow('connection lost');
    const second = setup({ allIds: [id(1), id(2)], failing: (ids) => (ids.length > 1 ? foreignKey() : outage) });
    await expect(second.maintenance.rebuild()).rejects.toThrow('connection lost');
    const third = setup({ allIds: [id(1)], failing: () => 'not an error object' });
    await expect(third.maintenance.rebuild()).rejects.toBe('not an error object');
  });
});
