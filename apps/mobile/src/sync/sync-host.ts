/**
 * Holds the synchronization service of the current session (EVM-107): one instance per session and `userId`. The host is what the
 * composition (`session.ts`) gives to the screens as `SyncControl`; it starts a service after the full sign-in and the owner check,
 * and disposes it on sign-out, `session_revoked`, wipe and `device_wipe_required` (security S2/S3).
 */
import type { EnqueueInput } from '@evia/sync-core';
import { SyncService, type SyncServiceStore } from './sync-service';
import {
  IDLE_SNAPSHOT,
  type AttentionResult,
  type QueueView,
  type SyncRuntime,
  type SyncPauseReason,
  type SyncSnapshot,
  type TargetOption,
} from './types';

export type SyncHostFactory = (
  store: SyncServiceStore,
  hooks: { isOnline: () => boolean; onPause: (reason: SyncPauseReason) => void },
) => SyncService;

export class SyncHost implements SyncRuntime {
  readonly #create: SyncHostFactory;
  readonly #listeners = new Set<() => void>();
  readonly #pauseListeners = new Set<(reason: SyncPauseReason) => void>();
  #service: SyncService | null = null;
  #unsubscribe: (() => void) | undefined;
  #online = false;

  constructor(create: SyncHostFactory, storeOf: () => SyncServiceStore | null = () => null) {
    this.#create = create;
    this.#storeOf = storeOf;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  };

  getSnapshot = (): SyncSnapshot => this.#service?.getSnapshot() ?? IDLE_SNAPSHOT;

  #notify(): void {
    for (const listener of [...this.#listeners]) listener();
  }

  readonly #storeOf: () => SyncServiceStore | null;

  /** Called after the owner check passed (the store exists only then): replaces any earlier service. */
  startSession(): void {
    const store = this.#storeOf();
    if (store !== null) this.start(store);
  }

  start(store: SyncServiceStore): void {
    this.stop();
    const service = this.#create(store, {
      isOnline: () => this.#online,
      onPause: (reason) => {
        for (const listener of [...this.#pauseListeners]) listener(reason);
      },
    });
    this.#service = service;
    this.#unsubscribe = service.subscribe(() => {
      this.#notify();
    });
    void service.start();
    this.#notify();
  }

  /** Sign-out, end of session, wipe: the service is cancelled before the replica is removed. */
  stop(): void {
    if (this.#service === null) return;
    this.#unsubscribe?.();
    this.#service.dispose();
    this.#service = null;
    this.#unsubscribe = undefined;
    this.#notify();
  }

  get running(): boolean {
    return this.#service !== null;
  }

  setOnline(online: boolean): void {
    this.#online = online;
    this.#service?.setOnline(online);
  }

  foreground(): void {
    this.#service?.trigger('foreground');
  }

  onPause(listener: (reason: SyncPauseReason) => void): () => void {
    this.#pauseListeners.add(listener);
    return () => {
      this.#pauseListeners.delete(listener);
    };
  }

  trigger(): void {
    this.#service?.trigger('manual');
  }
  queueView(withLabels: boolean): Promise<QueueView> {
    return this.#service?.queueView(withLabels) ?? Promise.resolve({ items: [], sent: [] });
  }
  dependentsOf(id: string): Promise<number> {
    return this.#service?.dependentsOf(id) ?? Promise.resolve(0);
  }
  enqueue(input: EnqueueInput): Promise<AttentionResult> {
    return this.#service?.enqueue(input) ?? Promise.resolve({ ok: false, code: 'no_session' });
  }
  discard(id: string): Promise<AttentionResult> {
    return this.#service?.discard(id) ?? Promise.resolve({ ok: false, code: 'no_session' });
  }
  recreate(id: string): Promise<AttentionResult> {
    return this.#service?.recreate(id) ?? Promise.resolve({ ok: false, code: 'no_session' });
  }
  retarget(id: string, workOrderId: string): Promise<AttentionResult> {
    return this.#service?.retarget(id, workOrderId) ?? Promise.resolve({ ok: false, code: 'no_session' });
  }
  copyText(id: string): Promise<string | null> {
    return this.#service?.copyText(id) ?? Promise.resolve(null);
  }
  retargetOptions(exclude: string | null): Promise<readonly TargetOption[]> {
    return this.#service?.retargetOptions(exclude) ?? Promise.resolve([]);
  }
}
