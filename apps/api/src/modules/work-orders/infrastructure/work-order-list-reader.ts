/**
 * Reads a page of the list of work orders (SELECT only; Kysely builder with bound parameters — no `sql.raw`, no concatenation
 * of a value of the request, CWE-89). ONE statement: the work orders that the read policy lets the caller see (condition in the
 * query, EVM-017 AC6) with a LEFT JOIN to the active coordinator of the order (at most one: partial unique index), filtered,
 * ordered and cut by a keyset — no OFFSET, so a deep page costs what the first one does. One row more than the limit is read to
 * know whether a next page exists.
 *
 * The sort is a map from the enum of the contract to fixed columns. The key of `number` is unique and compared bytewise
 * (`COLLATE "C"`); the key `created_at` is made total by `id`, with the direction of `id` equal to the direction of the sort
 * (a row comparison). The columns are listed explicitly: what the list may show is decided here, not by what the table holds.
 */
import type { Kysely } from 'kysely';
import type { Database } from '../../../platform/database/database.ts';
import type { Principal } from '../../../platform/http/principal.ts';
import {
  CLOSED_STATUSES,
  SORT_RULES,
  type Position,
  type WorkOrderListQuery,
  type WorkOrderStatus,
} from '../domain/work-order-list-query.ts';
import { visibleWorkOrders } from './read-policy.ts';
import { workOrderTables } from './tables.ts';

export interface WorkOrderRow {
  readonly id: string;
  readonly number: string;
  readonly title: string;
  readonly status: WorkOrderStatus;
  readonly createdAt: Date;
  readonly coordinatorUserId: string | null;
}

const ORDERS = 'work_orders.work_orders';
const ASSIGNMENTS = 'work_orders.work_order_assignments';

/** @returns at most `query.limit + 1` rows in the order of the sort */
export async function readWorkOrderPage(
  db: Kysely<Database>,
  principal: Principal,
  query: WorkOrderListQuery,
  position: Position | undefined,
): Promise<WorkOrderRow[]> {
  const rule = SORT_RULES[query.sort];
  const descending = rule.direction === 'desc';
  let select = workOrderTables(db)
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
      `${ORDERS}.title as title`,
      `${ORDERS}.status as status`,
      `${ORDERS}.created_at as createdAt`,
      `${ASSIGNMENTS}.user_id as coordinatorUserId`,
    ])
    .where(visibleWorkOrders(principal));
  if (query.statuses.length > 0) select = select.where(`${ORDERS}.status`, 'in', query.statuses);
  if (query.view === 'all_open') select = select.where(`${ORDERS}.status`, 'not in', CLOSED_STATUSES);
  // `mine` is the user of the SESSION, never a value of the request; both conditions apply (AND) when both are given.
  if (query.view === 'mine') select = select.where(`${ASSIGNMENTS}.user_id`, '=', principal.userId);
  if (query.coordinatorId !== undefined) select = select.where(`${ASSIGNMENTS}.user_id`, '=', query.coordinatorId);
  if (query.customerId !== undefined) select = select.where(`${ORDERS}.customer_id`, '=', query.customerId);
  if (position !== undefined) {
    const comparator = descending ? '<' : '>';
    select =
      'number' in position
        ? select.where(`${ORDERS}.number`, comparator, position.number)
        : select.where((eb) =>
            eb(eb.refTuple(`${ORDERS}.created_at`, `${ORDERS}.id`), comparator, eb.tuple(position.createdAt, position.id)),
          );
  }
  const direction = rule.direction;
  const ordered =
    rule.key === 'number'
      ? select.orderBy(`${ORDERS}.number`, direction)
      : select.orderBy(`${ORDERS}.created_at`, direction).orderBy(`${ORDERS}.id`, direction);
  return ordered.limit(query.limit + 1).execute();
}
