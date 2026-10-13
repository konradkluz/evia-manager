/**
 * The wiring of the worker process (ADR-0010; EVM-034 step 9): the environment, the application context (the same modules as the
 * API, NO HTTP server — nothing listens, no migration runs) and the queue over the database as the APPLICATION role. The composition
 * root registers the jobs of the modules here; `run-worker.ts` runs them. The streams, the signals and the queue are parameters, so
 * the whole process is exercised by the integration test with a real database and a real queue.
 *
 * Debt for EVM-024: the context is the whole `AppModule` (as the server command of the projection), because the validated
 * configuration (`loadConfig`) requires the keys of the HTTP side as well; a `WorkerModule` with the platform and the modules the jobs
 * need, and a configuration without the keys of HTTP, comes with the worker of e-mails.
 */
import 'reflect-metadata';
import type { Writable } from 'node:stream';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module.ts';
import { VerifyProjectionJob } from '../modules/overview/index.ts';
import { loadConfig } from '../platform/config/config.ts';
import { PgBossJobQueue } from '../platform/jobs/pg-boss-job-queue.ts';
import type { JobDefinition, JobQueue } from '../platform/jobs/index.ts';
import { createLogger, type Logger } from '../platform/logging/logger.ts';
import { NestLoggerAdapter } from '../platform/logging/nest-logger.ts';
import { installProcessHandlers, type ProcessLike } from '../platform/process/process-handlers.ts';
import { runWorker, type SignalSource } from './run-worker.ts';

export interface WorkerIo {
  readonly stdout: Writable;
  readonly signals: SignalSource;
  /** The last-resort handlers (an unhandled rejection, an uncaught exception) are installed on this process when given. */
  readonly process?: ProcessLike;
}

export interface WorkerWiring {
  /** The queue over the database; replaced by the tests that need other timings. */
  readonly createQueue?: (connectionString: string, logger: Logger) => JobQueue;
}

/** @returns the exit code of the process */
export async function runWorkerFromProcess(
  env: Readonly<Record<string, string | undefined>>,
  io: WorkerIo,
  wiring: WorkerWiring = {},
): Promise<number> {
  const config = loadConfig(env);
  const logger = createLogger({ level: config.logLevel, destination: io.stdout });
  if (io.process !== undefined) installProcessHandlers(io.process, logger);
  const app = await NestFactory.createApplicationContext(AppModule.register({ config, logger }), { logger: new NestLoggerAdapter(logger) });
  try {
    const queue = wiring.createQueue?.(config.databaseUrl, logger) ?? new PgBossJobQueue({ connectionString: config.databaseUrl, logger });
    const jobs: JobDefinition[] = [app.get(VerifyProjectionJob, { strict: false }).definition()];
    return await runWorker({ queue, jobs, signals: io.signals, logger });
  } finally {
    await app.close();
  }
}
