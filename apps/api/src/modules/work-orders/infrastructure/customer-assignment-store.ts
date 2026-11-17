/**
 * The queries of the assignment of a customer to a site survey (EVM-136; ADR-0024 pt 3). Every value is a bound parameter; the read policy is a condition of
 * the query, never a filter of the result (SR-AUTHZ-03); the columns are named (no `select *`).
 */
import type { Principal } from '../../../platform/http/principal.ts';
import { visibleWorkOrders } from './read-policy.ts';
import type { WorkOrdersDb } from './tables.ts';

/**
 * The order of the command LOCKED (`SELECT ... FOR NO KEY UPDATE`) with the read policy in the query: every decision is taken on THIS row, which no other
 * transaction can change until this one ends (two assignments of different customers serialise here - the second one reads the committed customer).
 */
export function lockWorkOrderForCustomerAssignment(db: WorkOrdersDb, principal: Principal, id: string) {
  return db
    .selectFrom('work_orders.work_orders')
    .select(['id', 'status', 'customer_id', 'site_survey_expires_at', 'version'])
    .where('id', '=', id)
    .where(visibleWorkOrders(principal))
    .forNoKeyUpdate()
    .executeTakeFirst();
}

export type AssignableWorkOrderRow = NonNullable<Awaited<ReturnType<typeof lockWorkOrderForCustomerAssignment>>>;

/**
 * THE one `UPDATE` of the assignment: the customer is set and the whole state of the survey is cleared - the deadline (the marker: `NULL` = an ordinary order),
 * the counter of the extensions, the mark of the reminder and the phone of the requester (the CHECK `work_orders_site_survey_fields` ties the last three to the
 * deadline, so a row that kept one of them would be refused). The status, the number, the site and the dates stay. Conditions: the version the decision was
 * taken on, no customer yet, an open survey - the second line behind the lock. `undefined` - nothing was updated (the caller fails: `internal_error`).
 */
export async function assignCustomerToSurvey(
  db: WorkOrdersDb,
  id: string,
  expectedVersion: number,
  customerId: string,
  actorUserId: string,
  now: Date,
): Promise<number | undefined> {
  const row = await db
    .updateTable('work_orders.work_orders')
    .set((eb) => ({
      customer_id: customerId,
      site_survey_expires_at: null,
      site_survey_extensions: 0,
      site_survey_reminded_at: null,
      requester_phone: null,
      updated_at: now,
      updated_by: actorUserId,
      version: eb('version', '+', 1),
    }))
    .where('id', '=', id)
    .where('version', '=', expectedVersion)
    .where('customer_id', 'is', null)
    .where('site_survey_expires_at', 'is not', null)
    .where('deleted_at', 'is', null)
    .returning('version')
    .executeTakeFirst();
  return row?.version;
}
