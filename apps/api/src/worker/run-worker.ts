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

export interface RunWorkerOptions {
  readonly queue: JobQueue;
  readonly jobs: readonly JobDefinition[];
  readonly signals: SignalSource;
  readonly logger: Logger;
}

/** @returns the exit code once the worker has been stopped by a signal (or failed to start) */
export async function runWorker({ queue, jobs, signals, logger }: RunWorkerOptions): Promise<number> {
  const stopped = new Promise<void>((resolve) => {
    signals.once('SIGTERM', resolve);
    signals.once('SIGINT', resolve);
  });
  try {
    await queue.start();
    for (const job of jobs) {
      await queue.work(job.name, job.handler);
      if (job.schedule !== undefined) await queue.schedule(job.name, job.schedule);
    }
    logger.info({ jobs: jobs.length }, 'worker: ready');
  } catch (error) {
    logger.error({ errorType: error instanceof Error ? error.name : 'unknown' }, 'worker: start failed');
    await queue.stop().catch(() => undefined);
    return EXIT_FAILED;
  }
  await stopped;
  logger.info({}, 'worker: stopping');
  try {
    await queue.stop();
  } catch (error) {
    logger.error({ errorType: error instanceof Error ? error.name : 'unknown' }, 'worker: stop failed');
    return EXIT_FAILED;
  }
  return EXIT_OK;
}
