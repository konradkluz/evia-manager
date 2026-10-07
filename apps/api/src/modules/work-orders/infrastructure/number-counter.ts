/**
 * The yearly counter of work order numbers (EVM-022 AC5, AC6; SR-API-07; ASVS V2.3.3; CWE-362). ONE statement takes the next
 * value: `INSERT … ON CONFLICT (year) DO UPDATE … RETURNING` — atomic, and the row lock it takes lasts until the end of the
 * transaction of the creation, so two creations never get the same number and the numbers of a year follow each other. It is a
 * row and not a database sequence ON PURPOSE: a sequence is not rolled back, so a failed creation would leave a gap in the numbers
 * (and a customer asks why `0007` is missing); a row is rolled back with the order that used it.
 * The price is that creations of orders are taken one after another until the commit — a transaction of a few statements, no
 * external I/O (see the port `WorkOrderCompositionContributor`).
 */
import type { WorkOrdersDb } from './tables.ts';

/** @returns the next number in the year (1 for the first order of the year) */
export async function takeNextNumber(db: WorkOrdersDb, year: number): Promise<number> {
  const row = await db
    .insertInto('work_orders.number_counters')
    .values({ year, last_value: 1 })
    .onConflict((conflict) =>
      conflict.column('year').doUpdateSet((eb) => ({ last_value: eb('work_orders.number_counters.last_value', '+', 1) })),
    )
    .returning('last_value')
    .executeTakeFirstOrThrow();
  return row.last_value;
}
