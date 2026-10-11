/**
 * Domain events of the `timeline` module (EVM-037). Published through the platform event bus inside the transaction of the change;
 * `audit` subscribes to them (the dependency points from `audit` to this file, never back). The event type is the audit action:
 * `<object>.<past tense>`. An event carries identifiers only — NEVER the text of the entry, its category or the name of its stage
 * (the text may name a customer or a party, and the audit trail is append-only and cannot be erased, RODO art. 17; SR-LOG-02,
 * SR-LOG-03). The object is the entry; its order, kind and the entry it corrects are columns of the entry itself (append-only, so
 * they cannot drift) and are read from there by the identifier.
 */
import type { DomainEvent } from '../../platform/events/event-bus.ts';

export const TIMELINE_EVENT_TYPES = ['timeline_entry.created'] as const;

export interface TimelineEntryEvent extends DomainEvent {
  readonly type: (typeof TIMELINE_EVENT_TYPES)[number];
  readonly actor: { readonly type: 'user'; readonly userId: string };
  readonly outcome: 'success';
  readonly objectType: 'timeline_entry';
  readonly objectId: string;
}
