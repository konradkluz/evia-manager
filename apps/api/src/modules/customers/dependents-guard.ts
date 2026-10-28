/**
 * The port through which other modules say whether a customer still has dependents that forbid its deletion and its anonymization
 * (EVM-041 AC2; ADR-0001; SR-AUTHZ-10, SR-ERR-01; domain-model.md -> "Klient"). `customers` does not depend on `work-orders`:
 * `work-orders` registers an implementation here (the open orders of the customer) - the dependency is inverted, there is no cycle.
 * It is modelled on `WorkOrderDeletionRegistry` of `work-orders`.
 *
 * Rules of an implementation (the service relies on them):
 * - `countOpen` runs UNDER THE LOCK of the customer (`SELECT ... FOR UPDATE`), in the transaction of the command, BEFORE anything is
 *   written, as a statement of its own (READ COMMITTED: an order committed before the lock is taken is counted), and reads the database only;
 * - it answers with a non-negative integer - the number of its dependents that block; never a name, a number or an identifier of a dependent;
 * - the registry returns the counts PER IMPLEMENTATION (by `name`): the answer to the caller takes `openWorkOrders` from the implementation
 *   named {@link WORK_ORDERS_GUARD} only, so a module added later never changes what that number means;
 * - the order of the calls is fixed: ascending `order`, then `name`; two implementations cannot share a name.
 * The registry fails closed: with nobody registered, or with an implementation that throws or answers with something else than a
 * non-negative integer, the command is not decided (`500`, nothing written) - never allowed.
 */
import type { Kysely } from 'kysely';
import type { Database } from '../../platform/database/database.ts';

/** The name of the implementation of `work-orders`: the source of `openWorkOrders` in the problem `has_active_dependents`. */
export const WORK_ORDERS_GUARD = 'work-orders';

export interface CustomerDependentsGuard {
  /** Unique, stable name (the tie-break of the order and the key of the registry). */
  readonly name: string;
  /** Position in the sequence; the lower runs first. */
  readonly order: number;
  /** @returns the number of dependents of the customer that block the deletion and the anonymization */
  countOpen(tx: Kysely<Database>, customerId: string): Promise<number>;
}

/** What one implementation counted. */
export interface DependentsCount {
  readonly name: string;
  readonly open: number;
}

/** The registry the implementations announce themselves to; the service takes them in the fixed order. */
export class CustomerDependentsRegistry {
  readonly #guards = new Map<string, CustomerDependentsGuard>();

  register(guard: CustomerDependentsGuard): void {
    if (this.#guards.has(guard.name)) throw new Error(`customer dependents guard ${guard.name} is already registered`);
    this.#guards.set(guard.name, guard);
  }

  ordered(): CustomerDependentsGuard[] {
    return [...this.#guards.values()].sort((a, b) => a.order - b.order || (a.name < b.name ? -1 : 1));
  }

  /** The names of the registered implementations (a test and a diagnosis; no behaviour depends on them). */
  names(): string[] {
    return this.ordered().map((guard) => guard.name);
  }

  /**
   * The count of every implementation, in order. Fails closed: an empty registry, an implementation that throws or one that answers with
   * something else than a non-negative integer is an `Error` (the command answers `500` and rolls back), never a permission.
   */
  async countAll(tx: Kysely<Database>, customerId: string): Promise<DependentsCount[]> {
    const guards = this.ordered();
    if (guards.length === 0) throw new Error('no customer dependents guard is registered');
    const counts: DependentsCount[] = [];
    for (const guard of guards) {
      const open = await guard.countOpen(tx, customerId);
      if (typeof open !== 'number' || !Number.isInteger(open) || open < 0) {
        throw new Error(`customer dependents guard ${guard.name} returned an invalid count`);
      }
      counts.push({ name: guard.name, open });
    }
    return counts;
  }
}
