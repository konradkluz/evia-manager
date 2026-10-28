/**
 * The wiring of the worker process (ADR-0010; EVM-034 step 9): the environment, the application context (the same modules as the
 * API, NO HTTP server — nothing listens, no migration runs) and the queue over the database as the APPLICATION role. The composition
 * root registers the jobs of the modules here; `run-worker.ts` runs them. The streams, the signals and the queue are parameters, so
 * the whole process is exercised by the integration test with a real database and a real queue.
 *
 * EVM-024 adds the e-mail: the transport comes from the configuration of the worker (`EMAIL_TRANSPORT`, required, no default). `smtp` registers
 * the job `email.send` (retries per queue) and the relay of the outbox; `none` registers NEITHER — the messages wait in the outbox as
 * `pending` (a job could not wait in the queue: the library deletes a job it has not run after its retention) and the health file says so.
 * The composition root is also where the modules meet the platform: the composer of the identity module is handed to the job here.
 *
 * Debt: the context is the whole `AppModule` (as the server command of the projection), because the validated configuration (`loadConfig`)
 * requires the keys of the HTTP side as well; a `WorkerModule` with the platform and the modules the jobs need would not.
 */
import 'reflect-metadata';
import type { Writable } from 'node:stream';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module.ts';
import {
  InvitationEmailComposer,
  LoginSecurityEmailComposer,
  MfaEmailComposer,
  PasswordEmailComposer,
  PurgeLoginSecurityJob,
  PurgeSessionsJob,
} from '../modules/identity/index.ts';
import { AbandonedUploadsJob, MediaScanService, QuarantineRetentionJob, SignatureMonitorJob } from '../modules/media/index.ts';
import { VerifyProjectionJob } from '../modules/overview/index.ts';
import { PurgeIdempotencyJob } from '../platform/idempotency/purge-idempotency.job.ts';
import type { Kysely } from 'kysely';
import { loadWorkerConfig, type EmailConfig } from '../platform/config/config.ts';
import type { Clock } from '../platform/clock/clock.ts';
import type { Database } from '../platform/database/database.ts';
import { EmailRelay } from '../platform/email/email-relay.ts';
import type { EmailSender } from '../platform/email/email-sender.ts';
import { SendEmailJob } from '../platform/email/send-email.job.ts';
import { SmtpEmailSender } from '../platform/email/smtp-email-sender.ts';
import { PgBossJobQueue } from '../platform/jobs/pg-boss-job-queue.ts';
import type { JobDefinition, JobQueue } from '../platform/jobs/index.ts';
import { createLogger, type Logger } from '../platform/logging/logger.ts';
import { NestLoggerAdapter } from '../platform/logging/nest-logger.ts';
import { installProcessHandlers, type ProcessLike } from '../platform/process/process-handlers.ts';
import { CLOCK, DATABASE } from '../platform/tokens.ts';
import { runWorker, type BackgroundTask, type SignalSource } from './run-worker.ts';
import { DEFAULT_HEALTH_FILE, healthTask } from './worker-health.ts';

export interface WorkerIo {
  readonly stdout: Writable;
  readonly signals: SignalSource;
  /** The last-resort handlers (an unhandled rejection, an uncaught exception) are installed on this process when given. */
  readonly process?: ProcessLike;
}

export interface WorkerWiring {
  /** The queue over the database; replaced by the tests that need other timings. */
  readonly createQueue?: (connectionString: string, logger: Logger) => JobQueue;
  /** The sender of e-mails for `EMAIL_TRANSPORT=smtp`; the tests put a fake here (the fake is never chosen by configuration). */
  readonly createEmailSender?: (config: Extract<EmailConfig, { transport: 'smtp' }>) => EmailSender;
  /** The file the health of the worker is written to (the container's `tmpfs`); shortened by nothing, moved by the tests only. */
  readonly healthFile?: string;
  /** The interval of the relay of the outbox; shortened by the tests only (the default is 5 seconds). */
  readonly relayIntervalMs?: number;
  /** The interval of the scan of uploaded files (EVM-044); shortened by the tests only (the default is 5 seconds). */
  readonly mediaScanIntervalMs?: number;
}

/** @returns the exit code of the process */
export async function runWorkerFromProcess(
  env: Readonly<Record<string, string | undefined>>,
  io: WorkerIo,
  wiring: WorkerWiring = {},
): Promise<number> {
  const config = loadWorkerConfig(env);
  const logger = createLogger({ level: config.logLevel, destination: io.stdout });
  if (io.process !== undefined) installProcessHandlers(io.process, logger);
  const app = await NestFactory.createApplicationContext(AppModule.register({ config, logger }), { logger: new NestLoggerAdapter(logger) });
  try {
    const queue = wiring.createQueue?.(config.databaseUrl, logger) ?? new PgBossJobQueue({ connectionString: config.databaseUrl, logger });
    const jobs: JobDefinition[] = [
      app.get(VerifyProjectionJob, { strict: false }).definition(),
      app.get(PurgeIdempotencyJob, { strict: false }).definition(),
      app.get(PurgeLoginSecurityJob, { strict: false }).definition(),
      app.get(PurgeSessionsJob, { strict: false }).definition(),
      // EVM-049: the retention of the quarantine, the sweeper of abandoned uploads and the monitor of the signatures of the scanner
      app.get(QuarantineRetentionJob, { strict: false }).definition(),
      app.get(AbandonedUploadsJob, { strict: false }).definition(),
      app.get(SignatureMonitorJob, { strict: false }).definition(),
    ];
    const db = app.get<Kysely<Database>>(DATABASE, { strict: false });
    const clock = app.get<Clock>(CLOCK, { strict: false });
    const tasks: BackgroundTask[] = [healthTask(wiring.healthFile ?? DEFAULT_HEALTH_FILE, config.email.transport, () => clock.now())];

    // EVM-044: the scan of uploaded files runs only with BOTH the storage and the scanner configured; otherwise no file ever becomes clean (fail closed)
    const mediaScan = app.get(MediaScanService, { strict: false });
    if (mediaScan.enabled) tasks.push({ start: () => mediaScan.start(wiring.mediaScanIntervalMs) });
    else
      logger.warn(
        { job: 'media.scan' },
        'worker: the media scan is off (storage or scanner not configured); uploaded files wait in the state uploaded',
      );

    if (config.email.transport === 'smtp') {
      const sender = wiring.createEmailSender?.(config.email) ?? new SmtpEmailSender(config.email);
      const composers = [
        app.get(InvitationEmailComposer, { strict: false }),
        app.get(PasswordEmailComposer, { strict: false }),
        app.get(MfaEmailComposer, { strict: false }),
        app.get(LoginSecurityEmailComposer, { strict: false }),
      ];
      jobs.push(new SendEmailJob({ db, clock, logger, sender, composers }).definition());
      const relay = new EmailRelay(db, queue, clock, logger);
      tasks.push({ start: () => relay.start(wiring.relayIntervalMs) });
      if (sender instanceof SmtpEmailSender) {
        tasks.push({
          start: () => () => {
            sender.close();
          },
        });
      }
    } else {
      // Fail closed: nothing is sent and nothing is handed to the queue; the rows stay `pending` in the outbox, the health check is red.
      logger.error({ transport: 'none' }, 'worker: the e-mail transport is none; e-mails are not sent and wait in the outbox');
    }
    return await runWorker({ queue, jobs, tasks, signals: io.signals, logger });
  } finally {
    await app.close();
  }
}
