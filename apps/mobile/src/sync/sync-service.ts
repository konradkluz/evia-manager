/**
 * The synchronization service of one signed-in session (EVM-107 AC1-AC5, AC8): composes `createSyncCore` from the ports of the local
 * store and the transport, owns the triggers, the timer of the backoff and the state the screens read. One instance per session and
 * `userId`; `dispose()` ends it (sign-out, `session_revoked`, wipe) and nothing starts afterwards.
 *
 * Rules kept here (architect and security of the story):
 * - the core is the only caller of the engines (single-flight, push/pull order, ADR-0021 pull-first until the first download is done);
 * - the contact of the 7-day rule is written by the core after an authenticated 2xx only, and never while the data are hidden by the
 *   rule (a synchronization does not bring them back - only a full sign-in does);
 * - `lastSuccessAt` is the app's own value (kept in the replica), never the checkpoint of the 7-day rule;
 * - a write to the replica after `dispose()` is refused, so an answer in flight cannot recreate what the wipe removed;
 * - errors of the store are classified into a fixed code (`disk_full`) and dropped; nothing of an answer or a driver message is logged.
 */
import {
  createSyncCore,
  QueueError,
  attentionPlan,
  type Clock,
  type EnqueueInput,
  type EngineEvent,
  type EngineOptions,
  type MonotonicClock,
  type PullTransport,
  type QueueRecord,
  type QueueStore,
  type Random,
  type ReplicaStore,
  type SessionOwner,
  type SettledInfo,
  type SyncCore,
  type SyncOptions,
  type Transport,
  type TransportResponse,
} from '@evia/sync-core';
import { buildOrderDetail, type OrderDetail, type OrderDetailSource } from '../orders/order-detail-model';
import { buildOrderList, queueFact, type OrderListSource, type OrderRow } from '../orders/order-list-model';
import { EMPTY_QUICK_SOURCE, type QuickOrderSource } from '../orders/quick-order-model';
import { parseStoredTemplates, parseTemplateResponse, type TemplateSet } from '../orders/templates';
import { classifySqlError } from '../storage/errors';
import {
  EMPTY_COUNTS,
  INITIAL_FIRST_PULL,
  type AttentionResult,
  type FirstPullFailure,
  type QueueCounts,
  type QueueItem,
  type QueueView,
  type SentItem,
  type SyncControl,
  type SyncFailureKind,
  type SyncPauseReason,
  type SyncSnapshot,
  type TargetOption,
  type TemplateTransport,
} from './types';

/** Triggers are spaced out: the server allows 60 requests a minute per device (security S10). */
export const MIN_CYCLE_SPACING_MS = 1_000;
export const MAX_TIMER_MS = 5 * 60_000;
export const SLOW_AFTER_MS = 30_000;
const SENT_KEPT = 20;
const LABEL_MAX = 200;

export type SyncTrigger = 'start' | 'online' | 'foreground' | 'manual' | 'timer' | 'queue';

export interface SyncServiceStore {
  readonly queue: QueueStore;
  readonly replica: ReplicaStore;
  readonly replicaExtras: {
    readLastSuccess(): Promise<number | null>;
    writeLastSuccess(at: number): Promise<void>;
    listWorkOrders(limit?: number): Promise<{ id: string; number: string; title: string }[]>;
    readOrderListSource(withData: boolean): Promise<OrderListSource>;
    readOrderDetailSource(workOrderId: string): Promise<OrderDetailSource | null>;
    /** The templates of work orders (EVM-106): the stored document as it is (`unknown`; the reader validates it) and its atomic replacement. */
    readTemplates(): Promise<unknown>;
    writeTemplates(set: TemplateSet): Promise<void>;
    /** The customers and places of the active generation for the form of a quick work order (EVM-106); never called in the hidden-data mode. */
    readQuickOrderSource(): Promise<QuickOrderSource>;
  };
  takeSettled(): Promise<{ mutationId: string; info: SettledInfo }[]>;
}

export interface TransportContext {
  readonly signal: AbortSignal;
  /** The number of unsent items for pull requests: the service forwards the value of the engine status. */
  readonly pendingItems: () => number;
}

export type SyncDiagnostic =
  | { readonly event: 'sync-failure'; readonly kind: SyncFailureKind | 'resync' }
  | { readonly event: 'sync-attention'; readonly code: string };

export interface SyncServiceDeps {
  readonly store: SyncServiceStore;
  readonly owner: SessionOwner;
  /** Whether the 7-day rule lets the data be shown: a contact is recorded only then. */
  readonly contactVisible: () => Promise<boolean>;
  readonly createTransport: (context: TransportContext) => Transport & PullTransport & TemplateTransport;
  readonly clock: Clock;
  readonly monotonic: MonotonicClock;
  readonly random: Random;
  readonly isOnline: () => boolean;
  /** A pause of the engine that the app answers with a screen (426, 403) or the end of the session (401). */
  readonly onPause: (reason: SyncPauseReason) => void;
  readonly diagnostics?: (event: SyncDiagnostic) => void;
  readonly engineOptions?: EngineOptions;
  /** Timer seam for tests; the default is `setTimeout`. Returns the cancel function. */
  readonly schedule?: (callback: () => void, ms: number) => () => void;
}

const defaultSchedule = (callback: () => void, ms: number): (() => void) => {
  const id = setTimeout(callback, ms);
  return () => {
    clearTimeout(id);
  };
};

const same = (a: unknown, b: unknown): boolean => a === b || JSON.stringify(a) === JSON.stringify(b);

/** The replica as the core sees it, with the guards of the service: refused after `dispose`, store errors classified, contact rule. */
class GuardedReplica implements ReplicaStore {
  readonly #inner: ReplicaStore;
  readonly #service: SyncService;
  constructor(inner: ReplicaStore, service: SyncService) {
    this.#inner = inner;
    this.#service = service;
  }
  async #run<T>(task: () => Promise<T>): Promise<T> {
    if (this.#service.isDisposed()) throw new Error('disposed');
    try {
      return await task();
    } catch (error) {
      this.#service.noteStoreError(error);
      throw error;
    }
  }
  loadState: ReplicaStore['loadState'] = () => this.#run(() => this.#inner.loadState());
  readVersions: ReplicaStore['readVersions'] = (g, k) => this.#run(() => this.#inner.readVersions(g, k));
  findWorkOrdersBySite: ReplicaStore['findWorkOrdersBySite'] = (g, s) => this.#run(() => this.#inner.findWorkOrdersBySite(g, s));
  applyPage: ReplicaStore['applyPage'] = (i) => this.#run(() => this.#inner.applyPage(i));
  applySnapshot: ReplicaStore['applySnapshot'] = (i) => this.#run(() => this.#inner.applySnapshot(i));
  beginShadow: ReplicaStore['beginShadow'] = (r) => this.#run(() => this.#inner.beginShadow(r));
  promoteShadow: ReplicaStore['promoteShadow'] = (g) => this.#run(() => this.#inner.promoteShadow(g));
  discardShadow: ReplicaStore['discardShadow'] = () => this.#run(() => this.#inner.discardShadow());
  wipeReplica: ReplicaStore['wipeReplica'] = () => this.#run(() => this.#inner.wipeReplica());
  sweep: ReplicaStore['sweep'] = (r) => this.#run(() => this.#inner.sweep(r));
  saveConfig: ReplicaStore['saveConfig'] = (c) => this.#run(() => this.#inner.saveConfig(c));
  /** The synchronization never brings back data hidden by the 7-day rule: the contact is recorded only while they are visible. */
  saveContact: ReplicaStore['saveContact'] = (record) =>
    this.#run(async () => {
      if (await this.#service.contactVisible()) await this.#inner.saveContact(record);
    });
}

export class SyncService implements SyncControl {
  readonly #deps: SyncServiceDeps;
  readonly #core: SyncCore;
  readonly #templates: TemplateTransport;
  readonly #abort = new AbortController();
  readonly #listeners = new Set<() => void>();
  readonly #schedule: (callback: () => void, ms: number) => () => void;
  #snapshot: SyncSnapshot;
  #disposed = false;
  #started = false;
  #running: Promise<void> | undefined;
  #rerun: SyncTrigger | undefined;
  #lastStart = Number.NEGATIVE_INFINITY;
  #cancelTimer: (() => void) | undefined;
  #cancelTrailing: (() => void) | undefined;
  #cancelSlow: (() => void) | undefined;
  #lastFailureCode: string | undefined;
  #storeError: 'disk_full' | 'other' | undefined;
  readonly #sent: SentItem[] = [];
  #pausedReason: SyncPauseReason | null = null;

  constructor(deps: SyncServiceDeps) {
    this.#deps = deps;
    this.#schedule = deps.schedule ?? defaultSchedule;
    this.#snapshot = {
      active: false,
      online: deps.isOnline(),
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
    const transport = deps.createTransport({ signal: this.#abort.signal, pendingItems: () => this.#snapshot.counts.unsent });
    this.#templates = transport;
    this.#core = createSyncCore({
      store: deps.store.queue,
      transport,
      clock: deps.clock,
      random: deps.random,
      session: deps.owner,
      events: {
        emit: (event) => {
          this.#onEvent(event);
        },
      },
      ...(deps.engineOptions === undefined ? {} : { options: deps.engineOptions }),
      pull: {
        transport,
        replica: new GuardedReplica(deps.store.replica, this),
        monotonic: deps.monotonic,
        pullFirstUntilLoaded: true,
      },
    });
  }

  // ---- state for the screens ------------------------------------------------------------------------------------------------

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  };

  getSnapshot = (): SyncSnapshot => this.#snapshot;

  #set(patch: Patch): void {
    const next = { ...this.#snapshot, ...patch };
    if ((Object.keys(next) as (keyof SyncSnapshot)[]).every((key) => same(next[key], this.#snapshot[key]))) return;
    this.#snapshot = next;
    for (const listener of [...this.#listeners]) listener();
  }

  isDisposed(): boolean {
    return this.#disposed;
  }

  contactVisible(): Promise<boolean> {
    return this.#deps.contactVisible().catch(() => false);
  }

  noteStoreError(error: unknown): void {
    this.#storeError = classifySqlError(error) === 'disk_full' ? 'disk_full' : 'other';
  }

  // ---- lifecycle ------------------------------------------------------------------------------------------------------------

  /** Loads what the screens need (the first download done?, the last success) and runs the first cycle. */
  async start(): Promise<void> {
    if (this.#started || this.#disposed) return;
    this.#started = true;
    const [done, last] = await Promise.all([
      this.#core.pull?.initialLoadDone().catch(() => false) ?? Promise.resolve(true),
      this.#deps.store.replicaExtras.readLastSuccess().catch(() => null),
    ]);
    if (this.isDisposed()) return;
    this.#set({ active: true, initialLoad: done ? 'done' : 'loading', lastSuccessAt: last });
    await this.#refreshCounts();
    this.trigger('start');
  }

  /** Cancels the run in flight, the timers and the subscriptions; nothing starts afterwards (security S2). */
  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#abort.abort();
    this.#cancelTimer?.();
    this.#cancelTrailing?.();
    this.#cancelSlow?.();
    this.#cancelTimer = this.#cancelTrailing = this.#cancelSlow = undefined;
    this.#listeners.clear();
    this.#snapshot = { ...this.#snapshot, active: false, syncing: false, resyncing: false };
  }

  /** The phone's connection changed. Back online: a cycle that does not wait for the backoff of a network error. */
  setOnline(online: boolean): void {
    if (this.#disposed) return;
    const was = this.#snapshot.online;
    this.#set({ online });
    if (online && !was) this.trigger('online');
    if (!online) {
      this.#cancelTimer?.();
      this.#cancelTimer = undefined;
    }
  }

  // ---- triggers -------------------------------------------------------------------------------------------------------------

  trigger(source: SyncTrigger = 'manual'): void {
    if (this.#disposed || !this.#started) return;
    if (!this.#deps.isOnline()) {
      this.#set({ online: false });
      return;
    }
    if (this.#running !== undefined) {
      this.#rerun = source;
      return;
    }
    const wait = this.#lastStart + MIN_CYCLE_SPACING_MS - this.#deps.clock.now();
    if (wait > 0) {
      this.#cancelTrailing ??= this.#schedule(() => {
        this.#cancelTrailing = undefined;
        this.trigger(source);
      }, wait);
      return;
    }
    this.#running = this.#cycle(source).finally(() => {
      this.#running = undefined;
      const again = this.#rerun;
      this.#rerun = undefined;
      if (again !== undefined) this.trigger(again);
    });
  }

  async #cycle(source: SyncTrigger): Promise<void> {
    this.#lastStart = this.#deps.clock.now();
    this.#cancelTimer?.();
    this.#cancelTimer = undefined;
    this.#storeError = undefined;
    this.#lastFailureCode = undefined;
    const loading = this.#snapshot.initialLoad !== 'done';
    this.#set({ syncing: true, online: true, ...(loading ? { initialLoad: 'loading' as const } : {}) });
    if (loading) this.#armSlow();
    const options: SyncOptions = { networkRestored: source === 'online' };
    try {
      if (this.#pausedReason === 'auth_required' || this.#pausedReason === 'unexpected_response') {
        if (await this.#core.resume()) this.#pausedReason = null;
      }
      const result = await this.#core.sync(options);
      if (this.#disposed) return;
      await this.#after(result);
    } catch {
      if (this.#disposed) return;
      this.#set({ failure: 'push' });
      this.#deps.diagnostics?.({ event: 'sync-failure', kind: 'push' });
    } finally {
      this.#cancelSlow?.();
      this.#cancelSlow = undefined;
      if (!this.#disposed) this.#set({ syncing: false });
    }
  }

  async #after(result: Awaited<ReturnType<SyncCore['sync']>>): Promise<void> {
    const paused = result.flush.paused ?? result.pull?.paused;
    const status = await this.#core.engine.status();
    await this.#refreshCounts();
    await this.#collectSettled();
    const retry = status.nextAttemptAt;
    if (paused !== undefined && paused !== 'replica_stale') {
      this.#pausedReason = paused;
      this.#set({ paused, failure: null });
      this.#deps.onPause(paused);
      return;
    }
    this.#pausedReason = null;
    const pullStatus = result.pull?.status;
    const rateLimited = this.#lastFailureCode === 'rate_limited';
    const pullFailed = pullStatus === 'retry' || pullStatus === 'backoff';
    const pushFailed = result.flush.retryScheduled;
    const failure: SyncFailureKind | null =
      rateLimited && (pullFailed || pushFailed) ? 'rate_limited' : pullFailed ? 'pull' : pushFailed ? 'push' : null;
    const next = [retry, result.pull?.nextAttemptAt].filter((n): n is number => n !== undefined);
    const retryAt = next.length === 0 ? null : Math.min(...next);
    const loaded = (await this.#core.pull?.initialLoadDone().catch(() => false)) ?? true;
    const patch: Patch = { paused: null, failure, retryAt: failure === null ? null : retryAt };
    if (failure === null && (pullStatus === undefined || pullStatus === 'complete' || pullStatus === 'partial')) {
      const at = this.#deps.clock.now();
      if (pullStatus !== 'partial') {
        patch.lastSuccessAt = at;
        void this.#deps.store.replicaExtras.writeLastSuccess(at).catch(() => undefined);
      }
    }
    if (loaded) {
      patch.initialLoad = 'done';
      patch.firstPull = INITIAL_FIRST_PULL;
    } else if (failure !== null || pullStatus === 'stale' || pullStatus === 'paused') {
      patch.initialLoad = 'failed';
      patch.firstPull = {
        ...this.#snapshot.firstPull,
        failure: this.#firstPullFailure(rateLimited),
        attempts: this.#snapshot.firstPull.attempts + 1,
        retryAt: retryAt,
        slow: false,
      };
    }
    if (failure !== null) {
      this.#deps.diagnostics?.({ event: 'sync-failure', kind: failure });
    }
    if (failure === null) patch.resyncing = this.#snapshot.resyncing && pullStatus !== 'complete';
    this.#set(patch);
    if (pullStatus === 'partial') {
      // the limits of one cycle were reached, not an error: carry on at once (the spacing protects against loops, not against paging)
      this.#lastStart = Number.NEGATIVE_INFINITY;
      this.#rerun ??= 'queue';
    } else {
      if (retryAt !== null && this.#deps.isOnline()) this.#armTimer(retryAt);
      await this.#refreshTemplates();
    }
  }

  /**
   * The templates of work orders (EVM-106 AC1; security K1-K3): once per finished cycle, only while the gate is not paused and the data
   * are visible. A failure goes to the SAME gate as push and pull (401 -> one refresh and one more try, 403 of both codes, 426 -> pause
   * and screen); 5xx, a network error, a damaged answer and a failed write leave the old set quietly. The result is stored only when the
   * epoch of the gate and the user are unchanged (a sign-out or a wipe during the request does not bring the key back). It touches
   * neither `failure` nor `lastSuccessAt`, and nothing of the answer is logged.
   */
  async #refreshTemplates(): Promise<void> {
    const gate = this.#core.gate;
    const alive = (epoch: number): boolean => !this.#disposed && gate.paused === undefined && gate.epoch === epoch;
    try {
      if (this.#disposed || gate.paused !== undefined || !this.#deps.isOnline() || !(await this.contactVisible())) return;
      const userId = await this.#deps.owner.currentUserId();
      if (userId === null) return;
      const epoch = gate.epoch;
      for (let canRefresh = true; ; canRefresh = false) {
        let response: TransportResponse;
        try {
          response = await this.#templates.listWorkOrderTemplates();
        } catch {
          return;
        }
        if (!alive(epoch)) return;
        if (response.kind === 'network') return;
        if (response.kind === 'ok') {
          const set = parseTemplateResponse(response.body, this.#deps.clock.now());
          if (set === null) return;
          if ((await this.#deps.owner.currentUserId()) !== userId || !alive(epoch)) return;
          await this.#deps.store.replicaExtras.writeTemplates(set);
          return;
        }
        const code = response.code !== undefined && /^[a-z_]{1,64}$/.test(response.code) ? response.code : undefined;
        const verdict = await gate.onHttpFailure(response.status, code, userId, canRefresh);
        if (verdict === 'retry') continue;
        if (verdict === 'stop') this.#paused(gate.paused);
        return;
      }
    } catch {
      // the old set stays; the next cycle tries again (no content in any message)
    }
  }

  #paused(reason: SyncPauseReason | undefined): void {
    if (reason === undefined || this.#disposed) return;
    this.#pausedReason = reason;
    this.#set({ paused: reason, failure: null });
    this.#deps.onPause(reason);
  }

  #firstPullFailure(rateLimited: boolean): FirstPullFailure {
    if (this.#storeError === 'disk_full') return 'disk_full';
    if (this.#storeError === 'other') return 'storage';
    if (rateLimited) return 'rate_limited';
    return this.#lastFailureCode === 'server_error' ? 'server' : 'network';
  }

  #armTimer(at: number): void {
    const delay = Math.min(MAX_TIMER_MS, Math.max(MIN_CYCLE_SPACING_MS, at - this.#deps.clock.now()));
    this.#cancelTimer = this.#schedule(() => {
      this.#cancelTimer = undefined;
      this.trigger('timer');
    }, delay);
  }

  #armSlow(): void {
    this.#cancelSlow?.();
    this.#cancelSlow = this.#schedule(() => {
      this.#set({ firstPull: { ...this.#snapshot.firstPull, slow: true } });
    }, SLOW_AFTER_MS);
  }

  #onEvent(event: EngineEvent): void {
    if (this.#disposed) return;
    switch (event.kind) {
      case 'pull_page_applied':
        if (this.#snapshot.initialLoad !== 'done') {
          this.#set({
            firstPull: {
              ...this.#snapshot.firstPull,
              step: event.phase === 'changes' ? 2 : 1,
              received: this.#snapshot.firstPull.received + event.count,
              slow: false,
              failure: null,
            },
          });
          this.#armSlow();
        }
        break;
      case 'resync_scheduled':
        this.#set({ resyncing: true });
        this.#deps.diagnostics?.({ event: 'sync-failure', kind: 'resync' });
        break;
      case 'resync_completed':
        this.#set({ resyncing: false });
        break;
      case 'retry_scheduled':
      case 'pull_retry_scheduled':
      case 'pull_failed':
        this.#lastFailureCode = event.code;
        break;
      case 'needs_attention':
        this.#deps.diagnostics?.({ event: 'sync-attention', code: event.code });
        break;
      default:
        break;
    }
  }

  async #refreshCounts(): Promise<void> {
    const status = await this.#core.engine.status().catch(() => null);
    if (status === null || this.#disposed) return;
    const attention = status.needsAttention;
    const counts: QueueCounts = {
      pending: status.pending,
      retrying: status.retrying,
      blocked: status.blocked,
      attention,
      unsent: status.pending + status.retrying + status.blocked + attention,
    };
    this.#set({ counts });
  }

  async #collectSettled(): Promise<void> {
    const settled = await this.#deps.store.takeSettled().catch(() => []);
    for (const item of settled) {
      this.#sent.unshift({ id: item.mutationId, type: this.#typeOf.get(item.mutationId) ?? 'CreateNote', at: this.#deps.clock.now() });
    }
    this.#sent.length = Math.min(this.#sent.length, SENT_KEPT);
  }

  /** Types of the entries seen in the queue, so that a "sent" row can say what it was without keeping any content. */
  readonly #typeOf = new Map<string, QueueItem['type']>();

  // ---- the queue for the screens --------------------------------------------------------------------------------------------

  async #records(): Promise<QueueRecord[]> {
    const userId = await this.#deps.owner.currentUserId();
    return (await this.#core.queue.entries()).flatMap((entry) =>
      entry.valid && entry.record.ownerUserId === userId ? [entry.record] : [],
    );
  }

  async queueView(withLabels: boolean): Promise<QueueView> {
    const records = await this.#records();
    for (const r of records) this.#typeOf.set(r.mutationId, r.type);
    const ids = new Set(records.map((r) => r.mutationId));
    const children = new Map<string, QueueRecord[]>();
    for (const r of records) {
      if (r.parentMutationId !== undefined && ids.has(r.parentMutationId)) {
        children.set(r.parentMutationId, [...(children.get(r.parentMutationId) ?? []), r]);
      }
    }
    const descendants = (id: string): number => (children.get(id) ?? []).reduce((sum, c) => sum + 1 + descendants(c.mutationId), 0);
    const syncing = this.#snapshot.syncing;
    const items: QueueItem[] = records
      .filter((r) => r.parentMutationId === undefined || !ids.has(r.parentMutationId))
      .map((r): QueueItem => {
        const plan = r.state === 'needs_attention' ? attentionPlan(r) : null;
        const state = r.state === 'needs_attention' ? 'attention' : r.state === 'blocked' ? 'blocked' : syncing ? 'sending' : 'pending';
        return {
          id: r.mutationId,
          type: r.type,
          state,
          createdAt: r.createdAt,
          targetId: r.type === 'CreateQuickWorkOrder' ? null : r.orderingKey,
          code: r.lastCode ?? null,
          attempts: r.attempts,
          reason: plan?.reason ?? null,
          actions: plan?.actions ?? [],
          dependents: descendants(r.mutationId),
          label: withLabels ? labelOf(r) : null,
        };
      });
    return { items, sent: [...this.#sent] };
  }

  /**
   * "Moje zlecenia" (EVM-103): the replica and the queue read once each, joined in memory; no request to the server. The queue is read
   * through `#records()` only (valid entries of the owner; security K2). Without `withData` (the hidden-data mode) no name, address or
   * place is read from either side.
   */
  async orderList(withData: boolean): Promise<readonly OrderRow[]> {
    const [source, records] = await Promise.all([this.#deps.store.replicaExtras.readOrderListSource(withData), this.#records()]);
    return buildOrderList(
      source,
      records.map((record) => queueFact(record, withData)),
    );
  }

  /**
   * The details of one work order (EVM-104): one read of the replica and one of the queue, joined in memory; no request to the server.
   * `null` = the order is not in the active generation (outside the scope or deleted; AC5) - its queue items stay untouched. Only
   * notes and comments of this order are taken from the queue (security K5). Never called in the hidden-data mode (the screen decides).
   */
  async orderDetail(workOrderId: string): Promise<OrderDetail | null> {
    const [source, records, userId] = await Promise.all([
      this.#deps.store.replicaExtras.readOrderDetailSource(workOrderId),
      this.#records(),
      this.#deps.owner.currentUserId(),
    ]);
    return buildOrderDetail(source, records, userId ?? '');
  }

  /** The templates kept on the phone (replica only); a damaged or missing document is `null`. */
  async templates(): Promise<TemplateSet | null> {
    try {
      return parseStoredTemplates(await this.#deps.store.replicaExtras.readTemplates());
    } catch {
      return null;
    }
  }

  /** The customers and places for the quick order form; nothing while the data are hidden (the form is not available then). */
  async quickOrderSource(): Promise<QuickOrderSource> {
    if (!(await this.contactVisible())) return EMPTY_QUICK_SOURCE;
    return this.#deps.store.replicaExtras.readQuickOrderSource();
  }

  async dependentsOf(id: string): Promise<number> {
    const records = await this.#records();
    const seen = new Set([id]);
    for (const r of records) if (r.parentMutationId !== undefined && seen.has(r.parentMutationId)) seen.add(r.mutationId);
    return Math.max(0, seen.size - 1);
  }

  async #op(task: () => Promise<{ dependents?: number } | undefined>): Promise<AttentionResult> {
    try {
      const result = await task();
      await this.#refreshCounts();
      this.trigger('queue');
      return { ok: true, ...(result?.dependents === undefined ? {} : { dependents: result.dependents }) };
    } catch (error) {
      // a typed error of the core carries a fixed code and never data
      return { ok: false, code: error instanceof QueueError ? error.code : 'storage_failure' };
    }
  }

  enqueue(input: EnqueueInput): Promise<AttentionResult> {
    return this.#op(async () => {
      await this.#core.queue.enqueue(input);
      return undefined;
    });
  }

  discard(id: string): Promise<AttentionResult> {
    return this.#op(async () => {
      const { dependents } = await this.#core.attention.discard(id);
      return { dependents };
    });
  }

  recreate(id: string): Promise<AttentionResult> {
    return this.#op(async () => {
      await this.#core.attention.recreate(id);
      return undefined;
    });
  }

  retarget(id: string, workOrderId: string): Promise<AttentionResult> {
    return this.#op(async () => {
      const visible = new Set((await this.#deps.store.replicaExtras.listWorkOrders(500)).map((w) => w.id));
      await this.#core.attention.retarget(id, { workOrderId, isVisibleWorkOrder: (candidate) => visible.has(candidate) });
      return undefined;
    });
  }

  async copyText(id: string): Promise<string | null> {
    const record = (await this.#records()).find((r) => r.mutationId === id);
    return record === undefined ? null : copyTextOf(record);
  }

  async retargetOptions(excludeWorkOrderId: string | null): Promise<readonly TargetOption[]> {
    const list = await this.#deps.store.replicaExtras.listWorkOrders(200).catch(() => []);
    return list.filter((w) => w.id !== excludeWorkOrderId).map((w) => ({ id: w.id, number: w.number, title: w.title }));
  }
}

const text = (value: unknown): string | null => (typeof value === 'string' && value.trim() !== '' ? value : null);

type Patch = { -readonly [K in keyof SyncSnapshot]?: SyncSnapshot[K] };

function labelOf(record: QueueRecord): string | null {
  const value = text(record.payload['body']) ?? text(record.payload['title']);
  return value === null ? null : value.slice(0, LABEL_MAX);
}

/** What "Kopiuj treść" puts on the clipboard: the text of a note or comment; for a quick work order the data the technician typed. */
export function copyTextOf(record: QueueRecord): string | null {
  const p = record.payload;
  if (record.type !== 'CreateQuickWorkOrder') return text(p['body']);
  const customer = typeof p['newCustomer'] === 'object' && p['newCustomer'] !== null ? (p['newCustomer'] as Record<string, unknown>) : {};
  const site = typeof p['newSite'] === 'object' && p['newSite'] !== null ? (p['newSite'] as Record<string, unknown>) : {};
  const address = [text(site['street']), text(site['buildingNumber']), text(site['postalCode']), text(site['city'])].filter(
    (x) => x !== null,
  );
  const lines = [
    text(p['title']),
    text(customer['displayName']),
    text(customer['phone']),
    address.length > 0 ? address.join(' ') : null,
    text(p['note']),
  ];
  const out = lines.filter((x): x is string => x !== null).join('\n');
  return out === '' ? null : out;
}
