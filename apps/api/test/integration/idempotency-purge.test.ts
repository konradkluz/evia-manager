import { sql, type Kysely } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { SystemClock } from '../../src/platform/clock/clock.ts';
import { createDatabase, type Database } from '../../src/platform/database/database.ts';
import { PgIdempotency, type IdempotencyRequest, type StoredResult } from '../../src/platform/idempotency/idempotency.ts';
import { PgIdempotencyPurger } from '../../src/platform/idempotency/idempotency-purger.ts';
import { BATCH_SIZE, PurgeIdempotencyJob } from '../../src/platform/idempotency/purge-idempotency.job.ts';
import { createLogger } from '../../src/platform/logging/logger.ts';
import { MetricsRegistry } from '../../src/platform/metrics/metrics.ts';
import { LogCapture } from '../support/app.ts';
import { FixedClock } from '../support/clock.ts';
import { migratedDatabase, type MigratedDatabase } from './database.ts';

let database: MigratedDatabase;
let app: Kysely<Database>;
let purger: PgIdempotencyPurger;

beforeAll(async () => {
  database = await migratedDatabase();
  app = createDatabase({ url: database.appUrl, logger: createLogger({ level: 'fatal' }), pool: { max: 8 } });
  purger = new PgIdempotencyPurger(app, new SystemClock());
});
afterAll(async () => {
  await app.destroy();
  await database.close();
});
beforeEach(async () => {
  await sql`truncate platform.idempotency_records`.execute(database.admin);
});

const USER = '0198b0a0-0000-7000-8000-00000000a001';
const RESOURCE = '0198b0a0-0000-7000-8000-00000000e001';
const key = (n: number): string => `0198b0a0-0000-7000-8000-${String(n).padStart(12, '0')}`;

/** Inserts `count` records whose `expires_at` is `offsetSeconds` from the database clock (negative = expired). */
const seed = (first: number, count: number, offsetSeconds: number) =>
  sql`
    insert into platform.idempotency_records (user_id, device_id, idempotency_key, scope, request_hash, result_status, result_code, result_resource_id, created_at, expires_at)
    select ${USER}::uuid, null, ('0198b0a0-0000-7000-8000-' || lpad((${first}::int + n)::text, 12, '0'))::uuid, 'POST /api/v1/customers', ${'a'.repeat(64)}, 201, 'created', ${RESOURCE}::uuid,
           now() - interval '31 days', now() + make_interval(secs => ${offsetSeconds}::int)
    from generate_series(0, ${count}::int - 1) as n`.execute(database.admin);
const count = async () =>
  Number((await sql<{ n: string }>`select count(*)::text as n from platform.idempotency_records`.execute(database.admin)).rows[0]?.n);

describe('purge of expired idempotency records (EVM-079)', () => {
  it('EVM-079 AC1 expired records are deleted, live ones (also one at the edge) stay, and a live key still replays', async () => {
    await seed(1, 3, -86_400); // long expired
    await seed(10, 1, -1); // expired a second ago
    await seed(20, 1, 30); // valid for a while yet
    await seed(30, 1, 30 * 86_400);
    expect(await purger.purgeBatch(100)).toBe(4);
    const { rows } = await sql<{ idempotency_key: string }>`select idempotency_key from platform.idempotency_records order by 1`.execute(
      database.admin,
    );
    expect(rows.map((row) => row.idempotency_key)).toEqual([key(20), key(30)]);

    const idempotency = new PgIdempotency(new SystemClock(), new MetricsRegistry());
    const request: IdempotencyRequest = {
      userId: USER,
      deviceId: null,
      key: key(30),
      scope: 'POST /api/v1/customers',
      bodyHash: 'a'.repeat(64),
    };
    const stored: StoredResult = { status: 201, code: 'created', resourceId: RESOURCE };
    let calls = 0;
    const outcome = await app.transaction().execute((tx) =>
      idempotency.run(tx, request, () => {
        calls += 1;
        return Promise.resolve({ value: 'x', result: stored });
      }),
    );
    expect(outcome).toEqual({ replayed: true, result: stored });
    expect(calls).toBe(0);
  });

  it('EVM-079 AC1 the instant is the application clock (controlled): the same record is live at an earlier instant and expired at a later one', async () => {
    await seed(1, 1, -3600); // expired an hour ago by the database clock
    const clock = new FixedClock(new Date(Date.now() - 2 * 3_600_000));
    const earlier = new PgIdempotencyPurger(app, clock);
    expect(await earlier.purgeBatch(10)).toBe(0); // two hours ago it was still valid
    clock.advance(2 * 3_600_000);
    expect(await earlier.purgeBatch(10)).toBe(1);
  });

  it('EVM-079 AC1 a record that expires between runs is deleted by the next one, and an empty table is a quiet no-op', async () => {
    expect(await purger.purgeBatch(100)).toBe(0);
    await seed(1, 1, -600); // expired ten minutes ago by the database clock, so the cap never interferes
    const { rows } = await sql<{ expires_at: Date }>`select expires_at from platform.idempotency_records`.execute(database.admin);
    const expiresAt = rows[0]?.expires_at.getTime() ?? 0;
    const clock = new FixedClock(new Date(expiresAt - 1000)); // controlled instant: one second before expiry
    const controlled = new PgIdempotencyPurger(app, clock);
    expect(await controlled.purgeBatch(100)).toBe(0);
    expect(await count()).toBe(1);
    clock.advance(2000); // one second after expiry
    expect(await controlled.purgeBatch(100)).toBe(1);
    expect(await count()).toBe(0);
  });

  it('EVM-079 AC2 a batch is bounded: the size is respected, clamped to at least 1, and the job walks a large backlog in batches', async () => {
    await seed(1, 2500, -60);
    expect(await purger.purgeBatch(100)).toBe(100);
    expect(await purger.purgeBatch(0)).toBe(1);
    expect(await purger.purgeBatch(-5)).toBe(1);
    expect(await count()).toBe(2398);
    const logs = new LogCapture();
    const job = new PurgeIdempotencyJob(purger, createLogger({ level: 'info', destination: logs }), new SystemClock());
    expect(await job.run()).toEqual({ deleted: 2398, batches: Math.floor(2398 / BATCH_SIZE) + 1 });
    expect(await count()).toBe(0);
    expect(await job.run()).toEqual({ deleted: 0, batches: 1 });
  });

  it('EVM-079 AC2 several instances at once delete every expired record exactly once, with no error and no live record touched', async () => {
    await seed(1, 3000, -60);
    await seed(5000, 5, 3600);
    const results = await Promise.all(
      [purger, purger, purger].map(async (instance) => {
        let total = 0;
        for (;;) {
          const purged = await instance.purgeBatch(250);
          total += purged;
          if (purged === 0) return total;
        }
      }),
    );
    expect(results.reduce((sum, value) => sum + value, 0)).toBe(3000);
    expect(await count()).toBe(5);
  });

  it('EVM-079 AC2 a row held by a request is skipped without waiting and removed by the next run; a failed run leaves the rest for the next one', async () => {
    await seed(1, 2, -60);
    await database.admin.transaction().execute(async (held) => {
      await sql`select 1 from platform.idempotency_records where idempotency_key = ${key(1)} for update`.execute(held);
      expect(await purger.purgeBatch(100)).toBe(1); // the other row only, nothing waited
    });
    expect(await count()).toBe(1);
    expect(await purger.purgeBatch(100)).toBe(1);

    const unreachable = createDatabase({
      url: 'postgres://nobody:x@127.0.0.1:1/none',
      logger: createLogger({ level: 'fatal' }),
      pool: { max: 1 },
    });
    try {
      await seed(1, 1, -60);
      await expect(new PgIdempotencyPurger(unreachable, new SystemClock()).purgeBatch(10)).rejects.toBeDefined();
      expect(await count()).toBe(1);
      expect(await purger.purgeBatch(10)).toBe(1);
    } finally {
      await unreachable.destroy();
    }
  });

  it('EVM-079 AC3 the application role has no DELETE or TRUNCATE on the table: a direct DELETE of any record is refused', async () => {
    await seed(1, 1, 3600);
    await seed(2, 1, -60);
    const { rows } = await sql<Record<string, boolean>>`
      select has_table_privilege('evia_it_app', 'platform.idempotency_records', 'DELETE') as "delete",
             has_table_privilege('evia_it_app', 'platform.idempotency_records', 'TRUNCATE') as "truncate",
             has_table_privilege('evia_it_app', 'platform.idempotency_records', 'SELECT') as "select",
             has_table_privilege('evia_it_app', 'platform.idempotency_records', 'INSERT') as "insert",
             has_table_privilege('evia_it_app', 'platform.idempotency_records', 'UPDATE') as "update"`.execute(database.admin);
    expect(rows[0]).toEqual({ delete: false, truncate: false, select: true, insert: true, update: true });
    for (const statement of [
      sql`delete from platform.idempotency_records where idempotency_key = ${key(1)}`,
      sql`delete from platform.idempotency_records where expires_at < now()`,
      sql`delete from platform.idempotency_records`,
      sql`truncate platform.idempotency_records`,
    ]) {
      await expect(statement.execute(app)).rejects.toMatchObject({ code: '42501' });
    }
    expect(await count()).toBe(2);
  });

  it('EVM-079 AC3 the instant of the caller is capped by the database clock: a future instant never deletes a live record, and the function is closed to PUBLIC', async () => {
    await seed(1, 2, 3600);
    expect(await purger.purgeBatch(5000)).toBe(0);
    await expect(
      sql`select platform.purge_expired_idempotency_records(10, now() + interval '100 days')`.execute(app),
    ).resolves.toMatchObject({ rows: [{ purge_expired_idempotency_records: 0 }] });
    expect(await count()).toBe(2);
    const { rows } = await sql<Record<string, unknown>>`
      select has_function_privilege('public', 'platform.purge_expired_idempotency_records(integer, timestamptz)', 'EXECUTE') as public_execute,
             has_function_privilege('evia_app', 'platform.purge_expired_idempotency_records(integer, timestamptz)', 'EXECUTE') as app_execute,
             p.prosecdef as definer, p.proconfig as config
      from pg_proc p where p.proname = 'purge_expired_idempotency_records'`.execute(database.admin);
    expect(rows).toEqual([{ public_execute: false, app_execute: true, definer: true, config: ['search_path=pg_catalog, pg_temp'] }]);
  });
});
