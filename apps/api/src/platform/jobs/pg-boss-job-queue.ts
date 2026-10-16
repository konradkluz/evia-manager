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
import {
  assertJobName,
  jobPayloadSchema,
  runHandler,
  type JobHandler,
  type JobQueue,
  type JobSchedule,
  type QueueRetryPolicy,
  type SendOptions,
  type WorkOptions,
} from './job-queue.ts';

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
  /** Set by the tests only: overrides the delay of every queue, whatever its policy says. */
  readonly #retryDelayOverride: number | undefined;
  readonly #polling: number;
  /** The queues that exist for this process; `true` when the settings of a policy were applied to it. */
  readonly #queues = new Map<string, boolean>();

  constructor(options: PgBossJobQueueOptions) {
    this.#logger = options.logger;
    this.#retryDelayOverride = options.retryDelaySeconds;
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

  async work(name: string, handler: JobHandler, options: WorkOptions = {}): Promise<void> {
    await this.#ensureQueue(name, options.retry);
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

  async send(name: string, ids: readonly string[], options: SendOptions = {}): Promise<void> {
    assertJobName(name);
    const payload = jobPayloadSchema.parse({ ids });
    await this.#ensureQueue(name);
    // A deterministic id makes a second send of the same job a no-op (`ON CONFLICT DO NOTHING` of the library): no doubled work.
    await this.#boss.send(name, payload, options.jobId === undefined ? {} : { id: options.jobId });
  }

  /**
   * Creates the queue and its dead-letter queue. `createQueue` does not change a queue that exists, so the settings of a retry policy are
   * applied once more with `updateQueue` — a queue created by an older version of the worker takes the policy at the next start.
   */
  async #ensureQueue(name: string, retry?: QueueRetryPolicy): Promise<void> {
    assertJobName(name);
    const known = this.#queues.get(name);
    if (known !== undefined && (retry === undefined || known)) return;
    const deadLetter = `${name}${DEAD_LETTER_SUFFIX}`;
    const settings = { ...QUEUE_SETTINGS, retryDelay: this.#retryDelayOverride ?? QUEUE_SETTINGS.retryDelay, partition: false };
    const policy = retry === undefined ? {} : this.#policySettings(retry);
    await this.#boss.createQueue(deadLetter, { ...settings, retryLimit: 0 });
    await this.#boss.createQueue(name, { ...settings, ...policy, deadLetter });
    if (retry !== undefined) await this.#boss.updateQueue(name, policy);
    this.#queues.set(name, retry !== undefined);
  }

  #policySettings(retry: QueueRetryPolicy) {
    return {
      retryLimit: retry.retryLimit,
      retryDelay: this.#retryDelayOverride ?? retry.retryDelaySeconds,
      retryBackoff: retry.retryBackoff,
      ...(retry.retryDelayMaxSeconds === undefined ? {} : { retryDelayMax: retry.retryDelayMaxSeconds }),
    };
  }
}
