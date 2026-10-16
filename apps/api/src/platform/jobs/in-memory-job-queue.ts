/** An in-process queue for the unit tests: no database, no clock, no timers — `runDue` runs what was sent. */
import {
  assertJobName,
  jobPayloadSchema,
  runHandler,
  type JobCounts,
  type JobHandler,
  type JobQueue,
  type JobSchedule,
  type QueueRetryPolicy,
  type SendOptions,
  type WorkOptions,
} from './job-queue.ts';

export class InMemoryJobQueue implements JobQueue {
  readonly handlers = new Map<string, JobHandler>();
  readonly schedules = new Map<string, JobSchedule>();
  readonly retryPolicies = new Map<string, QueueRetryPolicy>();
  readonly #jobIds = new Set<string>();
  readonly pending: Array<{ readonly name: string; readonly payload: unknown }> = [];
  started = false;
  stopped = false;

  start(): Promise<void> {
    this.started = true;
    return Promise.resolve();
  }

  stop(): Promise<void> {
    this.stopped = true;
    return Promise.resolve();
  }

  work(name: string, handler: JobHandler, options: WorkOptions = {}): Promise<void> {
    return this.#settle(() => {
      assertJobName(name);
      this.handlers.set(name, handler);
      if (options.retry !== undefined) this.retryPolicies.set(name, options.retry);
    });
  }

  schedule(name: string, schedule: JobSchedule): Promise<void> {
    return this.#settle(() => {
      assertJobName(name);
      this.schedules.set(name, schedule);
    });
  }

  send(name: string, ids: readonly string[], options: SendOptions = {}): Promise<void> {
    return this.#settle(() => {
      assertJobName(name);
      const payload = jobPayloadSchema.parse({ ids });
      if (options.jobId !== undefined) {
        const key = `${name}|${options.jobId}`;
        if (this.#jobIds.has(key)) return;
        this.#jobIds.add(key);
      }
      this.pending.push({ name, payload });
    });
  }

  /** A refusal is a rejected promise, as with the real queue. */
  #settle(action: () => void): Promise<void> {
    return new Promise((resolve) => {
      action();
      resolve();
    });
  }

  /** Fires the job as the schedule would (an empty list of identifiers). */
  fire(name: string): void {
    this.pending.push({ name, payload: { ids: [] } });
  }

  /** Delivers everything sent so far, one job at a time, as the library would (the payload is parsed again). */
  async runDue(): Promise<JobCounts[]> {
    const results: JobCounts[] = [];
    for (const job of this.pending.splice(0)) {
      const handler = this.handlers.get(job.name);
      if (handler === undefined) throw new Error('no handler');
      results.push((await runHandler(handler, job.payload)) ?? {});
    }
    return results;
  }
}
