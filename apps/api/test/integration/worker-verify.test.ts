import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { VERIFY_PROJECTION_JOB } from '../../src/modules/overview/index.ts';
import { PgBossJobQueue } from '../../src/platform/jobs/pg-boss-job-queue.ts';
import { createLogger } from '../../src/platform/logging/logger.ts';
import { PURGE_IDEMPOTENCY_JOB } from '../../src/platform/idempotency/purge-idempotency.job.ts';
import { runWorkerFromProcess } from '../../src/worker/worker-process.ts';
import { UNREACHABLE_DATABASE_URL, validEnv } from '../support/app.ts';
import { insertCustomer } from '../support/customer-fixtures.ts';
import { skipProjectionCheckOnce } from '../support/projection.ts';
import { insertWorkOrders, numberOf } from '../support/work-order-fixtures.ts';
import { migratedDatabase, type MigratedDatabase } from './database.ts';

let database: MigratedDatabase;
beforeAll(async () => {
  database = await migratedDatabase();
});
afterAll(async () => {
  await database.close();
});

interface Started {
  readonly signals: EventEmitter;
  readonly lines: () => Array<Record<string, unknown>>;
  readonly exit: Promise<number>;
}

/** The whole process as it runs: real wiring, real queue as the application role, in-memory streams and signals. */
function startWorker(env: Record<string, string | undefined>): Started {
  const stdout = new PassThrough();
  const text: string[] = [];
  stdout.on('data', (chunk: Buffer) => text.push(chunk.toString('utf8')));
  const signals = new EventEmitter();
  const exit = runWorkerFromProcess(
    validEnv({ LOG_LEVEL: 'info', EMAIL_TRANSPORT: 'none', ...env }),
    { stdout, signals },
    {
      healthFile: join(tmpdir(), `worker-health-${String(process.pid)}`),
      createQueue: (connectionString, logger) =>
        new PgBossJobQueue({ connectionString, logger, retryDelaySeconds: 0, pollingIntervalSeconds: 0.5 }),
    },
  );
  const lines = () =>
    text
      .join('')
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Record<string, unknown>);
  return { signals, lines, exit };
}

async function until<T>(read: () => Promise<T | undefined> | T | undefined, what: string): Promise<T> {
  const deadline = Date.now() + 30_000;
  for (;;) {
    const value = await read();
    if (value !== undefined) return value;
    if (Date.now() > deadline) throw new Error(`timeout: ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

describe('the worker with the nightly verify (EVM-034 W11; ADR-0010, ADR-0017 W11)', () => {
  it('EVM-034 W11 the worker as the application role registers the schedule, verifies the projection when the job is sent, alerts on a difference of the authorisation column and stops on SIGTERM', async () => {
    const customerId = await insertCustomer(database.admin, { email: 'jan@example.invalid' });
    const ids = await insertWorkOrders(database.admin, [
      { number: numberOf(2026, 31), customerId, title: 'Tytul Wrazliwy' },
      { number: numberOf(2026, 32), customerId },
    ]);
    const [first = ''] = [...ids.values()];

    const worker = startWorker({ DATABASE_URL: database.appUrl });
    await until(() => worker.lines().find((line) => line['msg'] === 'worker: ready'), 'the worker is ready');
    const { rows: schedules } = await sql<{ name: string; cron: string; timezone: string }>`
      select name, cron, timezone from pgboss.schedule order by name`.execute(database.admin);
    expect(schedules).toEqual([
      { name: VERIFY_PROJECTION_JOB, cron: '30 3 * * *', timezone: 'Europe/Warsaw' },
      { name: PURGE_IDEMPOTENCY_JOB, cron: '10 4 * * *', timezone: 'Europe/Warsaw' }, // EVM-079 AC2
    ]);

    const sender = new PgBossJobQueue({ connectionString: database.appUrl, logger: createLogger({ level: 'fatal' }) });
    await sender.start();
    try {
      await sender.send(VERIFY_PROJECTION_JOB, []);
      const clean = await until(async () => {
        const { rows } = await sql<{ state: string; output: Record<string, number> }>`
          select state, output from pgboss.job where name = ${VERIFY_PROJECTION_JOB} order by created_on desc limit 1`.execute(
          database.admin,
        );
        return rows[0]?.state === 'completed' ? rows[0].output : undefined;
      }, 'the first run completes');
      expect(clean).toEqual({ checked: 2, inSync: 2, missing: 0, differing: 0, authz: 0 });
      const { rows: alertsBefore } = await sql`select 1 from platform.security_alert_outbox`.execute(database.admin);
      expect(alertsBefore).toHaveLength(0);

      // the authorisation column differs from the source: the alert, the metric in the log, and the job still succeeds
      await sql`update overview.work_order_summaries set deleted_at = now() where work_order_id = ${first}`.execute(database.admin);
      skipProjectionCheckOnce();
      await sender.send(VERIFY_PROJECTION_JOB, []);
      const drift = await until(async () => {
        const { rows } = await sql<{ state: string; output: Record<string, number> }>`
          select state, output from pgboss.job where name = ${VERIFY_PROJECTION_JOB} and state = 'completed'
            and (output ->> 'differing')::int > 0`.execute(database.admin);
        return rows[0]?.output;
      }, 'the second run completes');
      expect(drift).toEqual({ checked: 2, inSync: 1, missing: 0, differing: 1, authz: 1 });
      const { rows: alerts } = await sql<{ alert_code: string }>`select alert_code from platform.security_alert_outbox`.execute(
        database.admin,
      );
      expect(alerts).toEqual([{ alert_code: 'projection_authz_drift' }]);
      const { rows: stored } = await sql<{ output: unknown }>`select output from pgboss.job`.execute(database.admin);
      expect(JSON.stringify(stored)).not.toContain(first);
    } finally {
      await sender.stop();
      await sql`update overview.work_order_summaries set deleted_at = null where work_order_id = ${first}`.execute(database.admin);
    }

    const warning = worker.lines().find((line) => line['msg'] === 'projection verify: drift found');
    expect(warning).toMatchObject({
      metric: 'projection_drift_total',
      value: 1,
      authz: 1,
      traceId: expect.stringMatching(/^[0-9a-f]{32}$/) as string,
    });
    const everything = JSON.stringify(worker.lines());
    expect(everything).not.toMatch(/Wrazliw|jan@example|postgres:\/\//);
    expect(everything).not.toContain(first);

    worker.signals.emit('SIGTERM');
    expect(await worker.exit).toBe(0);
    expect(worker.lines().map((line) => line['msg'])).toContain('worker: stopping');
  });

  it('EVM-034 W11 a worker that cannot reach the database exits with code 1 and logs no connection string', async () => {
    const worker = startWorker({ DATABASE_URL: UNREACHABLE_DATABASE_URL });
    expect(await worker.exit).toBe(1);
    expect(worker.lines().map((line) => line['msg'])).toContain('worker: start failed');
    expect(JSON.stringify(worker.lines())).not.toMatch(/evia-test|postgres:\/\//);
  });

  it('EVM-034 W11 the worker has no HTTP server and runs no migration', () => {
    const root = join(import.meta.dirname, '..', '..', 'src');
    for (const file of ['worker.ts', 'worker/worker-process.ts', 'worker/run-worker.ts']) {
      const source = readFileSync(join(root, file), 'utf8');
      expect(source, file).not.toMatch(/\.listen\(|createApiApp|migrateToLatest|MIGRATIONS/);
    }
  });
});
