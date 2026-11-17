/**
 * The queries of the anonymization of a location created for a site survey (EVM-139 AC2; migration 0068). Every value is a bound parameter; the columns are named.
 * Nothing here returns an address.
 */
import { sql } from 'kysely';
import { ANONYMIZED_SITE_VALUES } from '../domain/anonymized-site.ts';
import type { SitesDb } from './tables.ts';

export interface LockedSite {
  readonly createdBy: string | null;
  readonly createdAt: Date;
  readonly anonymized: boolean;
}

/**
 * The site LOCKED `FOR UPDATE` (not `NO KEY`): the lock conflicts with the `FOR KEY SHARE` that the insert of an order pointing at the site takes, so an order that is
 * being created at this moment either is committed before the lock (and the caller sees it) or waits until the anonymization is committed (and finds the site gone).
 */
export async function lockSite(db: SitesDb, siteId: string): Promise<LockedSite | undefined> {
  const row = await db
    .selectFrom('sites.sites')
    .select(['created_by', 'created_at', 'anonymized_at'])
    .where('id', '=', siteId)
    .forUpdate()
    .executeTakeFirst();
  return row === undefined ? undefined : { createdBy: row.created_by, createdAt: row.created_at, anonymized: row.anonymized_at !== null };
}

/** The anonymization and the soft delete in ONE update (the read policy hides a deleted site everywhere): the neutral values, the mark, `version + 1`. */
export async function anonymizeSite(db: SitesDb, siteId: string, actorUserId: string, now: Date): Promise<boolean> {
  const row = await db
    .updateTable('sites.sites')
    .set({
      ...ANONYMIZED_SITE_VALUES,
      anonymized_at: now,
      anonymized_by: actorUserId,
      deleted_at: sql<Date>`coalesce(deleted_at, ${now})`,
      deleted_by: sql<string>`coalesce(deleted_by, ${actorUserId})`,
      updated_at: now,
      updated_by: actorUserId,
      version: sql<number>`version + 1`,
    })
    .where('id', '=', siteId)
    .where('anonymized_at', 'is', null)
    .returning('id')
    .executeTakeFirst();
  return row !== undefined;
}
