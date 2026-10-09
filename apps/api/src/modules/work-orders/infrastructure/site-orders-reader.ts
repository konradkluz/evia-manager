/**
 * The other orders of a site (EVM-036 AC5, AC6; SR-AUTHZ-03, SR-AUTHZ-08, AB-19, CWE-639): the metadata of the orders that share the
 * site of ONE order, and their number, in ONE query. The read policy of work orders (`visibleWorkOrders`) is a condition of that
 * query, so the list and the counter are decided by the same condition — nobody filters a page after it was read. The columns are
 * named and no table of a customer, a medium, a document or a payment is joined: a row of another order carries its number, title,
 * status and closing time and nothing else, whoever asks.
 */
import { sql } from 'kysely';
import type { Principal } from '../../../platform/http/principal.ts';
import { visibleWorkOrders } from './read-policy.ts';
import type { WorkOrdersDb } from './tables.ts';

/** The page is fixed on the server (the contract has no `limit`): the section shows the latest orders and a counter. */
export const SITE_ORDERS_LIMIT = 20;

/**
 * @param siteId the site of the order that was ALREADY resolved with the read policy — never a value from the request
 * @param exceptWorkOrderId the order the user is looking at (excluded in the query)
 */
export async function listOtherOrdersOfSite(db: WorkOrdersDb, principal: Principal, siteId: string, exceptWorkOrderId: string) {
  const rows = await db
    .selectFrom('work_orders.work_orders')
    .select(['id', 'number', 'title', 'status', 'closed_at', sql<string>`count(*) over ()`.as('total')])
    .where('site_id', '=', siteId)
    .where('id', '<>', exceptWorkOrderId)
    .where(visibleWorkOrders(principal))
    .orderBy('number', 'desc')
    .orderBy('id', 'desc')
    .limit(SITE_ORDERS_LIMIT)
    .execute();
  return { total: rows[0] === undefined ? 0 : Number(rows[0].total), rows };
}
