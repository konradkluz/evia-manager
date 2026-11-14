/**
 * Types of the synchronization that screens may import (EVM-107): no runtime dependency on the transport, the service or the store
 * (dependency-cruiser `mobile-screens-without-adapters`). The screens read `SyncSnapshot` and call `SyncControl`.
 */
import type { OrderDetail } from '../orders/order-detail-model';
import type { OrderRow } from '../orders/order-list-model';
import type { AttentionAction, AttentionReason, EnqueueInput, MutationType, TransportResponse } from '@evia/sync-core';
import type { QuickOrderSource } from '../orders/quick-order-model';
import type { TemplateSet } from '../orders/templates';

export type { AttentionAction, AttentionReason };

/** The one call of the catalogue the phone makes besides the synchronization (EVM-106 AC1; `listWorkOrderTemplates` of the contract). */
export interface TemplateTransport {
  listWorkOrderTemplates(): Promise<TransportResponse>;
}

export type FirstPullFailure = 'network' | 'rate_limited' | 'disk_full' | 'storage' | 'server';
export type SyncFailureKind = 'push' | 'pull' | 'rate_limited';
export type SyncPauseReason =
  'session_revoked' | 'device_wipe_required' | 'upgrade_required' | 'auth_required' | 'forbidden' | 'unexpected_response';

export interface QueueCounts {
  readonly pending: number;
  readonly retrying: number;
  readonly blocked: number;
  readonly attention: number;
  /** Everything not yet sent: this is the `pendingItems` of the requests. */
  readonly unsent: number;
}

export interface FirstPullState {
  /** 1 = "Pobieramy zlecenia…", 2 = "Zapisujemy na telefonie…". */
  readonly step: 1 | 2;
  /** Changes received so far; the server does not announce a total, so the bar is indeterminate. */
  readonly received: number;
  /** No progress for 30 s: the weak-signal notice. */
  readonly slow: boolean;
  readonly failure: FirstPullFailure | null;
  /** Failed attempts since the screen was shown (three lead to "Pomoc"). */
  readonly attempts: number;
  /** When the server asked to wait (429) or the engine will retry. */
  readonly retryAt: number | null;
}

export interface SyncSnapshot {
  /** A service runs for this session (the device checks passed). */
  readonly active: boolean;
  readonly online: boolean;
  readonly syncing: boolean;
  /** `pending` = not known yet; `done` = the list may be shown (the first download finished, also for an account with no orders). */
  readonly initialLoad: 'pending' | 'loading' | 'failed' | 'done';
  readonly firstPull: FirstPullState;
  /** Time of the last successful synchronization (kept in the replica, removed with it). Not the checkpoint of the 7-day rule. */
  readonly lastSuccessAt: number | null;
  readonly counts: QueueCounts;
  readonly failure: SyncFailureKind | null;
  readonly retryAt: number | null;
  /** A full refresh of the replica is running in the background; the list keeps showing the previous generation. */
  readonly resyncing: boolean;
  readonly paused: SyncPauseReason | null;
}

export type QueueItemState = 'pending' | 'sending' | 'attention' | 'blocked';

export interface QueueItem {
  readonly id: string;
  readonly type: MutationType;
  readonly state: QueueItemState;
  readonly createdAt: number;
  /** The work order a note or comment belongs to (a UUID, no content); `null` for a quick work order. */
  readonly targetId: string | null;
  /** Code kept for the technical details (never a server message). */
  readonly code: string | null;
  readonly attempts: number;
  /** Plain-language reason and offered actions, only for `attention` (flow 16). */
  readonly reason: AttentionReason | null;
  readonly actions: readonly AttentionAction[];
  /** Entries waiting behind this one (for a quick work order: its notes and photos). */
  readonly dependents: number;
  /** Text of a note / comment / the title of a quick work order; `null` in the hidden-data mode (never read then). */
  readonly label: string | null;
}

export interface SentItem {
  readonly id: string;
  readonly type: MutationType;
  readonly at: number;
}

export interface QueueView {
  readonly items: readonly QueueItem[];
  /** Results delivered in this session (the "wysłano" rows), newest first, without contents. */
  readonly sent: readonly SentItem[];
}

export type AttentionResult = { readonly ok: true; readonly dependents?: number } | { readonly ok: false; readonly code: string };

export interface TargetOption {
  readonly id: string;
  readonly number: string;
  readonly title: string;
}

export interface SyncControl {
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => SyncSnapshot;
  /** Dotknięcie SyncIndicator / "Ponów" / "Spróbuj ponownie": joins the running cycle, never skips the backoff of a `429`. */
  trigger(): void;
  /** Saves a mutation in the durable queue (before it returns) and starts a cycle when online. Typed error code, never data. */
  enqueue(input: EnqueueInput): Promise<AttentionResult>;
  /** The queue as the "Kolejka" list shows it; contents are read only with `withLabels`. */
  queueView(withLabels: boolean): Promise<QueueView>;
  /**
   * The rows of "Moje zlecenia" (EVM-103): the local replica and the queue only, never the server. `withData = false` in the
   * hidden-data mode: no name, address or place is read at all.
   */
  orderList(withData: boolean): Promise<readonly OrderRow[]>;
  /**
   * The details of one work order (EVM-104): the local replica and the queue only, never the server. `null` = not available (outside
   * the scope of the phone or deleted). Never called in the hidden-data mode.
   */
  orderDetail(workOrderId: string): Promise<OrderDetail | null>;
  /**
   * The templates of work orders stored on the phone (EVM-106 AC1) - the replica only, never the server; `null` = none downloaded yet.
   * Not personal data, so also readable in the hidden-data mode (the form itself is not).
   */
  templates(): Promise<TemplateSet | null>;
  /**
   * The customers and places of the phone for the quick order form (EVM-106 AC2, AC3) - the replica only. Never called in the
   * hidden-data mode; the caller keeps the result in memory only for as long as the form is open.
   */
  quickOrderSource(): Promise<QuickOrderSource>;
  /** Entries that depend on this one, for the confirmation dialog. */
  dependentsOf(id: string): Promise<number>;
  discard(id: string): Promise<AttentionResult>;
  recreate(id: string): Promise<AttentionResult>;
  retarget(id: string, workOrderId: string): Promise<AttentionResult>;
  /** The text to copy for an entry (not available in the hidden-data mode - the caller checks); `null` when unknown. */
  copyText(id: string): Promise<string | null>;
  /** Work orders of the local replica that a note may be moved to (visible data only). */
  retargetOptions(excludeWorkOrderId: string | null): Promise<readonly TargetOption[]>;
}

/** What the composition gives the session root: the control plus the lifecycle (screens use `SyncControl` only). */
export interface SyncRuntime extends SyncControl {
  /** Starts the service for the signed-in session once the owner check has passed; a no-op without a store. */
  startSession(): void;
  /** Ends it (sign-out, end of session, wipe): timers, subscriptions and the run in flight are cancelled. */
  stop(): void;
  setOnline(online: boolean): void;
  /** A pause the app answers with a screen (426, 403) - or the end of the session (401). */
  onPause(listener: (reason: SyncPauseReason) => void): () => void;
}

export const EMPTY_COUNTS: QueueCounts = { pending: 0, retrying: 0, blocked: 0, attention: 0, unsent: 0 };

export const INITIAL_FIRST_PULL: FirstPullState = { step: 1, received: 0, slow: false, failure: null, attempts: 0, retryAt: null };

export const IDLE_SNAPSHOT: SyncSnapshot = {
  active: false,
  online: false,
  syncing: false,
  initialLoad: 'pending',
  firstPull: INITIAL_FIRST_PULL,
  lastSuccessAt: null,
  counts: EMPTY_COUNTS,
  failure: null,
  retryAt: null,
  resyncing: false,
  paused: null,
};
