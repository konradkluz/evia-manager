/**
 * Own types of the pull side (EVM-092): like the push side, the core does not import the OpenAPI contract at runtime; compatibility
 * with `SyncChangesPage`, `SyncResyncRequired`, `SyncWorkOrderSnapshot` and `ClientConfig` is proven by a test (EVM-107).
 */

export const ENTITY_TYPES = [
  'work_order',
  'customer',
  'site',
  'party',
  'scope_item',
  'procedure_stage',
  'timeline_entry',
  'media_asset',
  'user',
] as const;
export type EntityType = (typeof ENTITY_TYPES)[number];

/** Key of an object in the replica (`type:id`); the id is validated as a UUID before a key is built. */
export type EntityKey = `${EntityType}:${string}`;
export const entityKey = (type: EntityType, id: string): EntityKey => `${type}:${id}`;

export type FieldValue = string | number | boolean | null | Readonly<Record<string, string | number | boolean>>;

/** An object of the replica: only fields of its projection, copied one by one (never a spread of server data). */
export interface ReplicaEntity {
  readonly type: EntityType;
  readonly id: string;
  readonly version: number;
  readonly fields: Readonly<Record<string, FieldValue>>;
}

/** Cursor of the change feed: opaque to the client; the only thing we check is the shape (SR-SYNC-07). */
export const CURSOR_PATTERN = /^[A-Za-z0-9_-]{16,1024}$/;

export const RESYNC_REASONS = [
  'periodic',
  'access_changed',
  'scope_changed',
  'cursor_expired',
  'cursor_invalid',
  'invalid_change',
] as const;
/** Reasons of the contract plus the local one (`invalid_change`); an unknown reason of the server maps to `periodic` (ADR-0021 D2). */
export type ResyncReason = (typeof RESYNC_REASONS)[number];

export const HYDRATION_REASONS = ['unknown_anchor', 'missing_reference', 'not_found'] as const;
export type HydrationReason = (typeof HYDRATION_REASONS)[number];

/** A work order whose snapshot (`GET /sync/work-orders/{id}`) must be fetched; persisted in the same transaction as the page. */
export interface HydrationItem {
  readonly workOrderId: string;
  readonly reason: HydrationReason;
}

export type ChangePhase = 'snapshot' | 'changes';

export interface WireDelete {
  readonly type: EntityType;
  readonly id: string;
  /** The contract's delete marker carries no version today; ADR-0021 D3 allows one. Absent = unknown. */
  readonly version?: number;
}

export type ParsedChange =
  | { readonly kind: 'upsert'; readonly entity: ReplicaEntity }
  | ({ readonly kind: 'delete' } & WireDelete)
  | { readonly kind: 'unknown' }
  | { readonly kind: 'invalid'; readonly reason: 'malformed' | 'projection_mismatch'; readonly type: EntityType | 'unknown' };

export interface ChangesPage {
  readonly result: 'changes';
  readonly phase: ChangePhase;
  readonly changes: readonly unknown[];
  readonly cursor: string;
  readonly hasMore: boolean;
  /** Epoch milliseconds. */
  readonly serverTime: number;
}

export interface ResyncRequired {
  readonly result: 'resync_required';
  readonly reason: ResyncReason;
  readonly serverTime: number;
}

export interface WorkOrderSnapshot {
  readonly serverTime: number;
  readonly entities: readonly unknown[];
}

/** Parameters from `GET /meta/client-config` after validation (ADR-0021 D7); out-of-range values become defaults. */
export interface ClientConfig {
  readonly offlineContactWindowDays: number;
  readonly closedWorkOrdersInScopeDays: number;
  readonly periodicResyncDays: number;
  readonly scopeRuleVersion: string;
}

export const DEFAULT_CLIENT_CONFIG: ClientConfig = {
  offlineContactWindowDays: 7,
  closedWorkOrdersInScopeDays: 30,
  periodicResyncDays: 7,
  scopeRuleVersion: '',
};

export type ReplicaOp =
  | { readonly op: 'upsert'; readonly entity: ReplicaEntity }
  | { readonly op: 'delete'; readonly type: EntityType; readonly id: string; readonly version: number };

/** What the replica store keeps for one generation (raw: the core validates after reading, SR-MOB-10). */
export interface GenerationState {
  readonly generation: number;
  readonly cursor: unknown;
  /** Cycle state: the feed reached its end (`hasMore = false` in phase `changes`). Drops to `false` on the next incremental page. */
  readonly complete: boolean;
  /**
   * Durable and never reverted until the replica is wiped: the first download of this generation finished (feed complete and no
   * snapshot left to fetch). A shadow generation gets it when promoted. Until then the active generation may hold a PARTIAL list, so
   * the host shows a loading state instead of the data (`PullEngine.initialLoadDone()`).
   */
  readonly initialLoadDone: boolean;
  readonly hydration: readonly unknown[];
}

export interface ReplicaState {
  /** User the replica belongs to; `null` for an empty replica. */
  readonly ownerUserId: string | null;
  /** Whether the replica holds any data (an entity, a cursor) — an empty replica has nothing to hide. */
  readonly hasData: boolean;
  readonly active: GenerationState;
  readonly shadow: GenerationState | null;
  /** Durable intent "start a full resync" written in the transaction of the page that caused it. */
  readonly pendingResync: unknown;
  readonly lastServerTime: unknown;
  readonly contact: unknown;
  readonly config: unknown;
}

export interface ApplyPageInput {
  readonly generation: number;
  readonly ownerUserId: string;
  readonly ops: readonly ReplicaOp[];
  readonly cursor: string;
  readonly phase: ChangePhase;
  /**
   * The last page of the feed: phase `changes` and no more pages. The store stores it as `complete` and, when the hydration list is
   * empty afterwards, sets the sticky `initialLoadDone` (also after `applySnapshot` that empties the list on a complete generation).
   */
  readonly complete: boolean;
  readonly serverTime: number;
  readonly hydrationAdd: readonly HydrationItem[];
  readonly hydrationRemove: readonly string[];
  /** Written in the same transaction (active generation only); the next cycle starts a shadow generation. */
  readonly plannedResync?: ResyncReason;
}

export interface ApplySnapshotInput {
  readonly generation: number;
  readonly ownerUserId: string;
  readonly ops: readonly ReplicaOp[];
  readonly serverTime: number;
  readonly hydrationRemove: readonly string[];
  /** 404: remove the whole aggregate (the work order and its children) and the list entry in the same transaction. */
  readonly removeWorkOrderId?: string;
}

export type WriteOutcome = 'applied' | 'stale';

export interface SweepRule {
  readonly generation: number;
  /** Work orders `settled`/`cancelled` with `closedAt` before this instant leave the scope (epoch ms, from server time). */
  readonly closedBefore: number;
  /** Work orders that pending mutations point to or create: not removed by the time rule. */
  readonly keepWorkOrderIds: readonly string[];
  /** Ids of customers/sites/parties/users that pending objects reference: not removed as orphans. */
  readonly keepReferencedIds: readonly string[];
}

export interface SweepResult {
  readonly removedWorkOrders: number;
  readonly removedOrphans: number;
}

/** Objects created on the phone and not yet confirmed (derived from the queue — the queue stays the source of truth). */
export interface PendingObjects {
  readonly objectIds: ReadonlySet<string>;
  readonly workOrderIds: ReadonlySet<string>;
  readonly referencedIds: ReadonlySet<string>;
}

export const EMPTY_PENDING: PendingObjects = { objectIds: new Set(), workOrderIds: new Set(), referencedIds: new Set() };

/** Result of reading a record of the last contact with the server (AC7). */
export type Visibility =
  | { readonly visible: true }
  | { readonly visible: false; readonly reason: 'no_contact_record' | 'window_elapsed' | 'clock_anomaly' | 'owner_mismatch' };
