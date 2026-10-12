/**
 * Reads a page of the list of work orders from the PROJECTION (SELECT only; Kysely builder with bound parameters — no `sql.raw`, no
 * concatenation of a value of the request, CWE-89). ONE statement: the orders that the read policy lets the caller see (the condition
 * of `authorization` on `deleted_at` of the projection, in the query — never a filter of a page already read; EVM-017 AC6, EVM-034
 * W2), filtered, ordered and cut by a keyset — no OFFSET, so a deep page costs what the first one does. One row more than the limit
 * is read to know whether a next page exists.
 *
 * The sort is a map from the enum of the contract to fixed columns, with the identifier of the order as the last key, so the order
 * is total. The columns are listed explicitly: what the list may show is decided here, not by what the table holds. The title is
 * NOT here (W1): the service takes it from `work-orders`, in one batch, under the read policy of the caller.
 */
import type { Kysely } from 'kysely';
import { workOrderReadCondition } from '../../authorization/index.ts';
import type { Database } from '../../../platform/database/database.ts';
import type { Principal } from '../../../platform/http/principal.ts';
import {
  CLOSED_STATUSES,
  SORT_RULES,
  type Position,
  type WorkOrderListQuery,
  type WorkOrderStatus,
} from '../domain/work-order-list-query.ts';
import { overviewTables } from './tables.ts';

export interface WorkOrderRow {
  readonly id: string;
  readonly number: string;
  readonly status: WorkOrderStatus;
  readonly createdAt: Date;
  readonly coordinatorUserId: string | null;
}

const SUMMARIES = 'overview.work_order_summaries';

/** @returns at most `query.limit + 1` rows in the order of the sort */
export async function readWorkOrderPage(
  db: Kysely<Database>,
  principal: Principal,
  query: WorkOrderListQuery,
  position: Position | undefined,
): Promise<WorkOrderRow[]> {
  const rule = SORT_RULES[query.sort];
  const descending = rule.direction === 'desc';
  let select = overviewTables(db)
    .selectFrom(SUMMARIES)
    .select([
      `${SUMMARIES}.work_order_id as id`,
      `${SUMMARIES}.number as number`,
      `${SUMMARIES}.status as status`,
      `${SUMMARIES}.created_at as createdAt`,
      `${SUMMARIES}.coordinator_user_id as coordinatorUserId`,
    ])
    .where(workOrderReadCondition(principal, SUMMARIES));
  if (query.statuses.length > 0) select = select.where(`${SUMMARIES}.status`, 'in', query.statuses);
  if (query.view === 'all_open') select = select.where(`${SUMMARIES}.status`, 'not in', CLOSED_STATUSES);
  // `mine` is the user of the SESSION, never a value of the request; both conditions apply (AND) when both are given.
  if (query.view === 'mine') select = select.where(`${SUMMARIES}.coordinator_user_id`, '=', principal.userId);
  if (query.coordinatorId !== undefined) select = select.where(`${SUMMARIES}.coordinator_user_id`, '=', query.coordinatorId);
  if (query.customerId !== undefined) select = select.where(`${SUMMARIES}.customer_id`, '=', query.customerId);
  if (position !== undefined) {
    const comparator = descending ? '<' : '>';
    select =
      'number' in position
        ? select.where(`${SUMMARIES}.number`, comparator, position.number)
        : select.where((eb) =>
            eb(eb.refTuple(`${SUMMARIES}.created_at`, `${SUMMARIES}.work_order_id`), comparator, eb.tuple(position.createdAt, position.id)),
          );
  }
  const direction = rule.direction;
  const ordered =
    rule.key === 'number'
      ? select.orderBy(`${SUMMARIES}.number`, direction)
      : select.orderBy(`${SUMMARIES}.created_at`, direction).orderBy(`${SUMMARIES}.work_order_id`, direction);
  const rows = await ordered.limit(query.limit + 1).execute();
  return rows as WorkOrderRow[];
}
