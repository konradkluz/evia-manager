/**
 * Domain events of the `sites` module (EVM-021). Published through the platform event bus inside the transaction of the change;
 * `audit` subscribes to them (the dependency points from `audit` to this file, never back). The event type is the audit action:
 * `<object>.<past tense>`. An event carries identifiers and codes only — never an address, a parking spot, a PPE or a note (the
 * audit trail is append-only and cannot be erased, RODO art. 17).
 */
import type { DomainEvent } from '../../platform/events/event-bus.ts';

export const SITE_EVENT_TYPES = ['site.created'] as const;

export interface SiteEvent extends DomainEvent {
  readonly type: (typeof SITE_EVENT_TYPES)[number];
  readonly actor: { readonly type: 'user'; readonly userId: string };
  readonly outcome: 'success';
  readonly objectType: 'site';
  readonly objectId: string;
}
