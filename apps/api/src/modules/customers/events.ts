/**
 * Domain events of the `customers` module (EVM-020). Published through the platform event bus inside the transaction of the
 * change; `audit` subscribes to them (the dependency points from `audit` to this file, never back). The event type is the audit
 * action: `<object>.<past tense>`. An event carries identifiers and codes only — never a name, a telephone number, an e-mail
 * address or a note (the audit trail is append-only and cannot be erased, RODO art. 17). `deleted`, `restored` and `anonymized` (EVM-041) are actions of
 * their own and carry the customer id, the actor and the outcome - nothing else (SR-LOG-03).
 */
import type { DomainEvent } from '../../platform/events/event-bus.ts';

export const CUSTOMER_EVENT_TYPES = [
  'customer.created',
  'customer.updated',
  'customer.deleted',
  'customer.restored',
  'customer.anonymized',
] as const;

export interface CustomerEvent extends DomainEvent {
  readonly type: (typeof CUSTOMER_EVENT_TYPES)[number];
  readonly actor: { readonly type: 'user'; readonly userId: string };
  /** `failed`: the register of deletions refused the record of an anonymization (EVM-041 AC5) - written in a short transaction of its own after the rollback. */
  readonly outcome: 'success' | 'failed';
  readonly objectType: 'customer';
  readonly objectId: string;
}
