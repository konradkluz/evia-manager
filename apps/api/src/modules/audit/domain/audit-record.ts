/**
 * An audit record before it is written (domain-model.md → AuditEvent; SR-LOG-03, SR-LOG-04). Every field comes from a
 * closed list, an identifier or a time — there is no free text, so no e-mail, name or password can reach the table
 * (the trail is append-only; a filter for personal data in free text would be unreliable, Q3). The schema is strict.
 */
import { z } from 'zod';
import { CUSTOMER_EVENT_TYPES, type CustomerEvent } from '../../customers/index.ts';
import { IDENTITY_EVENT_TYPES, REASON_CODES, type IdentityEvent } from '../../identity/index.ts';
import { PARTY_EVENT_TYPES, type PartyEvent } from '../../parties/index.ts';
import { SITE_EVENT_TYPES, type SiteEvent } from '../../sites/index.ts';
import { WORK_ORDER_EVENT_TYPES, type WorkOrderEvent } from '../../work-orders/index.ts';
import { BULK_READ_EVENT_TYPES, type BulkReadEvent } from '../../../platform/bulk-read/bulk-read-event.ts';
import type { EventContext } from '../../../platform/events/event-bus.ts';
import { truncateIp } from './ip-prefix.ts';

/** The event of the audit module itself: the Administrator read the log (SR-LOG-03). The object is the log — no object id. */
export interface AuditReadEvent {
  readonly type: 'audit.read';
  readonly actor: IdentityEvent['actor'];
  readonly outcome: 'success' | 'denied';
  readonly objectType: 'audit';
}

/** Every action the trail knows: the events of identity and the read of the log itself. */
export const AUDIT_ACTIONS = [
  ...IDENTITY_EVENT_TYPES,
  'audit.read',
  ...BULK_READ_EVENT_TYPES,
  ...CUSTOMER_EVENT_TYPES,
  ...SITE_EVENT_TYPES,
  ...PARTY_EVENT_TYPES,
  ...WORK_ORDER_EVENT_TYPES,
] as const;
export const AUDIT_OBJECT_TYPES = ['user', 'session', 'passkey', 'audit', 'work_order', 'customer', 'site', 'party'] as const;
export const AUDIT_OUTCOMES = ['success', 'denied', 'failed'] as const;

export const auditRecordSchema = z.strictObject({
  occurredAt: z.date(),
  actorType: z.enum(['user', 'system', 'anonymous']),
  actorUserId: z.uuid().nullable(),
  sessionId: z.uuid().nullable(),
  ipPrefix: z.string().max(43).nullable(),
  origin: z.enum(['web', 'cli']),
  action: z.enum(AUDIT_ACTIONS),
  outcome: z.enum(AUDIT_OUTCOMES),
  reasonCode: z.enum(REASON_CODES).nullable(),
  objectType: z.enum(AUDIT_OBJECT_TYPES),
  objectId: z.uuid().nullable(),
  traceId: z.string().regex(/^[0-9a-f]{32}$/),
});

export type AuditRecord = z.infer<typeof auditRecordSchema>;

/** Maps an identity event and its request context to the record; throws when something is outside the closed lists. */
export function toAuditRecord(
  event: IdentityEvent | AuditReadEvent | BulkReadEvent | CustomerEvent | SiteEvent | PartyEvent | WorkOrderEvent,
  context: EventContext,
  occurredAt: Date,
): AuditRecord {
  return auditRecordSchema.parse({
    occurredAt,
    actorType: event.actor.type,
    actorUserId: event.actor.type === 'user' ? event.actor.userId : null,
    sessionId: context.sessionId ?? null,
    ipPrefix: context.origin === 'web' ? truncateIp(context.ip) : null,
    origin: context.origin,
    action: event.type,
    outcome: event.outcome,
    reasonCode: 'reasonCode' in event ? (event.reasonCode ?? null) : null,
    objectType: event.objectType,
    objectId: 'objectId' in event ? (event.objectId ?? null) : null,
    traceId: context.traceId,
  });
}
