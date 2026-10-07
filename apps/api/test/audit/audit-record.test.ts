import { describe, expect, it } from 'vitest';
import { auditRecordSchema, toAuditRecord } from '../../src/modules/audit/domain/audit-record.ts';
import { truncateIp } from '../../src/modules/audit/domain/ip-prefix.ts';
import { AuditSubscriber } from '../../src/modules/audit/audit.module.ts';
import { IDENTITY_EVENT_TYPES, REASON_CODES, type IdentityEvent } from '../../src/modules/identity/index.ts';
import { EventBus, type EventContext } from '../../src/platform/events/event-bus.ts';
import { FixedClock } from '../support/clock.ts';

const user = '0190a1b2-0000-7000-8000-00000000a001';
const session = '0190a1b2-0000-7000-8000-00000000b001';
const traceId = 'c'.repeat(32);
const at = new Date('2026-10-01T08:00:00Z');

const event = (overrides: Partial<IdentityEvent> = {}): IdentityEvent => ({
  type: 'session.created',
  actor: { type: 'user', userId: user },
  outcome: 'success',
  objectType: 'session',
  objectId: session,
  ...overrides,
});

describe('where an audit event came from (EVM-016 AC7; P9)', () => {
  it('EVM-016 AC7 the address is kept as /24 for IPv4 and /48 for IPv6, and nothing for an unparsable or missing one', () => {
    expect(truncateIp('192.0.2.77')).toBe('192.0.2.0/24');
    expect(truncateIp('::ffff:192.0.2.77')).toBe('192.0.2.0/24');
    expect(truncateIp('2001:db8:abcd:1234::1')).toBe('2001:db8:abcd::/48');
    expect(truncateIp('not an address')).toBeNull();
    expect(truncateIp(undefined)).toBeNull();
  });
});

describe('audit record (EVM-016 AC7; SR-LOG-03, SR-LOG-04)', () => {
  it('EVM-067 AC2 a failed sign-in with an unknown e-mail is an anonymous actor with a reason code and no object, no account and no e-mail', () => {
    const failed: IdentityEvent = {
      type: 'login.failed',
      actor: { type: 'anonymous' },
      outcome: 'failed',
      reasonCode: 'unknown_user',
      objectType: 'user',
    };
    const record = toAuditRecord(failed, { origin: 'web', traceId, ip: '203.0.113.200' }, at);
    expect(record).toMatchObject({
      actorType: 'anonymous',
      actorUserId: null,
      objectId: null,
      reasonCode: 'unknown_user',
      outcome: 'failed',
      ipPrefix: '203.0.113.0/24',
    });
    expect(Object.keys(record).sort()).toEqual(Object.keys(auditRecordSchema.shape).sort());
  });

  it('EVM-016 AC7 a web event has who, what, when (UTC), where (a prefix, never the full address), outcome and trace id', () => {
    const context: EventContext = { origin: 'web', traceId, ip: '203.0.113.200', sessionId: session };
    const record = toAuditRecord(event({ reasonCode: 'logout', type: 'session.revoked' }), context, at);
    expect(record).toEqual({
      occurredAt: at,
      actorType: 'user',
      actorUserId: user,
      sessionId: session,
      ipPrefix: '203.0.113.0/24',
      origin: 'web',
      action: 'session.revoked',
      outcome: 'success',
      reasonCode: 'logout',
      objectType: 'session',
      objectId: session,
      traceId,
    });
    expect(JSON.stringify(record)).not.toContain('203.0.113.200');
  });

  it('EVM-016 AC7 an event of the server command has no address (its origin is "cli") and a system actor', () => {
    const record = toAuditRecord(
      event({ type: 'activation_link.issued', actor: { type: 'system' }, objectType: 'user', objectId: user }),
      { origin: 'cli', traceId, ip: '203.0.113.200' },
      at,
    );
    expect(record).toMatchObject({
      actorType: 'system',
      actorUserId: null,
      sessionId: null,
      ipPrefix: null,
      origin: 'cli',
      reasonCode: null,
    });
  });

  it('EVM-016 AC7 the holder of a link who is not signed in is an anonymous actor without a user id', () => {
    const record = toAuditRecord(
      event({ type: 'account.password_set', actor: { type: 'anonymous' }, objectType: 'user', objectId: user }),
      { origin: 'web', traceId, ip: '2001:db8:1::1' },
      at,
    );
    expect(record).toMatchObject({ actorType: 'anonymous', actorUserId: null, ipPrefix: '2001:db8:1::/48' });
  });

  it('EVM-016 AC7 everything is a code, an identifier or a time: free text, an e-mail address or a bad id is refused', () => {
    const context: EventContext = { origin: 'web', traceId };
    expect(() => toAuditRecord(event({ objectId: 'jan.przykladowy@evia.invalid' }), context, at)).toThrow();
    expect(() => toAuditRecord(event({ reasonCode: 'user asked: jan@evia.invalid' as never }), context, at)).toThrow();
    expect(() => toAuditRecord(event({ type: 'account.made_up' as never }), context, at)).toThrow();
    expect(() => toAuditRecord(event({ actor: { type: 'user', userId: 'jan@evia.invalid' } }), context, at)).toThrow();
    expect(() => toAuditRecord(event(), { origin: 'web', traceId: 'not-a-trace-id' }, at)).toThrow();
    expect(() => toAuditRecord(event(), { origin: 'web', traceId, sessionId: 'x@y.invalid' }, at)).toThrow();
    expect(() => auditRecordSchema.parse({ ...toAuditRecord(event(), context, at), email: 'jan@evia.invalid' })).toThrow();
  });

  it('EVM-016 AC7 the closed lists contain the events of the stories (EVM-016, EVM-067, EVM-029) and no free-text reason', () => {
    expect([...IDENTITY_EVENT_TYPES]).toEqual([
      'activation_link.issued',
      'account.password_set',
      'passkey.registered',
      'account.activated',
      'session.created',
      'session.revoked',
      'session.expired',
      'login.succeeded',
      'login.failed',
      'account.emergency_reset',
      'step_up.succeeded',
      'step_up.failed',
    ]);
    for (const code of REASON_CODES) expect(code).toMatch(/^[a-z_]+$/);
  });
});

describe('audit subscription (EVM-016 AC7, W1)', () => {
  it('EVM-016 AC7 audit subscribes to every event type of identity, so publishing any of them has a handler', async () => {
    const bus = new EventBus();
    new AuditSubscriber(bus, new FixedClock(at)).onModuleInit();
    const failures = await Promise.all(
      IDENTITY_EVENT_TYPES.map(async (type) => {
        try {
          // the handler needs a real transaction to write: reaching it (and failing there) proves that a handler is registered
          await bus.publish({} as never, event({ type }), { origin: 'cli', traceId });
          return '';
        } catch (error) {
          return String(error);
        }
      }),
    );
    expect(failures.filter((failure) => failure.includes('No handler subscribed'))).toEqual([]);
  });
});

describe('audit record of a read of the audit log (EVM-029 AC6; SR-LOG-03)', () => {
  const read = { type: 'audit.read', actor: { type: 'user', userId: user }, outcome: 'success', objectType: 'audit' } as const;

  it('EVM-029 AC6 audit.read is an event of the audit module itself: who, when, from where — the object is the log, there is no object id', () => {
    const record = toAuditRecord(read, { origin: 'web', traceId, ip: '203.0.113.200', sessionId: session }, at);
    expect(record).toEqual({
      occurredAt: at,
      actorType: 'user',
      actorUserId: user,
      sessionId: session,
      ipPrefix: '203.0.113.0/24',
      origin: 'web',
      action: 'audit.read',
      outcome: 'success',
      reasonCode: null,
      objectType: 'audit',
      objectId: null,
      traceId,
    });
  });

  it('EVM-029 AC6 a free-text reason or an object id cannot be smuggled into the record of a read', () => {
    expect(() => toAuditRecord({ ...read, objectId: 'jan@evia.invalid' } as never, { origin: 'web', traceId }, at)).toThrow();
    expect(() => toAuditRecord({ ...read, type: 'audit.exported' } as never, { origin: 'web', traceId }, at)).toThrow();
  });
});
