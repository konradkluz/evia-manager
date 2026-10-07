/**
 * Audit events of the mass-read control (EVM-017 AC5; SR-LOG-03, SR-LOG-06; policy P10). The control only publishes them through
 * a function it is given; the `audit` module subscribes (the platform never imports a module). The event carries the actor and
 * the type of the object read — never a title, a filter value or a count (the trail has no free text).
 */
import type { DomainEvent } from '../events/event-bus.ts';

/** What was read in bulk: work orders (EVM-017) or customers (EVM-020). */
export type BulkReadObjectType = 'work_order' | 'customer';

export const BULK_READ_EVENT_TYPES = ['bulk_read.alerted', 'bulk_read.rejected'] as const;

export interface BulkReadEvent extends DomainEvent {
  readonly type: (typeof BULK_READ_EVENT_TYPES)[number];
  readonly actor: { readonly type: 'user'; readonly userId: string };
  /** `success` for the alert (the read was served), `denied` for the refusal (`429`). */
  readonly outcome: 'success' | 'denied';
  readonly objectType: BulkReadObjectType;
}
