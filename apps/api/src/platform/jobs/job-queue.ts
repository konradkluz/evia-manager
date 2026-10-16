/**
 * Background jobs of the platform (ADR-0010; EVM-034 W11): a thin interface over the queue, so the modules and the tests know a
 * contract — not the library. The adapter over pg-boss is `pg-boss-job-queue.ts` (the only file that imports it); the tests of the
 * units use `InMemoryJobQueue`. Nothing here imports a module (ADR-0001): the composition root of the worker registers the jobs.
 *
 * A job carries NO personal data (TM-26, TM-72, SR-LOG-02): its payload is `{ ids: [UUID, …] }` — an empty list is a job of the
 * schedule — and its result is a record of NUMBERS. Both are validated strictly (unknown keys and free text are refused), on the
 * sending side AND on the receiving side, because the queue table is writable by the application role.
 */
import { z } from 'zod';

/** Most identifiers one job may carry (one batch of a bulk operation). */
export const MAX_PAYLOAD_IDS = 500;

export const jobPayloadSchema = z.strictObject({ ids: z.array(z.uuid()).max(MAX_PAYLOAD_IDS) });
export type JobPayload = z.infer<typeof jobPayloadSchema>;

/** `<module>.<job>` in lower case with hyphens, e.g. `overview.verify-projection`. */
export const JOB_NAME = /^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)+$/;

/** The only thing a handler returns: counts under short names — they are stored as the output of the job. */
export type JobCounts = Readonly<Record<string, number>>;

export type JobHandler = (payload: JobPayload) => Promise<JobCounts | undefined>;

export interface JobSchedule {
  /** Five-field cron expression. */
  readonly cron: string;
  /** IANA zone the expression is evaluated in. */
  readonly timezone: string;
}

/**
 * The retries of ONE queue (EVM-024 AC5): the library re-runs a handler that threw, after `retryDelaySeconds` (doubled each time with a
 * jitter when `retryBackoff`, at most `retryDelayMaxSeconds`), at most `retryLimit` times. A queue without a policy has the default of
 * the platform. The settings of a queue are applied when the queue is registered (`work`) — also to a queue that already exists.
 */
export interface QueueRetryPolicy {
  readonly retryLimit: number;
  readonly retryDelaySeconds: number;
  readonly retryBackoff: boolean;
  readonly retryDelayMaxSeconds?: number;
}

export interface WorkOptions {
  readonly retry?: QueueRetryPolicy;
}

export interface SendOptions {
  /**
   * A deterministic identifier of the job (a UUID the sender owns, e.g. the id of an outbox row): sending the same one twice creates ONE job
   * (the second send is a no-op), so a relay that hands a row over again can never double the work.
   */
  readonly jobId?: string;
}

/** A job with its schedule, as a module hands it to the composition root of the worker. */
export interface JobDefinition {
  readonly name: string;
  readonly schedule?: JobSchedule;
  readonly handler: JobHandler;
  readonly retry?: QueueRetryPolicy;
}

/**
 * The only error that leaves a handler towards the queue: a fixed code and a fixed message. A library error (a driver error carries
 * the `detail` of a row) would be stored with the job and in the dead-letter queue (TM-26, SR-LOG-02).
 */
export class JobFailure extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.name = 'JobFailure';
    this.code = code;
  }
}

export const INVALID_PAYLOAD = 'invalid_payload';
export const JOB_FAILED = 'job_failed';

export interface JobQueue {
  start(): Promise<void>;
  /** Graceful: waits for the running handlers, then releases the connections. */
  stop(): Promise<void>;
  /** Takes the jobs of the queue `name` (creates the queue and its dead-letter queue); one at a time. */
  work(name: string, handler: JobHandler, options?: WorkOptions): Promise<void>;
  /** The job `name` is created by the schedule (one run, however many workers run). */
  schedule(name: string, schedule: JobSchedule): Promise<void>;
  /** Enqueues a job with identifiers only. Refuses anything that is not a list of UUIDs. */
  send(name: string, ids: readonly string[], options?: SendOptions): Promise<void>;
}

export function assertJobName(name: string): void {
  if (!JOB_NAME.test(name)) throw new Error('invalid job name');
}

export function parsePayload(value: unknown): JobPayload {
  const parsed = jobPayloadSchema.safeParse(value ?? { ids: [] });
  if (!parsed.success) throw new JobFailure(INVALID_PAYLOAD);
  return parsed.data;
}

/** Wraps whatever a handler threw into the error with the fixed code, so the library stores nothing of the original. */
export async function runHandler(handler: JobHandler, rawPayload: unknown): Promise<JobCounts | undefined> {
  const payload = parsePayload(rawPayload);
  try {
    return await handler(payload);
  } catch (error) {
    throw error instanceof JobFailure ? error : new JobFailure(JOB_FAILED);
  }
}
