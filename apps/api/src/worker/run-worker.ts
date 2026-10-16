/**
 * The life of the worker process (ADR-0010; EVM-034 step 9), without the wiring of the application: it receives the queue, the
 * jobs and the source of the signals, so it is tested on `InMemoryJobQueue` with no database and no real signal.
 *
 * Start: the queue starts, then every job is taken (`work`) and — when it has a schedule — scheduled. Then the worker waits for
 * SIGTERM or SIGINT and stops the queue gracefully (the running job finishes, the connections are released). A failure to start ends with
 * exit code 1 (the orchestrator restarts the container); nothing listens on a port — the worker has no HTTP server.
 * The log holds the kind of a failure and counts, never a message of the driver or the connection string (SR-LOG-02).
 */
import type { JobDefinition, JobQueue } from '../platform/jobs/index.ts';
import type { Logger } from '../platform/logging/logger.ts';

export const EXIT_OK = 0;
export const EXIT_FAILED = 1;

export interface SignalSource {
  once(signal: 'SIGTERM' | 'SIGINT', listener: () => void): unknown;
}

/** Work that runs next to the jobs while the worker is up (the relay of an outbox, the health file): started when the jobs are taken, stopped before the queue. */
export interface BackgroundTask {
  /** @returns a function that stops it */
  start(): () => void;
}

export interface RunWorkerOptions {
  readonly queue: JobQueue;
  readonly jobs: readonly JobDefinition[];
  readonly tasks?: readonly BackgroundTask[];
  readonly signals: SignalSource;
  readonly logger: Logger;
}

/** @returns the exit code once the worker has been stopped by a signal (or failed to start) */
export async function runWorker({ queue, jobs, tasks = [], signals, logger }: RunWorkerOptions): Promise<number> {
  const stops: Array<() => void> = [];
  const stopped = new Promise<void>((resolve) => {
    signals.once('SIGTERM', resolve);
    signals.once('SIGINT', resolve);
  });
  try {
    await queue.start();
    for (const job of jobs) {
      await queue.work(job.name, job.handler, job.retry === undefined ? {} : { retry: job.retry });
      if (job.schedule !== undefined) await queue.schedule(job.name, job.schedule);
    }
    for (const task of tasks) stops.push(task.start());
    logger.info({ jobs: jobs.length, tasks: tasks.length }, 'worker: ready');
  } catch (error) {
    logger.error({ errorType: error instanceof Error ? error.name : 'unknown' }, 'worker: start failed');
    for (const stop of stops) stop();
    await queue.stop().catch(() => undefined);
    return EXIT_FAILED;
  }
  await stopped;
  logger.info({}, 'worker: stopping');
  for (const stop of stops) stop();
  try {
    await queue.stop();
  } catch (error) {
    logger.error({ errorType: error instanceof Error ? error.name : 'unknown' }, 'worker: stop failed');
    return EXIT_FAILED;
  }
  return EXIT_OK;
}
