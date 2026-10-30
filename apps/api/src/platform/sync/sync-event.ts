/**
 * Audit events of the pull of changes (EVM-096 AC8; AB-08, SR-LOG-03; ADR-0021 addendum on the dictionary of the audit trail): a FULL download of a phone -
 * its start (`success`) or its refusal by the limit per day (`denied`), and its end (`sync.full_download_completed`) with the counts of the entities by type
 * (the only numbers the trail holds; no personal data, no free text). Like the events of the mass-read control they live in `platform`: `sync` publishes them
 * and `audit` subscribes, so nothing depends on `sync` (ADR-0021 D8). The register `sync.full_downloads` keeps the same counts for the limit.
 */
import type { DomainEvent } from '../events/event-bus.ts';

export const SYNC_EVENT_TYPES = ['sync.full_download', 'sync.full_download_completed'] as const;

export interface SyncAuditEvent extends DomainEvent {
  readonly type: (typeof SYNC_EVENT_TYPES)[number];
  readonly actor: { readonly type: 'user'; readonly userId: string };
  readonly outcome: 'success' | 'denied';
  readonly objectType: 'device';
  readonly objectId: string;
  /** The entities served by type; present exactly on `sync.full_download_completed`. */
  readonly counts?: { readonly workOrders: number; readonly customers: number; readonly sites: number };
}
