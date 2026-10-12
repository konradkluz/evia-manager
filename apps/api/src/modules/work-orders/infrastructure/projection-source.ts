/** The queries behind the system port of `work-orders` for the read model (see `../system-ports.ts`): SELECT only, bound parameters. */
import type { Kysely } from 'kysely';
import type { Database } from '../../../platform/database/database.ts';
import type { WorkOrderKeys, WorkOrderProjectionSource } from '../system-ports.ts';
import { workOrderTables } from './tables.ts';

const ORDERS = 'work_orders.work_orders';
const ASSIGNMENTS = 'work_orders.work_order_assignments';

export class WorkOrderProjectionSourceService implements WorkOrderProjectionSource {
  async keysOf(tx: Kysely<Database>, ids: readonly string[]): Promise<readonly WorkOrderKeys[]> {
    if (ids.length === 0) return [];
    const rows = await workOrderTables(tx)
      .selectFrom(ORDERS)
      .leftJoin(ASSIGNMENTS, (join) =>
        join
          .onRef(`${ASSIGNMENTS}.work_order_id`, '=', `${ORDERS}.id`)
          .on(`${ASSIGNMENTS}.role`, '=', 'coordinator')
          .on(`${ASSIGNMENTS}.deleted_at`, 'is', null),
      )
      .select([
        `${ORDERS}.id as id`,
        `${ORDERS}.number as number`,
        `${ORDERS}.status as status`,
        `${ORDERS}.created_at as createdAt`,
        `${ORDERS}.deleted_at as deletedAt`,
        `${ORDERS}.customer_id as customerId`,
        `${ORDERS}.site_id as siteId`,
        `${ORDERS}.source_template_id as sourceTemplateId`,
        `${ASSIGNMENTS}.user_id as coordinatorUserId`,
      ])
      .where(`${ORDERS}.id`, 'in', ids)
      .execute();
    return rows;
  }

  async idsAfter(tx: Kysely<Database>, afterId: string | undefined, limit: number): Promise<readonly string[]> {
    let query = workOrderTables(tx).selectFrom(ORDERS).select('id').orderBy('id').limit(limit);
    if (afterId !== undefined) query = query.where('id', '>', afterId);
    return (await query.execute()).map((row) => row.id);
  }
}
