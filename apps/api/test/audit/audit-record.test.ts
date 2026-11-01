import { describe, expect, it } from 'vitest';
import { AUDIT_ACTIONS, AUDIT_OBJECT_TYPES, auditRecordSchema, toAuditRecord } from '../../src/modules/audit/domain/audit-record.ts';
import { truncateIp } from '../../src/modules/audit/domain/ip-prefix.ts';
import { AuditSubscriber } from '../../src/modules/audit/audit.module.ts';
import { MEDIA_EVENT_TYPES } from '../../src/modules/media/index.ts';
import { PAYMENT_MILESTONE_EVENT_TYPES, type PaymentMilestoneEvent } from '../../src/modules/payments/index.ts';
import { PROCEDURE_EVENT_TYPES, type ProcedureAuditEvent, type ProcedureStageEvent } from '../../src/modules/procedures/index.ts';
import { IDENTITY_EVENT_TYPES, REASON_CODES, type IdentityEvent } from '../../src/modules/identity/index.ts';
import { TIMELINE_EVENT_TYPES, type TimelineEntryEvent } from '../../src/modules/timeline/index.ts';
import type { SyncAuditEvent, SyncMutationAuditEvent } from '../../src/platform/sync/sync-event.ts';
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
      amountBeforeMinor: null,
      amountAfterMinor: null,
      currency: null,
      fromCode: null,
      toCode: null,
      workOrderCount: null,
      customerCount: null,
      siteCount: null,
      entityCount: null,
      deviceId: null,
      workOrderId: null,
      commandType: null,
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

  it('EVM-016 AC7 the closed lists contain the events of the stories (EVM-016, EVM-067, EVM-029, EVM-024, EVM-025, EVM-023, EVM-027) and no free-text reason', () => {
    expect([...IDENTITY_EVENT_TYPES]).toEqual([
      'activation_link.issued',
      'account.password_set',
      'passkey.registered',
      'account.activated',
      'user.invited',
      'invitation.resent',
      'password.reset_requested',
      'password_reset_link.issued',
      'password.reset',
      'session.created',
      'session.revoked',
      'session.expired',
      'login.succeeded',
      'login.failed',
      'account.emergency_reset',
      'step_up.succeeded',
      'step_up.failed',
      'mfa.totp_enrolled',
      'mfa.recovery_codes_generated',
      'login.recovery_code_used',
      'user.role_changed',
      'user.deactivated',
      'user.reactivated',
      'user.sessions_ended',
      'user.second_step_reset',
      'account.locked', // EVM-026
      'account.browser_locked',
      'account.profile_updated', // EVM-028
      'password.changed',
      'passkey.removed',
      'mfa.totp_removed',
      'reauthentication.succeeded',
      'reauthentication.failed',
      'device.registered', // EVM-094
      'device.recognized',
      'device.wipe_confirmed',
      'session.refreshed',
    ]);
    for (const code of REASON_CODES) expect(code).toMatch(/^[a-z_]+$/);
  });
});

describe('the codes of a change of a role (EVM-027 AC1; SR-LOG-03)', () => {
  const changed = (overrides: Partial<IdentityEvent> = {}): IdentityEvent =>
    event({ type: 'user.role_changed', objectType: 'user', objectId: user, fromCode: 'editor', toCode: 'read_only', ...overrides });
  const context: EventContext = { origin: 'web', traceId, ip: '203.0.113.200', sessionId: session };

  it('EVM-027 AC1 a change of a role carries the codes of the roles before and after, both together', () => {
    expect(toAuditRecord(changed(), context, at)).toMatchObject({ action: 'user.role_changed', fromCode: 'editor', toCode: 'read_only' });
  });

  it('EVM-027 AC1 the codes belong to the change of a role (or of a payment milestone) only, and only both together: any other event or half a pair is refused', () => {
    expect(() => toAuditRecord(event({ fromCode: 'editor', toCode: 'read_only' }), context, at)).toThrow();
    expect(() => toAuditRecord(event({ type: 'user.deactivated', objectType: 'user', fromCode: 'a', toCode: 'b' }), context, at)).toThrow();
    const { type, actor, outcome, objectType, objectId, fromCode } = changed();
    expect(() =>
      toAuditRecord({ type, actor, outcome, objectType, objectId, ...(fromCode === undefined ? {} : { fromCode }) }, context, at),
    ).toThrow();
    expect(() => toAuditRecord(changed({ fromCode: 'Editor Jan Kowalski' }), context, at)).toThrow();
  });

  it('EVM-027 AC4 the reason of a reset is a code of the closed list (how the identity was verified), never a text', () => {
    const reset = event({ type: 'user.second_step_reset', objectType: 'user', reasonCode: 'identity_verified_video_call' });
    expect(toAuditRecord(reset, context, at)).toMatchObject({ reasonCode: 'identity_verified_video_call' });
    expect(() => toAuditRecord(event({ type: 'user.second_step_reset', reasonCode: 'dowod osobisty' as never }), context, at)).toThrow();
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

describe('audit of the change of a stage (EVM-031; SR-LOG-03, SR-DATA-03)', () => {
  const stageEvent: ProcedureStageEvent = {
    type: 'procedure_stage.updated',
    actor: { type: 'user', userId: user },
    outcome: 'success',
    objectType: 'procedure_stage',
    objectId: session,
  };

  it('EVM-031 SR-LOG-03 audit subscribes to every event type of procedures, so publishing any of them has a handler', async () => {
    const bus = new EventBus();
    new AuditSubscriber(bus, new FixedClock(at)).onModuleInit();
    const failures = await Promise.all(
      PROCEDURE_EVENT_TYPES.map(async (type) => {
        try {
          // the handler needs a real transaction to write: reaching it (and failing there) proves that a handler is registered
          await bus.publish({} as never, { ...stageEvent, type }, { origin: 'web', traceId });
          return '';
        } catch (error) {
          return String(error);
        }
      }),
    );
    expect(failures.filter((failure) => failure.includes('No handler subscribed'))).toEqual([]);
  });

  it('EVM-031 SR-LOG-03 the record has the actor, the stage, the outcome and the trace — and nothing else: no name, no date, no field', () => {
    const record = toAuditRecord(stageEvent, { origin: 'web', traceId, ip: '203.0.113.200', sessionId: session }, at);
    expect(record).toEqual({
      occurredAt: at,
      actorType: 'user',
      actorUserId: user,
      sessionId: session,
      ipPrefix: '203.0.113.0/24',
      origin: 'web',
      action: 'procedure_stage.updated',
      outcome: 'success',
      reasonCode: null,
      objectType: 'procedure_stage',
      objectId: session,
      traceId,
      amountBeforeMinor: null,
      amountAfterMinor: null,
      currency: null,
      fromCode: null,
      toCode: null,
      workOrderCount: null,
      customerCount: null,
      siteCount: null,
      entityCount: null,
      deviceId: null,
      workOrderId: null,
      commandType: null,
    });
  });
});

describe('audit of the transition of a stage (EVM-032; SR-LOG-03, SR-DATA-02)', () => {
  it('EVM-032 SR-LOG-03 the record of a transition has the actor, the stage, the outcome and the trace — and no reason of a block, no party, no day', () => {
    const record = toAuditRecord(
      {
        type: 'procedure_stage.transitioned',
        actor: { type: 'user', userId: user },
        outcome: 'success',
        objectType: 'procedure_stage',
        objectId: session,
      },
      { origin: 'web', traceId, ip: '203.0.113.200', sessionId: session },
      at,
    );
    expect(record).toMatchObject({
      action: 'procedure_stage.transitioned',
      objectType: 'procedure_stage',
      objectId: session,
      outcome: 'success',
      reasonCode: null,
    });
    expect(Object.keys(record).sort()).toEqual(
      [
        'occurredAt',
        'actorType',
        'actorUserId',
        'sessionId',
        'ipPrefix',
        'origin',
        'action',
        'outcome',
        'reasonCode',
        'objectType',
        'objectId',
        'traceId',
        'amountBeforeMinor',
        'amountAfterMinor',
        'currency',
        'fromCode',
        'toCode',
        'workOrderCount',
        'customerCount',
        'siteCount',
        'entityCount',
        'deviceId',
        'workOrderId',
        'commandType',
      ].sort(),
    );
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
      amountBeforeMinor: null,
      amountAfterMinor: null,
      currency: null,
      fromCode: null,
      toCode: null,
      workOrderCount: null,
      customerCount: null,
      siteCount: null,
      entityCount: null,
      deviceId: null,
      workOrderId: null,
      commandType: null,
    });
  });

  it('EVM-029 AC6 a free-text reason or an object id cannot be smuggled into the record of a read', () => {
    expect(() => toAuditRecord({ ...read, objectId: 'jan@evia.invalid' } as never, { origin: 'web', traceId }, at)).toThrow();
    expect(() => toAuditRecord({ ...read, type: 'audit.exported' } as never, { origin: 'web', traceId }, at)).toThrow();
  });
});

describe('audit of the creation of a journal entry (EVM-037; SR-LOG-02, SR-LOG-03, SR-DATA-02)', () => {
  const entryEvent: TimelineEntryEvent = {
    type: 'timeline_entry.created',
    actor: { type: 'user', userId: user },
    outcome: 'success',
    objectType: 'timeline_entry',
    objectId: session,
  };

  it('EVM-037 SR-LOG-03 audit subscribes to every event type of timeline, so publishing any of them has a handler', async () => {
    const bus = new EventBus();
    new AuditSubscriber(bus, new FixedClock(at)).onModuleInit();
    const failures = await Promise.all(
      TIMELINE_EVENT_TYPES.map(async (type) => {
        try {
          // the handler needs a real transaction to write: reaching it (and failing there) proves that a handler is registered
          await bus.publish({} as never, { ...entryEvent, type }, { origin: 'web', traceId });
          return '';
        } catch (error) {
          return String(error);
        }
      }),
    );
    expect(failures.filter((failure) => failure.includes('No handler subscribed'))).toEqual([]);
  });

  it('EVM-037 SR-LOG-03 the record has the actor, the entry, the outcome and the trace — and no text, no category, no stage', () => {
    const record = toAuditRecord(entryEvent, { origin: 'web', traceId, ip: '203.0.113.200', sessionId: session }, at);
    expect(record).toEqual({
      occurredAt: at,
      actorType: 'user',
      actorUserId: user,
      sessionId: session,
      ipPrefix: '203.0.113.0/24',
      origin: 'web',
      action: 'timeline_entry.created',
      outcome: 'success',
      reasonCode: null,
      objectType: 'timeline_entry',
      objectId: session,
      traceId,
      amountBeforeMinor: null,
      amountAfterMinor: null,
      currency: null,
      fromCode: null,
      toCode: null,
      workOrderCount: null,
      customerCount: null,
      siteCount: null,
      entityCount: null,
      deviceId: null,
      workOrderId: null,
      commandType: null,
    });
  });

  it('EVM-037 SR-LOG-02 a text cannot be smuggled into the record of an entry: the schema is strict', () => {
    expect(() => toAuditRecord({ ...entryEvent, objectId: 'Rozmowa z Janem Kowalskim' }, { origin: 'web', traceId }, at)).toThrow();
  });
});

describe('audit of the payment milestones (EVM-053 AC3, AC4, AC6; SR-LOG-03 — the described exception for payments)', () => {
  const payment = (overrides: Partial<PaymentMilestoneEvent> = {}): PaymentMilestoneEvent => ({
    type: 'payment_milestone.amount_changed',
    actor: { type: 'user', userId: user },
    outcome: 'success',
    objectType: 'payment_milestone',
    objectId: session,
    workOrderId: user,
    amountBeforeMinor: 300000,
    amountAfterMinor: 360000,
    fromCode: null,
    toCode: null,
    ...overrides,
  });
  const context: EventContext = { origin: 'web', traceId, ip: '203.0.113.200', sessionId: session };

  it('EVM-053 AC3 the record has the actor, the milestone, the trace and the amount before and after in PLN — and no name, no order, no field', () => {
    const record = toAuditRecord(payment(), context, at);
    expect(record).toMatchObject({
      action: 'payment_milestone.amount_changed',
      objectType: 'payment_milestone',
      objectId: session,
      actorUserId: user,
      amountBeforeMinor: 300000,
      amountAfterMinor: 360000,
      currency: 'PLN',
    });
    expect(Object.keys(record).sort()).toEqual(Object.keys(auditRecordSchema.shape).sort());
    // the order of a mutation of a phone (EVM-098) is a column of its own, empty on every other event
    expect(record.workOrderId).toBeNull();
    expect(JSON.stringify(record)).not.toMatch(/name/);
  });

  it('EVM-053 AC4 AC6 a creation without an amount and a cancellation of a milestone never priced carry no amount and no currency', () => {
    expect(
      toAuditRecord(payment({ type: 'payment_milestone.created', amountBeforeMinor: null, amountAfterMinor: null }), context, at),
    ).toMatchObject({
      amountBeforeMinor: null,
      amountAfterMinor: null,
      currency: null,
      fromCode: null,
      toCode: null,
      workOrderCount: null,
      customerCount: null,
      siteCount: null,
      entityCount: null,
      deviceId: null,
      workOrderId: null,
      commandType: null,
    });
  });

  it('EVM-053 SR-LOG-03 the schema refuses an amount on any other action, an amount without its currency and an amount that is not a positive integer', () => {
    const base = toAuditRecord(payment(), context, at);
    expect(auditRecordSchema.safeParse({ ...base, action: 'work_order.cancelled' }).success).toBe(false);
    expect(auditRecordSchema.safeParse({ ...base, currency: null }).success).toBe(false);
    expect(auditRecordSchema.safeParse({ ...base, amountAfterMinor: 0 }).success).toBe(false);
    expect(auditRecordSchema.safeParse({ ...base, amountAfterMinor: 1.5 }).success).toBe(false);
    expect(auditRecordSchema.safeParse({ ...base, amountBeforeMinor: null, amountAfterMinor: null }).success).toBe(false);
    expect(PAYMENT_MILESTONE_EVENT_TYPES).toEqual([
      'payment_milestone.created',
      'payment_milestone.amount_changed',
      'payment_milestone.cancelled',
      'payment_milestone.invoiced',
      'payment_milestone.paid',
      'payment_milestone.details_changed',
      'payment_milestone.invoice_withdrawn',
      'payment_milestone.invoice_cancelled',
      'payment_milestone.payment_undone',
      'payment_milestone.restored',
      'payment_milestone.amount_corrected',
      'payment_milestone.deleted',
    ]);
  });

  it('EVM-057 AC1 AC3 AC4 SR-LOG-03 a correction keeps the amount (and the status codes of a move); a deletion has the amount before only, without codes', () => {
    expect(
      toAuditRecord(
        payment({
          type: 'payment_milestone.invoice_withdrawn',
          amountBeforeMinor: 360000,
          amountAfterMinor: 360000,
          fromCode: 'invoiced',
          toCode: 'planned',
        }),
        context,
        at,
      ),
    ).toMatchObject({
      action: 'payment_milestone.invoice_withdrawn',
      amountBeforeMinor: 360000,
      amountAfterMinor: 360000,
      fromCode: 'invoiced',
      toCode: 'planned',
      currency: 'PLN',
    });
    expect(
      toAuditRecord(payment({ type: 'payment_milestone.deleted', amountBeforeMinor: 360000, amountAfterMinor: null }), context, at),
    ).toMatchObject({
      action: 'payment_milestone.deleted',
      amountBeforeMinor: 360000,
      amountAfterMinor: null,
      fromCode: null,
      toCode: null,
      currency: 'PLN',
    });
    expect(
      toAuditRecord(payment({ type: 'payment_milestone.deleted', amountBeforeMinor: null, amountAfterMinor: null }), context, at),
    ).toMatchObject({ amountBeforeMinor: null, amountAfterMinor: null, currency: null });
  });

  it('EVM-053 AC3 the audit module subscribes to the three events of payments', async () => {
    const bus = new EventBus();
    new AuditSubscriber(bus, new FixedClock(at)).onModuleInit();
    const failures = await Promise.all(
      PAYMENT_MILESTONE_EVENT_TYPES.map(async (type) => {
        try {
          // the handler needs a real transaction to write: reaching it (and failing there) proves that a handler is registered
          await bus.publish({} as never, payment({ type }), context);
          return '';
        } catch (error) {
          return String(error);
        }
      }),
    );
    expect(failures.filter((failure) => failure.includes('No handler subscribed'))).toEqual([]);
    expect(failures.every((failure) => failure !== '')).toBe(true);
  });
});

describe('audit of the processes and stages added, deleted and restored by hand (EVM-042 AC3, AC5; SR-LOG-03, TM-21)', () => {
  const context = { origin: 'web', traceId, ip: '203.0.113.200', sessionId: session } as const;
  const actor = { type: 'user', userId: user } as const;

  it('EVM-042 AC5 every action has a record of its own: the actor, the object, the outcome and the trace — and nothing else', () => {
    const cases = [
      ['procedure.created', 'procedure'],
      ['procedure.deleted', 'procedure'],
      ['procedure.restored', 'procedure'],
      ['procedure_stage.created', 'procedure_stage'],
      ['procedure_stage.deleted', 'procedure_stage'],
      ['procedure_stage.restored', 'procedure_stage'],
    ] as const;
    for (const [type, objectType] of cases) {
      const record = toAuditRecord({ type, actor, outcome: 'success', objectType, objectId: session } as ProcedureAuditEvent, context, at);
      expect(record, type).toMatchObject({
        action: type,
        objectType,
        objectId: session,
        outcome: 'success',
        actorUserId: user,
        ipPrefix: '203.0.113.0/24',
        reasonCode: null,
        amountBeforeMinor: null,
        amountAfterMinor: null,
        currency: null,
      });
    }
  });

  it('EVM-042 AC5 the removal and the return of a record are told apart from a change in the list of actions of the trail', () => {
    for (const action of ['procedure.deleted', 'procedure.restored', 'procedure_stage.deleted', 'procedure_stage.restored']) {
      expect(AUDIT_ACTIONS).toContain(action);
    }
    expect(AUDIT_OBJECT_TYPES).toContain('procedure');
  });
});

describe('the status codes of a transition of a payment milestone (EVM-054 AC1, AC3; SR-LOG-03)', () => {
  const context: EventContext = { origin: 'web', traceId, ip: '203.0.113.200', sessionId: session };
  const invoiced: PaymentMilestoneEvent = {
    type: 'payment_milestone.invoiced',
    actor: { type: 'user', userId: user },
    outcome: 'success',
    objectType: 'payment_milestone',
    objectId: session,
    workOrderId: user,
    amountBeforeMinor: null,
    amountAfterMinor: 123000,
    fromCode: 'planned',
    toCode: 'invoiced',
  };

  it('EVM-054 AC1 the record of an invoice has the amount after and the codes planned → invoiced — never the order, the number or a name', () => {
    const record = toAuditRecord(invoiced, context, at);
    expect(record).toMatchObject({
      action: 'payment_milestone.invoiced',
      amountAfterMinor: 123000,
      fromCode: 'planned',
      toCode: 'invoiced',
    });
    expect(record.workOrderId).toBeNull();
    expect(JSON.stringify(record)).not.toMatch(/FV/);
  });

  it('EVM-054 SR-LOG-03 the schema refuses one code without the other, a code that is not a code and codes on an action outside the payments', () => {
    const base = toAuditRecord(invoiced, context, at);
    expect(auditRecordSchema.safeParse({ ...base, toCode: null }).success).toBe(false);
    expect(auditRecordSchema.safeParse({ ...base, fromCode: 'Planowana' }).success).toBe(false);
    expect(auditRecordSchema.safeParse({ ...base, action: 'work_order.cancelled', amountAfterMinor: null, currency: null }).success).toBe(
      false,
    );
    expect(auditRecordSchema.safeParse({ ...base, fromCode: null, toCode: null }).success).toBe(true);
  });
});

describe('audit of the addresses of files (EVM-045 AC3, AC5; SR-LOG-03, SR-FILE-07)', () => {
  const context: EventContext = { origin: 'web', traceId, ip: '203.0.113.77', sessionId: session };
  const media = '0190a1b2-0000-7000-8000-00000000c001';

  it('EVM-045 AC3 the closed list of the media actions is a snapshot (a new type is a conscious change)', () => {
    expect([...MEDIA_EVENT_TYPES]).toEqual([
      'media_asset.created',
      'media_file.quarantined',
      'media_file.rescan_requested',
      'media_file.rescanned',
      'media_file.quarantine_purged',
      'media_file.original_downloaded',
      'media_file.original_download_denied',
      'media_file.download_alerted',
      'media_file.download_rejected',
      // EVM-047: the documents
      'document.created',
      'document.confidentiality_raised',
      'document_file.downloaded',
      'document_file.download_denied',
      // EVM-048: the metadata
      'media_asset.metadata_updated',
      'document.metadata_updated',
    ]);
    for (const type of MEDIA_EVENT_TYPES) expect(AUDIT_ACTIONS).toContain(type);
  });

  it('EVM-045 AC3 AC5 the record names who, which medium, when and the outcome - and has no file name, address, key or order', () => {
    for (const [type, outcome] of [
      ['media_file.original_downloaded', 'success'],
      ['media_file.original_download_denied', 'denied'],
      ['media_file.download_alerted', 'success'],
      ['media_file.download_rejected', 'denied'],
    ] as const) {
      const record = toAuditRecord(
        { type, actor: { type: 'user', userId: user }, outcome, objectType: 'media_asset', objectId: media },
        context,
        at,
      );
      expect(record).toMatchObject({
        action: type,
        outcome,
        actorUserId: user,
        objectType: 'media_asset',
        objectId: media,
        occurredAt: at,
        origin: 'web',
        traceId,
        ipPrefix: '203.0.113.0/24',
        fromCode: null,
        toCode: null,
      });
      expect(Object.keys(record).sort()).toEqual(Object.keys(auditRecordSchema.shape).sort());
    }
  });
});

describe('the counts of a full download in the trail (EVM-096 AC8; AB-08)', () => {
  const device = '0190a1b2-0000-7000-8000-00000000d001';
  const completed = (overrides: Partial<SyncAuditEvent> = {}): SyncAuditEvent => ({
    type: 'sync.full_download_completed',
    actor: { type: 'user', userId: user },
    outcome: 'success',
    objectType: 'device',
    objectId: device,
    counts: { workOrders: 12, customers: 5, sites: 7 },
    ...overrides,
  });
  const context: EventContext = { origin: 'web', traceId };

  it('EVM-096 AC8 the end of a full download carries the counts of the entities by type', () => {
    const record = toAuditRecord(completed(), context, at);
    expect(record).toMatchObject({
      action: 'sync.full_download_completed',
      objectType: 'device',
      objectId: device,
      workOrderCount: 12,
      customerCount: 5,
      siteCount: 7,
    });
  });

  it('EVM-096 AC8 the start of a download has no counts, and the end without counts or counts on another event is refused', () => {
    const start = toAuditRecord(completed({ type: 'sync.full_download', counts: undefined }), context, at);
    expect(start).toMatchObject({ workOrderCount: null, customerCount: null, siteCount: null });
    expect(() => toAuditRecord(completed({ counts: undefined }), context, at)).toThrow();
    expect(() => toAuditRecord(completed({ type: 'sync.full_download' }), context, at)).toThrow();
  });
});

describe('the number of entities of a snapshot of an order in the trail (EVM-097 AC7; AB-08)', () => {
  const device = '0190a1b2-0000-7000-8000-00000000d002';
  const snapshot = (overrides: Partial<SyncAuditEvent> = {}): SyncAuditEvent => ({
    type: 'sync.work_order_snapshot',
    actor: { type: 'user', userId: user },
    outcome: 'success',
    objectType: 'device',
    objectId: device,
    entityCount: 37,
    ...overrides,
  });
  const context: EventContext = { origin: 'web', traceId };

  it('EVM-097 AC7 a served snapshot carries the NUMBER of its entities - and no other count, no object of the order', () => {
    const record = toAuditRecord(snapshot(), context, at);
    expect(record).toMatchObject({
      action: 'sync.work_order_snapshot',
      objectType: 'device',
      objectId: device,
      entityCount: 37,
      workOrderCount: null,
      customerCount: null,
      siteCount: null,
    });
  });

  it('EVM-097 AC7 a refusal by the limit carries no number; a number on a refusal, on another event or below zero is refused', () => {
    expect(toAuditRecord(snapshot({ outcome: 'denied', entityCount: undefined }), context, at)).toMatchObject({ entityCount: null });
    expect(() => toAuditRecord(snapshot({ outcome: 'denied' }), context, at)).toThrow();
    expect(() => toAuditRecord(snapshot({ type: 'sync.full_download' }), context, at)).toThrow();
    expect(() => toAuditRecord(snapshot({ entityCount: -1 }), context, at)).toThrow();
  });
});

describe('the applied mutation of a phone in the trail (EVM-098 AC8; SR-LOG-03, SR-LOG-04)', () => {
  const device = '0190a1b2-0000-7000-8000-00000000d003';
  const order = '0190a1b2-0000-7000-8000-00000000d004';
  const entry = '0190a1b2-0000-7000-8000-00000000d005';
  const applied = (overrides: Partial<Record<keyof SyncMutationAuditEvent, unknown>> = {}): SyncMutationAuditEvent =>
    ({
      type: 'sync.mutation_applied',
      actor: { type: 'user', userId: user },
      outcome: 'success',
      objectType: 'timeline_entry',
      objectId: entry,
      deviceId: device,
      workOrderId: order,
      commandType: 'CreateNote',
      ...overrides,
    }) as SyncMutationAuditEvent;
  const context: EventContext = { origin: 'web', traceId, sessionId: session };

  it('EVM-098 AC8 the record is self-contained: the type of the command, the order, the entry, the device, the actor, the session, the trace - and no count, no amount', () => {
    expect(toAuditRecord(applied(), context, at)).toMatchObject({
      action: 'sync.mutation_applied',
      actorUserId: user,
      sessionId: session,
      objectType: 'timeline_entry',
      objectId: entry,
      deviceId: device,
      workOrderId: order,
      commandType: 'CreateNote',
      traceId,
      occurredAt: at,
      entityCount: null,
      workOrderCount: null,
      amountBeforeMinor: null,
    });
    expect(toAuditRecord(applied({ commandType: 'CreateComment' }), context, at)).toMatchObject({ commandType: 'CreateComment' });
  });

  it('EVM-098 AC8 a type outside the closed list, a missing field of the three or the fields on another action are refused', () => {
    expect(() => toAuditRecord(applied({ commandType: 'CreateQuickWorkOrder' }), context, at)).toThrow();
    expect(() => toAuditRecord(applied({ deviceId: 'not-a-uuid' }), context, at)).toThrow();
    expect(() => toAuditRecord(applied({ type: 'timeline_entry.created' }), context, at)).toThrow();
    expect(() => toAuditRecord(applied({ deviceId: null }), context, at)).toThrow();
  });
});
