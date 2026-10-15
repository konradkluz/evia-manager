import {
  DummyDriver,
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
  type CompiledQuery,
  type DatabaseConnection,
  type QueryResult,
} from 'kysely';
import { describe, expect, it } from 'vitest';
import type { Database } from '../../src/platform/database/database.ts';
import { PgIdempotencyPurger } from '../../src/platform/idempotency/idempotency-purger.ts';
import { FixedClock } from '../support/clock.ts';

/** A driver that answers every statement with the given rows (the default: none) — no database needed. */
class RowsDriver extends DummyDriver {
  readonly #rows: unknown[];

  constructor(rows: unknown[]) {
    super();
    this.#rows = rows;
  }

  override acquireConnection(): Promise<DatabaseConnection> {
    const rows = this.#rows;
    return Promise.resolve({
      executeQuery: <R>(): Promise<QueryResult<R>> => Promise.resolve({ rows: rows as R[] }),
      streamQuery: () => {
        throw new Error('not used');
      },
    });
  }
}

function setup(rows: unknown[]) {
  const compiled: CompiledQuery[] = [];
  const db = new Kysely<Database>({
    dialect: {
      createAdapter: () => new PostgresAdapter(),
      createDriver: () => new RowsDriver(rows),
      createIntrospector: (kysely) => new PostgresIntrospector(kysely),
      createQueryCompiler: () => new PostgresQueryCompiler(),
    },
    log: (event) => {
      if (event.level === 'query') compiled.push(event.query);
    },
  });
  const now = new Date('2026-10-14T02:10:00.000Z');
  return { purger: new PgIdempotencyPurger(db, new FixedClock(now)), compiled, now };
}

describe('the adapter of the cleanup of idempotency records (EVM-079)', () => {
  it('EVM-079 AC1 a statement that returns no row purges 0 and calls the function with the batch and the instant of the clock', async () => {
    const { purger, compiled, now } = setup([]);

    expect(await purger.purgeBatch(500)).toBe(0);

    expect(compiled).toHaveLength(1);
    expect(compiled[0]?.sql).toContain('platform.purge_expired_idempotency_records($1, $2)');
    expect(compiled[0]?.parameters).toEqual([500, now]);
  });

  it('EVM-079 AC1 the number returned by the function is the number of purged records', async () => {
    const { purger } = setup([{ purged: 3 }]);
    expect(await purger.purgeBatch(500)).toBe(3);
  });
});
