// A fake of the synchronization seen by the screens (EVM-107): a settable snapshot and queue, recorded calls.
import type { EnqueueInput } from '@evia/sync-core';
import type { OrderDetail } from '../../src/orders/order-detail-model';
import { redactRows, type OrderRow } from '../../src/orders/order-list-model';
import {
  EMPTY_COUNTS,
  INITIAL_FIRST_PULL,
  type AttentionResult,
  type QueueItem,
  type QueueView,
  type SyncPauseReason,
  type SyncRuntime,
  type SyncSnapshot,
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
  dependentsOf(id: string): Promise<number> {
    this.calls.push(`dependentsOf:${id}`);
    return Promise.resolve(this.dependents);
  }
  discard(id: string): Promise<AttentionResult> {
    this.calls.push(`discard:${id}`);
    return Promise.resolve(this.result);
  }
  recreate(id: string): Promise<AttentionResult> {
    this.calls.push(`recreate:${id}`);
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
}
