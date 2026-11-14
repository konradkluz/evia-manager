import { SyncEngine, type EngineOptions, type FlushOptions, type FlushResult } from './engine.ts';
import { queuePendingSource } from './pending.ts';
import type {
  Clock,
  EventSink,
  MonotonicClock,
  PendingObjectsSource,
  PullTransport,
  QueueStore,
  Random,
  ReplicaStore,
  SessionOwner,
  Transport,
} from './ports.ts';
import { PullEngine, type PullOptions, type PullResult } from './pull.ts';
import { MutationQueue, type DiscardResult, type RecreateInput, type RetargetInput } from './queue.ts';
import type { QueueRecord } from './types.ts';
import { SessionGate } from './session-gate.ts';
import { createUuidV7 } from './uuidv7.ts';

/** The pull side; optional, so a push-only core keeps working unchanged. */
export interface PullDepsConfig {
  readonly transport: PullTransport;
  readonly replica: ReplicaStore;
  readonly monotonic: MonotonicClock;
  /** Defaults to the pending objects derived from the queue; an adapter may read the queue in the transaction of the replica. */
  readonly pending?: PendingObjectsSource;
  readonly options?: PullOptions;
  /**
   * ADR-0021: until the first download is done, a cycle pulls first and sends the queue afterwards (see `SyncOptions.pullFirst`).
   * Off by default so that a host that has not decided keeps the plain push-then-pull order; the phone app turns it on.
   */
  readonly pullFirstUntilLoaded?: boolean;
}

export interface SyncCoreDeps {
  readonly store: QueueStore;
  readonly transport: Transport;
  readonly clock: Clock;
  readonly random: Random;
  readonly session: SessionOwner;
  readonly events?: EventSink;
  readonly options?: EngineOptions;
  readonly pull?: PullDepsConfig;
}

export interface CycleResult {
  readonly flush: FlushResult;
  readonly pull?: PullResult;
}

export interface SyncOptions extends FlushOptions {
  /**
   * Order of the cycle. Default: with `PullDepsConfig.pullFirstUntilLoaded` - while the replica has not finished its first download the cycle PULLS FIRST (up to the end
   * of the download), then sends the queue, then pulls the increments (ADR-0021: results of sending never mix with the generation that
   * is being built; the server is the source of the scope). Afterwards: push first, then pull.
   */
  readonly pullFirst?: boolean;
}

/** Operations on entries that "need attention"; serialized with the cycle (same lock as `sync()`), see `MutationQueue`. */
export interface AttentionOperations {
  discard(mutationId: string): Promise<DiscardResult>;
  recreate(mutationId: string, input?: RecreateInput): Promise<QueueRecord>;
  retarget(mutationId: string, input: RetargetInput): Promise<QueueRecord>;
}

export interface SyncCore {
  readonly attention: AttentionOperations;
  readonly queue: MutationQueue;
  readonly engine: SyncEngine;
  readonly pull?: PullEngine;
  /**
   * The session gate shared by push and pull. A further call of the phone (EVM-106: the template list) reports its HTTP failures to it, so
   * 401, 403 and 426 end in the same pause and the same screens as for a push or a pull.
   */
  readonly gate: SessionGate;
  /** One whole cycle, single-flight: push (flush) first, then pull. A pause from either side stops both. */
  sync(options?: SyncOptions): Promise<CycleResult>;
  /** Resumes the shared session pause and, when that succeeded, the pull-only hold. */
  resume(): Promise<boolean>;
}

/** Wires the queue and the engines on the given ports (one UUIDv7 generator and one session gate for the whole core). */
export function createSyncCore(deps: SyncCoreDeps): SyncCore {
  const queue = new MutationQueue({
    store: deps.store,
    clock: deps.clock,
    session: deps.session,
    newId: createUuidV7(deps.clock, deps.random),
  });
  const gate = new SessionGate(deps.session, deps.events);
  const engine = new SyncEngine({ ...deps, queue, gate });
  let pull: PullEngine | undefined;
  if (deps.pull !== undefined) {
    const p = deps.pull;
    pull = new PullEngine({
      replica: p.replica,
      transport: p.transport,
      clock: deps.clock,
      random: deps.random,
      monotonic: p.monotonic,
      gate,
      pending: p.pending ?? queuePendingSource(deps.store, deps.session),
      ...(p.options === undefined ? {} : { options: p.options }),
    });
  }
  let running: Promise<CycleResult> | undefined;
  let again: FlushOptions | undefined;
  let operations = 0;
  let chain: Promise<unknown> = Promise.resolve();
  const emptyFlush: FlushResult = { settled: 0, attention: 0, retryScheduled: false };
  const cycle = async (options: SyncOptions): Promise<CycleResult> => {
    const first =
      pull !== undefined && (options.pullFirst ?? (deps.pull?.pullFirstUntilLoaded === true && !(await pull.initialLoadDone())));
    let flush: FlushResult;
    let pulled: PullResult | undefined;
    if (first && pull !== undefined) {
      pulled = await pull.pull(options);
      // A failed or paused download sends nothing: the queue stays as it is (the next cycle repeats the download first).
      // `partial` (page limit of the cycle) while the first download is unfinished sends nothing either: ADR-0021, no mixing with the
      // generation under construction; the caller repeats the cycle.
      const ok = pulled.status === 'complete' || (pulled.status === 'partial' && (await pull.initialLoadDone()));
      flush = ok ? await engine.flush(options) : { ...emptyFlush, ...(gate.paused === undefined ? {} : { paused: gate.paused }) };
      if (ok && gate.paused === undefined) pulled = await pull.pull(options);
    } else {
      flush = await engine.flush(options);
      pulled = pull === undefined || flush.paused !== undefined ? undefined : await pull.pull(options);
    }
    while (again !== undefined && gate.paused === undefined) {
      const next = again;
      again = undefined;
      flush = await engine.flush(next);
      if (pull !== undefined) pulled = await pull.pull(next);
    }
    return { flush, ...(pulled === undefined ? {} : { pull: pulled }) };
  };
  const startCycle = (options: SyncOptions): Promise<CycleResult> => {
    if (running !== undefined) {
      again = options;
      return running;
    }
    const run = cycle(options).finally(() => {
      running = undefined;
    });
    running = run;
    return run;
  };
  const sync = async (options: SyncOptions = {}): Promise<CycleResult> => {
    // An operation on the queue in progress holds the cycle back (same lock).
    while (operations > 0) await chain;
    return startCycle(options);
  };
  const exclusive = <T>(fn: () => Promise<T>): Promise<T> => {
    operations += 1;
    const result = chain.then(async () => {
      if (running !== undefined) await running.catch(() => undefined);
      return fn();
    });
    const settled = result.then(
      () => undefined,
      () => undefined,
    );
    chain = settled;
    void settled.then(() => {
      operations -= 1;
    });
    return result;
  };
  const attention: AttentionOperations = {
    discard: (id) => exclusive(() => queue.discard(id)),
    recreate: (id, input) => exclusive(() => queue.recreate(id, input)),
    retarget: (id, input) => exclusive(() => queue.retarget(id, input)),
  };
  const resume = async (): Promise<boolean> => {
    const ok = await engine.resume();
    if (ok) pull?.resume();
    return ok;
  };
  return { queue, engine, attention, gate, ...(pull === undefined ? {} : { pull }), sync, resume };
}
