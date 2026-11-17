/**
 * The queries of the extension of a site survey (EVM-140; ADR-0024 pt 9). Every value is a bound parameter; the read policy is a condition of the query, never a
 * filter of the result (SR-AUTHZ-03); the columns are named (no `select *`). Neither the address nor the phone of the requester is read.
 */
import type { Principal } from '../../../platform/http/principal.ts';
import { visibleWorkOrders } from './read-policy.ts';
import type { WorkOrdersDb } from './tables.ts';

/** The order LOCKED (`SELECT ... FOR NO KEY UPDATE`) with the read policy in the query: every decision is taken on THIS row. */
export function lockWorkOrderForExtension(db: WorkOrdersDb, principal: Principal, id: string) {
  return db
    .selectFrom('work_orders.work_orders')
    .select(['id', 'status', 'customer_id', 'site_survey_expires_at', 'site_survey_extensions', 'version'])
    .where('id', '=', id)
    .where(visibleWorkOrders(principal))
    .forNoKeyUpdate()
    .executeTakeFirst();
}

export type ExtendableWorkOrderRow = NonNullable<Awaited<ReturnType<typeof lockWorkOrderForExtension>>>;

/**
 * THE one `UPDATE` of the extension: the new deadline, the counter, the mark of the reminder cleared (the next one comes 15 days before the new deadline), the
 * version + 1. Conditions: the version the decision was taken on, the counter it was taken on (the second line behind the lock, and the range CHECK of 0066
 * refuses a third), an open survey. `undefined` - nothing was updated (the caller fails: `internal_error`).
 */
export async function extendSiteSurvey(
  db: WorkOrdersDb,
  id: string,
  expectedVersion: number,
  expectedExtensions: number,
  expiresAt: Date,
  actorUserId: string,
  now: Date,
): Promise<number | undefined> {
  const row = await db
    .updateTable('work_orders.work_orders')
    .set((eb) => ({
      site_survey_expires_at: expiresAt,
      site_survey_extensions: expectedExtensions + 1,
      site_survey_reminded_at: null,
      updated_at: now,
      updated_by: actorUserId,
      version: eb('version', '+', 1),
    }))
    .where('id', '=', id)
    .where('version', '=', expectedVersion)
    .where('site_survey_extensions', '=', expectedExtensions)
    .where('customer_id', 'is', null)
    .where('site_survey_expires_at', 'is not', null)
    .where('deleted_at', 'is', null)
    .returning('version')
    .executeTakeFirst();
  return row?.version;
}
