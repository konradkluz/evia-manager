/**
 * The adapter of the job queue over pg-boss (ADR-0010; EVM-034 W11) — the ONLY file that imports the library (dependency-cruiser).
 *
 * The schema `pgboss` is created and migrated by the MIGRATION as the migrator role (migration 0024); the worker runs as the application
 * role with `migrate: false` and `createSchema: false` and holds DML only — no CREATE on the schema or the database. A queue is
 * created WITHOUT a partition (`partition: false` — a partition would be a table, i.e. DDL at runtime).
 *
 * Settings of every queue: one job at a time, `retryLimit` 2 with a delay, an expiry of an active job, a dead-letter queue, and an
 * explicit retention of the finished jobs (7 days). The pool is small and named (`application_name=evia-worker`). A job holds
 * identifiers only; whatever a handler throws is replaced by `JobFailure` before the library can store it (see `runHandler`).
 */
import { PgBoss } from 'pg-boss';
import type { Logger } from '../logging/logger.ts';
import { assertJobName, runHandler, jobPayloadSchema, type JobHandler, type JobQueue, type JobSchedule } from './job-queue.ts';

export const SCHEMA = 'pgboss';
const DAY_SECONDS = 86_400;

/** Settings that are the same for every queue; the delay and the polling interval can be shortened by a test. */
export const QUEUE_SETTINGS = Object.freeze({
  retryLimit: 2,
  retryDelay: 60,
  expireInSeconds: 15 * 60,
  retentionSeconds: 7 * DAY_SECONDS,
  deleteAfterSeconds: 7 * DAY_SECONDS,
});

export const DEFAULT_POLLING_SECONDS = 30;
export const POOL_SIZE = 2;
export const DEAD_LETTER_SUFFIX = '.dead-letter';
/** Connection options of the queue's pool: the statements of the library are short; a stuck one must not hold the worker. */
const CONNECTION_OPTIONS = '-c statement_timeout=30000 -c lock_timeout=10000';

export interface PgBossJobQueueOptions {
  readonly connectionString: string;
  readonly logger: Logger;
  /** Shortened by the tests only. */
  readonly retryDelaySeconds?: number;
  readonly pollingIntervalSeconds?: number;
}

export class PgBossJobQueue implements JobQueue {
  readonly #boss: PgBoss;
  readonly #logger: Logger;
  readonly #retryDelay: number;
  readonly #polling: number;
  readonly #queues = new Set<string>();

  constructor(options: PgBossJobQueueOptions) {
    this.#logger = options.logger;
    this.#retryDelay = options.retryDelaySeconds ?? QUEUE_SETTINGS.retryDelay;
    this.#polling = options.pollingIntervalSeconds ?? DEFAULT_POLLING_SECONDS;
    this.#boss = new PgBoss({
      connectionString: options.connectionString,
      schema: SCHEMA,
      application_name: 'evia-worker',
      max: POOL_SIZE,
      options: CONNECTION_OPTIONS,
      migrate: false,
      createSchema: false,
      // maintenance rebuilds indexes with REINDEX, which needs the owner of the tables — not the application role
      reindex: false,
    });
    // Without a listener an `error` event stops the process. Only the kind of the failure is logged: a driver message carries values.
    this.#boss.on('error', (error: Error & { code?: unknown }) => {
      this.#logger.error({ errorType: error.name, errorCode: typeof error.code === 'string' ? error.code : undefined }, 'job queue: error');
    });
    this.#boss.on('warning', (warning) => {
      this.#logger.warn({ warning: warning.message.slice(0, 120) }, 'job queue: warning');
    });
  }

  async start(): Promise<void> {
    await this.#boss.start();
  }

  async stop(): Promise<void> {
    await this.#boss.stop({ graceful: true, close: true, timeout: 30_000 });
  }

  async work(name: string, handler: JobHandler): Promise<void> {
    await this.#ensureQueue(name);
    await this.#boss.work(
      name,
      { batchSize: 1, localConcurrency: 1, pollingIntervalSeconds: this.#polling },
      async (jobs) => (await runHandler(handler, jobs[0]?.data)) ?? {},
    );
  }

  async schedule(name: string, schedule: JobSchedule): Promise<void> {
    await this.#ensureQueue(name);
    await this.#boss.schedule(name, schedule.cron, { ids: [] }, { tz: schedule.timezone });
  }

  async send(name: string, ids: readonly string[]): Promise<void> {
    assertJobName(name);
    const payload = jobPayloadSchema.parse({ ids });
    await this.#ensureQueue(name);
    await this.#boss.send(name, payload);
  }

  async #ensureQueue(name: string): Promise<void> {
    assertJobName(name);
    if (this.#queues.has(name)) return;
    const deadLetter = `${name}${DEAD_LETTER_SUFFIX}`;
    const settings = { ...QUEUE_SETTINGS, retryDelay: this.#retryDelay, partition: false };
    await this.#boss.createQueue(deadLetter, { ...settings, retryLimit: 0 });
    await this.#boss.createQueue(name, { ...settings, deadLetter });
    this.#queues.add(name);
  }
}
