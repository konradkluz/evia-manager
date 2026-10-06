import { sql, type Kysely } from 'kysely';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { enqueueSecurityAlert, POLL_INTERVAL_MS, SecurityAlertEmitter } from '../../src/platform/alerts/security-alerts.ts';
import { createDatabase, type Database } from '../../src/platform/database/database.ts';
import { createLogger } from '../../src/platform/logging/logger.ts';
import { FixedClock } from '../support/clock.ts';
import { LogCapture } from '../support/app.ts';
import { migratedDatabase, type MigratedDatabase } from './database.ts';

let database: MigratedDatabase;
let app: Kysely<Database>;
let logs: LogCapture;
let clock: FixedClock;
let emitter: SecurityAlertEmitter;

beforeEach(async () => {
  database = await migratedDatabase();
  app = createDatabase({ url: database.appUrl, logger: createLogger({ level: 'fatal' }), pool: { max: 2 } });
  logs = new LogCapture();
  clock = new FixedClock('2026-10-01T08:00:00Z');
  emitter = new SecurityAlertEmitter(app, createLogger({ level: 'info', destination: logs }), clock);
});

afterEach(async () => {
  vi.useRealTimers();
  await app.destroy();
  await database.close();
});

const enqueue = (trace: string) =>
  app.transaction().execute((tx) => enqueueSecurityAlert(tx, { code: 'emergency_reset', occurredAt: clock.now(), traceId: trace }));

describe('security alerts through the outbox (EVM-016 AC2; SR-LOG-07, CWE-778)', () => {
  it('EVM-016 AC2 an alert is written with the transaction of the change: a rolled back change leaves no alert', async () => {
    await expect(
      app.transaction().execute(async (tx) => {
        await enqueueSecurityAlert(tx, { code: 'emergency_reset', occurredAt: clock.now(), traceId: 'a'.repeat(32) });
        throw new Error('the change failed');
      }),
    ).rejects.toThrow('the change failed');
    expect((await sql`select 1 from platform.security_alert_outbox`.execute(database.admin)).rows).toEqual([]);
  });

  it('EVM-016 AC2 pending alerts are emitted in order of time, each once, and carry only a code and times', async () => {
    await enqueue('b'.repeat(32));
    clock.advance(1000);
    await enqueue('c'.repeat(32));
    expect(await emitter.emitPending()).toBe(2);
    expect(await emitter.emitPending()).toBe(0);
    expect(logs.entries.map((entry) => entry['alertTraceId'])).toEqual(['b'.repeat(32), 'c'.repeat(32)]);
    expect(
      logs.entries.every(
        (entry) => entry['alert'] === 'security' && entry['alertCode'] === 'emergency_reset' && entry['level'] === 'error',
      ),
    ).toBe(true);
    expect(Object.keys(logs.entries[0] ?? {}).sort()).toEqual(['alert', 'alertCode', 'alertTraceId', 'level', 'msg', 'occurredAt', 'time']);
  });

  it('EVM-016 AC2 the application role cannot rewrite or remove an alert it has emitted beyond marking it (no DELETE)', async () => {
    await enqueue('d'.repeat(32));
    await expect(sql`delete from platform.security_alert_outbox`.execute(app)).rejects.toMatchObject({ code: '42501' });
    await expect(sql`truncate platform.security_alert_outbox`.execute(app)).rejects.toMatchObject({ code: '42501' });
  });

  it('EVM-016 AC2 the API process polls the outbox on a timer and stops when asked; a failing poll is logged and retried', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    await enqueue('e'.repeat(32));
    const stop = emitter.start();
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    await vi.waitFor(() => {
      expect(logs.entries.filter((entry) => entry['alert'] === 'security')).toHaveLength(1);
    });
    await enqueue('f'.repeat(32));
    stop();
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 3);
    expect(logs.entries.filter((entry) => entry['alert'] === 'security')).toHaveLength(1);

    const broken = new SecurityAlertEmitter(
      { transaction: () => ({ execute: () => Promise.reject(new Error('database down')) }) } as unknown as Kysely<Database>,
      createLogger({ level: 'info', destination: logs }),
      clock,
    );
    const stopBroken = broken.start(1000);
    await vi.advanceTimersByTimeAsync(2500);
    stopBroken();
    const failures = logs.entries.filter((entry) => entry['msg'] === 'security alert emission failed; will retry');
    expect(failures.length).toBeGreaterThanOrEqual(2);
    expect(failures[0]).toMatchObject({ level: 'warn' });
  });
});

describe('the running API process emits alerts (EVM-016 AC2)', () => {
  it('EVM-016 AC2 an alert in the outbox reaches the log of the API process through createApiApp, with no manual emitPending()', async () => {
    const { createApiApp } = await import('../../src/app.ts');
    const { loadConfig } = await import('../../src/platform/config/config.ts');
    const { validEnv } = await import('../support/app.ts');
    await enqueue('9'.repeat(32));
    const apiApp = await createApiApp(
      loadConfig(validEnv({ DATABASE_URL: database.appUrl })),
      createLogger({ level: 'info', destination: logs }),
      {
        alertPollMs: 20,
      },
    );
    try {
      await vi.waitFor(() => {
        expect(logs.entries.filter((entry) => entry['alert'] === 'security' && entry['alertTraceId'] === '9'.repeat(32))).toHaveLength(1);
      });
    } finally {
      await apiApp.close();
    }
  });
});
