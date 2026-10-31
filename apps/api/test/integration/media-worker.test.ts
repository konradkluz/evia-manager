import { randomBytes } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PgBossJobQueue } from '../../src/platform/jobs/pg-boss-job-queue.ts';
import { runWorkerFromProcess } from '../../src/worker/worker-process.ts';
import { validEnv } from '../support/app.ts';
import { migratedDatabase, type MigratedDatabase } from './database.ts';

let database: MigratedDatabase;
beforeAll(async () => {
  database = await migratedDatabase();
});
afterAll(async () => {
  await database.close();
});

const MEDIA = {
  S3_ENDPOINT: 'http://127.0.0.1:9',
  S3_REGION: 'us-east-1',
  MEDIA_BUCKET: 'evia-test-media',
  MEDIA_S3_ACCESS_KEY_ID: 'SYNTHETICKEY0001',
  MEDIA_S3_SECRET_ACCESS_KEY: 'synthetic-secret-value',
};

/** The worker as it runs, stopped by a signal as soon as it says it is ready. */
async function runUntilReady(env: Record<string, string | undefined>): Promise<Array<Record<string, unknown>>> {
  const stdout = new PassThrough();
  const text: string[] = [];
  stdout.on('data', (chunk: Buffer) => text.push(chunk.toString('utf8')));
  const signals = new EventEmitter();
  const exit = runWorkerFromProcess(
    validEnv({ DATABASE_URL: database.appUrl, LOG_LEVEL: 'info', EMAIL_TRANSPORT: 'none', ...env }),
    { stdout, signals },
    {
      healthFile: join(tmpdir(), `worker-media-health-${String(process.pid)}`),
      mediaScanIntervalMs: 60_000,
      createQueue: (connectionString, logger) =>
        new PgBossJobQueue({ connectionString, logger, retryDelaySeconds: 0, pollingIntervalSeconds: 0.5 }),
    },
  );
  const lines = () =>
    text
      .join('')
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Record<string, unknown>);
  for (let attempt = 0; attempt < 300 && !lines().some((line) => line['msg'] === 'worker: ready'); attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  signals.emit('SIGTERM');
  expect(await exit).toBe(0);
  return lines();
}

const isOff = (line: Record<string, unknown>): boolean => String(line['msg']).includes('the media scan is off');

describe('EVM-044 AC3 the worker scans only with both the storage and the scanner configured (P5, SR-FILE-05)', () => {
  it('EVM-044 AC3 without the media configuration the worker starts, says the scan is off, and nothing is scanned', async () => {
    const lines = await runUntilReady({});
    expect(lines.some(isOff)).toBe(true);
    expect(lines.some((line) => line['msg'] === 'worker: ready')).toBe(true);
  }, 60_000);

  it('EVM-044 AC3 with the storage but without clamd the scan is still off (no file becomes clean without a scanner)', async () => {
    expect((await runUntilReady(MEDIA)).some(isOff)).toBe(true);
  }, 60_000);

  it('EVM-044 AC3 with the storage and clamd the scan loop starts and stops with the worker', async () => {
    const lines = await runUntilReady({ ...MEDIA, CLAMD_SOCKET: 'tcp://127.0.0.1:9' });
    expect(lines.some(isOff)).toBe(false);
    expect(lines.some((line) => line['msg'] === 'worker: ready')).toBe(true);
  }, 60_000);
});

const PROCESSOR = { MEDIA_PROCESSOR_SOCKET: '/tmp/evia-test-processor/p.sock', MEDIA_PROCESSOR_WORKDIR: '/tmp/evia-test-processor' };
const processOff = (line: Record<string, unknown>): boolean => String(line['msg']).includes('the making of derivatives is off');

describe('EVM-068 AC1 the worker makes derivatives only with the storage and the processor configured (fail fast in production)', () => {
  it('EVM-068 AC1 outside production a worker with the scan but without the processor starts and says the derivatives are off', async () => {
    const lines = await runUntilReady({ ...MEDIA, CLAMD_SOCKET: 'tcp://127.0.0.1:9' });
    expect(lines.some(processOff)).toBe(true);
    expect(lines.some((line) => line['msg'] === 'worker: ready')).toBe(true);
  }, 60_000);

  it('EVM-068 AC1 with the processor settings the loop starts and stops with the worker', async () => {
    const lines = await runUntilReady({ ...MEDIA, CLAMD_SOCKET: 'tcp://127.0.0.1:9', ...PROCESSOR });
    expect(lines.some(processOff)).toBe(false);
    expect(lines.some((line) => line['msg'] === 'worker: ready')).toBe(true);
  }, 60_000);

  it('EVM-068 AC1 in production a worker that scans but has no processor refuses to start (no silent skipping)', async () => {
    const production = (extra: Record<string, string>) =>
      runWorkerFromProcess(
        validEnv({
          NODE_ENV: 'production',
          DATABASE_URL: database.appUrl,
          CURSOR_KEY: randomBytes(32).toString('base64url'), // generated per run, never committed
          LOGIN_THROTTLE_KEY: randomBytes(32).toString('base64url'),
          EMAIL_TRANSPORT: 'none',
          ...MEDIA,
          CLAMD_SOCKET: 'tcp://127.0.0.1:9',
          ...extra,
        }),
        { stdout: new PassThrough(), signals: new EventEmitter() },
        { healthFile: join(tmpdir(), `worker-media-health-prod-${String(process.pid)}`) },
      );
    await expect(production({})).rejects.toThrow('MEDIA_PROCESSOR_SOCKET');
  }, 60_000);
});
