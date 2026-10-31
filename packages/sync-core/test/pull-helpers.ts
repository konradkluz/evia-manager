import {
  CASCADE_CHILDREN,
  createSyncCore,
  entityKey,
  planSweep,
  type ApplyPageInput,
  type ApplySnapshotInput,
  type EngineEvent,
  type EntityKey,
  type HydrationItem,
  type PullDepsConfig,
  type PullOptions,
  type ReplicaEntity,
  type ReplicaOp,
  type ReplicaState,
  type ReplicaStore,
  type ResyncReason,
  type SweepResult,
  type SweepRule,
  type SyncCore,
  type TransportResponse,
  type WriteOutcome,
  type PullTransport,
  type EntityType,
} from '../src/index.ts';
import { FakeClock, FakeServer, FakeSession, InMemoryQueueStore, seededRandom } from './helpers.ts';

interface Gen {
  entities: Record<string, ReplicaEntity>;
  tombstones: Record<string, number>;
  cursor: unknown;
  complete: boolean;
  initialLoadDone: boolean;
  hydration: HydrationItem[];
}

export interface Disk {
  owner: string | null;
  nextGen: number;
  active: number;
  shadow: number | null;
  gens: Record<number, Gen>;
  pendingResync: { reason: ResyncReason } | null;
  lastServerTime: unknown;
  contact: unknown;
  config: unknown;
}

const emptyGen = (): Gen => ({ entities: {}, tombstones: {}, cursor: null, complete: false, initialLoadDone: false, hydration: [] });

export function newDisk(): Disk {
  return {
    owner: null,
    nextGen: 2,
    active: 1,
    shadow: null,
    gens: { 1: emptyGen() },
    pendingResync: null,
    lastServerTime: null,
    contact: null,
    config: null,
  };
}

/**
 * Reference implementation of `ReplicaStore` with real transaction semantics: a write works on a copy of the "disk" and commits only
 * when it finishes, so a crash in the middle (`failOn`) leaves nothing behind. A restart is a new instance on the same disk.
 */
export class FakeReplica implements ReplicaStore {
  readonly disk: { data: Disk };
  /** Crash in the middle of the n-th call (1-based) of a write method, after the draft was changed. */
  failOn: { method: string; call: number } | undefined;
  readonly calls: Record<string, number> = {};
  readonly log: string[] = [];
  readonly reasons: string[] = [];

  constructor(disk: { data: Disk } = { data: newDisk() }) {
    this.disk = disk;
  }

  #count(method: string): number {
    this.calls[method] = (this.calls[method] ?? 0) + 1;
    this.log.push(method);
    return this.calls[method];
  }

  #tx<T>(method: string, fn: (draft: Disk) => T): Promise<T> {
    const call = this.#count(method);
    const draft = structuredClone(this.disk.data);
    const result = fn(draft);
    if (this.failOn?.method === method && this.failOn.call === call) return Promise.reject(new Error('simulated crash mid-transaction'));
    this.disk.data = draft;
    return Promise.resolve(result);
  }

  loadState(): Promise<ReplicaState> {
    this.#count('loadState');
    const d = structuredClone(this.disk.data);
    const view = (n: number) => {
      const g = d.gens[n] as Gen;
      return { generation: n, cursor: g.cursor, complete: g.complete, initialLoadDone: g.initialLoadDone, hydration: g.hydration };
    };
    return Promise.resolve({
      ownerUserId: d.owner,
      hasData: Object.values(d.gens).some((g) => Object.keys(g.entities).length > 0 || g.cursor !== null),
      active: view(d.active),
      shadow: d.shadow === null ? null : view(d.shadow),
      pendingResync: d.pendingResync,
      lastServerTime: d.lastServerTime,
      contact: d.contact,
      config: d.config,
    });
  }

  readVersions(generation: number, keys: readonly EntityKey[]): Promise<ReadonlyMap<EntityKey, { version: number; deleted: boolean }>> {
    this.#count('readVersions');
    const g = this.disk.data.gens[generation];
    const out = new Map<EntityKey, { version: number; deleted: boolean }>();
    if (g === undefined) return Promise.resolve(out);
    for (const key of keys) {
      const live = g.entities[key];
      const dead = g.tombstones[key];
      if (live !== undefined) out.set(key, { version: live.version, deleted: false });
      else if (dead !== undefined) out.set(key, { version: dead, deleted: true });
    }
    return Promise.resolve(out);
  }

  findWorkOrdersBySite(generation: number, siteIds: readonly string[]): Promise<ReadonlyMap<string, readonly string[]>> {
    this.#count('findWorkOrdersBySite');
    const g = this.disk.data.gens[generation];
    const out = new Map<string, string[]>();
    for (const e of Object.values(g?.entities ?? {})) {
      const siteId = e.type === 'work_order' ? e.fields['siteId'] : undefined;
      if (typeof siteId === 'string' && siteIds.includes(siteId)) out.set(siteId, [...(out.get(siteId) ?? []), e.id]);
    }
    return Promise.resolve(out);
  }

  static #apply(g: Gen, ops: readonly ReplicaOp[]): void {
    for (const op of ops) {
      if (op.op === 'upsert') {
        const key = entityKey(op.entity.type, op.entity.id);
        const live = g.entities[key];
        const dead = g.tombstones[key];
        if ((live !== undefined && live.version >= op.entity.version) || (dead !== undefined && dead >= op.entity.version)) continue;
        g.entities[key] = op.entity;
        Reflect.deleteProperty(g.tombstones, key);
      } else {
        const key = entityKey(op.type, op.id);
        const live = g.entities[key];
        if (live !== undefined && op.version < live.version && op.version > 0) continue;
        Reflect.deleteProperty(g.entities, key);
        g.tombstones[key] = Math.max(op.version, live?.version ?? 0, g.tombstones[key] ?? 0);
        FakeReplica.#cascade(g, op.type, op.id);
      }
    }
  }

  static #cascade(g: Gen, type: EntityType, id: string): void {
    const children = CASCADE_CHILDREN[type];
    if (children.length === 0) return;
    for (const [key, e] of Object.entries(g.entities))
      if (children.includes(e.type) && e.fields['workOrderId'] === id) Reflect.deleteProperty(g.entities, key);
  }

  applyPage(input: ApplyPageInput): Promise<WriteOutcome> {
    return this.#tx('applyPage', (d) => {
      const g = d.gens[input.generation];
      if (g === undefined) return 'stale';
      FakeReplica.#apply(g, input.ops);
      g.cursor = input.cursor;
      g.complete = input.complete;
      g.hydration = g.hydration.filter((h) => !input.hydrationRemove.includes(h.workOrderId));
      for (const item of input.hydrationAdd) if (!g.hydration.some((h) => h.workOrderId === item.workOrderId)) g.hydration.push(item);
      if (g.complete && g.hydration.length === 0) g.initialLoadDone = true;
      d.owner = input.ownerUserId;
      d.lastServerTime = input.serverTime;
      if (input.plannedResync !== undefined && input.generation === d.active) d.pendingResync = { reason: input.plannedResync };
      return 'applied';
    });
  }

  applySnapshot(input: ApplySnapshotInput): Promise<WriteOutcome> {
    return this.#tx('applySnapshot', (d) => {
      const g = d.gens[input.generation];
      if (g === undefined) return 'stale';
      FakeReplica.#apply(g, input.ops);
      if (input.removeWorkOrderId !== undefined) {
        Reflect.deleteProperty(g.entities, entityKey('work_order', input.removeWorkOrderId));
        FakeReplica.#cascade(g, 'work_order', input.removeWorkOrderId);
      }
      g.hydration = g.hydration.filter((h) => !input.hydrationRemove.includes(h.workOrderId));
      if (g.complete && g.hydration.length === 0) g.initialLoadDone = true;
      d.owner = input.ownerUserId;
      d.lastServerTime = input.serverTime;
      return 'applied';
    });
  }

  beginShadow(reason: ResyncReason): Promise<number> {
    this.reasons.push(reason);
    return this.#tx('beginShadow', (d) => {
      if (d.shadow !== null) Reflect.deleteProperty(d.gens, d.shadow);
      const n = d.nextGen;
      d.nextGen += 1;
      d.gens[n] = emptyGen();
      d.shadow = n;
      d.pendingResync = null;
      return n;
    });
  }

  promoteShadow(generation: number): Promise<WriteOutcome> {
    return this.#tx('promoteShadow', (d) => {
      if (d.shadow !== generation) return 'stale';
      Reflect.deleteProperty(d.gens, d.active);
      d.active = generation;
      d.shadow = null;
      (d.gens[generation] as Gen).initialLoadDone = true;
      return 'applied';
    });
  }

  discardShadow(): Promise<void> {
    return this.#tx('discardShadow', (d) => {
      if (d.shadow !== null) Reflect.deleteProperty(d.gens, d.shadow);
      d.shadow = null;
    });
  }

  wipeReplica(): Promise<void> {
    return this.#tx('wipeReplica', (d) => {
      d.gens = {};
      const n = d.nextGen;
      d.nextGen += 1;
      d.gens[n] = emptyGen();
      d.active = n;
      d.shadow = null;
      d.owner = null;
      d.pendingResync = null;
    });
  }

  sweep(rule: SweepRule): Promise<SweepResult> {
    return this.#tx('sweep', (d) => {
      const g = d.gens[rule.generation];
      if (g === undefined) return { removedWorkOrders: 0, removedOrphans: 0 };
      const plan = planSweep(Object.values(g.entities), rule);
      for (const key of plan.removeKeys) Reflect.deleteProperty(g.entities, key);
      return { removedWorkOrders: plan.removedWorkOrders, removedOrphans: plan.removedOrphans };
    });
  }

  saveContact(record: unknown): Promise<void> {
    return this.#tx('saveContact', (d) => {
      d.contact = record;
    });
  }

  saveConfig(config: unknown): Promise<void> {
    return this.#tx('saveConfig', (d) => {
      d.config = config;
    });
  }

  // --- helpers for assertions -------------------------------------------------------------------------------------------
  active(): Gen {
    return this.disk.data.gens[this.disk.data.active] as Gen;
  }
  shadow(): Gen | undefined {
    return this.disk.data.shadow === null ? undefined : this.disk.data.gens[this.disk.data.shadow];
  }
  has(type: EntityType, id: string): boolean {
    return entityKey(type, id) in this.active().entities;
  }
  versionOf(type: EntityType, id: string): number | undefined {
    return this.active().entities[entityKey(type, id)]?.version;
  }
  /** Stable text image of the visible replica (for "same state after retry" assertions). */
  image(): string {
    const g = this.active();
    return JSON.stringify([
      Object.keys(g.entities)
        .sort()
        .map((k) => [k, (g.entities[k] as ReplicaEntity).version]),
      g.cursor,
      g.complete,
    ]);
  }
}

// --- wire builders (synthetic data) ------------------------------------------------------------------------------------------

const PREFIX: Record<EntityType, string> = {
  work_order: '1',
  customer: '2',
  site: '3',
  party: '4',
  scope_item: '5',
  procedure_stage: '6',
  timeline_entry: '7',
  media_asset: '8',
  user: '9',
};

export const uid = (type: EntityType, n: number): string => `${PREFIX[type]}0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
export const cur = (n: number): string => `cursor-${String(n).padStart(12, '0')}`;
export const iso = (ms: number): string => new Date(ms).toISOString();
export const SERVER_NOW = Date.UTC(2026, 9, 29, 8, 0, 0);

type Wire = Record<string, unknown>;

export function wireEntity(type: EntityType, n: number, version: number, extra: Wire = {}): Wire {
  const id = uid(type, n);
  const base: Wire = { type, id, version };
  switch (type) {
    case 'work_order':
      Object.assign(base, {
        number: `ZL-${n}`,
        title: `Order ${n}`,
        status: 'in_progress',
        customerId: uid('customer', n),
        siteId: uid('site', n),
        coordinatorUserId: null,
        description: null,
        plannedDate: null,
        createdAt: iso(SERVER_NOW - 5 * 86_400_000),
        closedAt: null,
      });
      break;
    case 'customer':
      Object.assign(base, { kind: 'person', displayName: `Customer ${n}`, phone: '+48000000000' });
      break;
    case 'site':
      Object.assign(base, {
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
      });
      break;
    case 'party':
      Object.assign(base, { kind: 'other', displayName: `Party ${n}`, contactPersonName: null, phone: null });
      break;
    case 'scope_item':
      Object.assign(base, {
        workOrderId: uid('work_order', n),
        position: 1,
        code: 'C1',
        name: 'Item',
        parameterSetCode: null,
        parameters: {},
        quantity: 1,
        notes: null,
      });
      break;
    case 'procedure_stage':
      Object.assign(base, {
        workOrderId: uid('work_order', n),
        procedureId: uid('procedure_stage', 999),
        procedureCode: 'P',
        procedureName: 'Proc',
        code: 'S',
        name: 'Stage',
        position: 1,
        status: 'todo',
        dueDate: null,
        responsibleUserId: null,
        waitingOn: null,
        waitingPartyId: null,
        waitingSince: null,
        blockedReason: null,
        startedAt: null,
        completedOn: null,
      });
      break;
    case 'timeline_entry':
      Object.assign(base, {
        workOrderId: uid('work_order', n),
        kind: 'note',
        noteCategory: 'other',
        body: 'synthetic body',
        procedureStageId: null,
        authorUserId: null,
        createdAt: iso(SERVER_NOW),
        origin: 'web',
        capturedAt: null,
        supersedesEntryId: null,
        supersededByEntryId: null,
        redactedAt: null,
      });
      break;
    case 'media_asset':
      Object.assign(base, {
        workOrderId: uid('work_order', n),
        mediaType: 'photo',
        category: null,
        description: null,
        procedureStageId: null,
        capturedAt: null,
        fileState: 'ready',
        fileStateReasonCode: null,
        sizeBytes: 10,
        durationSeconds: null,
        widthPx: 1,
        heightPx: 1,
      });
      break;
    case 'user':
      Object.assign(base, { displayName: `User ${n}` });
      break;
  }
  return { ...base, ...extra };
}

export const upsert = (type: EntityType, n: number, version = 1, extra: Wire = {}): Wire => ({
  op: 'upsert',
  entity: wireEntity(type, n, version, extra),
});
export const del = (type: EntityType, n: number, version?: number): Wire => ({
  op: 'delete',
  type,
  id: uid(type, n),
  ...(version === undefined ? {} : { version }),
});

/** A complete order with its customer and site (what a snapshot page of an aggregate carries). */
export const aggregate = (n: number, version = 1): Wire[] => [upsert('customer', n), upsert('site', n), upsert('work_order', n, version)];

export function page(
  changes: unknown[],
  o: { phase?: 'snapshot' | 'changes'; cursor?: number | string; hasMore?: boolean; serverTime?: number } = {},
): TransportResponse {
  return {
    kind: 'ok',
    body: {
      result: 'changes',
      phase: o.phase ?? 'changes',
      changes,
      cursor: typeof o.cursor === 'string' ? o.cursor : cur(o.cursor ?? 1),
      hasMore: o.hasMore ?? false,
      serverTime: iso(o.serverTime ?? SERVER_NOW),
    },
  };
}

export const resync = (reason: string): TransportResponse => ({
  kind: 'ok',
  body: { result: 'resync_required', reason, serverTime: iso(SERVER_NOW) },
});

export const snapshotOf = (entities: unknown[], serverTime = SERVER_NOW): TransportResponse => ({
  kind: 'ok',
  body: { serverTime: iso(serverTime), entities },
});

export const CONFIG_BODY = {
  offlineContactWindowDays: 7,
  closedWorkOrdersInScopeDays: 30,
  periodicResyncDays: 7,
  scopeRuleVersion: 3,
  minSupportedVersion: { android: '1.0.0', ios: '1.0.0' },
  recommendedVersion: { android: '1.0.0', ios: '1.0.0' },
};

type Reply = TransportResponse | ((request: { cursor?: string; limit: number }) => TransportResponse | Promise<TransportResponse>);

export class FakePullTransport implements PullTransport {
  readonly changesScript: Reply[] = [];
  readonly changeRequests: { cursor?: string; limit: number }[] = [];
  readonly snapshotScript = new Map<string, TransportResponse[]>();
  readonly snapshotRequests: string[] = [];
  config: TransportResponse = { kind: 'ok', body: CONFIG_BODY };
  configCalls = 0;

  async getChanges(request: { cursor?: string; limit: number }): Promise<TransportResponse> {
    this.changeRequests.push({ ...request });
    const next = this.changesScript.shift();
    if (next === undefined) throw new Error('no scripted response');
    return typeof next === 'function' ? next(request) : next;
  }

  getWorkOrderSnapshot(workOrderId: string): Promise<TransportResponse> {
    this.snapshotRequests.push(workOrderId);
    const queue = this.snapshotScript.get(workOrderId);
    const next = queue?.length === 1 ? queue[0] : queue?.shift();
    return Promise.resolve(next ?? { kind: 'http', status: 404, code: 'not_found' });
  }

  getClientConfig(): Promise<TransportResponse> {
    this.configCalls += 1;
    return Promise.resolve(this.config);
  }
}

export class FakeMono {
  mono = 1000;
  boot = 'boot-1';
  monotonicNow(): number {
    return this.mono;
  }
  bootId(): string {
    return this.boot;
  }
}

export interface PullHarness {
  core: SyncCore;
  pull: NonNullable<SyncCore['pull']>;
  replica: FakeReplica;
  transport: FakePullTransport;
  queue: InMemoryQueueStore;
  server: FakeServer;
  session: FakeSession;
  clock: FakeClock;
  mono: FakeMono;
  events: EngineEvent[];
}

export function makePull(
  o: {
    disk?: { data: Disk };
    replica?: FakeReplica;
    queue?: InMemoryQueueStore;
    session?: FakeSession;
    clock?: FakeClock;
    mono?: FakeMono;
    transport?: FakePullTransport;
    options?: PullOptions;
    seed?: number;
  } = {},
): PullHarness {
  const queue = o.queue ?? new InMemoryQueueStore();
  const server = new FakeServer();
  const session = o.session ?? new FakeSession();
  const clock = o.clock ?? new FakeClock(SERVER_NOW);
  const mono = o.mono ?? new FakeMono();
  const replica = o.replica ?? new FakeReplica(o.disk);
  const transport = o.transport ?? new FakePullTransport();
  const events: EngineEvent[] = [];
  const pullDeps: PullDepsConfig = { transport, replica, monotonic: mono, ...(o.options === undefined ? {} : { options: o.options }) };
  const core = createSyncCore({
    store: queue,
    transport: server,
    clock,
    random: seededRandom(o.seed ?? 11),
    session,
    events: { emit: (e) => events.push(e) },
    pull: pullDeps,
  });
  return { core, pull: core.pull as NonNullable<SyncCore['pull']>, replica, transport, queue, server, session, clock, mono, events };
}
