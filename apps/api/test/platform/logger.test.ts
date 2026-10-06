import { describe, expect, it } from 'vitest';
import {
  createLogger,
  isSensitiveKey,
  MAX_SCRUBBED_LENGTH,
  REDACTED,
  redactSensitive,
  scrubValues,
  serializeError,
} from '../../src/platform/logging/logger.ts';
import { LogCapture } from '../support/app.ts';

/** Synthetic values that must never reach the log output (ADR-0013 list). */
const SENSITIVE: Record<string, string> = {
  authorization: 'Bearer fake-one',
  cookie: '__Host-evia_session=fake-two',
  'set-cookie': 'fake-three',
  password: 'fake-four',
  accessToken: 'fake-five',
  refresh_token: 'fake-six',
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
  signedUrl: 'https://bucket.invalid/o?X-Amz-Signature=fake-seven',
  'X-Amz-Signature': 'fake-eight',
  apiKey: 'fake-nine',
};

function capture(level: 'info' | 'warn' = 'info') {
  const destination = new LogCapture();
  return { logger: createLogger({ level, destination }), destination };
}

/** Shape of pg's DatabaseError (name 'error', severity, SQLSTATE) without importing the driver here (SR-INPUT-03 lint). */
const databaseError = (message: string, fields: Record<string, string>) =>
  Object.assign(new Error(message), { name: 'error', severity: 'ERROR', ...fields });

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
    expect(serialised).toMatchObject({ type: 'Error', code: '23505', message: 'duplicate key value violates unique constraint' });
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

  it('EVM-008 AC4 error messages and stacks are scrubbed of values (e-mail, phone, PESEL, quoted text)', () => {
    const error = new TypeError(
      'failed for jan.przykladowy@example.invalid, tel. +48 600 000 000, PESEL 00000000000, name "Klient Przykładowy" and \'Ul. Przykładowa\'',
    );
    const serialised = serializeError(error);
    expect(serialised.type).toBe('TypeError');
    expect(serialised.message).toBe(`failed for ${REDACTED}, tel. ${REDACTED}, PESEL ${REDACTED}, name "${REDACTED}" and '${REDACTED}'`);
    expect(serialised.stack).toMatch(/^\s+at /);
    expect(serialised.stack).not.toContain('TypeError');
    const { logger, destination } = capture();
    logger.error({ err: error }, 'handler failed');
    for (const value of ['jan.przykladowy', '600 000 000', '00000000000', 'Klient', 'Przykładowa'])
      expect(destination.text).not.toContain(value);
  });

  it('EVM-008 AC4 scrubbing keeps technical identifiers (UUID, dates, ports, paths) readable', () => {
    const text = 'work order 0190a1b2-0000-7000-8000-000000000000 at 2026-10-05 on 127.0.0.1:5432 in /srv/app/x.ts:31:11';
    expect(scrubValues(text)).toBe(text);
    expect(scrubValues('„Jan” and «Anna»')).toBe(`„${REDACTED}” and «${REDACTED}»`);
  });

  it('EVM-008 AC4 database driver errors are logged without their message (pg 22P02 with a quoted value)', () => {
    const error = databaseError('invalid input syntax for type uuid: "jan.przykladowy-value"', {
      code: '22P02',
      routine: 'string_to_uuid',
      table: 'work_orders',
      column: 'id',
      constraint: 'work_orders_pkey',
      detail: 'synthetic detail with jan.przykladowy-value',
    });
    const serialised = serializeError(error);
    expect(serialised).toMatchObject({
      type: 'DatabaseError',
      message: 'database error',
      code: '22P02',
      table: 'work_orders',
      column: 'id',
      constraint: 'work_orders_pkey',
    });
    expect(Object.keys(serialised)).not.toContain('detail');
    const { logger, destination } = capture();
    logger.error({ err: error }, 'query failed');
    expect(destination.text).not.toContain('jan.przykladowy-value');
    expect(destination.text).not.toContain('invalid input syntax');
    const minimal = databaseError('relation "x" does not exist', { code: '42P01' });
    delete minimal.stack;
    expect(serializeError(minimal)).toEqual({ type: 'DatabaseError', message: 'database error', code: '42P01' });
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

  it('EVM-016 AC1 WebAuthn ceremony data, CSRF and activation tokens are redacted by key (SR-LOG-02)', () => {
    const { logger, destination } = capture();
    logger.info({
      challenge: 'fake-challenge',
      clientDataJSON: 'fake-client-data',
      attestationObject: 'fake-attestation',
      csrfToken: 'fake-csrf',
      'X-CSRF-Token': 'fake-csrf-header',
      activationToken: 'fake-activation',
      nested: { assertion: 'fake-assertion' },
    });
    expect(destination.text).not.toMatch(/fake-/);
    for (const key of ['challenge', 'clientDataJSON', 'attestationObject', 'csrfToken', 'X-CSRF-Token', 'activationToken']) {
      expect(isSensitiveKey(key), key).toBe(true);
    }
    expect(isSensitiveKey('traceId')).toBe(false);
  });

  it('EVM-016 AC5 a URL fragment that looks like a one-time token is scrubbed from error messages (SR-LOG-02)', () => {
    const token = 'abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG';
    const message = scrubValues(`failed to load https://panel.evia.test/activate#${token} twice`);
    expect(message).not.toContain(token);
    expect(message).toContain(`#${REDACTED}`);
    expect(scrubValues('anchor #short-one stays')).toBe('anchor #short-one stays');
  });

  it('EVM-016 AC4 attacker-controlled text of any length is scrubbed in linear time and truncated (CWE-1333, SR-LOG-02)', () => {
    const hostile = [
      'a'.repeat(1_000_000),
      `${'1 '.repeat(500_000)}x`,
      '"'.repeat(500_000),
      `${'a.'.repeat(500_000)}@`,
      `${'9'.repeat(1_000_000)}z`,
    ];
    for (const text of hostile) {
      const started = performance.now();
      const scrubbed = scrubValues(text);
      expect(performance.now() - started, text.slice(0, 8)).toBeLessThan(250);
      // bounded by the truncation (quoted text grows when replaced pair by pair, never with the input length)
      expect(scrubbed.length).toBeLessThan(MAX_SCRUBBED_LENGTH * 8);
    }
    const error = Object.assign(new Error(`origin mismatch ${'x'.repeat(500_000)}`), {
      stack: `Error: boom
    at ${'y'.repeat(500_000)}`,
    });
    const started = performance.now();
    const serialized = serializeError(error);
    expect(performance.now() - started).toBeLessThan(250);
    expect(serialized.message.length).toBeLessThan(MAX_SCRUBBED_LENGTH + 40);
    expect((serialized.stack ?? '').length).toBeLessThan(9000);
  });

  it('EVM-016 AC4 an e-mail address in a long message is still redacted after truncation and a long local part is covered', () => {
    expect(scrubValues(`${'z'.repeat(100)}@example.invalid failed`)).toBe(`${REDACTED} failed`);
    expect(scrubValues('mail jan.przykladowy@example.invalid sent')).toBe(`mail ${REDACTED} sent`);
  });
});
