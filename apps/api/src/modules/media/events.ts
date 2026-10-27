/**
 * Domain events of the `media` module (EVM-044). Published through the platform event bus INSIDE the transaction of the change;
 * `audit` and `timeline` subscribe (the dependency points from them to this file, never back — ADR-0001). An event carries identifiers
 * and codes only: never a file name, a description, a checksum, an object key or the reason of a quarantine (SR-LOG-03, SR-DATA-01;
 * the audit trail is append-only and cannot be erased).
 */
import type { DomainEvent } from '../../platform/events/event-bus.ts';

/** The audit actions: a media asset was created (per medium), a file was put in quarantine by the scan (a malware or a wrong type). */
export const MEDIA_EVENT_TYPES = ['media_asset.created', 'media_file.quarantined'] as const;

export interface MediaAuditEvent extends DomainEvent {
  readonly type: (typeof MEDIA_EVENT_TYPES)[number];
  /** A user for the creation; the system (the scan of the worker) for a quarantine. */
  readonly actor: { readonly type: 'user'; readonly userId: string } | { readonly type: 'system' };
  readonly outcome: 'success';
  readonly objectType: 'media_asset';
  readonly objectId: string;
}

/** The entry of the journal of the order (EVM-038): ONE per batch — the count and the identifiers (at most 50). */
export const MEDIA_JOURNAL_EVENT_TYPES = ['media.assets_added'] as const;

export interface MediaAssetsAddedEvent extends DomainEvent {
  readonly type: 'media.assets_added';
  readonly actor: { readonly type: 'user'; readonly userId: string };
  readonly outcome: 'success';
  readonly workOrderId: string;
  readonly mediaAssetIds: readonly string[];
}
