import type {
  ApplyPageInput,
  ApplySnapshotInput,
  EntityKey,
  PendingObjects,
  ReplicaState,
  ResyncReason,
  SweepResult,
  SweepRule,
  WriteOutcome,
} from './pull-types.ts';
import type { EngineEvent, QueueRecord, RecordPatch, SettledInfo, WireMutation } from './types.ts';

/**
 * Durable storage of the queue. Production: SQLCipher only (EVM-093); never AsyncStorage or plain files (SR-MOB-01, MASVS-STORAGE-1).
 * Every method resolves only after the change is durable.
 */
export interface QueueStore {
  /** Appends at the end (insertion order is the queue order). */
  append(record: QueueRecord): Promise<void>;
  /** All entries in insertion order, as stored — unvalidated (the core validates after reading, SR-MOB-10). */
  readAll(): Promise<readonly unknown[]>;
  update(mutationId: string, patch: RecordPatch): Promise<void>;
  /** Removes the mutation and hands the result to the consumer atomically (one transaction in the adapter). */
  settle(mutationId: string, info: SettledInfo): Promise<void>;
}

export interface SyncRequest {
  readonly mutations: readonly WireMutation[];
  /** Number of items still waiting on the phone (W-17, informational for the server). */
  readonly pendingItems: number;
}

/** The transport maps HTTP and network outcomes; it must not pass messages, bodies or causes of errors on. */
export type TransportResponse =
  | { readonly kind: 'ok'; readonly body: unknown }
  | { readonly kind: 'http'; readonly status: number; readonly code?: string; readonly retryAfter?: string | number }
  | { readonly kind: 'network' };

export interface Transport {
  sendBatch(request: SyncRequest): Promise<TransportResponse>;
}

export interface Clock {
  /** Epoch milliseconds. */
  now(): number;
}

/** Production: a CSPRNG (`crypto.getRandomValues` / expo-crypto). Fills and returns the array. */
export interface Random {
  getRandomValues(bytes: Uint8Array): Uint8Array;
}

export type RefreshResult = 'refreshed' | 'session_revoked' | 'unavailable';

/**
 * The session of the signed-in user. `refresh` must persist the new refresh token before it hands out the new access token and
 * must hold the cross-process lock (background task) itself.
 */
export interface SessionOwner {
  currentUserId(): Promise<string | null>;
  refresh(): Promise<RefreshResult>;
}

export interface EventSink {
  emit(event: EngineEvent): void;
}

/** Monotonic clock for the offline-contact rule (AC7). Must be continuous within one `bootId` (Android: `elapsedRealtime`). */
export interface MonotonicClock {
  monotonicNow(): number;
  /** Identifier of the boot (or, when the adapter only has per-process time, of the process). */
  bootId(): string;
}

/** One call of the pull API; same outcome model as the push transport. Segments of paths are encoded by the adapter. */
export interface PullTransport {
  getChanges(request: { readonly cursor?: string; readonly limit: number }): Promise<TransportResponse>;
  getWorkOrderSnapshot(workOrderId: string): Promise<TransportResponse>;
  getClientConfig(): Promise<TransportResponse>;
}

export interface PendingObjectsSource {
  read(): Promise<PendingObjects>;
}

/**
 * The only durable surface of the replica (production: SQLCipher, EVM-093). Every write method is ONE transaction: on failure
 * nothing is stored. Generation numbers are never reused, so a response fetched before a wipe cannot be applied afterwards.
 * Bulk contract (no N+1): `readVersions` and `findWorkOrdersBySite` get a whole page at once, `sweep` and cascades are set operations.
 * Semantics every adapter must reproduce (executable: `@evia/sync-core/conformance/replica`, run on the fake here and on SQLCipher):
 * a write to a generation that is gone returns `stale`; `plannedResync` is stored for the ACTIVE generation only; a delete marker keeps
 * the maximum version and blocks older upserts; deleting a work order cascades to its children; `initialLoadDone` is sticky.
 */
export interface ReplicaStore {
  loadState(): Promise<ReplicaState>;
  /** Versions (and tombstone versions) of the generation for the given keys: one call per page. */
  readVersions(
    generation: number,
    keys: readonly EntityKey[],
  ): Promise<ReadonlyMap<EntityKey, { readonly version: number; readonly deleted: boolean }>>;
  /** Ids of work orders that point to the given sites (to hydrate them when a site's references are unresolved). */
  findWorkOrdersBySite(generation: number, siteIds: readonly string[]): Promise<ReadonlyMap<string, readonly string[]>>;
  /** Ops + cursor + hydration list + planned resync + owner + last server time in one transaction. `stale` if the generation is gone. */
  applyPage(input: ApplyPageInput): Promise<WriteOutcome>;
  applySnapshot(input: ApplySnapshotInput): Promise<WriteOutcome>;
  /** New shadow generation (a previous shadow is dropped), clears `pendingResync`; one transaction. Returns the generation. */
  beginShadow(reason: ResyncReason): Promise<number>;
  /** Replaces the active generation with the shadow, drops the old generation (data, tombstones, list), moves the cursor. */
  promoteShadow(generation: number): Promise<WriteOutcome>;
  discardShadow(): Promise<void>;
  /** Removes both generations, cursors, lists, tombstones and the owner. Never touches the queue. */
  wipeReplica(): Promise<void>;
  sweep(rule: SweepRule): Promise<SweepResult>;
  saveContact(record: unknown): Promise<void>;
  saveConfig(config: unknown): Promise<void>;
}
