/**
 * The whole worker process as it runs, for the integration tests (EVM-024): real wiring, the real queue as the application role, the real SMTP adapter,
 * in-memory streams and signals. The streams of the process are collected so a test can search them for what must never be logged.
 */
import { EventEmitter } from 'node:events';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { PgBossJobQueue } from '../../src/platform/jobs/pg-boss-job-queue.ts';
import { runWorkerFromProcess, type WorkerWiring } from '../../src/worker/worker-process.ts';
import { validEnv } from './app.ts';

export interface StartedWorker {
  readonly signals: EventEmitter;
  readonly healthFile: string;
  readonly lines: () => Array<Record<string, unknown>>;
  readonly text: () => string;
  readonly exit: Promise<number>;
  stop(): Promise<number>;
}

let counter = 0;

export function startWorker(env: Record<string, string | undefined>, wiring: WorkerWiring = {}): StartedWorker {
  counter += 1;
  const stdout = new PassThrough();
  const chunks: string[] = [];
  stdout.on('data', (chunk: Buffer) => chunks.push(chunk.toString('utf8')));
  const signals = new EventEmitter();
  const healthFile = join(tmpdir(), `worker-health-${String(process.pid)}-${String(counter)}`);
  const exit = runWorkerFromProcess(
    validEnv({ LOG_LEVEL: 'info', ...env }),
    { stdout, signals },
    {
      healthFile,
      relayIntervalMs: 100,
      createQueue: (connectionString, logger) =>
        new PgBossJobQueue({ connectionString, logger, retryDelaySeconds: 0, pollingIntervalSeconds: 0.5 }),
      ...wiring,
    },
  );
  const text = () => chunks.join('');
  return {
    signals,
    healthFile,
    text,
    lines: () =>
      text()
        .split(String.fromCharCode(10))
        .filter(Boolean)
        .map((line) => JSON.parse(line) as Record<string, unknown>),
    exit,
    stop: () => {
      signals.emit('SIGTERM');
      return exit;
    },
  };
}

export async function until<T>(read: () => Promise<T | undefined> | T | undefined, what: string, timeoutMs = 30_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await read();
    if (value !== undefined) return value;
    if (Date.now() > deadline) throw new Error(`timeout: ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}
