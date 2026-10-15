import { DummyDriver, Kysely, PostgresAdapter, PostgresIntrospector, PostgresQueryCompiler, type CompiledQuery } from 'kysely';
import { describe, expect, it } from 'vitest';
import type { Database } from '../../src/platform/database/database.ts';
import { PgIdempotencyPurger } from '../../src/platform/idempotency/idempotency-purger.ts';
import { FixedClock } from '../support/clock.ts';

describe('the adapter of the cleanup of idempotency records (EVM-079)', () => {
  it('EVM-079 AC1 a statement that returns no row purges 0 and calls the function with the batch and the instant of the clock', async () => {
    const compiled: CompiledQuery[] = [];
    const db = new Kysely<Database>({
      dialect: {
        createAdapter: () => new PostgresAdapter(),
        createDriver: () => new DummyDriver(),
        createIntrospector: (kysely) => new PostgresIntrospector(kysely),
        createQueryCompiler: () => new PostgresQueryCompiler(),
      },
      log: (event) => {
        if (event.level === 'query') compiled.push(event.query);
      },
    });
    const now = new Date('2026-10-14T02:10:00.000Z');
    const purger = new PgIdempotencyPurger(db, new FixedClock(now));

    expect(await purger.purgeBatch(500)).toBe(0);

    expect(compiled).toHaveLength(1);
    expect(compiled[0]?.sql).toContain('platform.purge_expired_idempotency_records($1, $2)');
    expect(compiled[0]?.parameters).toEqual([500, now]);
  });
});
