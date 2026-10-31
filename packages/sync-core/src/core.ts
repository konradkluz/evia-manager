import { SyncEngine, type EngineOptions } from './engine.ts';
import type { Clock, EventSink, QueueStore, Random, SessionOwner, Transport } from './ports.ts';
import { MutationQueue } from './queue.ts';
import { createUuidV7 } from './uuidv7.ts';

export interface SyncCoreDeps {
  readonly store: QueueStore;
  readonly transport: Transport;
  readonly clock: Clock;
  readonly random: Random;
  readonly session: SessionOwner;
  readonly events?: EventSink;
  readonly options?: EngineOptions;
}

export interface SyncCore {
  readonly queue: MutationQueue;
  readonly engine: SyncEngine;
}

/** Wires the queue and the engine on the given ports (one UUIDv7 generator for the whole core). */
export function createSyncCore(deps: SyncCoreDeps): SyncCore {
  const queue = new MutationQueue({
    store: deps.store,
    clock: deps.clock,
    session: deps.session,
    newId: createUuidV7(deps.clock, deps.random),
  });
  const engine = new SyncEngine({ ...deps, queue });
  return { queue, engine };
}
