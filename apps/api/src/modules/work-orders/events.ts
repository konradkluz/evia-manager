/**
 * Domain events of the `work-orders` module (EVM-022). Published through the platform event bus inside the transaction of the
 * change; `audit` subscribes to them (the dependency points from `audit` to this file, never back). The event type is the audit
 * action: `<object>.<past tense>`. An event carries identifiers and codes only — never the title, the description or a name (the
 * audit trail is append-only and cannot be erased, RODO art. 17). The entry of the journal of the order itself
 * (`work_order_created`, EVM-038) is written by `timeline`, which subscribes to `work_order.created` and to the journal event
 * below. The cancellation and the restoration of an order (EVM-030) are audited: the reason of a cancellation is free text and
 * never part of the event.
 */
import type { DomainEvent } from '../../platform/events/event-bus.ts';
import type { WorkOrderStatus } from './domain/work-order-list-query.ts';

export const WORK_ORDER_EVENT_TYPES = ['work_order.created', 'work_order.cancelled', 'work_order.restored'] as const;

export interface WorkOrderEvent extends DomainEvent {
  readonly type: (typeof WORK_ORDER_EVENT_TYPES)[number];
  readonly actor: { readonly type: 'user'; readonly userId: string };
  readonly outcome: 'success';
  readonly objectType: 'work_order';
  readonly objectId: string;
}

/**
 * The change of the status of an order for the JOURNAL (EVM-038), published inside the transaction of the transition for EVERY
 * transition (the audited actions above exist only for some). It is NOT in `WORK_ORDER_EVENT_TYPES`: `audit` does not subscribe to
 * it (the journal of an order does not replace the audit trail). It carries the actor, the order and the two status codes — never
 * the reason of a hold or a cancellation, a title or a name (SR-LOG-03).
 */
export const WORK_ORDER_JOURNAL_EVENT_TYPES = ['work_order.status_changed'] as const;

export interface WorkOrderStatusChangedEvent extends DomainEvent {
  readonly type: (typeof WORK_ORDER_JOURNAL_EVENT_TYPES)[number];
  readonly actor: { readonly type: 'user'; readonly userId: string };
  readonly outcome: 'success';
  readonly objectType: 'work_order';
  readonly objectId: string;
  readonly fromStatus: WorkOrderStatus;
  readonly toStatus: WorkOrderStatus;
}
