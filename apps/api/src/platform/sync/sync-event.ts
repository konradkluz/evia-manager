/**
 * Audit events of the pull of changes (EVM-096 AC8; AB-08, SR-LOG-03; ADR-0021 addendum on the dictionary of the audit trail): a FULL download of a phone -
 * its start (`success`) or its refusal by the limit per day (`denied`), and its end (`sync.full_download_completed`) with the counts of the entities by type
 * (the only numbers the trail holds; no personal data, no free text), and (EVM-097) the snapshot of one order - served (with the NUMBER of its entities) or refused by the
 * limit per hour. Like the events of the mass-read control they live in `platform`: `sync` publishes them
 * and `audit` subscribes, so nothing depends on `sync` (ADR-0021 D8). The register `sync.full_downloads` keeps the same counts for the limit.
 */
import type { DomainEvent } from '../events/event-bus.ts';

export const SYNC_EVENT_TYPES = ['sync.full_download', 'sync.full_download_completed', 'sync.work_order_snapshot'] as const;

export interface SyncAuditEvent extends DomainEvent {
  readonly type: (typeof SYNC_EVENT_TYPES)[number];
  readonly actor: { readonly type: 'user'; readonly userId: string };
  readonly outcome: 'success' | 'denied';
  readonly objectType: 'device';
  readonly objectId: string;
  /** The entities served by type; present exactly on `sync.full_download_completed`. */
  readonly counts?: { readonly workOrders: number; readonly customers: number; readonly sites: number };
  /** The number of entities of a snapshot of an order; present exactly on `sync.work_order_snapshot` with the outcome `success` (EVM-097 AC7: a number, never a content). */
  readonly entityCount?: number;
}
