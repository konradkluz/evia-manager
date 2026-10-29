/** The query behind the sync port of `customers` (see `../system-ports.ts`): SELECT only, the listed columns, the read policy in the WHERE. */
import type { Kysely } from 'kysely';
import type { Database } from '../../../platform/database/database.ts';
import type { Principal } from '../../../platform/http/principal.ts';
import type { SyncRowState } from '../../../platform/sync/sync-row-state.ts';
import type { CustomerSyncSource, SyncCustomerProjection } from '../system-ports.ts';
import { visibleCustomers } from './read-policy.ts';
import { customerTables } from './tables.ts';

export class CustomerSyncSourceService implements CustomerSyncSource {
  async statesOf(
    tx: Kysely<Database>,
    principal: Principal,
    ids: readonly string[],
  ): Promise<ReadonlyMap<string, SyncRowState<SyncCustomerProjection>>> {
    const states = new Map<string, SyncRowState<SyncCustomerProjection>>();
    if (ids.length === 0) return states;
    const visible = await customerTables(tx)
      .selectFrom('customers.customers')
      .select(['id', 'version', 'kind', 'display_name as displayName', 'phone'])
      .where('id', 'in', ids)
      .where(visibleCustomers(principal))
      .execute();
    for (const row of visible) states.set(row.id, { kind: 'upsert', projection: row });
    const rest = ids.filter((id) => !states.has(id));
    if (rest.length === 0) return states;
    const hidden = await customerTables(tx).selectFrom('customers.customers').select('id').where('id', 'in', rest).execute();
    for (const row of hidden) states.set(row.id, { kind: 'delete' });
    return states;
  }
}
