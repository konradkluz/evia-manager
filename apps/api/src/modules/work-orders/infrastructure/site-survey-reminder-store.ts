/**
 * The queries of the reminder of a site survey that is about to be deleted (EVM-140 AC1; ADR-0024 pt 9). Every value is a bound parameter, the columns are named.
 * An open survey that is due: no customer, a deadline not later than the horizon, never reminded, not cancelled, not deleted, not purged. Neither the address nor
 * the phone of the requester is read.
 */
import type { WorkOrdersDb } from './tables.ts';

const due = (db: WorkOrdersDb, horizon: Date) =>
  db
    .selectFrom('work_orders.work_orders')
    .where('customer_id', 'is', null)
    .where('site_survey_expires_at', 'is not', null)
    .where('site_survey_expires_at', '<=', horizon)
    .where('site_survey_reminded_at', 'is', null)
    .where('status', '<>', 'cancelled')
    .where('deleted_at', 'is', null)
    .where('site_survey_purged_at', 'is', null);

/** The identifiers of the surveys that are due, the nearest deadline first, at most `limit`. */
export async function dueSurveyIds(db: WorkOrdersDb, horizon: Date, limit: number): Promise<string[]> {
  const rows = await due(db, horizon).select('id').orderBy('site_survey_expires_at').orderBy('id').limit(limit).execute();
  return rows.map((row) => row.id);
}

/** One due survey locked (`FOR NO KEY UPDATE SKIP LOCKED`: a command on it, e.g. the extension, wins and the job leaves it for the next run); `undefined` when it is not due any more. */
export async function lockDueSurvey(
  db: WorkOrdersDb,
  id: string,
  horizon: Date,
): Promise<{ readonly id: string; readonly createdBy: string | null } | undefined> {
  const row = await due(db, horizon).select(['id', 'created_by']).where('id', '=', id).forNoKeyUpdate().skipLocked().executeTakeFirst();
  return row === undefined ? undefined : { id: row.id, createdBy: row.created_by };
}

/** The mark of the reminder (the deduplication): the survey is not reminded again until an extension clears it. No version change - it is no change of the order. */
export async function markReminded(db: WorkOrdersDb, id: string, now: Date): Promise<void> {
  await db.updateTable('work_orders.work_orders').set({ site_survey_reminded_at: now }).where('id', '=', id).execute();
}

/** What the composer of the message needs of a survey: the number, the deadline, the creator and whether it is still open. */
export async function surveyForReminder(db: WorkOrdersDb, id: string) {
  return db
    .selectFrom('work_orders.work_orders')
    .select(['id', 'number', 'site_survey_expires_at', 'site_survey_extensions', 'created_by', 'customer_id', 'status', 'deleted_at'])
    .where('id', '=', id)
    .executeTakeFirst();
}
