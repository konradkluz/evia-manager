// A fake of the synchronization seen by the screens (EVM-107): a settable snapshot and queue, recorded calls.
import type { EnqueueInput } from '@evia/sync-core';
import type { OrderDetail } from '../../src/orders/order-detail-model';
import type { OrderMedia } from '../../src/orders/order-photos-model';
import { redactRows, type OrderRow } from '../../src/orders/order-list-model';
import type { QuickOrderSource } from '../../src/orders/quick-order-model';
import type { TemplateSet } from '../../src/orders/templates';
import {
  EMPTY_COUNTS,
  INITIAL_FIRST_PULL,
  type AttentionResult,
  type QueueItem,
  type QueueView,
  type RecreateSource,
  type SyncPauseReason,
  type SyncRuntime,
  type SyncSnapshot,
  type OrderNumber,
  type TargetOption,
} from '../../src/sync/types';

export const DONE_SNAPSHOT: SyncSnapshot = {
  active: true,
  online: true,
  syncing: false,
  initialLoad: 'done',
  firstPull: INITIAL_FIRST_PULL,
  lastSuccessAt: null,
  counts: EMPTY_COUNTS,
  failure: null,
  retryAt: null,
  resyncing: false,
  paused: null,
};

export class FakeSync implements SyncRuntime {
  snapshot: SyncSnapshot = DONE_SNAPSHOT;
  items: QueueItem[] = [];
  sent: QueueView['sent'] = [];
  targets: TargetOption[] = [];
  copyValue: string | null = 'synthetic text';
  readonly calls: string[] = [];
  readonly labelRequests: boolean[] = [];
  /** When set, the queue comes from here (the older stub of the owner's rows). */
  source: ((withLabels: boolean) => QueueItem[]) | undefined;
  dependents = 0;
  result: AttentionResult = { ok: true };
  readonly #listeners = new Set<() => void>();
  readonly #pause = new Set<(reason: SyncPauseReason) => void>();

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  };
  getSnapshot = (): SyncSnapshot => this.snapshot;
  set(patch: Partial<{ -readonly [K in keyof SyncSnapshot]: SyncSnapshot[K] }>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const listener of [...this.#listeners]) listener();
  }
  pause(reason: SyncPauseReason): void {
    for (const listener of [...this.#pause]) listener(reason);
  }
  startSession(): void {
    this.calls.push('start');
  }
  stop(): void {
    this.calls.push('stop');
  }
  setOnline(online: boolean): void {
    this.calls.push(`online:${String(online)}`);
  }
  onPause(listener: (reason: SyncPauseReason) => void): () => void {
    this.#pause.add(listener);
    return () => {
      this.#pause.delete(listener);
    };
  }
  trigger(): void {
    this.calls.push('trigger');
  }
  /** What was passed to `enqueue`, in order (EVM-105); `enqueueHook` lets a test hold or fail the call. */
  readonly enqueued: EnqueueInput[] = [];
  enqueueHook: ((input: EnqueueInput) => Promise<AttentionResult>) | undefined;
  enqueue(input: EnqueueInput): Promise<AttentionResult> {
    this.calls.push(`enqueue:${input.type}`);
    this.enqueued.push(input);
    if (this.enqueueHook !== undefined) return this.enqueueHook(input);
    return Promise.resolve(this.result);
  }
  queueView(withLabels: boolean): Promise<QueueView> {
    this.labelRequests.push(withLabels);
    if (this.source !== undefined && this.items.length === 0) return Promise.resolve({ items: this.source(withLabels), sent: this.sent });
    return Promise.resolve({
      items: this.items.map((item) => ({ ...item, label: withLabels ? item.label : null })),
      sent: this.sent,
    });
  }
  /** The rows `orderList` answers (set by the test); `withData = false` rows are redacted by the fake like the real read. */
  rows: OrderRow[] = [];
  readonly orderRequests: boolean[] = [];
  orderListHook: ((withData: boolean) => Promise<readonly OrderRow[]>) | undefined;
  orderList(withData: boolean): Promise<readonly OrderRow[]> {
    this.orderRequests.push(withData);
    if (this.orderListHook !== undefined) return this.orderListHook(withData);
    return Promise.resolve(withData ? this.rows : redactRows(this.rows));
  }
  /** The details the fake answers by id (set by the test); an id that is not there = not available (null). */
  details = new Map<string, OrderDetail>();
  readonly detailRequests: string[] = [];
  orderDetailHook: ((id: string) => Promise<OrderDetail | null>) | undefined;
  orderDetail(id: string): Promise<OrderDetail | null> {
    this.detailRequests.push(id);
    if (this.orderDetailHook !== undefined) return this.orderDetailHook(id);
    return Promise.resolve(this.details.get(id) ?? null);
  }
  /** The photos the fake answers by order id (set by the test; EVM-142); an order that is not there has none. */
  photos = new Map<string, readonly OrderMedia[]>();
  readonly photoRequests: string[] = [];
  orderPhotosHook: ((id: string) => Promise<readonly OrderMedia[]>) | undefined;
  orderMedia(id: string): Promise<readonly OrderMedia[]> {
    this.photoRequests.push(id);
    if (this.orderPhotosHook !== undefined) return this.orderPhotosHook(id);
    return Promise.resolve(this.photos.get(id) ?? []);
  }
  /** The templates and the customers the fake answers (set by the test; EVM-106). */
  templateSet: TemplateSet | null = null;
  quickSource: QuickOrderSource = { customers: [], sites: [] };
  readonly quickSourceRequests: number[] = [];
  /** The switches the server announced (EVM-137); the site survey is on by default in the fake, the tests of the switch turn it off. */
  featureSet: { siteSurveys: boolean } = { siteSurveys: true };
  /** The orders that are site surveys (EVM-137): the camera starts with "Oględziny" for them. */
  readonly surveyIds = new Set<string>();
  isSurvey(workOrderId: string): Promise<boolean> {
    return Promise.resolve(this.surveyIds.has(workOrderId));
  }
  features(): Promise<{ readonly siteSurveys: boolean }> {
    return Promise.resolve(this.featureSet);
  }
  templates(): Promise<TemplateSet | null> {
    return Promise.resolve(this.templateSet);
  }
  quickOrderSource(): Promise<QuickOrderSource> {
    this.quickSourceRequests.push(this.quickSourceRequests.length);
    return Promise.resolve(this.quickSource);
  }
  summary: { photos: number; videos: number; entries: number; total: number } = { photos: 0, videos: 0, entries: 0, total: 0 };
  queueChanged(): void {
    this.calls.push('queueChanged');
  }
  groupSummary(id: string): Promise<{ photos: number; videos: number; entries: number; total: number }> {
    this.calls.push(`groupSummary:${id}`);
    return Promise.resolve(this.summary);
  }
  dependentsOf(id: string): Promise<number> {
    this.calls.push(`dependentsOf:${id}`);
    return Promise.resolve(this.dependents);
  }
  discard(id: string): Promise<AttentionResult> {
    this.calls.push(`discard:${id}`);
    return Promise.resolve(this.result);
  }
  /** The sources of "Utwórz ponownie" by id (EVM-128; set by the test); an id that is not there = `null`. `recreateSourceHook` can hold the answer. */
  recreateSources = new Map<string, RecreateSource>();
  readonly recreateSourceRequests: string[] = [];
  recreateSourceHook: ((id: string) => Promise<RecreateSource | null>) | undefined;
  recreateSource(id: string): Promise<RecreateSource | null> {
    this.recreateSourceRequests.push(id);
    if (this.recreateSourceHook !== undefined) return this.recreateSourceHook(id);
    return Promise.resolve(this.recreateSources.get(id) ?? null);
  }
  /** What was passed to `recreate` with data (EVM-128), in order; `recreateHook` lets a test hold or fail the call. */
  readonly recreated: { id: string; payload: Record<string, unknown> }[] = [];
  recreateHook: ((id: string, payload: Record<string, unknown>) => Promise<AttentionResult>) | undefined;
  recreate(id: string, payload?: Record<string, unknown>): Promise<AttentionResult> {
    this.calls.push(`recreate:${id}`);
    if (payload !== undefined) {
      this.recreated.push({ id, payload });
      if (this.recreateHook !== undefined) return this.recreateHook(id, payload);
    }
    return Promise.resolve(this.result);
  }
  retarget(id: string, workOrderId: string): Promise<AttentionResult> {
    this.calls.push(`retarget:${id}:${workOrderId}`);
    return Promise.resolve(this.result);
  }
  copyText(id: string): Promise<string | null> {
    this.calls.push(`copyText:${id}`);
    return Promise.resolve(this.copyValue);
  }
  retargetOptions(exclude: string | null): Promise<readonly TargetOption[]> {
    this.calls.push(`options:${String(exclude)}`);
    return Promise.resolve(this.targets);
  }
  /** What `orderNumbers` answers: derived from `targets` as `{id, number}` only (EVM-108; a title never passes through here). */
  readonly numberRequests: number[] = [];
  orderNumbers(): Promise<readonly OrderNumber[]> {
    this.numberRequests.push(this.numberRequests.length);
    return Promise.resolve(
      this.targets.map((target) => ({
        id: target.id,
        number: target.number,
        ...(target.survey?.awaitingNumber === true ? { awaitingNumber: true } : {}),
      })),
    );
  }
}
