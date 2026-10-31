/** The query behind the sync port of `parties` (see `../system-ports.ts`): SELECT only, the listed columns (no e-mail, notes, legal form), the read policy in the WHERE. */
import type { Kysely } from 'kysely';
import type { Database } from '../../../platform/database/database.ts';
import type { Principal } from '../../../platform/http/principal.ts';
import type { SyncRowState } from '../../../platform/sync/sync-row-state.ts';
import type { PartySyncSource, SyncPartyProjection } from '../system-ports.ts';
import { visibleParties } from './read-policy.ts';
import { partyTables } from './tables.ts';

export class PartySyncSourceService implements PartySyncSource {
  async statesOf(
    tx: Kysely<Database>,
    principal: Principal,
    ids: readonly string[],
  ): Promise<ReadonlyMap<string, SyncRowState<SyncPartyProjection>>> {
    const states = new Map<string, SyncRowState<SyncPartyProjection>>();
    if (ids.length === 0) return states;
    const visible = await partyTables(tx)
      .selectFrom('parties.parties')
      .select(['id', 'version', 'kind', 'display_name as displayName', 'contact_person_name as contactPersonName', 'phone'])
      .where('id', 'in', ids)
      .where(visibleParties(principal))
      .execute();
    for (const row of visible) states.set(row.id, { kind: 'upsert', projection: row });
    const rest = ids.filter((id) => !states.has(id));
    if (rest.length === 0) return states;
    const hidden = await partyTables(tx).selectFrom('parties.parties').select('id').where('id', 'in', rest).execute();
    for (const row of hidden) states.set(row.id, { kind: 'delete' });
    return states;
  }
}
