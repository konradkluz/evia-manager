/**
 * The port through which other modules add their part to the scope of a work order that is being edited (EVM-035 AC2, SR-API-06;
 * domain-model.md → "Kompozycja zlecenia z szablonu": adding an item PROPOSES the processes the item brings, with no duplicates by
 * code). `work-orders` does not depend on `procedures`; `procedures` depends on `work-orders` and registers an implementation here
 * (the same inversion as `composition-contributor.ts`) — there is no cycle.
 *
 * Rules of an implementation (the service relies on them):
 * - it runs in the SAME transaction as the item: the `tx` it is handed is the only handle it may write with, so its rows commit or
 *   roll back with the item, the journal, the audit record and the idempotency record. An error it throws rolls the whole command
 *   back;
 * - NO external I/O inside the transaction (a slow or hostile endpoint would hold the lock of the order and a connection);
 * - it is called with the order LOCKED (`SELECT … FOR NO KEY UPDATE`), so what it counts cannot change meanwhile;
 * - a process whose code is already active in the order is SKIPPED, not an error (no duplicates by code; a race with a second card
 *   must not fail the whole command); it answers the codes it really added;
 * - a limit of the API it would pass is {@link ScopeLimitError}: nothing is cut off silently (`422 limit_exceeded`);
 * - it gets identifiers and codes — never the title, the description, the notes or the parameters of the item.
 */
import type { Kysely } from 'kysely';
import type { Database } from '../../platform/database/database.ts';
import type { Principal } from '../../platform/http/principal.ts';

export interface ScopeAdditionContext {
  readonly workOrderId: string;
  readonly scopeItem: {
    readonly id: string;
    /** The item of the catalogue the scope item was copied from. */
    readonly sourceCatalogItemId: string;
    readonly code: string;
  };
  /** The codes of the processes to add — a subset of those the item brings (the service has checked it), each once. */
  readonly procedureCodes: readonly string[];
  readonly principal: Principal;
  readonly now: Date;
}

/** A participant would pass a limit of the API; `pointer` and `code` say which one and nothing else. */
export class ScopeLimitError extends Error {
  readonly pointer: string;
  readonly code: string;

  constructor(pointer: string, code: string) {
    super(`a limit of the scope was exceeded (${code})`);
    this.name = 'ScopeLimitError';
    this.pointer = pointer;
    this.code = code;
  }
}

export interface WorkOrderScopeParticipant {
  /** Unique, stable name (the tie-break of the order and the key of the registry). */
  readonly name: string;
  /** Position in the sequence; the lower runs first. */
  readonly order: number;
  /** @returns the codes of the processes it added (those that were skipped as duplicates are not among them) */
  addProcedures(tx: Kysely<Database>, context: ScopeAdditionContext): Promise<readonly string[]>;
  /**
   * The codes of the ACTIVE processes the scope item brought into the order, in order — what the answer of an addition and of its
   * repeat names (a repeat does not run `addProcedures` again).
   */
  procedureCodesOf(tx: Kysely<Database>, workOrderId: string, scopeItemId: string): Promise<readonly string[]>;
}

/** The registry the participants announce themselves to; the service takes them in the fixed order. */
export class WorkOrderScopeRegistry {
  readonly #participants = new Map<string, WorkOrderScopeParticipant>();

  register(participant: WorkOrderScopeParticipant): void {
    if (this.#participants.has(participant.name)) throw new Error(`scope participant ${participant.name} is already registered`);
    this.#participants.set(participant.name, participant);
  }

  ordered(): WorkOrderScopeParticipant[] {
    return [...this.#participants.values()].sort((a, b) => a.order - b.order || (a.name < b.name ? -1 : 1));
  }
}
