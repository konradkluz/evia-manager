import { readFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  DeletionRegisterUnavailable,
  type DeletionRecord,
  type DeletionRegister,
} from '../../src/platform/deletion-register/deletion-register.ts';
import { deletionRegisterFor, REGISTER_FAILURES_METRIC } from '../../src/platform/deletion-register/deletion-register-factory.ts';
import {
  resolveDeletionRegisterSettings,
  type ConfiguredDeletionRegister,
  type DeletionRegisterSettings,
} from '../../src/platform/deletion-register/deletion-register-settings.ts';
import { InMemoryDeletionRegister } from '../../src/platform/deletion-register/in-memory-deletion-register.ts';
import { registerObjectOf } from '../../src/platform/deletion-register/register-object.ts';
import { S3DeletionRegister } from '../../src/platform/deletion-register/s3-deletion-register.ts';
import { UnavailableDeletionRegister } from '../../src/platform/deletion-register/unavailable-deletion-register.ts';
import { createLogger } from '../../src/platform/logging/logger.ts';
import { MetricsRegistry } from '../../src/platform/metrics/metrics.ts';
import { LogCapture } from '../support/app.ts';
import { FixedClock } from '../support/clock.ts';

const NOW = '2026-10-03T22:30:00.000Z';
const CANARY = 'CANARY-TRESC-NUMER-DOWODU-ABC123456';
const SECRET = ['canary', 'value', 'for', 'tests'].join('-');
const ACCESS_KEY = ['SCW', 'ACCESS', 'CANARY'].join('');
const record: DeletionRecord = {
  operationCode: 'timeline_entry_redacted',
  subjectType: 'timeline_entry',
  subjectId: '0199aaaa-0000-7000-8000-000000000001',
  workOrderId: '0199aaaa-0000-7000-8000-000000000002',
  actorUserId: '0199aaaa-0000-7000-8000-000000000003',
};
const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

interface Seen {
  readonly method: string;
  readonly url: string;
  readonly headers: IncomingMessage['headers'];
  readonly body: string;
}

/** A local S3: records every request; `mode` decides the answer. Loopback only. */
class FakeStorage {
  readonly seen: Seen[] = [];
  mode: 'ok' | 'error' | 'hang' = 'ok';
  readonly #server: Server;

  constructor() {
    this.#server = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on('data', (chunk: Buffer) => chunks.push(chunk));
      request.on('end', () => {
        this.seen.push({
          method: request.method ?? '',
          url: (request.url ?? '').replace(/\?x-id=PutObject$/, ''),
          headers: request.headers,
          body: Buffer.concat(chunks).toString('utf8'),
        });
        if (this.mode === 'hang') return;
        response.statusCode = this.mode === 'ok' ? 200 : 500;
        response.setHeader('ETag', '"abc"');
        response.end(this.mode === 'ok' ? '' : `<Error><Message>${CANARY}</Message></Error>`);
      });
    });
  }

  async listen(): Promise<string> {
    await new Promise<void>((resolve) => this.#server.listen(0, '127.0.0.1', resolve));
    return `http://127.0.0.1:${(this.#server.address() as AddressInfo).port}`;
  }

  close(): Promise<void> {
    this.#server.closeAllConnections();
    return new Promise((resolve) =>
      this.#server.close(() => {
        resolve();
      }),
    );
  }
}

const settingsFor = (endpoint: string): ConfiguredDeletionRegister => ({
  status: 'configured',
  endpoint,
  region: 'pl-waw',
  bucket: 'evia-test-deletion-register',
  accessKeyId: ACCESS_KEY,
  secretAccessKey: SECRET,
});

describe('EVM-040 AC3 the object of a record (SR-PRIV-04): identifiers and codes, nothing else', () => {
  it('EVM-040 AC3 the key is <year>/<operationId>.json from a server UUIDv7 and the body holds exactly the fields of the contract', () => {
    const object = registerObjectOf(record, new Date(NOW));
    expect(object.operationId).toMatch(UUID_V7);
    expect(object.key).toBe(`2026/${object.operationId}.json`);
    expect(JSON.parse(object.body)).toEqual({
      schemaVersion: 1,
      operationId: object.operationId,
      operationCode: 'timeline_entry_redacted',
      subjectType: 'timeline_entry',
      subjectId: record.subjectId,
      workOrderId: record.workOrderId,
      actorUserId: record.actorUserId,
      occurredAt: NOW,
    });
  });

  it('EVM-040 AC3 the year of the key is the year in UTC (the turn of the year in Warsaw does not move it) and a subject outside an order has no workOrderId', () => {
    const object = registerObjectOf({ ...record, workOrderId: null }, new Date('2026-12-31T23:30:00.000Z'));
    expect(object.key.startsWith('2026/')).toBe(true);
    expect(JSON.parse(object.body)).not.toHaveProperty('workOrderId');
  });

  it('EVM-040 AC3 every record gets a new key (the identifier is made by the server, never repeated)', () => {
    const keys = new Set(Array.from({ length: 50 }, () => registerObjectOf(record, new Date(NOW)).key));
    expect(keys.size).toBe(50);
  });
});

/** One contract of the port, run against every implementation (EVM-040 AC3). */
function portContract(
  name: string,
  make: () => Promise<{ register: DeletionRegister; objects: () => Array<{ key: string; body: string }> }>,
) {
  describe(`the port DeletionRegister - ${name}`, () => {
    it('EVM-040 AC3 record() writes ONE new object with the identifiers, the code and the time - no text', async () => {
      const { register, objects } = await make();
      const receipt = await register.record(record);
      expect(receipt.operationId).toMatch(UUID_V7);
      const written = objects();
      expect(written).toHaveLength(1);
      expect(written[0]?.key).toBe(receipt.key);
      const body = JSON.parse(written[0]?.body ?? '{}') as Record<string, unknown>;
      expect(Object.keys(body).sort()).toEqual(
        ['actorUserId', 'occurredAt', 'operationCode', 'operationId', 'schemaVersion', 'subjectId', 'subjectType', 'workOrderId'].sort(),
      );
      expect(written[0]?.body).not.toContain(CANARY);
    });
  });
}

portContract('in memory', () => {
  const register = new InMemoryDeletionRegister(new FixedClock(NOW));
  return Promise.resolve({ register, objects: () => register.objects.map((object) => ({ key: object.key, body: object.body })) });
});

describe('the in-memory register and the register that refuses (EVM-040 AC3)', () => {
  it('EVM-040 AC3 the in-memory register can be made unavailable and recovers; the calls are listed even when refused', async () => {
    const register = new InMemoryDeletionRegister(new FixedClock(NOW));
    register.failAll();
    await expect(register.record(record)).rejects.toBeInstanceOf(DeletionRegisterUnavailable);
    register.recover();
    await register.record(record);
    expect(register.calls).toHaveLength(2);
    expect(register.objects).toHaveLength(1);
  });

  it('EVM-040 AC3 the register of an installation that is not configured refuses every record and counts it', async () => {
    const metrics = new MetricsRegistry();
    const register: DeletionRegister = new UnavailableDeletionRegister(metrics.counter(REGISTER_FAILURES_METRIC, ['reason']));
    await expect(register.record(record)).rejects.toMatchObject({ name: 'DeletionRegisterUnavailable', reason: 'not_configured' });
    expect(metrics.snapshot()).toEqual([{ name: REGISTER_FAILURES_METRIC, labels: { reason: 'not_configured' }, value: 1 }]);
  });
});

describe('the S3 adapter against a local server (EVM-040 AC3; SR-PRIV-04, SR-CRYPTO-04)', () => {
  let storage: FakeStorage;
  let endpoint: string;
  let logs: LogCapture;
  let metrics: MetricsRegistry;
  const adapter = (deadlineMs?: number) =>
    new S3DeletionRegister(
      settingsFor(endpoint),
      new FixedClock(NOW),
      createLogger({ level: 'debug', destination: logs }),
      metrics.counter(REGISTER_FAILURES_METRIC, ['reason']),
      deadlineMs,
    );
  beforeEach(async () => {
    storage = new FakeStorage();
    endpoint = await storage.listen();
    logs = new LogCapture();
    metrics = new MetricsRegistry();
  });
  afterEach(async () => {
    await storage.close();
  });

  portContract('S3 (node:http)', () => {
    return Promise.resolve({
      register: adapter(),
      objects: () => storage.seen.map((seen) => ({ key: seen.url.replace(/^\/[^/]+\//, ''), body: seen.body })),
    });
  });

  it('EVM-040 AC3 it sends ONE PUT: path-style bucket and key, SigV4 with the explicit key, JSON content type, no ACL and no metadata headers', async () => {
    const receipt = await adapter().record(record);
    expect(storage.seen).toHaveLength(1);
    const [seen] = storage.seen;
    expect(seen?.method).toBe('PUT');
    expect(seen?.url).toBe(`/evia-test-deletion-register/${receipt.key}`);
    expect(seen?.headers['content-type']).toBe('application/json');
    expect(String(seen?.headers['authorization'])).toMatch(/^AWS4-HMAC-SHA256 Credential=SCWACCESSCANARY\/\d{8}\/pl-waw\/s3\/aws4_request/);
    expect(seen?.headers['x-amz-acl']).toBeUndefined();
    expect(Object.keys(seen?.headers ?? {}).filter((header) => header.startsWith('x-amz-meta-'))).toEqual([]);
    expect(seen?.headers['if-none-match']).toBeUndefined();
    expect(seen?.headers['x-amz-checksum-crc32']).toBeUndefined();
    expect(JSON.parse(seen?.body ?? '{}')).toMatchObject({ operationId: receipt.operationId, subjectId: record.subjectId });
  });

  it('EVM-040 AC3 the credentials are the explicit ones: AWS_ACCESS_KEY_ID of the environment is ignored', async () => {
    const before = { id: process.env['AWS_ACCESS_KEY_ID'], secret: process.env['AWS_SECRET_ACCESS_KEY'] };
    process.env['AWS_ACCESS_KEY_ID'] = 'AKIAENVIRONMENTCANARY';
    process.env['AWS_SECRET_ACCESS_KEY'] = 'environment-secret-canary';
    try {
      await adapter().record(record);
    } finally {
      if (before.id === undefined) delete process.env['AWS_ACCESS_KEY_ID'];
      else process.env['AWS_ACCESS_KEY_ID'] = before.id;
      if (before.secret === undefined) delete process.env['AWS_SECRET_ACCESS_KEY'];
      else process.env['AWS_SECRET_ACCESS_KEY'] = before.secret;
    }
    const authorization = String(storage.seen[0]?.headers['authorization']);
    expect(authorization).toContain(`Credential=${ACCESS_KEY}/`);
    expect(authorization).not.toContain('ENVIRONMENTCANARY');
  });

  it('EVM-040 AC3 a 5xx answer is DeletionRegisterUnavailable; neither the answer of the storage nor a secret reaches the log; the failure is counted', async () => {
    storage.mode = 'error';
    await expect(adapter().record(record)).rejects.toMatchObject({ name: 'DeletionRegisterUnavailable', reason: 'write_failed' });
    expect(metrics.snapshot()).toEqual([{ name: REGISTER_FAILURES_METRIC, labels: { reason: 'write_failed' }, value: 1 }]);
    expect(logs.text).toContain('deletion register write failed');
    for (const forbidden of [CANARY, SECRET, ACCESS_KEY, 'Authorization']) expect(logs.text).not.toContain(forbidden);
    expect(storage.seen.length).toBeLessThanOrEqual(2);
  });

  it('EVM-040 AC3 no answer within the deadline is DeletionRegisterUnavailable', async () => {
    storage.mode = 'hang';
    const started = Date.now();
    await expect(adapter(300).record(record)).rejects.toBeInstanceOf(DeletionRegisterUnavailable);
    expect(Date.now() - started).toBeLessThan(3000);
  });

  it('EVM-040 AC3 a server that is not there is DeletionRegisterUnavailable', async () => {
    await storage.close();
    await expect(adapter(2000).record(record)).rejects.toBeInstanceOf(DeletionRegisterUnavailable);
    storage = new FakeStorage();
    endpoint = await storage.listen();
  });

  it('EVM-040 AC3 the adapter asks for nothing but PutObject: no read, list, head or delete - in the code and on the wire', async () => {
    await adapter().record(record);
    expect(storage.seen.map((seen) => seen.method)).toEqual(['PUT']);
    const source = readFileSync(new URL('../../src/platform/deletion-register/s3-deletion-register.ts', import.meta.url), 'utf8');
    expect([...new Set([...source.matchAll(/\b(\w+Command)\b/g)].map((match) => match[1]))]).toEqual(['PutObjectCommand']);
    expect(source).not.toMatch(/GetObject|ListObjects|DeleteObject|HeadObject|HeadBucket|ListBuckets/);
  });
});

describe('the settings of the register (EVM-040 AC3; SR-CRYPTO-04): all or nothing, never a stop', () => {
  const all = {
    S3_ENDPOINT: 'https://s3.pl-waw.scw.cloud',
    S3_REGION: 'pl-waw',
    DELETION_REGISTER_BUCKET: 'evia-staging-deletion-register',
    DELETION_REGISTER_S3_ACCESS_KEY_ID: ACCESS_KEY,
    DELETION_REGISTER_S3_SECRET_ACCESS_KEY: SECRET,
  };

  it('EVM-040 AC3 all five well formed settings are a configured register', () => {
    expect(resolveDeletionRegisterSettings(all, 'production')).toMatchObject({
      status: 'configured',
      bucket: 'evia-staging-deletion-register',
    });
  });

  it('EVM-040 AC3 none is "unconfigured"; empty strings count as absent', () => {
    expect(resolveDeletionRegisterSettings({}, 'production')).toEqual({ status: 'unconfigured' });
    expect(resolveDeletionRegisterSettings({ S3_ENDPOINT: '', DELETION_REGISTER_BUCKET: '' }, 'production')).toEqual({
      status: 'unconfigured',
    });
  });

  it('EVM-040 AC3 a partial set is "incomplete" and names the missing keys only', () => {
    const partial = { S3_ENDPOINT: all.S3_ENDPOINT, S3_REGION: all.S3_REGION };
    expect(resolveDeletionRegisterSettings(partial, 'production')).toEqual({
      status: 'incomplete',
      missing: ['DELETION_REGISTER_BUCKET', 'DELETION_REGISTER_S3_ACCESS_KEY_ID', 'DELETION_REGISTER_S3_SECRET_ACCESS_KEY'],
      invalid: [],
    });
  });

  it('EVM-040 AC3 a malformed value is "invalid": http outside loopback, credentials in the URL, a bad bucket or region, a short secret', () => {
    const invalidKeys = (override: Record<string, string>, env = 'production') => {
      const result = resolveDeletionRegisterSettings({ ...all, ...override }, env) as Extract<
        DeletionRegisterSettings,
        { status: 'incomplete' }
      >;
      return result.invalid;
    };
    expect(invalidKeys({ S3_ENDPOINT: 'http://s3.example.invalid' })).toEqual(['S3_ENDPOINT']);
    expect(invalidKeys({ S3_ENDPOINT: 'http://127.0.0.1:9000' })).toEqual(['S3_ENDPOINT']);
    expect(invalidKeys({ S3_ENDPOINT: 'https://user:pass@s3.example.invalid' })).toEqual(['S3_ENDPOINT']);
    expect(invalidKeys({ S3_ENDPOINT: 'https://s3.example.invalid/?x=1' })).toEqual(['S3_ENDPOINT']);
    expect(invalidKeys({ S3_ENDPOINT: 'not a url' })).toEqual(['S3_ENDPOINT']);
    expect(invalidKeys({ S3_REGION: 'PL WAW' })).toEqual(['S3_REGION']);
    expect(invalidKeys({ DELETION_REGISTER_BUCKET: 'Bad_Bucket' })).toEqual(['DELETION_REGISTER_BUCKET']);
    expect(invalidKeys({ DELETION_REGISTER_S3_SECRET_ACCESS_KEY: 'short' })).toEqual(['DELETION_REGISTER_S3_SECRET_ACCESS_KEY']);
    expect(invalidKeys({ DELETION_REGISTER_S3_ACCESS_KEY_ID: 'has space' })).toEqual(['DELETION_REGISTER_S3_ACCESS_KEY_ID']);
  });

  it('EVM-040 AC3 http is accepted for the loopback of a machine outside production only', () => {
    const local = { ...all, S3_ENDPOINT: 'http://127.0.0.1:9000' };
    expect(resolveDeletionRegisterSettings(local, 'test').status).toBe('configured');
    expect(resolveDeletionRegisterSettings({ ...local, S3_ENDPOINT: 'http://localhost:9000' }, 'development').status).toBe('configured');
    expect(resolveDeletionRegisterSettings({ ...local, S3_ENDPOINT: 'http://[::1]:9000' }, 'test').status).toBe('configured');
    expect(resolveDeletionRegisterSettings(local, 'production').status).toBe('incomplete');
  });
});

describe('the choice of the adapter and the line in the log (EVM-040 AC3; SR-LOG-02)', () => {
  const run = (settings: DeletionRegisterSettings) => {
    const logs = new LogCapture();
    const register = deletionRegisterFor(
      settings,
      new FixedClock(NOW),
      createLogger({ level: 'debug', destination: logs }),
      new MetricsRegistry(),
    );
    return { register, logs };
  };

  it('EVM-040 AC3 not configured: ONE warning, and the register refuses', async () => {
    const { register, logs } = run({ status: 'unconfigured' });
    expect(logs.entries).toHaveLength(1);
    expect(logs.entries[0]).toMatchObject({ level: 'warn' });
    await expect(register.record(record)).rejects.toBeInstanceOf(DeletionRegisterUnavailable);
  });

  it('EVM-040 AC3 an incomplete set: one error that names the keys and no value; the register refuses', async () => {
    const { register, logs } = run({ status: 'incomplete', missing: ['DELETION_REGISTER_BUCKET'], invalid: ['S3_ENDPOINT'] });
    expect(logs.entries).toHaveLength(1);
    expect(logs.entries[0]).toMatchObject({ level: 'error', missing: ['DELETION_REGISTER_BUCKET'], invalid: ['S3_ENDPOINT'] });
    await expect(register.record(record)).rejects.toBeInstanceOf(DeletionRegisterUnavailable);
  });

  it('EVM-040 AC3 a configured register is the S3 adapter and writes nothing to the log at start', () => {
    const { register, logs } = run(settingsFor('https://s3.example.invalid'));
    expect(register).toBeInstanceOf(S3DeletionRegister);
    expect(logs.entries).toEqual([]);
  });

  it('EVM-040 SR-LOG-02 the access key and the secret of the register are redacted by the logger at any depth', () => {
    const logs = new LogCapture();
    createLogger({ level: 'debug', destination: logs }).info({ nested: { accessKeyId: ACCESS_KEY, secretAccessKey: SECRET } }, 'x');
    expect(logs.text).not.toContain(ACCESS_KEY);
    expect(logs.text).not.toContain(SECRET);
  });
});
