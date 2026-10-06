/**
 * The wiring of the server command to a process (EVM-016 AC1, AC2): the environment, the application context (the same
 * modules as the API, no HTTP server) and the readline terminal. The streams are parameters, so the whole command — real
 * database, real use case, real prompts — is exercised by the integration tests with in-memory streams.
 */
import 'reflect-metadata';
import { createInterface } from 'node:readline/promises';
import type { Readable, Writable } from 'node:stream';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module.ts';
import { AdministratorBootstrap, EMERGENCY_REASONS } from '../modules/identity/index.ts';
import { loadConfig } from '../platform/config/config.ts';
import { createLogger } from '../platform/logging/logger.ts';
import { NestLoggerAdapter } from '../platform/logging/nest-logger.ts';
import { parseArguments } from './args.ts';
import { EXIT_USAGE, executeBootstrap, type TerminalIo } from './run.ts';

export interface ProcessStreams {
  readonly stdin: Readable;
  readonly stdout: Writable & { readonly isTTY?: boolean };
  readonly stderr: Writable;
}

/** @returns the exit code of the command */
export async function runFromProcess(
  argv: readonly string[],
  env: Readonly<Record<string, string | undefined>>,
  streams: ProcessStreams,
): Promise<number> {
  const parsed = parseArguments(argv, EMERGENCY_REASONS);
  if (!parsed.ok) {
    streams.stdout.write(`${parsed.message}\n`);
    return EXIT_USAGE;
  }
  const config = loadConfig(env);
  // Whatever the application logs goes to stderr of the terminal and only from warn up; the link is never logged.
  const logger = createLogger({ level: 'warn', destination: streams.stderr });
  const app = await NestFactory.createApplicationContext(AppModule.register({ config, logger }), { logger: new NestLoggerAdapter(logger) });
  const terminal = createInterface({ input: streams.stdin, output: streams.stdout, terminal: streams.stdout.isTTY === true });
  try {
    const io: TerminalIo = {
      question: (prompt) => terminal.question(prompt),
      write: (text) => {
        streams.stdout.write(text);
      },
    };
    return await executeBootstrap(argv, io, {
      bootstrap: app.get(AdministratorBootstrap, { strict: false }),
      panelOrigin: config.panelOrigin,
    });
  } finally {
    terminal.close();
    await app.close();
  }
}
