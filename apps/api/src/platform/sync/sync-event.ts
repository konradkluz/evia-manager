/**
 * Audit events of the pull of changes (EVM-096 AC8; AB-08, SR-LOG-03; ADR-0021 addendum on the dictionary of the audit trail): a FULL download of a phone -
 * its start (`success`) or its refusal by the limit per day (`denied`), and its end (`sync.full_download_completed`) with the counts of the entities by type
 * (the only numbers the trail holds; no personal data, no free text), and (EVM-097) the snapshot of one order - served (with the NUMBER of its entities) or refused by the
 * limit per hour. Like the events of the mass-read control they live in `platform`: `sync` publishes them
 * and `audit` subscribes, so nothing depends on `sync` (ADR-0021 D8). The register `sync.full_downloads` keeps the same counts for the limit.
 */
import type { DomainEvent } from '../events/event-bus.ts';

export const SYNC_EVENT_TYPES = ['sync.full_download', 'sync.full_download_completed', 'sync.work_order_snapshot'] as const;

/**
 * The applied mutation of a phone (EVM-098 AC8; SR-LOG-03, SR-LOG-04): written in the transaction of the change, so it exists exactly when the entry does. The
 * record is self-contained - the type of the command, the order, the entry and the device besides the actor, the session, the trace and the time - so it says
 * what happened even after the entry is redacted. Never the text, never the category.
 */
export const SYNC_MUTATION_EVENT_TYPES = ['sync.mutation_applied'] as const;

/** The commands whose application is audited (the database keeps the same closed list, widened by 0058 for `CreateQuickWorkOrder`). */
export const AUDITED_COMMAND_TYPES = ['CreateNote', 'CreateComment', 'CreateQuickWorkOrder'] as const;

/**
 * The refusal of a command that would pass the limit of new customers or sites of a device (EVM-099 AC7; AB-08, SR-API-07, SR-LOG-03): written in a short transaction
 * of its own AFTER the rollback of the mutation, once per device, kind and hour. The record has the device and the kind (`customer` | `site`) and nothing else -
 * no name, no telephone, no address, no identifier of the command.
 */
export const SYNC_QUOTA_EVENT_TYPES = ['sync.quota_exceeded'] as const;
export const QUOTA_KINDS = ['customer', 'site'] as const;

export interface SyncQuotaAuditEvent extends DomainEvent {
  readonly type: (typeof SYNC_QUOTA_EVENT_TYPES)[number];
  readonly actor: { readonly type: 'user'; readonly userId: string };
  readonly outcome: 'denied';
  readonly objectType: 'device';
  readonly objectId: string;
  readonly deviceId: string;
  readonly quotaKind: (typeof QUOTA_KINDS)[number];
}

export interface SyncMutationAuditEvent extends DomainEvent {
  readonly type: (typeof SYNC_MUTATION_EVENT_TYPES)[number];
  readonly actor: { readonly type: 'user'; readonly userId: string };
  readonly outcome: 'success';
  readonly objectType: 'timeline_entry' | 'work_order';
  /** The entry (a note, a comment) or the order (`CreateQuickWorkOrder`) the mutation created. */
  readonly objectId: string;
  readonly deviceId: string;
  readonly workOrderId: string;
  readonly commandType: (typeof AUDITED_COMMAND_TYPES)[number];
}

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
