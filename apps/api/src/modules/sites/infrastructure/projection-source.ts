/** The query behind the system port of `sites` for the read model (see `../system-ports.ts`). */
import type { Kysely } from 'kysely';
import type { Database } from '../../../platform/database/database.ts';
import type { SiteProjectionSource } from '../system-ports.ts';
import { siteTables } from './tables.ts';

export class SiteProjectionSourceService implements SiteProjectionSource {
  async siteTypesOf(tx: Kysely<Database>, ids: readonly string[]): Promise<ReadonlyMap<string, string>> {
    if (ids.length === 0) return new Map();
    const rows = await siteTables(tx).selectFrom('sites.sites').select(['id', 'site_type']).where('id', 'in', ids).execute();
    return new Map(rows.map((row) => [row.id, row.site_type]));
  }
}
