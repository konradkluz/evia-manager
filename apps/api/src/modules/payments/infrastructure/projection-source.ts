/** The query behind the system port of `payments` for the read model (see `../system-ports.ts`): SELECT only, bound parameters. */
import { sql, type Kysely } from 'kysely';
import type { Database } from '../../../platform/database/database.ts';
import type { MilestoneSignalRow, PaymentProjectionSource } from '../system-ports.ts';
import { paymentTables } from './tables.ts';

export class PaymentProjectionSourceService implements PaymentProjectionSource {
  async milestoneSignalsOf(tx: Kysely<Database>, workOrderIds: readonly string[]): Promise<readonly MilestoneSignalRow[]> {
    if (workOrderIds.length === 0) return [];
    const rows = await paymentTables(tx)
      .selectFrom('payments.payment_milestones')
      .select([
        'work_order_id as workOrderId',
        'status',
        sql<string | null>`to_char(${sql.ref('payments.payment_milestones.due_date')}, 'YYYY-MM-DD')`.as('dueDate'),
      ])
      .where('work_order_id', 'in', workOrderIds)
      .where('deleted_at', 'is', null)
      .where('status', '<>', 'cancelled')
      .execute();
    return rows as MilestoneSignalRow[];
  }
}
