/**
 * The queries of the automatic purge of site surveys (EVM-139; ADR-0024 pt 9). Every value is a bound parameter, the columns are named, nothing selects an address, a
 * phone, a title or a description. A candidate has exactly the THREE conditions of AC1; a survey that is soft deleted but not purged is still a candidate (its data lives).
 */
import { sql } from 'kysely';
import { SITE_SURVEY_TOMBSTONE_TITLE } from '../domain/site-survey-purge.ts';
import type { WorkOrdersDb } from './tables.ts';

const candidates = (db: WorkOrdersDb, now: Date) =>
  db
    .selectFrom('work_orders.work_orders')
    .where('site_survey_expires_at', '<', now)
    .where('customer_id', 'is', null)
    .where('site_survey_purged_at', 'is', null);

/** How many surveys are candidates now: the whole of the report mode. */
export async function countCandidates(db: WorkOrdersDb, now: Date): Promise<number> {
  const row = await candidates(db, now)
    .select((eb) => eb.fn.countAll<string>().as('n'))
    .executeTakeFirst();
  return Number(row?.n ?? 0);
}

/** The identifiers of the candidates, the oldest deadline first, at most `limit`. */
export async function candidateIds(db: WorkOrdersDb, now: Date, limit: number): Promise<string[]> {
  const rows = await candidates(db, now).select('id').orderBy('site_survey_expires_at').orderBy('id').limit(limit).execute();
  return rows.map((row) => row.id);
}

export interface LockedCandidate {
  readonly id: string;
  readonly siteId: string | null;
  readonly createdBy: string | null;
  readonly createdAt: Date;
}

/**
 * One candidate LOCKED (`FOR NO KEY UPDATE SKIP LOCKED`) with the three conditions asked AGAIN on the locked row: the command that assigns a customer takes the same lock, so
 * the one that comes second finds the row changed - a customer assigned at the last moment makes the survey no candidate, and a purged survey is no target of the assignment.
 * `undefined` - it is no candidate any more or another transaction holds it (the next run takes it).
 */
export async function lockCandidate(db: WorkOrdersDb, id: string, now: Date): Promise<LockedCandidate | undefined> {
  const row = await candidates(db, now)
    .select(['id', 'site_id', 'created_by', 'created_at'])
    .where('id', '=', id)
    .forNoKeyUpdate()
    .skipLocked()
    .executeTakeFirst();
  return row === undefined ? undefined : { id: row.id, siteId: row.site_id, createdBy: row.created_by, createdAt: row.created_at };
}

/** Another order (a purged tombstone does not count) that points at the location: while it exists the location is not the survey's alone. */
export async function siteHeldByAnotherOrder(db: WorkOrdersDb, siteId: string, workOrderId: string): Promise<boolean> {
  const row = await db
    .selectFrom('work_orders.work_orders')
    .select('id')
    .where('site_id', '=', siteId)
    .where('id', '<>', workOrderId)
    .where('site_survey_purged_at', 'is', null)
    .limit(1)
    .executeTakeFirst();
  return row !== undefined;
}

/**
 * THE one `UPDATE` of the tombstone: neutral title, no description, no phone, no free text of the reason, soft deleted (when it was not), the mark of the purge (written
 * once - trigger EV003; the CHECK of 0068 pins the values), `version + 1`. The three conditions again: a row that changed since the lock is no tombstone.
 */
export async function tombstoneSurvey(db: WorkOrdersDb, id: string, actorUserId: string, now: Date): Promise<boolean> {
  const row = await db
    .updateTable('work_orders.work_orders')
    .set({
      title: SITE_SURVEY_TOMBSTONE_TITLE,
      description: null,
      requester_phone: null,
      status_reason: null,
      deleted_at: sql<Date>`coalesce(deleted_at, ${now})`,
      deleted_by: sql<string>`coalesce(deleted_by, ${actorUserId})`,
      site_survey_purged_at: now,
      updated_at: now,
      updated_by: actorUserId,
      version: sql<number>`version + 1`,
    })
    .where('id', '=', id)
    .where('customer_id', 'is', null)
    .where('site_survey_purged_at', 'is', null)
    .returning('id')
    .executeTakeFirst();
  return row !== undefined;
}

/**
 * The free text of the items of scope of the order (`notes` - the notes and the description of a "Inna usługa"; the `name` is a copy from the catalogue and the
 * `parameters` hold technical values only), deleted items too: it becomes NULL, `version + 1` (the phones get the change through the trigger of the change log).
 */
export async function clearScopeItemNotes(db: WorkOrdersDb, workOrderId: string, actorUserId: string, now: Date): Promise<void> {
  await db
    .updateTable('work_orders.scope_items')
    .set({ notes: null, updated_at: now, updated_by: actorUserId, version: sql<number>`version + 1` })
    .where('work_order_id', '=', workOrderId)
    .where('notes', 'is not', null)
    .execute();
}
