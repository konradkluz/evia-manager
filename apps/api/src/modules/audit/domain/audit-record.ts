/**
 * An audit record before it is written (domain-model.md → AuditEvent; SR-LOG-03, SR-LOG-04). Every field comes from a
 * closed list, an identifier or a time — there is no free text, so no e-mail, name or password can reach the table
 * (the trail is append-only; a filter for personal data in free text would be unreliable, Q3). The schema is strict.
 */
import { z } from 'zod';
import { IDENTITY_EVENT_TYPES, REASON_CODES, type IdentityEvent } from '../../identity/index.ts';
import type { EventContext } from '../../../platform/events/event-bus.ts';
import { truncateIp } from './ip-prefix.ts';

export const auditRecordSchema = z.strictObject({
  occurredAt: z.date(),
  actorType: z.enum(['user', 'system', 'anonymous']),
  actorUserId: z.uuid().nullable(),
  sessionId: z.uuid().nullable(),
  ipPrefix: z.string().max(43).nullable(),
  origin: z.enum(['web', 'cli']),
  action: z.enum(IDENTITY_EVENT_TYPES),
  outcome: z.enum(['success', 'denied', 'failed']),
  reasonCode: z.enum(REASON_CODES).nullable(),
  objectType: z.enum(['user', 'session', 'passkey']),
  objectId: z.uuid().nullable(),
  traceId: z.string().regex(/^[0-9a-f]{32}$/),
});

export type AuditRecord = z.infer<typeof auditRecordSchema>;

/** Maps an identity event and its request context to the record; throws when something is outside the closed lists. */
export function toAuditRecord(event: IdentityEvent, context: EventContext, occurredAt: Date): AuditRecord {
  return auditRecordSchema.parse({
    occurredAt,
    actorType: event.actor.type,
    actorUserId: event.actor.type === 'user' ? event.actor.userId : null,
    sessionId: context.sessionId ?? null,
    ipPrefix: context.origin === 'web' ? truncateIp(context.ip) : null,
    origin: context.origin,
    action: event.type,
    outcome: event.outcome,
    reasonCode: event.reasonCode ?? null,
    objectType: event.objectType,
    objectId: event.objectId,
    traceId: context.traceId,
  });
}
