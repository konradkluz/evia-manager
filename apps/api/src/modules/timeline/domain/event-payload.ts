/**
 * The events of the journal of an order (EVM-038 AC1, AC2; SR-LOG-03, SR-DATA-01; ASVS V14.1.1, V16.2.1; CWE-359): the ONE place
 * that says which codes exist, which keys the payload of each has, and how a domain event of another module becomes one. Pure
 * functions of data — no database, no framework.
 *
 * Minimisation: the payload of an event is built from a CLOSED list of keys per code and validated with a STRICT schema before it is
 * written: the code of a status, the type and the identifier of the object, the identifier of the party waited for, the stable codes
 * of an item of the catalogue and of its processes (EVM-035) and the NAMES of the changed fields. Never the reason of a block or a
 * hold, a name of a party, a stage, a payment milestone or a person, the title, the description, the notes or a value of a parameter,
 * the due date, an amount, an invoice number or the reason of a cancellation (EVM-054, EVM-057): the journal is append-only and the names are read from the current data when the journal is shown, so anonymisation and redaction
 * (RODO art. 17) need no change in the events. A schema that would let a new key through is a defect that fails the write.
 *
 * Reading is TOLERANT (the version of the server may be rolled back after a later story added its codes): an unknown code or a
 * payload that does not fit gives a neutral view, never a failure of the whole page.
 */
import { zPaymentMilestoneStatus, zStageStatus, zStageWaitingOn, zWorkOrderStatus } from '@evia/contracts/zod';
import { z } from 'zod';
import type { DocumentAddedEvent, MediaAssetsAddedEvent } from '../../media/index.ts';
import type { PaymentMilestoneJournalEvent } from '../../payments/index.ts';
import type { StageJournalChangeEvent } from '../../procedures/index.ts';
import type { ScopeItemField, WorkOrderEvent, WorkOrderField, WorkOrderJournalChangeEvent } from '../../work-orders/index.ts';

export const JOURNAL_EVENT_CODES = [
  'work_order_created',
  'work_order_status_changed',
  'stage_status_changed',
  'stage_waiting_on_changed',
  'stage_updated',
  'work_order_fields_changed',
  'scope_item_added',
  'scope_item_updated',
  'scope_item_removed',
  'procedure_added',
  'procedure_removed',
  'procedure_restored',
  'stage_added',
  'stage_removed',
  'stage_restored',
  'payment_milestone_status_changed',
  'payment_milestone_deleted',
  'media_assets_added',
  'document_added',
] as const;
export type JournalEventCode = (typeof JOURNAL_EVENT_CODES)[number];

/** The names of the fields of a stage whose change is recorded (the values are NOT). */
export const JOURNAL_STAGE_FIELDS = ['responsibleUserId', 'dueDate'] as const;
/** The names of the fields of an order and of a scope item whose change is recorded (EVM-035; the values are NOT) — the lists of `work-orders`. */
export const JOURNAL_WORK_ORDER_FIELDS = [
  'title',
  'description',
  'plannedDate',
  'coordinator',
] as const satisfies readonly WorkOrderField[];
export const JOURNAL_SCOPE_ITEM_FIELDS = ['parameters', 'notes'] as const satisfies readonly ScopeItemField[];

const workOrderObject = { objectType: z.literal('work_order'), objectId: z.uuid() };
const stageObject = { objectType: z.literal('procedure_stage'), objectId: z.uuid() };
const procedureObject = { objectType: z.literal('procedure'), objectId: z.uuid() };
const scopeItemObject = { objectType: z.literal('scope_item'), objectId: z.uuid() };
const paymentMilestoneObject = { objectType: z.literal('payment_milestone'), objectId: z.uuid() };

/** A stable code of the catalogue (`snake_case`) — the item and the processes are named by it, never by a name. */
const catalogCode = z.string().regex(/^[a-z][a-z0-9_]{1,63}$/);
/** The most processes an order may have, so the most an item may bring at once. */
const MAX_PROCEDURE_CODES = 30;
/** The most media one request adds (the contract: `maxItems` 50). */
const MAX_MEDIA_PER_BATCH = 50;

/** The closed list of keys of every code. */
const SHAPES = {
  work_order_created: workOrderObject,
  work_order_status_changed: { ...workOrderObject, fromStatus: zWorkOrderStatus, toStatus: zWorkOrderStatus },
  stage_status_changed: {
    ...stageObject,
    fromStatus: zStageStatus,
    toStatus: zStageStatus,
    waitingOn: zStageWaitingOn.nullable(),
    waitingOnPartyId: z.uuid().nullable(),
  },
  stage_waiting_on_changed: { ...stageObject, waitingOn: zStageWaitingOn, waitingOnPartyId: z.uuid().nullable() },
  stage_updated: { ...stageObject, changedFields: z.array(z.enum(JOURNAL_STAGE_FIELDS)).min(1).max(JOURNAL_STAGE_FIELDS.length) },
  work_order_fields_changed: {
    ...workOrderObject,
    changedFields: z.array(z.enum(JOURNAL_WORK_ORDER_FIELDS)).min(1).max(JOURNAL_WORK_ORDER_FIELDS.length),
  },
  scope_item_added: { ...scopeItemObject, itemCode: catalogCode, procedureCodes: z.array(catalogCode).max(MAX_PROCEDURE_CODES) },
  scope_item_updated: {
    ...scopeItemObject,
    itemCode: catalogCode,
    changedFields: z.array(z.enum(JOURNAL_SCOPE_ITEM_FIELDS)).min(1).max(JOURNAL_SCOPE_ITEM_FIELDS.length),
  },
  scope_item_removed: { ...scopeItemObject, itemCode: catalogCode },
  // EVM-042: the code of the process (of the stage's process for a stage) — never the name of a stage
  procedure_added: { ...procedureObject, procedureCode: catalogCode },
  procedure_removed: { ...procedureObject, procedureCode: catalogCode },
  procedure_restored: { ...procedureObject, procedureCode: catalogCode },
  stage_added: { ...stageObject, procedureCode: catalogCode },
  stage_removed: { ...stageObject, procedureCode: catalogCode },
  stage_restored: { ...stageObject, procedureCode: catalogCode },
  // EVM-054 AC3: the two status codes of the milestone - no amount, no invoice number, no reason, no name
  payment_milestone_status_changed: { ...paymentMilestoneObject, fromStatus: zPaymentMilestoneStatus, toStatus: zPaymentMilestoneStatus },
  // EVM-057 AC4: the soft delete of a milestone - the milestone alone (its name is gone with it), no amount, no number
  payment_milestone_deleted: paymentMilestoneObject,
  // EVM-044 AC1: ONE entry per batch of media - the order, the count and the identifiers (at most 50); never a file name or a description
  media_assets_added: {
    ...workOrderObject,
    count: z.int().min(1).max(MAX_MEDIA_PER_BATCH),
    mediaAssetIds: z.array(z.uuid()).min(1).max(MAX_MEDIA_PER_BATCH),
  },
  // EVM-047 AC1: a document was added - its identifier and the code of its kind; never the title, the description or the file name
  document_added: {
    objectType: z.literal('document'),
    objectId: z.uuid(),
    kindCode: z.string().regex(/^[a-z][a-z0-9_]{1,63}$/),
  },
} as const satisfies Record<JournalEventCode, z.ZodRawShape>;

const STRICT = {
  work_order_created: z.strictObject(SHAPES.work_order_created),
  work_order_status_changed: z.strictObject(SHAPES.work_order_status_changed),
  stage_status_changed: z.strictObject(SHAPES.stage_status_changed),
  stage_waiting_on_changed: z.strictObject(SHAPES.stage_waiting_on_changed),
  stage_updated: z.strictObject(SHAPES.stage_updated),
  work_order_fields_changed: z.strictObject(SHAPES.work_order_fields_changed),
  scope_item_added: z.strictObject(SHAPES.scope_item_added),
  scope_item_updated: z.strictObject(SHAPES.scope_item_updated),
  scope_item_removed: z.strictObject(SHAPES.scope_item_removed),
  procedure_added: z.strictObject(SHAPES.procedure_added),
  procedure_removed: z.strictObject(SHAPES.procedure_removed),
  procedure_restored: z.strictObject(SHAPES.procedure_restored),
  stage_added: z.strictObject(SHAPES.stage_added),
  stage_removed: z.strictObject(SHAPES.stage_removed),
  stage_restored: z.strictObject(SHAPES.stage_restored),
  payment_milestone_status_changed: z.strictObject(SHAPES.payment_milestone_status_changed),
  payment_milestone_deleted: z.strictObject(SHAPES.payment_milestone_deleted),
  media_assets_added: z.strictObject(SHAPES.media_assets_added),
  document_added: z.strictObject(SHAPES.document_added),
} as const;

/** The source events `timeline` turns into entries (`work_order.created` is the creation event of the order, already audited). */
export type CreatedEvent = WorkOrderEvent & { readonly type: 'work_order.created' };
export type JournalSourceEvent =
  | CreatedEvent
  | WorkOrderJournalChangeEvent
  | StageJournalChangeEvent
  | PaymentMilestoneJournalEvent
  | MediaAssetsAddedEvent
  | DocumentAddedEvent;

/** What the store writes: the columns of the entry that an event decides. */
export interface JournalEventRecord {
  readonly code: JournalEventCode;
  readonly payload: Record<string, unknown>;
  readonly workOrderId: string;
  /** The stage the event is about (a composite key pins it to the same order), or `null`. */
  readonly procedureStageId: string | null;
  readonly actorUserId: string;
}

interface Candidate {
  readonly code: JournalEventCode;
  readonly payload: Record<string, unknown>;
  readonly workOrderId: string;
  readonly procedureStageId: string | null;
}

function candidateOf(event: JournalSourceEvent): Candidate {
  switch (event.type) {
    case 'work_order.created':
      return {
        code: 'work_order_created',
        payload: { objectType: 'work_order', objectId: event.objectId },
        workOrderId: event.objectId,
        procedureStageId: null,
      };
    case 'work_order.status_changed':
      return {
        code: 'work_order_status_changed',
        payload: { objectType: 'work_order', objectId: event.objectId, fromStatus: event.fromStatus, toStatus: event.toStatus },
        workOrderId: event.objectId,
        procedureStageId: null,
      };
    case 'work_order.fields_changed':
      return {
        code: 'work_order_fields_changed',
        payload: { objectType: 'work_order', objectId: event.objectId, changedFields: [...event.changedFields] },
        workOrderId: event.objectId,
        procedureStageId: null,
      };
    case 'work_order.scope_item_added':
      return {
        code: 'scope_item_added',
        payload: {
          objectType: 'scope_item',
          objectId: event.objectId,
          itemCode: event.itemCode,
          procedureCodes: [...event.procedureCodes],
        },
        workOrderId: event.workOrderId,
        procedureStageId: null,
      };
    case 'work_order.scope_item_updated':
      return {
        code: 'scope_item_updated',
        payload: {
          objectType: 'scope_item',
          objectId: event.objectId,
          itemCode: event.itemCode,
          changedFields: [...event.changedFields],
        },
        workOrderId: event.workOrderId,
        procedureStageId: null,
      };
    case 'work_order.scope_item_removed':
      return {
        code: 'scope_item_removed',
        payload: { objectType: 'scope_item', objectId: event.objectId, itemCode: event.itemCode },
        workOrderId: event.workOrderId,
        procedureStageId: null,
      };
    case 'procedure_stage.status_changed':
      return {
        code: 'stage_status_changed',
        payload: {
          objectType: 'procedure_stage',
          objectId: event.objectId,
          fromStatus: event.fromStatus,
          toStatus: event.toStatus,
          waitingOn: event.waitingOn,
          waitingOnPartyId: event.waitingOnPartyId,
        },
        workOrderId: event.workOrderId,
        procedureStageId: event.objectId,
      };
    case 'procedure_stage.waiting_on_changed':
      return {
        code: 'stage_waiting_on_changed',
        payload: {
          objectType: 'procedure_stage',
          objectId: event.objectId,
          waitingOn: event.waitingOn,
          waitingOnPartyId: event.waitingOnPartyId,
        },
        workOrderId: event.workOrderId,
        procedureStageId: event.objectId,
      };
    case 'procedure_stage.fields_changed':
      return {
        code: 'stage_updated',
        payload: { objectType: 'procedure_stage', objectId: event.objectId, changedFields: [...event.changedFields] },
        workOrderId: event.workOrderId,
        procedureStageId: event.objectId,
      };
    case 'procedure.added':
    case 'procedure.removed':
    case 'procedure.reinstated':
      return {
        code: PROCEDURE_CODES[event.type],
        payload: { objectType: 'procedure', objectId: event.objectId, procedureCode: event.procedureCode },
        workOrderId: event.workOrderId,
        procedureStageId: null,
      };
    case 'procedure_stage.added':
    case 'procedure_stage.removed':
    case 'procedure_stage.reinstated':
      return {
        code: STAGE_CODES[event.type],
        payload: { objectType: 'procedure_stage', objectId: event.objectId, procedureCode: event.procedureCode },
        workOrderId: event.workOrderId,
        procedureStageId: event.objectId,
      };
    case 'payment_milestone.status_changed':
      return {
        code: 'payment_milestone_status_changed',
        payload: { objectType: 'payment_milestone', objectId: event.objectId, fromStatus: event.fromStatus, toStatus: event.toStatus },
        workOrderId: event.workOrderId,
        procedureStageId: null,
      };
    case 'media.assets_added':
      return {
        code: 'media_assets_added',
        payload: {
          objectType: 'work_order',
          objectId: event.workOrderId,
          count: event.mediaAssetIds.length,
          mediaAssetIds: [...event.mediaAssetIds],
        },
        workOrderId: event.workOrderId,
        procedureStageId: null,
      };
    case 'media.document_added':
      return {
        code: 'document_added',
        payload: { objectType: 'document', objectId: event.documentId, kindCode: event.kindCode },
        workOrderId: event.workOrderId,
        procedureStageId: null,
      };
    case 'payment_milestone.removed':
      return {
        code: 'payment_milestone_deleted',
        payload: { objectType: 'payment_milestone', objectId: event.objectId },
        workOrderId: event.workOrderId,
        procedureStageId: null,
      };
  }
}

const PROCEDURE_CODES = {
  'procedure.added': 'procedure_added',
  'procedure.removed': 'procedure_removed',
  'procedure.reinstated': 'procedure_restored',
} as const;
const STAGE_CODES = {
  'procedure_stage.added': 'stage_added',
  'procedure_stage.removed': 'stage_removed',
  'procedure_stage.reinstated': 'stage_restored',
} as const;

/**
 * The entry for a domain event. The payload is validated with the STRICT schema of its code and the PARSED object is what is
 * written (so a key outside the list cannot be written, whatever the publisher put in the event); a payload that does not fit is a
 * defect that throws — and, as the handler runs in the transaction of the change, rolls the change back (fail closed, AC5).
 */
export function toJournalEvent(event: JournalSourceEvent): JournalEventRecord {
  const candidate = candidateOf(event);
  const payload: Record<string, unknown> = STRICT[candidate.code].parse(candidate.payload);
  return { ...candidate, payload, actorUserId: event.actor.userId };
}

/** What an answer needs from a stored event; every field but `code` may be `null`. */
export interface JournalEventView {
  readonly code: string;
  readonly objectType: 'work_order' | 'procedure' | 'procedure_stage' | 'scope_item' | 'payment_milestone' | null;
  /** The object of the event (its identifier in the payload), else `null` - a payment milestone is named from the current data. */
  readonly objectId: string | null;
  readonly fromStatus: string | null;
  readonly toStatus: string | null;
  readonly waitingOn: 'customer' | 'party' | null;
  readonly waitingOnPartyId: string | null;
  readonly changedFields: readonly string[];
  /** The stable code of the item of the catalogue (the events of the scope), else `null`. */
  readonly itemCode: string | null;
  /** The codes of the processes added with an item (`scope_item_added`), or the code of the process an event of EVM-042 is about, else `null`. */
  readonly procedureCodes: readonly string[] | null;
}

/** The code of the view of an event the server cannot read (a known code whose payload does not fit). */
export const UNKNOWN_EVENT_CODE = 'unknown_event';

const EMPTY = {
  objectId: null,
  fromStatus: null,
  toStatus: null,
  waitingOn: null,
  waitingOnPartyId: null,
  changedFields: [],
  itemCode: null,
  procedureCodes: null,
} as const;

const objectTypeOf = (payload: unknown): JournalEventView['objectType'] => {
  const type = typeof payload === 'object' && payload !== null ? (payload as { objectType?: unknown }).objectType : undefined;
  return type === 'work_order' ||
    type === 'procedure' ||
    type === 'procedure_stage' ||
    type === 'scope_item' ||
    type === 'payment_milestone'
    ? type
    : null;
};

const isKnown = (code: string): code is JournalEventCode => (JOURNAL_EVENT_CODES as readonly string[]).includes(code);

/**
 * Tolerant reading of a stored event. A known code is read with the shape of its code (keys of a later version are ignored); a code
 * the server does not know keeps its code (the panel shows a neutral text) and has no fields; a known code whose payload does not
 * fit becomes {@link UNKNOWN_EVENT_CODE}.
 */
export function readJournalEvent(code: string, payload: unknown): JournalEventView {
  if (!isKnown(code)) return { code, objectType: objectTypeOf(payload), ...EMPTY };
  const parsed = z.object(SHAPES[code]).safeParse(payload);
  if (!parsed.success) return { code: UNKNOWN_EVENT_CODE, objectType: null, ...EMPTY };
  const data = parsed.data as Record<string, unknown>;
  return {
    code,
    objectType: objectTypeOf(data),
    objectId: (data['objectId'] ?? null) as string | null,
    fromStatus: (data['fromStatus'] ?? null) as string | null,
    toStatus: (data['toStatus'] ?? null) as string | null,
    waitingOn: (data['waitingOn'] ?? null) as JournalEventView['waitingOn'],
    waitingOnPartyId: (data['waitingOnPartyId'] ?? null) as string | null,
    changedFields: (data['changedFields'] ?? []) as string[],
    itemCode: (data['itemCode'] ?? null) as string | null,
    procedureCodes: procedureCodesOf(data),
  };
}

/** The codes of the processes of an event: the list of an addition to the scope, or the one code of an event of a process or a stage. */
function procedureCodesOf(data: Record<string, unknown>): string[] | null {
  if (data['procedureCodes'] !== undefined) return data['procedureCodes'] as string[];
  return typeof data['procedureCode'] === 'string' ? [data['procedureCode']] : null;
}
