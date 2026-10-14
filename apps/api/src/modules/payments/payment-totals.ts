/**
 * The facade of the totals of payments for the list of work orders (EVM-056 AC1; ADR-0017 D8, W2 — the pattern C′). A SEPARATE entry
 * file, not part of `index.ts`: only the application layer of `overview` may import it (a rule of dependency-cruiser), because its
 * INVARIANT is on the caller:
 *
 * the identifiers passed in are the orders of ONE page of the list that the query of that page has already filtered with the read
 * policy of work orders (`workOrder.read`, in the query) and that the batch of titles of `work-orders` has shown to the caller — never
 * identifiers taken from a request (CWE-639, CWE-863). At most a page (100). The facade itself applies the right to read payments
 * (`canReadPayments`): without it the answer is empty (fail closed), whatever the identifiers.
 *
 * The totals count the live (not deleted) milestones `invoiced` only — the cancelled, planned and paid ones are in neither total (W3):
 * `invoicedTotal` all of them, `overdueTotal` those whose due date is before `today` (the day of the page, `YYYY-MM-DD` in
 * `Europe/Warsaw` — the same day as the state of the column, never the clock of the database). ONE query for the whole page.
 * Amounts never reach a log or an error: a second currency is a defect (`internal_error`), never a mixed sum (D8: a trigger of revision).
 */
import type { Kysely } from 'kysely';
import type { Database } from '../../platform/database/database.ts';
import type { Principal } from '../../platform/http/principal.ts';

export const PAYMENT_TOTALS_DIRECTORY = Symbol('PAYMENT_TOTALS_DIRECTORY');

/** The most identifiers one call may name: the largest page of the list. */
export const MAX_TOTALS_IDS = 100;

export interface PaymentTotals {
  /** grosze (PLN) of the milestones `invoiced`, overdue ones included */
  readonly invoicedMinor: number;
  /** grosze (PLN) of the milestones `invoiced` whose due date is before `today` */
  readonly overdueMinor: number;
}

export interface PaymentTotalsDirectory {
  /**
   * @param workOrderIds the orders of one page, already filtered by the read policy (see the invariant above); at most {@link MAX_TOTALS_IDS}
   * @param today the day of the page, `YYYY-MM-DD`
   * @returns the totals of the orders that have an issued milestone (an order without one is absent); empty for a caller who may not
   * read payments
   * @throws Error for more identifiers than a page, or for an amount in a currency other than PLN (a `500`, without the amount)
   */
  paymentTotalsOf(
    tx: Kysely<Database>,
    principal: Principal,
    workOrderIds: readonly string[],
    today: string,
  ): Promise<ReadonlyMap<string, PaymentTotals>>;
}
