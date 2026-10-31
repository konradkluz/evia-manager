/**
 * The wiring of the server command of the read model to a process (ADR-0017 W11; EVM-034): the environment and the application
 * context (the same modules as the API, NO HTTP server — nothing listens). The streams are parameters, so the whole command — real
 * database, real recomputation — is exercised by the integration tests.
 */
import 'reflect-metadata';
import type { Writable } from 'node:stream';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module.ts';
import { ProjectionMaintenance } from '../modules/overview/index.ts';
import { loadConfig } from '../platform/config/config.ts';
import { newTraceId } from '../platform/http/request-context.ts';
import { WORKER_POOL_SETTINGS } from '../platform/database/database.ts';
import { createLogger } from '../platform/logging/logger.ts';
import { NestLoggerAdapter } from '../platform/logging/nest-logger.ts';
import { executeOverviewCommand } from './overview-run.ts';

export interface OverviewStreams {
  readonly stdout: Writable;
  readonly stderr: Writable;
}

/** @returns the exit code of the command */
export async function runOverviewFromProcess(
  argv: readonly string[],
  env: Readonly<Record<string, string | undefined>>,
  streams: OverviewStreams,
): Promise<number> {
  const config = loadConfig(env);
  // The log is structured and goes to stderr; the report goes to stdout (it holds numbers and identifiers of orders only).
  const logger = createLogger({ level: config.logLevel, destination: streams.stderr });
  const app = await NestFactory.createApplicationContext(AppModule.register({ config, logger, pool: WORKER_POOL_SETTINGS }), {
    logger: new NestLoggerAdapter(logger),
  });
  try {
    return await executeOverviewCommand(
      argv,
      {
        write: (text) => {
          streams.stdout.write(text);
        },
      },
      { maintenance: app.get(ProjectionMaintenance, { strict: false }), logger, traceId: newTraceId() },
    );
  } finally {
    await app.close();
  }
}
