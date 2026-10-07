/**
 * Domain events of the `customers` module (EVM-020). Published through the platform event bus inside the transaction of the
 * change; `audit` subscribes to them (the dependency points from `audit` to this file, never back). The event type is the audit
 * action: `<object>.<past tense>`. An event carries identifiers and codes only — never a name, a telephone number, an e-mail
 * address or a note (the audit trail is append-only and cannot be erased, RODO art. 17).
 */
import type { DomainEvent } from '../../platform/events/event-bus.ts';

export const CUSTOMER_EVENT_TYPES = ['customer.created'] as const;

export interface CustomerEvent extends DomainEvent {
  readonly type: (typeof CUSTOMER_EVENT_TYPES)[number];
  readonly actor: { readonly type: 'user'; readonly userId: string };
  readonly outcome: 'success';
  readonly objectType: 'customer';
  readonly objectId: string;
}
