import { describe, expect, it } from 'vitest';
import {
  decodeCursor,
  DEFAULT_LIMIT,
  encodeCursor,
  MAX_LIMIT,
  resolveAuditQuery,
  type AuditQuery,
} from '../../src/modules/audit/domain/audit-query.ts';
import { ProblemException } from '../../src/platform/http/problem.ts';
import { parseInput } from '../../src/platform/http/validation.ts';

const NOW = new Date('2026-10-07T08:00:00.000Z');
const ID = '0190a1b2-0000-7000-8000-00000000a001';
const parse = (query: unknown): AuditQuery => parseInput(resolveAuditQuery(NOW), query);
const refusal = (query: unknown): { pointer: string; code: string }[] => {
  try {
    parse(query);
  } catch (error) {
    if (error instanceof ProblemException) return [...(error.extras.errors ?? [])];
    throw error;
  }
  throw new Error('the query was accepted');
};

describe('the query of the audit log (EVM-029 AC5; SR-API-02, SR-API-04; ASVS V2.2.1)', () => {
  it('EVM-029 AC5 the default period is the last 30 days, the default limit 50, no filters and no cursor', () => {
    expect(parse({})).toEqual({
      action: undefined,
      actorUserId: undefined,
      outcome: undefined,
      from: new Date('2026-09-07T08:00:00.000Z'),
      to: NOW,
      limit: DEFAULT_LIMIT,
      cursor: undefined,
    });
  });

  it('EVM-029 AC5 every filter is taken as sent, a limit as a number, a period as instants', () => {
    const query = parse({
      action: 'login.failed',
      actorUserId: ID,
      outcome: 'failed',
      from: '2026-10-01T00:00:00.000Z',
      to: '2026-10-02T00:00:00+02:00',
      limit: '100',
    });
    expect(query).toMatchObject({
      action: 'login.failed',
      actorUserId: ID,
      outcome: 'failed',
      from: new Date('2026-10-01T00:00:00.000Z'),
      to: new Date('2026-10-01T22:00:00.000Z'),
      limit: MAX_LIMIT,
    });
  });

  it('EVM-029 AC5 a period of exactly 2 years is allowed, one millisecond more is not (period_too_long)', () => {
    expect(() => parse({ from: '2024-10-07T08:00:00.000Z' })).not.toThrow();
    expect(refusal({ from: '2024-10-07T07:59:59.999Z' })).toEqual([{ pointer: '/from', code: 'invalid' }]);
  });

  it('EVM-029 AC5 from after to is refused and from equal to to is allowed', () => {
    expect(refusal({ from: '2026-10-02T00:00:00Z', to: '2026-10-01T00:00:00Z' })).toEqual([{ pointer: '/from', code: 'invalid' }]);
    expect(() => parse({ from: '2026-10-01T00:00:00Z', to: '2026-10-01T00:00:00Z' })).not.toThrow();
    expect(refusal({ from: '2026-10-08T00:00:00Z' })).toEqual([{ pointer: '/from', code: 'invalid' }]);
  });

  it('EVM-029 AC5 an unknown parameter, a value outside a closed list, a bad id, a bad instant and a bad limit are all refused', () => {
    expect(refusal({ email: 'jan@evia.invalid' })).toEqual([{ pointer: '/email', code: 'unknown_field' }]);
    expect(refusal({ action: 'account.deleted' })).toEqual([{ pointer: '/action', code: 'invalid_value' }]);
    expect(refusal({ outcome: 'ok' })).toEqual([{ pointer: '/outcome', code: 'invalid_value' }]);
    expect(refusal({ actorUserId: 'jan@evia.invalid' })).toEqual([{ pointer: '/actorUserId', code: 'invalid_format' }]);
    expect(refusal({ from: 'yesterday' })).toEqual([{ pointer: '/from', code: 'invalid_format' }]);
    expect(refusal({ to: '2026-10-07' })).toEqual([{ pointer: '/to', code: 'invalid_format' }]);
    for (const limit of ['0', '101', '-1', '1.5', 'abc', '', '1e2', '0050x']) {
      expect(
        refusal({ limit }).map((error) => error.pointer),
        limit,
      ).toEqual(['/limit']);
    }
  });

  it('EVM-029 AC5 the refusal names the parameter and the kind of fault, never the value that was sent', () => {
    const errors = refusal({ actorUserId: 'secret-value-123', outcome: 'secret-value-456' });
    expect(JSON.stringify(errors)).not.toContain('secret-value');
  });

  it('EVM-029 AC5 values that are not strings (an array or an object from a repeated or bracketed parameter) are refused', () => {
    expect(() => parse({ action: ['login.failed', 'login.succeeded'] })).toThrow(ProblemException);
    expect(() => parse({ limit: ['5'] })).toThrow(ProblemException);
    expect(() => parse({ cursor: { a: 'b' } })).toThrow(ProblemException);
  });
});

describe('the cursor of the audit log is opaque and exactly what the API issued (EVM-029 AC5; CWE-20)', () => {
  const position = { occurredAt: new Date('2026-10-06T10:00:00.123Z'), id: ID };

  it('EVM-029 AC5 a cursor round-trips and is base64url (no characters that need escaping in a URL)', () => {
    const cursor = encodeCursor(position);
    expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeCursor(cursor)).toEqual(position);
    expect(parse({ cursor }).cursor).toEqual(position);
  });

  it('EVM-029 AC5 anything else is a 400, never a 500: garbage, wrong shape, a bad id, a bad time, a non-canonical encoding', () => {
    const encode = (value: unknown): string => Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
    const bad = [
      'not-a-cursor',
      '!!!',
      Buffer.from('{"t":1}', 'utf8').toString('base64url'),
      encode(['2026-10-06T10:00:00.123Z']),
      encode(['2026-10-06T10:00:00.123Z', 'not-a-uuid']),
      encode(['not-a-time', ID]),
      encode(['2026-10-06T10:00:00.123Z', ID, 'extra']),
      encode(['2026-10-06T10:00:00.123Z', ID]) + 'AA',
      encode(['2026-10-06T10:00:00+00:00', ID]),
      encode(['2026-13-45T10:00:00.123Z', ID]),
      'A'.repeat(300),
    ];
    for (const cursor of bad) {
      expect(decodeCursor(cursor), cursor).toBeUndefined();
      expect([...new Set(refusal({ cursor }).map((error) => error.pointer))], cursor).toEqual(['/cursor']);
    }
  });
});
