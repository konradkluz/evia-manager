/**
 * Domain events of the `media` module (EVM-044). Published through the platform event bus INSIDE the transaction of the change;
 * `audit` and `timeline` subscribe (the dependency points from them to this file, never back — ADR-0001). An event carries identifiers
 * and codes only: never a file name, a description, a checksum, an object key or the reason of a quarantine (SR-LOG-03, SR-DATA-01;
 * the audit trail is append-only and cannot be erased).
 */
import type { DomainEvent } from '../../platform/events/event-bus.ts';

/**
 * The audit actions: a media asset was created (per medium), a file was put in quarantine by the scan (a malware or a wrong type), an
 * Administrator asked for a new scan of it (EVM-049), the worker's new scan of it ended (the result is the code `toCode`: `clean`,
 * `quarantined` or `failed`, never the reason), the object of a file was removed after 30 days of quarantine. EVM-045 (SR-FILE-07, SR-FILE-10,
 * SR-LOG-03): the address of an ORIGINAL was issued (`original_downloaded`, in the transaction of the issue), a Read-only caller asked for one
 * (`original_download_denied`), the user passed the alert threshold of the addresses of a window (`download_alerted`) and the first refusal
 * of a window for the limit (`download_rejected`). The object is always the medium; never an address, a name or a key.
 */
export const MEDIA_EVENT_TYPES = [
  'media_asset.created',
  'media_file.quarantined',
  'media_file.rescan_requested',
  'media_file.rescanned',
  'media_file.quarantine_purged',
  'media_file.original_downloaded',
  'media_file.original_download_denied',
  'media_file.download_alerted',
  'media_file.download_rejected',
  // EVM-047: the documents - created (the class as a code), the class raised (`fromCode`, `toCode`), the address of the file issued or refused (the class as a code)
  'document.created',
  'document.confidentiality_raised',
  'document_file.downloaded',
  'document_file.download_denied',
] as const;

/** The confidentiality classes as the codes of an audit event (a closed list; never a title, a name or a reason). */
export type ClassCode = 'standard' | 'building_security' | 'identity_data';

export interface MediaAuditEvent extends DomainEvent {
  readonly type: (typeof MEDIA_EVENT_TYPES)[number];
  /** A user for the creation; the system (the scan of the worker) for a quarantine. */
  readonly actor: { readonly type: 'user'; readonly userId: string } | { readonly type: 'system' };
  readonly outcome: 'success' | 'denied';
  /** A medium, or - for the events of EVM-047 and the quarantine of the file of a document - a document (the object is its id). */
  readonly objectType: 'media_asset' | 'document';
  readonly objectId: string;
  /** Only `media_file.rescanned`: the state before and after the new scan (a closed list of codes, never a reason). */
  readonly fromCode?: 'quarantined' | ClassCode;
  readonly toCode?: 'clean' | 'quarantined' | 'failed' | ClassCode;
}

/** The entry of the journal of the order (EVM-038): ONE per batch — the count and the identifiers (at most 50). */
export const MEDIA_JOURNAL_EVENT_TYPES = ['media.assets_added', 'media.document_added'] as const;

export interface MediaAssetsAddedEvent extends DomainEvent {
  readonly type: 'media.assets_added';
  readonly actor: { readonly type: 'user'; readonly userId: string };
  readonly outcome: 'success';
  readonly workOrderId: string;
  readonly mediaAssetIds: readonly string[];
}

/** The entry of the journal of the order for a new document (EVM-047 AC1): the identifier and the code of the kind - never the title or the file name. */
export interface DocumentAddedEvent extends DomainEvent {
  readonly type: 'media.document_added';
  readonly actor: { readonly type: 'user'; readonly userId: string };
  readonly outcome: 'success';
  readonly workOrderId: string;
  readonly documentId: string;
  readonly kindCode: string;
}
