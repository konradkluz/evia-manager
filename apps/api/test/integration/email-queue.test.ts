import { sql, type Kysely } from 'kysely';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDatabase, type Database } from '../../src/platform/database/database.ts';
import { EmailRelay, REHANDOVER_AFTER_MS } from '../../src/platform/email/email-relay.ts';
import { EMAIL_QUEUE, EMAIL_RETRY } from '../../src/platform/email/send-email.job.ts';
import { PgBossJobQueue } from '../../src/platform/jobs/pg-boss-job-queue.ts';
import type { JobQueue } from '../../src/platform/jobs/index.ts';
import { createLogger } from '../../src/platform/logging/logger.ts';
import { FixedClock } from '../support/clock.ts';
import { uuidv7 } from '../support/uuid.ts';
import { migratedDatabase, type MigratedDatabase } from './database.ts';

const logger = createLogger({ level: 'fatal' });
let database: MigratedDatabase;
let app: Kysely<Database>;
let queue: PgBossJobQueue;
const clock = new FixedClock('2026-10-16T08:00:00.000Z');

beforeEach(async () => {
  database = await migratedDatabase();
  app = createDatabase({ url: database.appUrl, logger, pool: { max: 4 } });
  queue = new PgBossJobQueue({ connectionString: database.appUrl, logger, retryDelaySeconds: 0, pollingIntervalSeconds: 0.5 });
  await queue.start();
  clock.set('2026-10-16T08:00:00.000Z');
});
afterEach(async () => {
  await queue.stop();
  await app.destroy();
  await database.close();
});

async function insertRow(overrides: { state?: string; enqueuedAt?: Date | null } = {}): Promise<string> {
  const { rows } = await sql<{ id: string }>`
    insert into platform.email_outbox (kind, recipient_user_id, state, enqueued_at, created_at)
    values ('user_invitation', ${uuidv7()}, ${overrides.state ?? 'pending'}, ${overrides.enqueuedAt ?? null}, ${clock.now()})
    returning id`.execute(database.admin);
  return rows[0]?.id ?? '';
}
const jobs = async () =>
  (
    await sql<{
      id: string;
      name: string;
      data: unknown;
      state: string;
    }>`select id, name, data, state from pgboss.job where name = ${EMAIL_QUEUE} order by created_on, id`.execute(database.admin)
  ).rows;
const enqueuedAt = async (id: string) =>
  (await sql<{ enqueued_at: Date | null }>`select enqueued_at from platform.email_outbox where id = ${id}`.execute(database.admin)).rows[0]
    ?.enqueued_at;
const relay = (to: JobQueue = queue) => new EmailRelay(app, to, clock, logger);

describe('the relay of the outbox to the queue email.send (EVM-024 AC1, AC5; ADR-0010; TM-26, TM-72)', () => {
  it('EVM-024 AC1 the relay hands a pending row to the queue as ONE job whose id is the id of the row and whose payload is that id alone; the row is marked only after the queue accepted it', async () => {
    const id = await insertRow();
    expect(await enqueuedAt(id)).toBeNull();

    expect(await relay().relayPending()).toBe(1);

    const [job, ...rest] = await jobs();
    expect(rest).toEqual([]);
    expect(job).toMatchObject({ id, name: EMAIL_QUEUE, state: 'created', data: { ids: [id] } });
    expect(Object.keys(job?.data as object)).toEqual(['ids']);
    expect((await enqueuedAt(id))?.toISOString()).toBe('2026-10-16T08:00:00.000Z');
    expect(await relay().relayPending()).toBe(0); // nothing is handed over twice
  });

  it('EVM-024 AC1 handing the same row over again — two relays at once, or the re-handover of a row that is still pending after 20 minutes — gives ONE job (the id of the job is the id of the row)', async () => {
    const id = await insertRow();
    await Promise.all([relay().relayPending(), relay().relayPending()]);
    expect(await jobs()).toHaveLength(1);

    clock.advance(REHANDOVER_AFTER_MS + 1000);
    expect(await relay().relayPending()).toBe(1); // handed over again...
    expect(await jobs()).toHaveLength(1); // ...and the queue took it as the same job
    expect((await enqueuedAt(id))?.toISOString()).toBe(clock.now().toISOString());
  });

  it('EVM-024 AC1 a row that is not pending (sent, failed, superseded) is never handed over', async () => {
    for (const state of ['failed', 'superseded']) await insertRow({ state });
    await sql`insert into platform.email_outbox (kind, recipient_user_id, state, sent_at, created_at) values ('user_invitation', ${uuidv7()}, 'sent', ${clock.now()}, ${clock.now()})`.execute(
      database.admin,
    );
    expect(await relay().relayPending()).toBe(0);
    expect(await jobs()).toEqual([]);
  });

  it('EVM-024 AC5 a queue that refuses a job leaves the row unmarked (it is handed over in the next round) and the relay does not throw; the rows before the refusal keep their mark', async () => {
    const first = await insertRow();
    clock.advance(1000);
    const second = await insertRow();
    let calls = 0;
    const flaky: JobQueue = {
      start: () => queue.start(),
      stop: () => queue.stop(),
      work: (name, handler, options) => queue.work(name, handler, options),
      schedule: (name, schedule) => queue.schedule(name, schedule),
      send: (name, ids, options) => {
        calls += 1;
        return calls === 1
          ? queue.send(name, ids, options)
          : Promise.reject(new Error('the queue is down: connection string postgres://secret'));
      },
    };
    expect(await relay(flaky).relayPending()).toBe(1);
    expect(await enqueuedAt(first)).not.toBeNull();
    expect(await enqueuedAt(second)).toBeNull();

    expect(await relay().relayPending()).toBe(1);
    expect(await enqueuedAt(second)).not.toBeNull();
    expect((await jobs()).map((job) => job.id).sort()).toEqual([first, second].sort());
  });

  it('EVM-024 AC1 the payload of a job holds identifiers only — nothing else is in the table of the queue', async () => {
    await insertRow();
    await insertRow();
    await relay().relayPending();
    const { rows } = await sql<{ row: string }>`select to_jsonb(j)::text as row from pgboss.job j where name = ${EMAIL_QUEUE}`.execute(
      database.admin,
    );
    expect(rows).toHaveLength(2);
    for (const { row } of rows) expect(row).not.toMatch(/@|example|token|activate|subject|text/i);
  });
});

describe('the settings of the queue email.send (EVM-024 AC5; SR-ERR-02)', () => {
  const settings = async (name: string) =>
    (
      await sql<{
        retry_limit: number;
        retry_delay: number;
        retry_backoff: boolean;
        retry_delay_max: number | null;
        dead_letter: string | null;
      }>`
        select retry_limit, retry_delay, retry_backoff, retry_delay_max, dead_letter from pgboss.queue where name = ${name}`.execute(
        database.admin,
      )
    ).rows[0];

  it('EVM-024 AC5 the queue takes the retry policy of the job: five retries, a first break of 30 seconds, doubled with a jitter up to 480 seconds, and its own dead-letter queue', async () => {
    const real = new PgBossJobQueue({ connectionString: database.appUrl, logger });
    await real.start();
    try {
      await real.work(EMAIL_QUEUE, () => Promise.resolve({}), { retry: EMAIL_RETRY });
    } finally {
      await real.stop();
    }
    expect(await settings(EMAIL_QUEUE)).toEqual({
      retry_limit: 5,
      retry_delay: 30,
      retry_backoff: true,
      retry_delay_max: 480,
      dead_letter: `${EMAIL_QUEUE}.dead-letter`,
    });
    expect(EMAIL_RETRY.retryLimit).toBeGreaterThanOrEqual(5); // not below the attempts the row counts (a net, not the rule)
  });

  it('EVM-024 AC5 a queue that already exists with the defaults takes the policy at the next start (createQueue alone would not change it)', async () => {
    // the queue is created first by a send (the defaults of the platform), as an older worker would have left it
    await queue.send(EMAIL_QUEUE, [uuidv7()]);
    expect(await settings(EMAIL_QUEUE)).toMatchObject({ retry_limit: 2, retry_backoff: false, retry_delay_max: null });

    const later = new PgBossJobQueue({ connectionString: database.appUrl, logger });
    await later.start();
    try {
      await later.work(EMAIL_QUEUE, () => Promise.resolve({}), { retry: EMAIL_RETRY });
    } finally {
      await later.stop();
    }
    expect(await settings(EMAIL_QUEUE)).toMatchObject({ retry_limit: 5, retry_delay: 30, retry_backoff: true, retry_delay_max: 480 });
  });

  it('EVM-024 AC5 a policy without a ceiling for the break leaves it open, and registering the same queue twice in one process asks the library once', async () => {
    const real = new PgBossJobQueue({ connectionString: database.appUrl, logger });
    await real.start();
    try {
      await real.work('overview.other-job', () => Promise.resolve({}), {
        retry: { retryLimit: 3, retryDelaySeconds: 10, retryBackoff: false },
      });
      await real.work('overview.other-job', () => Promise.resolve({}), {
        retry: { retryLimit: 3, retryDelaySeconds: 10, retryBackoff: false },
      });
      await real.send('overview.other-job', [uuidv7()]); // a send after the policy keeps it
    } finally {
      await real.stop();
    }
    expect(await settings('overview.other-job')).toMatchObject({
      retry_limit: 3,
      retry_delay: 10,
      retry_backoff: false,
      retry_delay_max: null,
    });
  });

  it('EVM-024 AC5 a queue without a policy keeps the defaults of the platform (the other jobs are not changed)', async () => {
    await queue.work('overview.sample-job', () => Promise.resolve({}));
    expect(await settings('overview.sample-job')).toMatchObject({ retry_limit: 2, retry_backoff: false, retry_delay_max: null });
  });
});
