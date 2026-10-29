import {
  createSyncCore,
  type EngineEvent,
  type EngineOptions,
  type QueueRecord,
  type QueueStore,
  type RecordPatch,
  type SessionOwner,
  type SettledInfo,
  type SyncCore,
  type SyncRequest,
  type Transport,
  type TransportResponse,
  type RefreshResult,
} from '../src/index.ts';

export const USER_A = 'user-a-synthetic';
export const USER_B = 'user-b-synthetic';

/** A test double of the durable store: `data` survives "restarts" (a new engine on the same store object). */
export class InMemoryQueueStore implements QueueStore {
  data: unknown[] = [];
  readonly settled: { mutationId: string; info: SettledInfo }[] = [];
  /** Throws on the n-th call of a method (1-based) to simulate a process killed mid-flush. */
  failOn: { method: 'append' | 'update' | 'settle'; call: number } | undefined;
  readonly #calls = { append: 0, update: 0, settle: 0 };

  #maybeCrash(method: 'append' | 'update' | 'settle'): void {
    this.#calls[method] += 1;
    if (this.failOn?.method === method && this.failOn.call === this.#calls[method]) throw new Error('simulated crash with synthetic data');
  }

  append(record: QueueRecord): Promise<void> {
    this.#maybeCrash('append');
    this.data.push(JSON.parse(JSON.stringify(record)));
    return Promise.resolve();
  }

  readAll(): Promise<readonly unknown[]> {
    return Promise.resolve(JSON.parse(JSON.stringify(this.data)) as unknown[]);
  }

  update(mutationId: string, patch: RecordPatch): Promise<void> {
    this.#maybeCrash('update');
    const index = this.data.findIndex((item) => (item as { mutationId?: string }).mutationId === mutationId);
    if (index < 0) return Promise.resolve();
    const next = { ...(this.data[index] as Record<string, unknown>), ...patch } as Record<string, unknown>;
    if (patch.lastCode === undefined) delete next['lastCode'];
    if (patch.nextAttemptAt === undefined) delete next['nextAttemptAt'];
    this.data[index] = next;
    return Promise.resolve();
  }

  settle(mutationId: string, info: SettledInfo): Promise<void> {
    this.#maybeCrash('settle');
    this.data = this.data.filter((item) => (item as { mutationId?: string }).mutationId !== mutationId);
    this.settled.push({ mutationId, info });
    return Promise.resolve();
  }

  records(): QueueRecord[] {
    return this.data as QueueRecord[];
  }
}

export class FakeClock {
  ms: number;
  constructor(ms = Date.UTC(2026, 9, 29, 8, 0, 0)) {
    this.ms = ms;
  }
  now(): number {
    return this.ms;
  }
  advance(ms: number): void {
    this.ms += ms;
  }
}

/** Deterministic byte source (xorshift32) — the seed makes failures reproducible. */
export function seededRandom(seed = 1): { getRandomValues(bytes: Uint8Array): Uint8Array } {
  let state = seed >>> 0 || 1;
  return {
    getRandomValues(bytes: Uint8Array): Uint8Array {
      for (let i = 0; i < bytes.length; i += 1) {
        state ^= state << 13;
        state >>>= 0;
        state ^= state >>> 17;
        state ^= state << 5;
        state >>>= 0;
        bytes[i] = state & 0xff;
      }
      return bytes;
    },
  };
}

/** A server double: idempotent by `mutationId`, can lose responses, and records every request. */
export class FakeServer implements Transport {
  readonly requests: SyncRequest[] = [];
  readonly applied = new Map<string, string>();
  /** Mutation ids in the order the server applied them for the first time. */
  readonly appliedOrder: string[] = [];
  /** Scripted responses taking precedence over the server logic (consumed in order). */
  readonly script: (TransportResponse | ((request: SyncRequest) => TransportResponse | Promise<TransportResponse>))[] = [];
  /** If set, the next batch is processed by the server but the response is lost. */
  loseNextResponse = false;
  /** Outcome per type for the server logic. */
  rejectCodes = new Map<string, string>();

  async sendBatch(request: SyncRequest): Promise<TransportResponse> {
    this.requests.push(JSON.parse(JSON.stringify(request)) as SyncRequest);
    const scripted = this.script.shift();
    if (scripted !== undefined) return typeof scripted === 'function' ? scripted(request) : scripted;
    const results = request.mutations.map((m) => {
      const reject = this.rejectCodes.get(m.mutationId);
      if (reject !== undefined) return { mutationId: m.mutationId, outcome: 'rejected', code: reject };
      const seen = this.applied.has(m.mutationId);
      if (!seen) this.appliedOrder.push(m.mutationId);
      this.applied.set(m.mutationId, JSON.stringify(m));
      return { mutationId: m.mutationId, outcome: seen ? 'duplicate' : 'applied' };
    });
    if (this.loseNextResponse) {
      this.loseNextResponse = false;
      return { kind: 'network' };
    }
    return { kind: 'ok', body: { serverTime: '2026-10-29T08:00:00Z', results } };
  }

  allMutationIds(): string[] {
    return this.requests.flatMap((r) => r.mutations.map((m) => m.mutationId));
  }
}

export class FakeSession implements SessionOwner {
  refreshCalls = 0;
  refreshResult: RefreshResult = 'refreshed';
  refreshDelay: Promise<void> | undefined;
  userId: string | null;
  constructor(userId: string | null = USER_A) {
    this.userId = userId;
  }
  currentUserId(): Promise<string | null> {
    return Promise.resolve(this.userId);
  }
  async refresh(): Promise<RefreshResult> {
    this.refreshCalls += 1;
    if (this.refreshDelay !== undefined) await this.refreshDelay;
    return this.refreshResult;
  }
}

export function makeCore(
  overrides: {
    store?: InMemoryQueueStore;
    server?: FakeServer;
    session?: FakeSession;
    clock?: FakeClock;
    seed?: number;
    options?: EngineOptions;
  } = {},
): {
  core: SyncCore;
  store: InMemoryQueueStore;
  server: FakeServer;
  session: FakeSession;
  clock: FakeClock;
  events: EngineEvent[];
} {
  const store = overrides.store ?? new InMemoryQueueStore();
  const server = overrides.server ?? new FakeServer();
  const session = overrides.session ?? new FakeSession();
  const clock = overrides.clock ?? new FakeClock();
  const events: EngineEvent[] = [];
  const core = createSyncCore({
    store,
    transport: server,
    clock,
    random: seededRandom(overrides.seed ?? 7),
    session,
    events: { emit: (e) => events.push(e) },
    ...(overrides.options === undefined ? {} : { options: overrides.options }),
  });
  return { core, store, server, session, clock, events };
}

export const WORK_ORDER = '0194c2a0-0000-7000-8000-000000000001';

export function noteInput(
  workOrderId = WORK_ORDER,
  extra: Record<string, unknown> = {},
): {
  type: string;
  commandVersion: number;
  payload: Record<string, unknown>;
  orderingKey: string;
} {
  return {
    type: 'CreateNote',
    commandVersion: 1,
    orderingKey: workOrderId,
    payload: { id: '0194c2a0-0000-7000-8000-0000000000aa', workOrderId, body: 'synthetic note', ...extra },
  };
}
