/**
 * What the three commands that end the life of a customer share (EVM-041): the check of the dependents under the lock and the event
 * of the audit trail. No state; pure apart from the registry it is given.
 */
import type { Kysely } from 'kysely';
import type { Database } from '../../../platform/database/database.ts';
import type { Principal } from '../../../platform/http/principal.ts';
import { ProblemException } from '../../../platform/http/problem.ts';
import { WORK_ORDERS_GUARD, type CustomerDependentsRegistry } from '../dependents-guard.ts';
import type { CustomerEvent } from '../events.ts';

/**
 * `409 has_active_dependents` when ANY implementation of the port counts a dependent that blocks. The number in the answer is the one of
 * the implementation of `work-orders` ONLY (`openWorkOrders`: a number and nothing else - no number, title or id of an order); it is left
 * out when that implementation counted none (the dependents of another module do not change what the number means). An empty registry,
 * an implementation that throws or one that does not answer with a non-negative integer is an `Error`: `500`, nothing written.
 */
export async function assertNoOpenDependents(
  registry: CustomerDependentsRegistry,
  tx: Kysely<Database>,
  customerId: string,
): Promise<void> {
  const counts = await registry.countAll(tx, customerId);
  if (counts.every((count) => count.open === 0)) return;
  const openWorkOrders = counts.find((count) => count.name === WORK_ORDERS_GUARD)?.open ?? 0;
  throw new ProblemException('has_active_dependents', openWorkOrders > 0 ? { openWorkOrders } : {});
}

/** The event of the audit trail: the actor, the customer and the outcome - never a value of the customer (SR-LOG-03). */
export function customerEvent(
  type: 'customer.deleted' | 'customer.restored' | 'customer.anonymized',
  principal: Principal,
  customerId: string,
  outcome: 'success' | 'failed',
): CustomerEvent {
  return { type, actor: { type: 'user', userId: principal.userId }, outcome, objectType: 'customer', objectId: customerId };
}
