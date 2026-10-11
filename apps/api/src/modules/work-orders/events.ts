/**
 * Domain events of the `work-orders` module (EVM-022). Published through the platform event bus inside the transaction of the
 * change; `audit` subscribes to them (the dependency points from `audit` to this file, never back). The event type is the audit
 * action: `<object>.<past tense>`. An event carries identifiers and codes only — never the title, the description, the notes, the
 * parameters or a name (the audit trail is append-only and cannot be erased, RODO art. 17). The entry of the journal of the order
 * itself (`work_order_created`, EVM-038) is written by `timeline`, which subscribes to `work_order.created` and to the journal
 * events below. The cancellation and the restoration of an order (EVM-030) are audited: the reason of a cancellation is free text
 * and never part of the event. The change of the data of an order and of its scope (EVM-035) is audited too, and the REMOVAL of a
 * scope item is an action of its own (`scope_item.deleted`), so a soft delete is told apart in the trail (domain-model.md →
 * "Przejścia audytowane").
 */
import type { DomainEvent } from '../../platform/events/event-bus.ts';
import type { WorkOrderStatus } from './domain/work-order-list-query.ts';
import type { WorkOrderField } from './domain/work-order-patch.ts';
import type { ScopeItemField } from './domain/scope-item-rules.ts';

export const WORK_ORDER_EVENT_TYPES = [
  'work_order.created',
  'work_order.cancelled',
  'work_order.restored',
  'work_order.updated',
  'scope_item.created',
  'scope_item.updated',
  'scope_item.deleted',
] as const;

export interface WorkOrderEvent extends DomainEvent {
  readonly type: (typeof WORK_ORDER_EVENT_TYPES)[number];
  readonly actor: { readonly type: 'user'; readonly userId: string };
  readonly outcome: 'success';
  /** `scope_item` for the three events of the scope: the object is the item (its order is a column of the item). */
  readonly objectType: 'work_order' | 'scope_item';
  readonly objectId: string;
}

/**
 * The changes of an order for the JOURNAL (EVM-038, EVM-035), published inside the transaction of the change. They are NOT in
 * `WORK_ORDER_EVENT_TYPES`: `audit` does not subscribe to them (the journal of an order does not replace the audit trail). They
 * carry the actor, the identifiers, the codes and the NAMES of the changed fields — never the reason of a hold or a cancellation, a
 * title, a description, a note, a value of a parameter or the name of the coordinator (SR-LOG-03, SR-DATA-01).
 */
export const WORK_ORDER_JOURNAL_EVENT_TYPES = [
  'work_order.status_changed',
  'work_order.fields_changed',
  'work_order.scope_item_added',
  'work_order.scope_item_updated',
  'work_order.scope_item_removed',
] as const;

interface WorkOrderJournalEvent extends DomainEvent {
  readonly type: (typeof WORK_ORDER_JOURNAL_EVENT_TYPES)[number];
  readonly actor: { readonly type: 'user'; readonly userId: string };
  readonly outcome: 'success';
}

export interface WorkOrderStatusChangedEvent extends WorkOrderJournalEvent {
  readonly type: 'work_order.status_changed';
  readonly objectType: 'work_order';
  readonly objectId: string;
  readonly fromStatus: WorkOrderStatus;
  readonly toStatus: WorkOrderStatus;
}

/** The data of the order changed (EVM-035 AC1, AC7): the NAMES of the fields that really changed. */
export interface WorkOrderFieldsChangedEvent extends WorkOrderJournalEvent {
  readonly type: 'work_order.fields_changed';
  readonly objectType: 'work_order';
  readonly objectId: string;
  readonly changedFields: readonly WorkOrderField[];
}

interface ScopeItemJournalEvent extends WorkOrderJournalEvent {
  readonly objectType: 'scope_item';
  /** The scope item. */
  readonly objectId: string;
  /** The order the item belongs to. */
  readonly workOrderId: string;
  /** The stable code of the item of the catalogue (the name is read from the catalogue when the journal is shown). */
  readonly itemCode: string;
}

export interface ScopeItemAddedEvent extends ScopeItemJournalEvent {
  readonly type: 'work_order.scope_item_added';
  /** The codes of the processes added with the item (at most 30). */
  readonly procedureCodes: readonly string[];
}

export interface ScopeItemUpdatedEvent extends ScopeItemJournalEvent {
  readonly type: 'work_order.scope_item_updated';
  readonly changedFields: readonly ScopeItemField[];
}

export interface ScopeItemRemovedEvent extends ScopeItemJournalEvent {
  readonly type: 'work_order.scope_item_removed';
}

export type WorkOrderJournalChangeEvent =
  WorkOrderStatusChangedEvent | WorkOrderFieldsChangedEvent | ScopeItemAddedEvent | ScopeItemUpdatedEvent | ScopeItemRemovedEvent;
