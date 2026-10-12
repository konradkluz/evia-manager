import { createRequire } from 'node:module';
import { sql, type Kysely } from 'kysely';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { getConstructionPlans } from 'pg-boss';
import { PGBOSS_FROZEN_SCHEMA_VERSION, PGBOSS_SCHEMA_43_SCRIPT } from '../../src/migrations/data/pgboss-schema-43.ts';
import { createDatabase, type Database } from '../../src/platform/database/database.ts';
import { PgBossJobQueue } from '../../src/platform/jobs/pg-boss-job-queue.ts';
import { createLogger } from '../../src/platform/logging/logger.ts';
import { LogCapture } from '../support/app.ts';
import { migratedDatabase, type MigratedDatabase } from './database.ts';

let database: MigratedDatabase;
let app: Kysely<Database>;
let readonlyUrl: string;
const queues: PgBossJobQueue[] = [];
const logger = createLogger({ level: 'fatal' });

beforeAll(async () => {
  database = await migratedDatabase();
  app = createDatabase({ url: database.appUrl, logger, pool: { max: 1 } });
  await sql`
    do $$
    begin
      create role evia_it_readonly login password 'evia-it-synthetic';
    exception
      when duplicate_object then null;
    end
    $$
  `.execute(database.admin);
  const url = new URL(database.adminUrl);
  url.username = 'evia_it_readonly';
  url.password = 'evia-it-synthetic';
  readonlyUrl = url.toString();
});
afterEach(async () => {
  // the queue must not leave open handles (the pool and the timers of the library)
  for (const queue of queues.splice(0)) await queue.stop();
  await sql`truncate pgboss.job, pgboss.schedule`.execute(database.admin);
});
afterAll(async () => {
  await app.destroy();
  await database.close();
});

function newQueue(options: { retryDelaySeconds?: number } = {}): PgBossJobQueue {
  const queue = new PgBossJobQueue({
    connectionString: database.appUrl,
    logger,
    retryDelaySeconds: options.retryDelaySeconds ?? 0,
    pollingIntervalSeconds: 0.5,
  });
  queues.push(queue);
  return queue;
}

async function until<T>(read: () => Promise<T | undefined>, what: string): Promise<T> {
  const deadline = Date.now() + 20_000;
  for (;;) {
    const value = await read();
    if (value !== undefined) return value;
    if (Date.now() > deadline) throw new Error(`timeout: ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

const jobsOf = (name: string) =>
  sql<{ state: string; data: unknown; output: unknown; retry_count: number }>`
    select state, data, output, retry_count from pgboss.job where name = ${name} order by created_on`.execute(database.admin);

describe('the job queue over pg-boss (EVM-034 W11; ADR-0010)', () => {
  it('EVM-034 W11 the schema version of the package equals the frozen one: a bump of pg-boss to a newer schema needs a migration', async () => {
    const installed = (createRequire(import.meta.url)('pg-boss/package.json') as { pgboss: { schema: number } }).pgboss.schema;
    expect(installed).toBe(PGBOSS_FROZEN_SCHEMA_VERSION);
    const { rows } = await sql<{ version: number }>`select version from pgboss.version`.execute(database.admin);
    expect(rows).toEqual([{ version: PGBOSS_FROZEN_SCHEMA_VERSION }]);
  });

  it('EVM-034 W11 the frozen script ends with the version it declares and matches the library while the versions are equal', () => {
    expect(PGBOSS_SCHEMA_43_SCRIPT).toMatch(/INSERT INTO pgboss\.version\(version\) VALUES \('43'\);\s*COMMIT;\s*$/);
    expect(PGBOSS_FROZEN_SCHEMA_VERSION).toBe(43);
    expect(getConstructionPlans('pgboss', { createSchema: true })).toBe(PGBOSS_SCHEMA_43_SCRIPT);
  });

  it('EVM-034 W11 the application role works on the queue with DML only; DDL in the schema is refused; the read-only role has no access', async () => {
    await expect(sql`create table pgboss.intruder (id int)`.execute(app)).rejects.toMatchObject({ code: '42501' });
    await expect(sql`drop table pgboss.job`.execute(app)).rejects.toMatchObject({ code: '42501' });
    await expect(sql`create schema intruder`.execute(app)).rejects.toMatchObject({ code: '42501' });
    const readonly = createDatabase({ url: readonlyUrl, logger, pool: { max: 1 } });
    try {
      await expect(sql`select * from pgboss.job`.execute(readonly)).rejects.toMatchObject({ code: '42501' });
      await expect(sql`select * from pgboss.queue`.execute(readonly)).rejects.toMatchObject({ code: '42501' });
    } finally {
      await readonly.destroy();
    }
    const { rows } = await sql<{ ok: boolean }>`select has_schema_privilege('evia_app', 'pgboss', 'CREATE') as ok`.execute(database.admin);
    expect(rows).toEqual([{ ok: false }]);
  });

  it('EVM-034 W11 as the application role (migrate false, createSchema false) the queue is created without DDL, runs the job and keeps identifiers and counts only', async () => {
    const queue = newQueue();
    const seen: string[][] = [];
    await queue.start();
    await queue.work('overview.sample-job', (payload) => {
      seen.push([...payload.ids]);
      return Promise.resolve({ checked: 3 });
    });
    const id = '0198a000-0000-7000-8000-000000000001';
    await queue.send('overview.sample-job', [id]);
    const [job] = await until(async () => {
      const { rows } = await jobsOf('overview.sample-job');
      return rows[0]?.state === 'completed' ? rows : undefined;
    }, 'the job completes');
    expect(seen).toEqual([[id]]);
    expect(job?.data).toEqual({ ids: [id] });
    expect(job?.output).toEqual({ checked: 3 });
    const { rows: tables } = await sql<{ table_name: string }>`
      select table_name from information_schema.tables where table_schema = 'pgboss' order by 1`.execute(database.admin);
    // a queue without a partition adds no table
    expect(tables.map((row) => row.table_name).filter((name) => /^j[0-9a-f]{20,}/.test(name))).toEqual([]);
  });

  it('EVM-034 W11 send refuses a payload that is not a list of UUIDs', async () => {
    const queue = newQueue();
    await queue.start();
    await expect(queue.send('overview.sample-job', ['jan@example.invalid'])).rejects.toThrow();
    await expect(queue.send('Overview Sample', [])).rejects.toThrow(/job name/);
    const { rows } = await sql<{ n: string }>`select count(*)::text as n from pgboss.job`.execute(database.admin);
    expect(rows[0]?.n).toBe('0');
  });

  it('EVM-034 W11 a payload written to the table by hand is refused by the handler (strict schema) and never reaches it', async () => {
    const queue = newQueue();
    let called = 0;
    await queue.start();
    await queue.work('overview.sample-job', () => {
      called += 1;
      return Promise.resolve(undefined);
    });
    await sql`
      insert into pgboss.job (name, data) values ('overview.sample-job', ${JSON.stringify({ ids: [], note: 'jan@example.invalid' })}::jsonb)`.execute(
      app,
    );
    const rows = await until(async () => {
      const { rows: found } = await jobsOf('overview.sample-job');
      return found[0]?.state === 'failed' ? found : undefined;
    }, 'the job fails');
    expect(called).toBe(0);
    expect(JSON.stringify(rows[0]?.output)).toContain('invalid_payload');
    expect(JSON.stringify(rows[0]?.output)).not.toContain('example.invalid');
  });

  it('EVM-034 W11 a failing handler is retried retryLimit times, then fails; the stored output holds the fixed code and nothing of the driver error', async () => {
    const queue = newQueue();
    let attempts = 0;
    await queue.start();
    await queue.work('overview.sample-job', () => {
      attempts += 1;
      const driver = Object.assign(new Error('duplicate key value violates unique constraint "x"'), {
        detail: 'Key (email)=(jan@example.invalid) already exists.',
      });
      return Promise.reject(driver);
    });
    await queue.send('overview.sample-job', []);
    const rows = await until(async () => {
      const { rows: found } = await jobsOf('overview.sample-job');
      return found[0]?.state === 'failed' ? found : undefined;
    }, 'the job fails after the retries');
    expect(attempts).toBe(3);
    const output = JSON.stringify(rows[0]?.output);
    expect(output).toContain('job_failed');
    expect(output).not.toMatch(/duplicate key|example\.invalid|detail|email/);
    const dead = await until(async () => {
      const { rows: found } = await jobsOf('overview.sample-job.dead-letter');
      return found.length > 0 ? found : undefined;
    }, 'the job reaches the dead-letter queue');
    expect(dead).toHaveLength(1);
    expect(dead[0]?.data).toEqual({ ids: [] });
  });

  it('EVM-034 W11 the schedule is registered once, with the cron and the zone, without waiting for the cron', async () => {
    const first = newQueue();
    const second = newQueue();
    await first.start();
    await second.start();
    await first.schedule('overview.sample-job', { cron: '30 3 * * *', timezone: 'Europe/Warsaw' });
    await second.schedule('overview.sample-job', { cron: '30 3 * * *', timezone: 'Europe/Warsaw' });
    const { rows } = await sql<{ name: string; cron: string; timezone: string }>`
      select name, cron, timezone from pgboss.schedule`.execute(database.admin);
    expect(rows).toEqual([{ name: 'overview.sample-job', cron: '30 3 * * *', timezone: 'Europe/Warsaw' }]);
  });

  it('EVM-034 W11 the listener of the queue never logs the connection string or a driver message', async () => {
    const logs = new LogCapture();
    const queue = new PgBossJobQueue({
      connectionString: 'postgres://nobody:secret-synthetic@127.0.0.1:1/none',
      logger: createLogger({ level: 'info', destination: logs }),
    });
    queues.push(queue);
    await expect(queue.start()).rejects.toThrow();
    expect(logs.text).not.toContain('secret-synthetic');
  });
});
