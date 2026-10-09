/**
 * Domain events of the `parties` module (EVM-021). Published through the platform event bus inside the transaction of the
 * change; `audit` subscribes to them (the dependency points from `audit` to this file, never back). The event type is the audit
 * action: `<object>.<past tense>`. An event carries identifiers and codes only — never a name (of a natural person too), a
 * telephone number, an e-mail address or a note (the audit trail is append-only and cannot be erased, RODO art. 17).
 */
import type { DomainEvent } from '../../platform/events/event-bus.ts';

export const PARTY_EVENT_TYPES = ['party.created', 'party.updated'] as const;

export interface PartyEvent extends DomainEvent {
  readonly type: (typeof PARTY_EVENT_TYPES)[number];
  readonly actor: { readonly type: 'user'; readonly userId: string };
  readonly outcome: 'success';
  readonly objectType: 'party';
  readonly objectId: string;
}
