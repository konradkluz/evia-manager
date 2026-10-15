/**
 * The totals of the issued milestones of a page of orders (EVM-056; see `../payment-totals.ts`): ONE statement, the identifiers as ONE
 * array parameter (`= any($1::uuid[])`) and the day as a parameter — never `now()` or `current_date`. The live milestones `invoiced`
 * only (the condition of the partial index of 0030). The sums are `bigint` (text from the driver), turned into numbers through
 * {@link amountFromDatabase} (a safe integer or an error).
 */
import { sql } from 'kysely';
import { CURRENCY } from '../domain/money.ts';
import type { PaymentTotals } from '../payment-totals.ts';
import { amountFromDatabase } from './milestone-store.ts';
import type { PaymentsDb } from './tables.ts';

export async function invoicedTotalsOf(
  db: PaymentsDb,
  workOrderIds: readonly string[],
  today: string,
): Promise<Map<string, PaymentTotals>> {
  const rows = await db
    .selectFrom('payments.payment_milestones')
    .select([
      'work_order_id as workOrderId',
      'currency',
      sql<string>`sum(amount_minor)`.as('invoiced'),
      sql<string>`coalesce(sum(amount_minor) filter (where due_date < ${today}::date), 0)`.as('overdue'),
    ])
    .where(sql<boolean>`work_order_id = any(${[...workOrderIds]}::uuid[])`)
    .where('status', '=', 'invoiced')
    .where('deleted_at', 'is', null)
    .groupBy(['work_order_id', 'currency'])
    .execute();
  const totals = new Map<string, PaymentTotals>();
  for (const row of rows) {
    // v1 knows PLN only (D8): a milestone in another currency is a defect of the data, never a mixed sum — the message names no amount
    if (row.currency !== CURRENCY) throw new Error('an issued payment milestone is not in PLN');
    totals.set(row.workOrderId, {
      invoicedMinor: amountFromDatabase(row.invoiced) ?? 0,
      overdueMinor: amountFromDatabase(row.overdue) ?? 0,
    });
  }
  return totals;
}
