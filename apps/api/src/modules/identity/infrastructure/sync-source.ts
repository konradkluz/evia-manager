/** The query behind the sync port of `identity` (see `../system-ports.ts`): SELECT only, three columns - the name and nothing about the account. */
import type { Kysely } from 'kysely';
import type { Database } from '../../../platform/database/database.ts';
import type { SyncRowState } from '../../../platform/sync/sync-row-state.ts';
import type { SyncUserProjection, UserSyncSource } from '../system-ports.ts';
import { identityTables } from './tables.ts';

export class UserSyncSourceService implements UserSyncSource {
  async statesOf(tx: Kysely<Database>, ids: readonly string[]): Promise<ReadonlyMap<string, SyncRowState<SyncUserProjection>>> {
    const states = new Map<string, SyncRowState<SyncUserProjection>>();
    if (ids.length === 0) return states;
    const rows = await identityTables(tx)
      .selectFrom('identity.users')
      .select(['id', 'version', 'display_name as displayName', 'deleted_at as deletedAt'])
      .where('id', 'in', ids)
      .execute();
    for (const row of rows) {
      states.set(
        row.id,
        row.deletedAt === null
          ? { kind: 'upsert', projection: { id: row.id, version: row.version, displayName: row.displayName } }
          : { kind: 'delete' },
      );
    }
    return states;
  }
}
