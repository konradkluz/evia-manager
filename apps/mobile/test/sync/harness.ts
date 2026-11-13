// Shared helpers of the synchronization tests (EVM-107): the real SQLCipher adapters on the node:sqlite engine, a scripted server and
// a manual clock/timer. Synthetic data only.
import { webcrypto } from 'node:crypto';
import type { PullTransport, SyncRequest, Transport, TransportResponse } from '@evia/sync-core';
import type { Database } from '../../src/storage/database';
import { SqlQueueStore } from '../../src/storage/queue-store';
import { SqlReplicaStore } from '../../src/storage/replica-store';
import { SyncService, type SyncServiceDeps, type SyncServiceStore } from '../../src/sync/sync-service';
import type { SyncPauseReason } from '../../src/sync/types';
import { migratedDatabase } from '../storage/harness';
import { newDisk, removeDisk, type NodeSqliteEngine, type TestDisk } from '../storage/node-sqlite-engine';

export const USER = 'user-a-synthetic';
export const NOW = Date.UTC(2026, 10, 2, 8, 0, 0);
export const PREFIX = { customer: '1', site: '2', work_order: '3' } as const;

export const uid = (type: keyof typeof PREFIX, n: number): string => `${PREFIX[type]}0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
export const cursor = (n: number): string => `cursor-${String(n).padStart(12, '0')}`;
const iso = (ms: number): string => new Date(ms).toISOString();

type Wire = Record<string, unknown>;

export function aggregate(n: number): Wire[] {
  const entity = (type: keyof typeof PREFIX, fields: Wire): Wire => ({
    op: 'upsert',
    entity: { type, id: uid(type, n), version: 1, ...fields },
  });
  return [
    entity('customer', { kind: 'person', displayName: `Customer ${String(n)}`, phone: '+48000000000' }),
    entity('site', {
      siteType: 'other',
      street: 'Test street',
      buildingNumber: '1',
      apartmentNumber: null,
      postalCode: '00-000',
      city: 'Testville',
      parkingSpotNumber: null,
      garageLevel: null,
      connectionPowerKw: null,
      managerPartyId: null,
      distributionSystemOperatorPartyId: null,
      notes: null,
    }),
    entity('work_order', {
      number: `ZL-${String(n)}`,
      title: `Order ${String(n)}`,
      status: 'in_progress',
      customerId: uid('customer', n),
      siteId: uid('site', n),
      coordinatorUserId: null,
      description: null,
      plannedDate: null,
      createdAt: iso(NOW - 5 * 86_400_000),
      closedAt: null,
    }),
  ];
}

export const page = (changes: unknown[], o: { phase?: 'snapshot' | 'changes'; cursor: number; hasMore?: boolean }): TransportResponse => ({
  kind: 'ok',
  body: {
    result: 'changes',
    phase: o.phase ?? 'changes',
    changes,
    cursor: cursor(o.cursor),
    hasMore: o.hasMore ?? false,
    serverTime: iso(NOW),
  },
});

export const CONFIG_BODY = {
  offlineContactWindowDays: 7,
  closedWorkOrdersInScopeDays: 30,
  periodicResyncDays: 7,
  scopeRuleVersion: 3,
  minSupportedVersion: { android: '1.0.0', ios: '1.0.0' },
  recommendedVersion: { android: '1.0.0', ios: '1.0.0' },
};

type Reply = TransportResponse | (() => TransportResponse | Promise<TransportResponse>);

/** A server that answers from scripts and counts what arrives; the push side is idempotent by `mutationId` like the contract says. */
export class ScriptedServer implements Transport, PullTransport {
  readonly changes: Reply[] = [];
  readonly pushScript: Reply[] = [];
  readonly pushes: SyncRequest[] = [];
  readonly changeRequests: { cursor?: string; limit: number }[] = [];
  readonly applied = new Map<string, number>();
  readonly order: string[] = [];
  pendingSeen: number[] = [];
  config: TransportResponse = { kind: 'ok', body: CONFIG_BODY };
  down = false;

  async sendBatch(request: SyncRequest): Promise<TransportResponse> {
    this.order.push('push');
    this.pushes.push(JSON.parse(JSON.stringify(request)) as SyncRequest);
    if (this.down) return { kind: 'network' };
    const scripted = this.pushScript.shift();
    if (scripted !== undefined) return typeof scripted === 'function' ? scripted() : scripted;
    const results = request.mutations.map((m) => {
      this.applied.set(m.mutationId, (this.applied.get(m.mutationId) ?? 0) + 1);
      return { mutationId: m.mutationId, outcome: (this.applied.get(m.mutationId) ?? 0) > 1 ? 'duplicate' : 'applied' };
    });
    return { kind: 'ok', body: { serverTime: iso(NOW), results } };
  }

  async getChanges(request: { cursor?: string; limit: number }): Promise<TransportResponse> {
    this.order.push('pull');
    this.changeRequests.push({ ...request });
    if (this.down) return { kind: 'network' };
    const next = this.changes.shift();
    if (next === undefined) return page([], { cursor: 900 });
    return typeof next === 'function' ? next() : next;
  }

  getWorkOrderSnapshot(): Promise<TransportResponse> {
    return Promise.resolve({ kind: 'http', status: 404, code: 'not_found' });
  }

  getClientConfig(): Promise<TransportResponse> {
    return Promise.resolve(this.config);
  }
}

export class ManualTimers {
  readonly pending: { at: number; run: () => void; cancelled: boolean }[] = [];
  schedule = (run: () => void, ms: number): (() => void) => {
    const item = { at: ms, run, cancelled: false };
    this.pending.push(item);
    return () => {
      item.cancelled = true;
    };
  };
  active(): { at: number; run: () => void; cancelled: boolean }[] {
    return this.pending.filter((t) => !t.cancelled);
  }
  async fireAll(): Promise<void> {
    const due = this.active();
    for (const t of due) {
      t.cancelled = true;
      t.run();
    }
    await settle();
  }
}

export const settle = async (): Promise<void> => {
  for (let i = 0; i < 1500; i += 1) await new Promise((resolve) => setImmediate(resolve));
};

export class Phone {
  readonly disk: TestDisk = newDisk();
  db!: Database;
  engine!: NodeSqliteEngine;
  queue!: SqlQueueStore;
  replica!: SqlReplicaStore;
  clockNow = NOW;
  readonly timers = new ManualTimers();
  online = true;
  contactVisible = true;
  readonly pauses: SyncPauseReason[] = [];
  readonly diagnostics: unknown[] = [];

  async open(): Promise<void> {
    const opened = await migratedDatabase(this.disk);
    this.db = opened.db;
    this.engine = opened.engine;
    this.queue = new SqlQueueStore(this.db);
    this.replica = new SqlReplicaStore(this.db);
  }

  /** A restart: the old connection is closed, a new one opens the same file (the process was killed). */
  async restart(): Promise<void> {
    await this.db.close();
    await this.open();
  }

  store(): SyncServiceStore {
    return {
      queue: this.queue,
      replica: this.replica,
      replicaExtras: {
        readLastSuccess: () => this.replica.readLastSuccess(),
        writeLastSuccess: (at) => this.replica.writeLastSuccess(at),
        listWorkOrders: (limit) => this.replica.listWorkOrders(limit),
        readOrderListSource: (withData) => this.replica.readOrderListSource(withData),
      },
      takeSettled: () => this.queue.takeSettled(),
    };
  }

  service(server: ScriptedServer, extra: Partial<SyncServiceDeps> = {}, userId: string | null = USER): SyncService {
    return new SyncService({
      store: this.store(),
      owner: { currentUserId: () => Promise.resolve(userId), refresh: () => Promise.resolve('refreshed') },
      contactVisible: () => Promise.resolve(this.contactVisible),
      createTransport: ({ pendingItems }) => ({
        sendBatch: (request) => {
          server.pendingSeen.push(request.pendingItems);
          return server.sendBatch(request);
        },
        getChanges: (request) => {
          server.pendingSeen.push(pendingItems());
          return server.getChanges(request);
        },
        getWorkOrderSnapshot: () => server.getWorkOrderSnapshot(),
        getClientConfig: () => server.getClientConfig(),
      }),
      clock: { now: () => this.clockNow },
      monotonic: { monotonicNow: () => this.clockNow, bootId: () => 'boot-1' },
      random: {
        getRandomValues: (bytes) => {
          webcrypto.getRandomValues(bytes as Uint8Array<ArrayBuffer>);
          return bytes;
        },
      },
      isOnline: () => this.online,
      onPause: (reason) => {
        this.pauses.push(reason);
      },
      diagnostics: (event) => {
        this.diagnostics.push(event);
      },
      schedule: this.timers.schedule,
      ...extra,
    });
  }

  close(): void {
    removeDisk(this.disk);
  }
}

export const NOTE_WO = '3a000000-0000-4000-8000-0000000000aa';

export const notePayload = (n: number, workOrderId = NOTE_WO): Record<string, unknown> => ({
  id: `0194c2a0-0000-7000-8000-${String(n + 700).padStart(12, '0')}`,
  workOrderId,
  noteCategory: 'meeting',
  body: `synthetic note ${String(n)}`,
  capturedAt: iso(NOW),
});

/** A value that the test knows to be there (the lint rules forbid a bare `!`). */
export function must<T>(value: T | undefined | null): T {
  if (value === undefined || value === null) throw new Error('expected a value');
  return value;
}
