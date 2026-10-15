/**
 * The facade of `payments` for the other modules (ADR-0001: a module reaches another one through its `index.ts` only). Its consumer is
 * `timeline` (EVM-054 AC3): an event of the journal names a milestone by its identifier and the page shows its CURRENT name. The caller
 * passes ITS transaction and THE ORDER of the journal: the query is anchored to it, so the identifier of a milestone of another order
 * gives nothing (CWE-639). Nothing but the name comes back — never an amount, a status or an invoice (SR-DATA-03).
 */
import type { Kysely } from 'kysely';
import type { Database } from '../../platform/database/database.ts';

export const PAYMENT_MILESTONE_DIRECTORY = Symbol('PAYMENT_MILESTONE_DIRECTORY');

export interface PaymentMilestoneDirectory {
  /**
   * The names of the LIVE milestones of the order `workOrderId` among `milestoneIds` (ONE query for the whole page; a milestone of
   * another order or a deleted one is absent — the journal shows it without a name).
   */
  namesOf(tx: Kysely<Database>, workOrderId: string, milestoneIds: readonly string[]): Promise<ReadonlyMap<string, string>>;
}
