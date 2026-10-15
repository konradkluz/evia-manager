import { describe, expect, it } from 'vitest';
import {
  auditPositionParts,
  auditQuerySchema,
  auditScope,
  DEFAULT_LIMIT,
  LIST_AUDIT_OPERATION,
  MAX_LIMIT,
  parseAuditPosition,
  resolveAuditQuery,
  type AuditQuery,
} from '../../src/modules/audit/domain/audit-query.ts';
import { CursorCodec } from '../../src/platform/crypto/opaque-cursor.ts';
import { ProblemException } from '../../src/platform/http/problem.ts';
import { parseInput } from '../../src/platform/http/validation.ts';

const NOW = new Date('2026-10-07T08:00:00.000Z');
const ID = '0190a1b2-0000-7000-8000-00000000a001';
const parse = (query: unknown, anchor: Date = NOW): AuditQuery => parseInput(resolveAuditQuery(anchor), query);
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

describe('the cursor of the audit log: shape, scope, position and the anchored period (EVM-080 AC1, AC2; CWE-20, CWE-345)', () => {
  const ASOF = new Date('2026-10-07T07:00:00.000Z');
  const LATER = new Date('2026-10-07T07:20:00.000Z');
  const last = { occurredAt: new Date('2026-10-06T10:00:00.123Z'), id: ID };

  it('EVM-080 AC2 the query only checks the shape of a cursor: base64url, 1..512 characters; the rest is for the codec', () => {
    expect(parse({ cursor: 'A'.repeat(512) }).cursor).toBeUndefined();
    for (const cursor of ['', 'a b', 'a+b', 'a=', 'a/b', 'A'.repeat(513), 'żółw'])
      expect([...new Set(refusal({ cursor }).map((error) => error.pointer))], cursor).toEqual(['/cursor']);
  });

  it('EVM-080 AC1 the cursor of the longest position still passes the shape check (the real token is about 270 characters, the limit 512)', () => {
    const codec = new CursorCodec(Buffer.alloc(32, 5), { now: () => ASOF });
    const token = codec.seal(LIST_AUDIT_OPERATION, {
      position: auditPositionParts(new Date('9999-12-31T23:59:59.999Z'), { occurredAt: new Date('9999-12-31T23:59:59.999Z'), id: ID }),
      scope: auditScope({
        action: 'login.failed',
        actorUserId: ID,
        outcome: 'failed',
        from: '2026-10-01T00:00:00.000+02:00',
        to: '2026-10-02T00:00:00.000+02:00',
      }),
      userId: ID,
    });
    expect(token.length).toBeGreaterThan(200);
    expect(token.length).toBeLessThanOrEqual(512);
    expect(parseInput(auditQuerySchema, { cursor: token }).cursor).toBe(token);
  });

  it('EVM-080 AC1 the position is [asOf, occurredAt, id] and round-trips; a position of another shape is undefined, never a throw', () => {
    const parts = auditPositionParts(ASOF, last);
    expect(parts).toEqual(['2026-10-07T07:00:00.000Z', '2026-10-06T10:00:00.123Z', ID]);
    expect(parseAuditPosition(parts)).toEqual({ asOf: ASOF, cursor: last });
    const [asOfText, atText] = ['2026-10-07T07:00:00.000Z', '2026-10-06T10:00:00.123Z'] as const;
    const bad: string[][] = [
      [],
      [ID],
      ['2026-10-06T10:00:00.123Z', ID],
      [asOfText, atText],
      [...parts, 'extra'],
      ['not-a-time', atText, ID],
      [asOfText, 'not-a-time', ID],
      [asOfText, atText, 'not-a-uuid'],
      ['2026-13-45T10:00:00.123Z', atText, ID],
      [asOfText, '2026-10-06', ID],
    ];
    for (const candidate of bad) expect(parseAuditPosition(candidate), candidate.join('|')).toBeUndefined();
  });

  it('EVM-080 AC1 the scope is the filters as named: stable without `to`, different for an explicit `to`, independent of limit and of the cursor', () => {
    const base = { action: 'login.failed', actorUserId: ID, outcome: 'failed', from: '2026-10-01T00:00:00.000Z' } as const;
    const scope = auditScope(base);
    expect(scope).toBe(auditScope({ ...base, limit: 5, cursor: 'abc' }));
    expect(scope).not.toBe(auditScope({ ...base, to: '2026-10-07T07:00:00.000Z' }));
    for (const other of [
      { ...base, action: 'login.succeeded' },
      { ...base, actorUserId: '0190a1b2-0000-7000-8000-00000000a002' },
      { ...base, outcome: 'denied' },
      { ...base, from: '2026-10-01T00:00:00Z' },
      { ...base, from: undefined },
      { action: 'login.failed' },
      {},
    ] as const)
      expect(auditScope(other), JSON.stringify(other)).not.toBe(scope);
    // the same value in another slot is another scope (a fixed order)
    expect(auditScope({ from: '2026-10-01T00:00:00Z' })).not.toBe(auditScope({ to: '2026-10-01T00:00:00Z' }));
  });

  it('EVM-080 AC1 the default period is anchored: with the `asOf` of the cursor it ends at `asOf` and starts 30 days before it, however late the page is asked', () => {
    const first = parse({}, ASOF);
    const later = parseInput(resolveAuditQuery(ASOF, last), {});
    expect(later).toEqual({ ...first, cursor: last });
    expect(later.to).toEqual(ASOF);
    expect(later.from).toEqual(new Date('2026-09-07T07:00:00.000Z'));
    expect(parse({}, LATER).to).toEqual(LATER);
  });

  it('EVM-080 AC1 named `from` and `to` are used as sent; the rules (from <= to, 2 years) count from the anchor when `to` is not named', () => {
    const named = parseInput(resolveAuditQuery(ASOF, last), { from: '2026-10-01T00:00:00Z', to: '2026-10-02T00:00:00Z' });
    expect(named).toMatchObject({ from: new Date('2026-10-01T00:00:00Z'), to: new Date('2026-10-02T00:00:00Z'), cursor: last });
    expect(() => parseInput(resolveAuditQuery(ASOF, last), { from: '2024-10-07T07:00:00.000Z' })).not.toThrow();
    expect(() => parseInput(resolveAuditQuery(ASOF, last), { from: '2024-10-07T06:59:59.999Z' })).toThrow(ProblemException);
    // a page asked later does not stretch the period: the same `from` is still within 2 years of `asOf`
    expect(() => parseInput(resolveAuditQuery(ASOF, last), { from: '2026-10-07T07:00:00.001Z' })).toThrow(ProblemException);
  });
});
