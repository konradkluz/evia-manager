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
