/**
 * An audit record before it is written (domain-model.md → AuditEvent; SR-LOG-03, SR-LOG-04). Every field comes from a
 * closed list, an identifier or a time — there is no free text, so no e-mail, name or password can reach the table
 * (the trail is append-only; a filter for personal data in free text would be unreliable, Q3). The schema is strict.
 * The one described exception (EVM-053): an event of a payment milestone carries the amount before and after in grosze with the
 * currency `PLN` — the schema refuses an amount on any other action (and the database refuses it too, 0027). A transition of a
 * milestone (EVM-054) carries the codes of the status before and after (`fromCode`, `toCode`: both or neither, codes of a closed list;
 * 0029 checks the shape) — only an event of a payment milestone has them in EVM-054.
 */
import { z } from 'zod';
import { CUSTOMER_EVENT_TYPES, type CustomerEvent } from '../../customers/index.ts';
import { IDENTITY_EVENT_TYPES, REASON_CODES, type IdentityEvent } from '../../identity/index.ts';
import { MEDIA_EVENT_TYPES, type MediaAuditEvent } from '../../media/index.ts';
import { PARTY_EVENT_TYPES, type PartyEvent } from '../../parties/index.ts';
import { PAYMENT_MILESTONE_EVENT_TYPES, type PaymentMilestoneEvent } from '../../payments/index.ts';
import { PROCEDURE_EVENT_TYPES, type ProcedureAuditEvent } from '../../procedures/index.ts';
import { SITE_EVENT_TYPES, type SiteEvent } from '../../sites/index.ts';
import { TIMELINE_EVENT_TYPES, type TimelineEntryEvent } from '../../timeline/index.ts';
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
  ...PROCEDURE_EVENT_TYPES,
  ...TIMELINE_EVENT_TYPES,
  ...PAYMENT_MILESTONE_EVENT_TYPES,
  ...MEDIA_EVENT_TYPES,
] as const;
export const AUDIT_OBJECT_TYPES = [
  'user',
  'session',
  'passkey',
  'audit',
  'work_order',
  'scope_item',
  'customer',
  'site',
  'party',
  'procedure',
  'procedure_stage',
  'timeline_entry',
  'payment_milestone',
  'media_asset',
] as const;
export const AUDIT_OUTCOMES = ['success', 'denied', 'failed'] as const;

const PAYMENT_ACTION_PREFIX = 'payment_milestone.';
/** The one identity event that carries codes: the role before and after (EVM-027). */
const ROLE_CHANGE_ACTION = 'user.role_changed';
/** The new scan of a quarantined file carries the state before and after (EVM-049): the result, never the reason. */
const RESCAN_ACTION = 'media_file.rescanned';
const amountMinor = z.int().min(1).max(99_999_999_999).nullable();
const statusCode = z
  .string()
  .regex(/^[a-z][a-z_]{0,39}$/)
  .nullable();

export const auditRecordSchema = z
  .strictObject({
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
    amountBeforeMinor: amountMinor,
    amountAfterMinor: amountMinor,
    currency: z.literal('PLN').nullable(),
    fromCode: statusCode,
    toCode: statusCode,
  })
  .refine(
    (record) =>
      record.amountBeforeMinor === null && record.amountAfterMinor === null
        ? record.currency === null
        : record.currency === 'PLN' && record.action.startsWith(PAYMENT_ACTION_PREFIX),
    { message: 'an amount belongs to an event of a payment milestone only, with its currency' },
  )
  .refine(
    (record) =>
      record.fromCode === null && record.toCode === null
        ? true
        : record.fromCode !== null &&
          record.toCode !== null &&
          (record.action.startsWith(PAYMENT_ACTION_PREFIX) || record.action === ROLE_CHANGE_ACTION || record.action === RESCAN_ACTION),
    {
      message:
        'the codes of a status belong to a transition of a payment milestone, a change of a role or a new scan of a file only, both together',
    },
  );

export type AuditRecord = z.infer<typeof auditRecordSchema>;

/** Maps an identity event and its request context to the record; throws when something is outside the closed lists. */
export function toAuditRecord(
  event:
    | IdentityEvent
    | AuditReadEvent
    | BulkReadEvent
    | CustomerEvent
    | SiteEvent
    | PartyEvent
    | WorkOrderEvent
    | ProcedureAuditEvent
    | TimelineEntryEvent
    | PaymentMilestoneEvent
    | MediaAuditEvent,
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
    ...amountsOf(event),
    ...codesOf(event),
  });
}

/** The codes of the status before and after of an event of a payment milestone (EVM-054); `null` for every other event. */
function codesOf(event: object): { fromCode: string | null; toCode: string | null } {
  return {
    fromCode: 'fromCode' in event ? (event.fromCode as string | null) : null,
    toCode: 'toCode' in event ? (event.toCode as string | null) : null,
  };
}

/** The amounts of an event of a payment milestone (the exception); `null` for every other event. */
function amountsOf(event: object): { amountBeforeMinor: number | null; amountAfterMinor: number | null; currency: 'PLN' | null } {
  const before = 'amountBeforeMinor' in event ? (event.amountBeforeMinor as number | null) : null;
  const after = 'amountAfterMinor' in event ? (event.amountAfterMinor as number | null) : null;
  return { amountBeforeMinor: before, amountAfterMinor: after, currency: before === null && after === null ? null : 'PLN' };
}
