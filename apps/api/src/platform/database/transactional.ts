/**
 * The ONE way to open a transaction in the API (ADR-0017 → "Aktualizacja, przebudowa i weryfikacja"; EVM-034). Besides running the
 * unit of work it owns a registry of PRE-COMMIT actions: a participant (today `overview`, the read model of the list) enlists work
 * while the domain events of the change are handled, and the registry runs it inside the SAME transaction after the unit of work
 * and before COMMIT — so the change and everything derived from it are committed together or rolled back together.
 *
 * Fail closed: a handler that needs the registry and finds a transaction opened some other way (a plain `db.transaction()`) gets an
 * error from {@link requirePreCommitRegistry}, never a silent skip — a skipped recomputation would let the projection drift. For
 * that reason `.transaction()` may occur only in this file (test: architecture of the platform).
 */
import type { Kysely } from 'kysely';
import type { Database } from './database.ts';

/** A participant of the pre-commit phase: its state is created on the first enlistment and handed to `run` before COMMIT. */
export interface PreCommitParticipant<State> {
  /** Identity of the participant; one state per transaction. */
  readonly key: symbol;
  create(): State;
  run(state: State, tx: Kysely<Database>): Promise<void>;
}

export class PreCommitRegistry {
  readonly #states = new Map<symbol, { readonly state: unknown; readonly participant: PreCommitParticipant<never> }>();

  /** @returns the state of the participant in this transaction (created on the first call) */
  enlist<State>(participant: PreCommitParticipant<State>): State {
    const known = this.#states.get(participant.key);
    if (known !== undefined) return known.state as State;
    const state = participant.create();
    this.#states.set(participant.key, { state, participant: participant as PreCommitParticipant<never> });
    return state;
  }

  /** Runs the participants in the order of their first enlistment; a participant enlisted while another runs is run as well. */
  async flush(tx: Kysely<Database>): Promise<void> {
    const done = new Set<symbol>();
    for (;;) {
      const next = [...this.#states.entries()].find(([key]) => !done.has(key));
      if (next === undefined) return;
      done.add(next[0]);
      await (next[1].participant as PreCommitParticipant<unknown>).run(next[1].state, tx);
    }
  }
}

const REGISTRIES = new WeakMap<object, PreCommitRegistry>();

export interface TransactionOptions {
  /** Default is the isolation level of the connection (READ COMMITTED); the consistent reads of several queries use `repeatable read`. */
  readonly isolationLevel?: 'repeatable read';
}

/** Runs `work` in a transaction, then the pre-commit actions of the registry, then commits. Any error rolls everything back. */
export function runInTransaction<T>(
  db: Kysely<Database>,
  work: (tx: Kysely<Database>) => Promise<T>,
  options: TransactionOptions = {},
): Promise<T> {
  const builder = db.transaction();
  const configured = options.isolationLevel === undefined ? builder : builder.setIsolationLevel(options.isolationLevel);
  return configured.execute(async (tx) => {
    const registry = new PreCommitRegistry();
    REGISTRIES.set(tx, registry);
    const result = await work(tx);
    await registry.flush(tx);
    return result;
  });
}

/** @throws Error when `tx` was not opened by {@link runInTransaction} (fail closed) */
export function requirePreCommitRegistry(tx: Kysely<Database>): PreCommitRegistry {
  const registry = REGISTRIES.get(tx);
  if (registry === undefined) throw new Error('The transaction was not opened by runInTransaction: no pre-commit registry');
  return registry;
}
