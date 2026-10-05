import { describe, expect, it } from 'vitest';
import { createLogger, isSensitiveKey, REDACTED, redactSensitive, serializeError } from '../../src/platform/logging/logger.ts';
import { LogCapture } from '../support/app.ts';

/** Synthetic values that must never reach the log output (ADR-0013 list). */
const SENSITIVE: Record<string, string> = {
  authorization: 'Bearer synthetic-token-1',
  cookie: '__Host-evia_session=synthetic-session-2',
  'set-cookie': 'synthetic-cookie-3',
  password: 'synthetic-password-4',
  accessToken: 'synthetic-token-5',
  refresh_token: 'synthetic-token-6',
  mfaCode: '123456',
  otp: '654321',
  email: 'jan.przykladowy@example.invalid',
  customerEmail: 'klient@example.invalid',
  phone: '+48000000000',
  phone_number: '+48000000001',
  firstName: 'Jan',
  lastName: 'Przykładowy',
  name: 'Klient Przykładowy',
  address: 'ul. Przykładowa 1, 00-000 Przykładowo',
  fileName: 'umowa-klienta.pdf',
  signedUrl: 'https://bucket.invalid/o?X-Amz-Signature=synthetic-signature-7',
  'X-Amz-Signature': 'synthetic-signature-8',
  apiKey: 'synthetic-api-key-9',
};

function capture(level: 'info' | 'warn' = 'info') {
  const destination = new LogCapture();
  return { logger: createLogger({ level, destination }), destination };
}

describe('logger with redaction (EVM-008 AC4; ADR-0013, SR-LOG-02, SR-LOG-05)', () => {
  it('EVM-008 AC4 logger redacts sensitive fields at the top level and nested one and two levels deep', () => {
    const { logger, destination } = capture();
    logger.info({ ...SENSITIVE, request: { ...SENSITIVE, headers: { ...SENSITIVE } }, list: [{ ...SENSITIVE }] }, 'synthetic event');
    for (const value of Object.values(SENSITIVE)) expect(destination.text).not.toContain(value);
    const [entry] = destination.entries;
    expect(entry?.['email']).toBe(REDACTED);
    expect((entry?.['request'] as Record<string, Record<string, unknown>>)['headers']?.['authorization']).toBe(REDACTED);
  });

  it('EVM-008 AC4 technical identifiers stay readable', () => {
    const { logger, destination } = capture();
    logger.info({ traceId: 'a'.repeat(32), workOrderId: 'synthetic-id', status: 503, route: '/api/health', durationMs: 3 }, 'request');
    expect(destination.entries[0]).toMatchObject({
      traceId: 'a'.repeat(32),
      workOrderId: 'synthetic-id',
      status: 503,
      route: '/api/health',
    });
  });

  it('EVM-008 AC4 key matching is normalised and covers the ADR-0013 list', () => {
    for (const key of Object.keys(SENSITIVE)) expect(isSensitiveKey(key), key).toBe(true);
    for (const key of ['traceId', 'status', 'route', 'method', 'durationMs', 'workOrderId', 'userId', 'level', 'msg'])
      expect(isSensitiveKey(key), key).toBe(false);
  });

  it('EVM-008 AC4 redaction handles cycles, deep nesting and non-plain values', () => {
    const cyclic: Record<string, unknown> = { email: 'x@example.invalid' };
    cyclic['self'] = cyclic;
    expect(redactSensitive(cyclic)).toEqual({ email: REDACTED, self: '[Circular]' });
    let deep: Record<string, unknown> = { password: 'synthetic' };
    for (let index = 0; index < 12; index += 1) deep = { child: deep };
    expect(JSON.stringify(redactSensitive(deep))).not.toContain('synthetic');
    const date = new Date(0);
    expect(redactSensitive({ at: date, count: 1, flag: null })).toEqual({ at: date, count: 1, flag: null });
    expect(redactSensitive('plain')).toBe('plain');
  });

  it('EVM-008 AC4 errors are serialised without database details (pg detail, where, query, parameters)', () => {
    const error = Object.assign(new Error('duplicate key value violates unique constraint'), {
      code: '23505',
      detail: 'Key (email)=(jan.przykladowy@example.invalid) already exists.',
      where: 'SQL statement',
      query: 'insert into customers (email) values ($1)',
      parameters: ['jan.przykladowy@example.invalid'],
    });
    const serialised = serializeError(error);
    expect(Object.keys(serialised)).toEqual(['type', 'message', 'code', 'stack']);
    expect(serialised).toMatchObject({ type: 'Error', code: '23505' });
    const { logger, destination } = capture();
    logger.error({ err: error }, 'query failed');
    expect(destination.text).not.toContain('jan.przykladowy');
    expect(destination.text).not.toContain('insert into');
    expect(serializeError('text')).toEqual({ type: 'string', message: 'non-error value thrown' });
    expect(serializeError(Object.assign(new TypeError('x'), { code: 7 }))).not.toHaveProperty('code');
    const withoutStack = new RangeError('no stack');
    delete withoutStack.stack;
    expect(serializeError(withoutStack)).toEqual({ type: 'RangeError', message: 'no stack' });
  });

  it('EVM-008 AC4 log lines are single-line JSON with escaped control characters (log injection, SR-LOG-05)', () => {
    const { logger, destination } = capture();
    logger.info({ route: '/x\n{"level":"fatal"}' }, 'line\r\nforged');
    expect(destination.lines).toHaveLength(1);
    expect(destination.entries[0]).toMatchObject({ level: 'info', msg: 'line\r\nforged' });
  });

  it('EVM-008 AC4 the configured level filters entries and the mixin adds request context', () => {
    const destination = new LogCapture();
    const logger = createLogger({ level: 'warn', destination, mixin: () => ({ traceId: 'b'.repeat(32) }) });
    logger.info('hidden');
    logger.warn('shown');
    expect(destination.entries).toEqual([expect.objectContaining({ level: 'warn', msg: 'shown', traceId: 'b'.repeat(32) })]);
    expect(destination.entries[0]).toHaveProperty('time');
    expect(destination.entries[0]).not.toHaveProperty('hostname');
    expect(destination.entries[0]).not.toHaveProperty('pid');
  });
});
