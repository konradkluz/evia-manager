import { sql, type Kysely } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDatabase, type Database } from '../../src/platform/database/database.ts';
import { ProblemException } from '../../src/platform/http/problem.ts';
import {
  IDEMPOTENCY_MISMATCH_METRIC,
  IDEMPOTENCY_RETENTION_MS,
  PgIdempotency,
  type IdempotencyRequest,
  type StoredResult,
} from '../../src/platform/idempotency/idempotency.ts';
import { createLogger } from '../../src/platform/logging/logger.ts';
import { MetricsRegistry } from '../../src/platform/metrics/metrics.ts';
import { FixedClock } from '../support/clock.ts';
import { migratedDatabase, type MigratedDatabase } from './database.ts';

let database: MigratedDatabase;
let app: Kysely<Database>;
let metrics: MetricsRegistry;
let idempotency: PgIdempotency;
const clock = new FixedClock('2026-10-07T08:00:00Z');

beforeAll(async () => {
  database = await migratedDatabase();
  // the role of the application: the grants of the migration are what the port really has
  app = createDatabase({ url: database.appUrl, logger: createLogger({ level: 'fatal' }), pool: { max: 4 } });
});
afterAll(async () => {
  await app.destroy();
  await database.close();
});
beforeEach(async () => {
  await sql`truncate platform.idempotency_records`.execute(database.admin);
  clock.set('2026-10-07T08:00:00Z');
  metrics = new MetricsRegistry();
  idempotency = new PgIdempotency(clock, metrics);
});

const USER = '0198b0a0-0000-7000-8000-00000000a001';
const OTHER_USER = '0198b0a0-0000-7000-8000-00000000a002';
const DEVICE = '0198b0a0-0000-7000-8000-00000000d001';
const KEY = '0198b0a0-0000-7000-8000-00000000c001';
const RESOURCE = '0198b0a0-0000-7000-8000-00000000e001';
const request = (overrides: Partial<IdempotencyRequest> = {}): IdempotencyRequest => ({
  userId: USER,
  deviceId: null,
  key: KEY,
  scope: 'POST /api/v1/customers',
  bodyHash: 'a'.repeat(64),
  ...overrides,
});
const created: StoredResult = { status: 201, code: 'created', resourceId: RESOURCE };
const run = (req: IdempotencyRequest, operation: () => Promise<{ value: string; result: StoredResult }>) =>
  app.transaction().execute((tx) => idempotency.run(tx, req, operation));
const counter = (name: string) => metrics.snapshot().find((sample) => sample.name === name)?.value ?? 0;
const count = async () =>
  Number((await sql<{ n: string }>`select count(*)::text as n from platform.idempotency_records`.execute(database.admin)).rows[0]?.n);
const problemOf = async (promise: Promise<unknown>): Promise<ProblemException> => {
  const error = await promise.then(
    () => undefined,
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(ProblemException);
  return error as ProblemException;
};

describe('idempotency port (EVM-020 AC4; SR-API-05, AB-09)', () => {
  it('EVM-020 AC4 the first call runs the operation and stores the minimal result; a repeat returns it and does NOT run the operation again', async () => {
    let calls = 0;
    const operation = () => {
      calls += 1;
      return Promise.resolve({ value: 'first', result: created });
    };
    expect(await run(request(), operation)).toEqual({ replayed: false, value: 'first', result: created });
    expect(await run(request(), operation)).toEqual({ replayed: true, result: created });
    expect(calls).toBe(1);
    const { rows } = await sql<Record<string, unknown>>`
      select user_id, device_id, idempotency_key, scope, request_hash, result_status, result_code, result_resource_id, expires_at
      from platform.idempotency_records`.execute(database.admin);
    expect(rows).toEqual([
      {
        user_id: USER,
        device_id: null,
        idempotency_key: KEY,
        scope: 'POST /api/v1/customers',
        request_hash: 'a'.repeat(64),
        result_status: 201,
        result_code: 'created',
        result_resource_id: RESOURCE,
        expires_at: new Date(clock.now().getTime() + IDEMPOTENCY_RETENTION_MS),
      },
    ]);
  });

  it('EVM-020 AC4 the same key with another body is 422 idempotency_mismatch and counted; so is the same key on another operation', async () => {
    await run(request(), () => Promise.resolve({ value: 'first', result: created }));
    const body = await problemOf(run(request({ bodyHash: 'b'.repeat(64) }), () => Promise.resolve({ value: 'x', result: created })));
    expect(body.code).toBe('idempotency_mismatch');
    const scope = await problemOf(run(request({ scope: 'POST /api/v1/other' }), () => Promise.resolve({ value: 'x', result: created })));
    expect(scope.code).toBe('idempotency_mismatch');
    expect(counter(IDEMPOTENCY_MISMATCH_METRIC)).toBe(2);
    expect(await count()).toBe(1);
  });

  it('EVM-020 AC4 the key belongs to the user: another user with the same key runs the operation anew and never gets the result of the first', async () => {
    await run(request(), () => Promise.resolve({ value: 'alice', result: created }));
    const other = { ...created, resourceId: '0198b0a0-0000-7000-8000-00000000e002' };
    expect(await run(request({ userId: OTHER_USER }), () => Promise.resolve({ value: 'bob', result: other }))).toEqual({
      replayed: false,
      value: 'bob',
      result: other,
    });
    expect(await count()).toBe(2);
  });

  it('EVM-020 AC4 the device is part of the key: a web key (no device) and a key of a device are two records', async () => {
    await run(request(), () => Promise.resolve({ value: 'web', result: created }));
    expect((await run(request({ deviceId: DEVICE }), () => Promise.resolve({ value: 'phone', result: created }))).replayed).toBe(false);
    expect((await run(request({ deviceId: DEVICE }), () => Promise.resolve({ value: 'again', result: created }))).replayed).toBe(true);
    expect((await run(request(), () => Promise.resolve({ value: 'again', result: created }))).replayed).toBe(true);
    expect(await count()).toBe(2);
  });

  it('EVM-020 AC4 a parallel request with the same key is 409 idempotency_in_progress with Retry-After 1 — it does not wait; after the first commits it is a repeat', async () => {
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let entered: () => void = () => undefined;
    const inside = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const first = run(request(), async () => {
      entered();
      await held;
      return { value: 'first', result: created };
    });
    await inside;
    const refused = await problemOf(run(request(), () => Promise.resolve({ value: 'second', result: created })));
    expect(refused.code).toBe('idempotency_in_progress');
    expect(refused.extras.retryAfterSeconds).toBe(1);
    expect(counter('idempotency_in_progress')).toBe(1);
    release();
    expect((await first).replayed).toBe(false);
    expect(await run(request(), () => Promise.resolve({ value: 'third', result: created }))).toEqual({ replayed: true, result: created });
  });

  it('EVM-020 AC4 a failed operation stores nothing: the transaction rolls back, the key stays free and the retry runs', async () => {
    await expect(run(request(), () => Promise.reject(new ProblemException('id_conflict')))).rejects.toMatchObject({ code: 'id_conflict' });
    expect(await count()).toBe(0);
    expect((await run(request(), () => Promise.resolve({ value: 'retry', result: created }))).replayed).toBe(false);
    expect(await count()).toBe(1);
  });

  it('EVM-020 AC4 an expired record (30 days) is not a repeat: the operation runs and the record is overwritten, not duplicated', async () => {
    await run(request(), () => Promise.resolve({ value: 'old', result: created }));
    clock.advance(IDEMPOTENCY_RETENTION_MS + 1);
    const fresh: StoredResult = { status: 201, code: 'created', resourceId: '0198b0a0-0000-7000-8000-00000000e003' };
    expect(await run(request({ bodyHash: 'c'.repeat(64) }), () => Promise.resolve({ value: 'new', result: fresh }))).toEqual({
      replayed: false,
      value: 'new',
      result: fresh,
    });
    expect(await count()).toBe(1);
    expect(await run(request({ bodyHash: 'c'.repeat(64) }), () => Promise.resolve({ value: 'x', result: fresh }))).toEqual({
      replayed: true,
      result: fresh,
    });
  });
});
