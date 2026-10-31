import type { EntityType, HydrationReason, ResyncReason } from './pull-types.ts';

/** Own types of the sync core (EVM-091): the core does not import the OpenAPI contract; compatibility is proven by a test. */

export const MUTATION_TYPES = ['CreateNote', 'CreateComment', 'CreateQuickWorkOrder'] as const;
export type MutationType = (typeof MUTATION_TYPES)[number];

/** Limits of the contract (SR-SYNC-06): a mutation up to 64 KB, a batch up to 50 mutations and 1 MB (we stay below). */
export const MAX_MUTATION_BYTES = 64 * 1024;
export const MAX_BATCH_MUTATIONS = 50;
export const MAX_BATCH_BYTES = 900_000;
export const MAX_PENDING_ITEMS = 1_000_000;

/** UUIDv7 as the contract's `SyncClientId` accepts it. */
export const CLIENT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** Codes from outside (server, transport) pass only in this shape (allow-list, no free text; security 8). */
export const CODE_PATTERN = /^[a-z_]{1,64}$/;

export type QueueState = 'pending' | 'retrying' | 'needs_attention' | 'blocked';
export const QUEUE_STATES: readonly QueueState[] = ['pending', 'retrying', 'needs_attention', 'blocked'];

/** What goes on the wire — exactly the contract's envelope (`additionalProperties: false` on the server). */
export interface WireMutation {
  readonly mutationId: string;
  readonly type: MutationType;
  readonly commandVersion: number;
  readonly payload: Readonly<Record<string, unknown>>;
}

/** A record of the local queue: the envelope plus local metadata that never leaves the phone. */
export interface QueueRecord extends WireMutation {
  /** Id of the object the mutation creates (note, comment, work order). */
  readonly objectId: string;
  /** FIFO key: the aggregate (work order) the mutation belongs to. */
  readonly orderingKey: string;
  /** The mutation that must be applied first (e.g. a note for a quick work order). */
  readonly parentMutationId?: string;
  readonly createdAt: number;
  readonly ownerUserId: string;
  readonly state: QueueState;
  readonly attempts: number;
  readonly lastCode?: string;
  readonly nextAttemptAt?: number;
}

/** The part of a record the engine changes after creation. */
export interface RecordPatch {
  readonly state: QueueState;
  readonly attempts: number;
  readonly lastCode?: string;
  readonly nextAttemptAt?: number;
}

/** What the consumer learns when a mutation is closed (handed over in the same call that removes it). */
export interface SettledInfo {
  readonly outcome: 'applied' | 'duplicate';
  readonly warnings: readonly string[];
  readonly workOrderNumber?: string;
}

/** Known rejection codes (an open vocabulary on the server: anything else becomes `unknown`). */
export const KNOWN_REJECTION_CODES = [
  'id_conflict',
  'forbidden',
  'target_unavailable',
  'validation_failed',
  'idempotency_mismatch',
  'template_unavailable',
] as const;

export type PauseReason =
  'session_revoked' | 'device_wipe_required' | 'upgrade_required' | 'auth_required' | 'forbidden' | 'unexpected_response';

/** Diagnostic events and signals: a closed union of identifiers, enums and numbers only (AC7; allow-list, not scrubbing). */
export type EngineEvent =
  | {
      readonly kind: 'signal';
      readonly signal:
        'session_revoked' | 'device_wipe_required' | 'upgrade_required' | 'auth_required' | 'owner_mismatch' | 'replica_stale';
    }
  | { readonly kind: 'paused'; readonly reason: PauseReason }
  | { readonly kind: 'batch_sent'; readonly size: number }
  | { readonly kind: 'mutation_settled'; readonly mutationId: string; readonly outcome: 'applied' | 'duplicate' }
  | { readonly kind: 'needs_attention'; readonly mutationId: string; readonly mutationType: MutationType; readonly code: string }
  | { readonly kind: 'blocked'; readonly mutationId: string }
  | { readonly kind: 'retry_scheduled'; readonly code: string; readonly attempts: number; readonly delayMs: number; readonly size: number }
  | { readonly kind: 'corrupt_record'; readonly index: number }
  | { readonly kind: 'ignored_result' }
  | { readonly kind: 'pull_page_applied'; readonly count: number; readonly phase: 'snapshot' | 'changes' }
  | { readonly kind: 'resync_scheduled'; readonly reason: ResyncReason }
  | { readonly kind: 'resync_completed' }
  | { readonly kind: 'hydration'; readonly reason: HydrationReason }
  | { readonly kind: 'change_invalid'; readonly reason: 'malformed' | 'projection_mismatch'; readonly type: EntityType | 'unknown' }
  | { readonly kind: 'change_unknown_skipped'; readonly count: number }
  | { readonly kind: 'replica_wiped'; readonly reason: 'access_changed' | 'session_revoked' | 'owner_changed' }
  | { readonly kind: 'sweep_done'; readonly removedWorkOrders: number; readonly removedOrphans: number }
  | { readonly kind: 'pull_retry_scheduled'; readonly code: PullFailureCode; readonly attempts: number; readonly delayMs: number }
  | { readonly kind: 'pull_failed'; readonly code: PullFailureCode }
  | { readonly kind: 'data_hidden'; readonly reason: 'no_contact_record' | 'window_elapsed' | 'clock_anomaly' | 'owner_mismatch' };

/** Closed vocabulary of pull failures (no messages of adapters or servers, SR-LOG-08). */
export type PullFailureCode =
  | 'network'
  | 'rate_limited'
  | 'timeout'
  | 'server_error'
  | 'invalid_response'
  | 'invalid_change_in_resync'
  | 'store_failure'
  | 'contact_not_saved'
  | 'unexpected_status';

/** Typed errors carry a fixed code and never data from the payload. */
export type QueueErrorCode = 'no_session' | 'invalid_input' | 'payload_too_large' | 'owner_mismatch' | 'storage_failure';

export class QueueError extends Error {
  readonly code: QueueErrorCode;
  constructor(code: QueueErrorCode) {
    super(code);
    this.name = 'QueueError';
    this.code = code;
  }
}
