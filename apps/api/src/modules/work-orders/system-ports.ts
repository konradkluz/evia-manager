/**
 * The SYSTEM port of `work-orders` for the read model (ADR-0017 W5; EVM-034): what `overview` needs to recompute the projection of an
 * order, with the MINIMAL data (keys, codes, dates — no title, no description, no names). It is NOT part of `index.ts` on purpose:
 * the rule of module boundaries lets only `modules/overview/(application|infrastructure)` import a `system-ports.ts`, so no controller
 * and no other module can reach a function that skips the read policy. The result does not depend on the role of anyone (T8): the
 * caller of the recomputation is the system, in the transaction of the change or in `rebuild`.
 */
import type { Kysely } from 'kysely';
import type { Database } from '../../platform/database/database.ts';

export const WORK_ORDER_PROJECTION_SOURCE = Symbol('WORK_ORDER_PROJECTION_SOURCE');

/** The keys of one order (soft deleted ones included: the projection holds the deletion as `deletedAt`). */
export interface WorkOrderKeys {
  readonly id: string;
  readonly number: string;
  readonly status: string;
  readonly createdAt: Date;
  readonly deletedAt: Date | null;
  /** The active coordinator, if any. */
  readonly coordinatorUserId: string | null;
  readonly customerId: string | null;
  readonly siteId: string | null;
  readonly sourceTemplateId: string | null;
}

export interface WorkOrderProjectionSource {
  /** The keys of the orders among `ids` that exist (ONE query); the others are absent. */
  keysOf(tx: Kysely<Database>, ids: readonly string[]): Promise<readonly WorkOrderKeys[]>;
  /** A page of identifiers in ascending order, after `afterId` (all orders: `rebuild` walks them in batches). */
  idsAfter(tx: Kysely<Database>, afterId: string | undefined, limit: number): Promise<readonly string[]>;
}
