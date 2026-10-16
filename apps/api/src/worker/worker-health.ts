/**
 * The health of the worker process (EVM-024 AC6; SR-API-12): the worker has no HTTP server and the public `/api/health` does not change, so
 * the worker writes a small file in its own `tmpfs` now and then — the time and the KIND of the transport, nothing else (no address, no
 * secret, no count) — and the healthcheck of the container (`dist/src/cli/worker-health.js`) reads it. The check FAILS when the file is
 * missing or older than two minutes (the worker is stuck or down) and when the transport is `none` (fail closed: a worker that cannot
 * send mail is not healthy, so the operator sees it — the messages wait in the outbox without loss).
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { EmailConfig } from '../platform/config/config.ts';
import type { BackgroundTask } from './run-worker.ts';

export const DEFAULT_HEALTH_FILE = '/tmp/worker-health';
export const HEALTH_INTERVAL_MS = 30_000;
export const HEALTH_MAX_AGE_MS = 2 * 60_000;

interface HealthRecord {
  readonly at: string;
  readonly transport: EmailConfig['transport'];
}

export async function writeHealth(path: string, transport: EmailConfig['transport'], now: Date): Promise<void> {
  const record: HealthRecord = { at: now.toISOString(), transport };
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.tmp`;
  await writeFile(temporary, JSON.stringify(record), { encoding: 'utf8', mode: 0o600 });
  await rename(temporary, path);
}

/** @returns true when the worker wrote the file recently and its transport can send mail */
export async function isWorkerHealthy(path: string, now: Date): Promise<boolean> {
  try {
    const record = JSON.parse(await readFile(path, 'utf8')) as Partial<HealthRecord>;
    const at = typeof record.at === 'string' ? Date.parse(record.at) : Number.NaN;
    if (Number.isNaN(at) || now.getTime() - at > HEALTH_MAX_AGE_MS || at - now.getTime() > HEALTH_MAX_AGE_MS) return false;
    return record.transport === 'smtp';
  } catch {
    return false;
  }
}

/** A background task of the worker: writes the file at once and then every 30 seconds. */
export function healthTask(path: string, transport: EmailConfig['transport'], now: () => Date): BackgroundTask {
  return {
    start: () => {
      const write = (): void => {
        writeHealth(path, transport, now()).catch(() => undefined);
      };
      write();
      const timer = setInterval(write, HEALTH_INTERVAL_MS);
      timer.unref();
      return () => {
        clearInterval(timer);
      };
    },
  };
}
