/**
 * Domain events of the `work-orders` module (EVM-022). Published through the platform event bus inside the transaction of the
 * change; `audit` subscribes to them (the dependency points from `audit` to this file, never back). The event type is the audit
 * action: `<object>.<past tense>`. An event carries identifiers and codes only — never the title, the description or a name (the
 * audit trail is append-only and cannot be erased, RODO art. 17). The entry of the journal of the order itself
 * (`work_order_created`) is a story of its own, EVM-038.
 */
import type { DomainEvent } from '../../platform/events/event-bus.ts';

export const WORK_ORDER_EVENT_TYPES = ['work_order.created'] as const;

export interface WorkOrderEvent extends DomainEvent {
  readonly type: (typeof WORK_ORDER_EVENT_TYPES)[number];
  readonly actor: { readonly type: 'user'; readonly userId: string };
  readonly outcome: 'success';
  readonly objectType: 'work_order';
  readonly objectId: string;
}
