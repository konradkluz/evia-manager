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
import { MutationQueue } from './queue.ts';
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

export interface SyncCore {
  readonly queue: MutationQueue;
  readonly engine: SyncEngine;
  readonly pull?: PullEngine;
  /** One whole cycle, single-flight: push (flush) first, then pull. A pause from either side stops both. */
  sync(options?: FlushOptions): Promise<CycleResult>;
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
  const cycle = async (options: FlushOptions): Promise<CycleResult> => {
    let flush = await engine.flush(options);
    let pulled = pull === undefined || flush.paused !== undefined ? undefined : await pull.pull(options);
    while (again !== undefined && gate.paused === undefined) {
      const next = again;
      again = undefined;
      flush = await engine.flush(next);
      if (pull !== undefined) pulled = await pull.pull(next);
    }
    return { flush, ...(pulled === undefined ? {} : { pull: pulled }) };
  };
  const sync = (options: FlushOptions = {}): Promise<CycleResult> => {
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
  return { queue, engine, ...(pull === undefined ? {} : { pull }), sync };
}
