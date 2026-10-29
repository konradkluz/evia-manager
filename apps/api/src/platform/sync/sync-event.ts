/**
 * Audit event of the pull of changes (EVM-096 AC8; AB-08, SR-LOG-03; ADR-0021 addendum on the dictionary of the audit trail): a FULL download of a phone -
 * its start (`success`) or its refusal by the limit per day (`denied`). Like the events of the mass-read control it lives in `platform`: `sync` publishes it and
 * `audit` subscribes, so nothing depends on `sync` (ADR-0021 D8). The counts of the entities by type are kept in `sync.full_downloads`; the trail has no counts
 * and no free text.
 */
import type { DomainEvent } from '../events/event-bus.ts';

export const SYNC_EVENT_TYPES = ['sync.full_download'] as const;

export interface SyncAuditEvent extends DomainEvent {
  readonly type: (typeof SYNC_EVENT_TYPES)[number];
  readonly actor: { readonly type: 'user'; readonly userId: string };
  readonly outcome: 'success' | 'denied';
  readonly objectType: 'device';
  readonly objectId: string;
}
