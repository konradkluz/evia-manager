/**
 * The port through which other modules add their part to a work order that is being created (EVM-022 AC6, SR-API-06; domain-model →
 * "Kompozycja zlecenia z szablonu"). `work-orders` does not depend on `procedures` and `payments`; they depend on `work-orders` and
 * register an implementation here (EVM-031: the processes and their stages — registered; EVM-053: the payment milestones) — the
 * dependency is inverted, there is no cycle.
 *
 * Rules of an implementation (the service relies on them):
 * - it runs in the SAME transaction as the order: the `tx` it is handed is the only handle it may write with, so its rows commit or
 *   roll back with the order. An error it throws rolls the whole creation back — no order, no scope item, no assignment, no audit
 *   record, no idempotency record, and the number is not used;
 * - NO external I/O inside the transaction: no HTTP call, no message sent, no file written (a slow or hostile endpoint would hold
 *   the transaction, the counter row and a connection; a call to a URL taken from data is an SSRF). It reads and writes the
 *   database only; anything else is done after the commit by a job;
 * - the order of the calls is fixed: ascending `order`, then `name`; two implementations cannot share a name;
 * - it gets the identifiers and the copied scope — never the title or the description of the order.
 */
import type { Kysely } from 'kysely';
import type { Database } from '../../platform/database/database.ts';
import type { Principal } from '../../platform/http/principal.ts';

export interface CompositionScopeItem {
  readonly id: string;
  readonly sourceCatalogItemId: string | null;
  readonly position: number;
  readonly code: string;
}

export interface CompositionContext {
  readonly workOrderId: string;
  /** `null` — an empty order (there is no template to compose from). */
  readonly templateId: string | null;
  /** The scope as it was copied, in order. */
  readonly scopeItems: readonly CompositionScopeItem[];
  readonly principal: Principal;
  readonly now: Date;
}

export interface WorkOrderCompositionContributor {
  /** Unique, stable name (the tie-break of the order and the key of the registry). */
  readonly name: string;
  /** Position in the sequence; the lower runs first (the processes before the payments, because a payment may refer to one). */
  readonly order: number;
  contribute(tx: Kysely<Database>, context: CompositionContext): Promise<void>;
}

/** The registry the contributors announce themselves to; the service takes them in the fixed order. */
export class WorkOrderCompositionRegistry {
  readonly #contributors = new Map<string, WorkOrderCompositionContributor>();

  register(contributor: WorkOrderCompositionContributor): void {
    if (this.#contributors.has(contributor.name)) throw new Error(`composition contributor ${contributor.name} is already registered`);
    this.#contributors.set(contributor.name, contributor);
  }

  ordered(): WorkOrderCompositionContributor[] {
    return [...this.#contributors.values()].sort((a, b) => a.order - b.order || (a.name < b.name ? -1 : 1));
  }
}

/**
 * A composition that cannot be applied because the CONFIGURATION of the template passes a limit (30 processes or stages, more than 20 payment milestones;
 * EVM-099): not a bug of the request, not an error of the server. A contributor wraps its own limit error in this one, so `work-orders` can tell it without
 * importing the contributor (the dependency points the other way). The creation rolls back as a whole; the panel keeps its answer, the phone gets
 * `template_unavailable`.
 */
export class CompositionRejectedError extends Error {
  constructor(options?: { readonly cause: unknown }) {
    super('the composition of the template passes a limit', options);
    this.name = 'CompositionRejectedError';
  }
}
