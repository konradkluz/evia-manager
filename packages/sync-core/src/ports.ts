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
