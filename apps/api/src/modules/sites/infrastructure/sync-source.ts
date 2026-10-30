/** The query behind the sync port of `sites` (see `../system-ports.ts`): SELECT only, the listed columns (no metering point), the read policy in the WHERE. */
import type { Kysely } from 'kysely';
import type { Database } from '../../../platform/database/database.ts';
import type { Principal } from '../../../platform/http/principal.ts';
import type { SyncRowState } from '../../../platform/sync/sync-row-state.ts';
import type { SiteSyncSource, SyncSiteProjection } from '../system-ports.ts';
import { visibleSites } from './read-policy.ts';
import { siteTables } from './tables.ts';

export class SiteSyncSourceService implements SiteSyncSource {
  async partyReferences(
    tx: Kysely<Database>,
    ids: readonly string[],
  ): Promise<ReadonlyArray<{ readonly partyId: string; readonly siteId: string }>> {
    if (ids.length === 0) return [];
    const rows = await siteTables(tx)
      .selectFrom('sites.sites')
      .select(['id', 'manager_party_id as managerPartyId', 'distribution_system_operator_party_id as operatorPartyId'])
      .where('deleted_at', 'is', null)
      .where((eb) => eb.or([eb('manager_party_id', 'in', ids), eb('distribution_system_operator_party_id', 'in', ids)]))
      .execute();
    const wanted = new Set(ids);
    return rows.flatMap((row) =>
      [row.managerPartyId, row.operatorPartyId].flatMap((partyId) =>
        partyId !== null && wanted.has(partyId) ? [{ partyId, siteId: row.id }] : [],
      ),
    );
  }

  async statesOf(
    tx: Kysely<Database>,
    principal: Principal,
    ids: readonly string[],
  ): Promise<ReadonlyMap<string, SyncRowState<SyncSiteProjection>>> {
    const states = new Map<string, SyncRowState<SyncSiteProjection>>();
    if (ids.length === 0) return states;
    const visible = await siteTables(tx)
      .selectFrom('sites.sites')
      .select([
        'id',
        'version',
        'site_type as siteType',
        'street',
        'building_number as buildingNumber',
        'apartment_number as apartmentNumber',
        'postal_code as postalCode',
        'city',
        'parking_spot_number as parkingSpotNumber',
        'garage_level as garageLevel',
        'connection_power_kw as connectionPowerKw',
        'manager_party_id as managerPartyId',
        'distribution_system_operator_party_id as distributionSystemOperatorPartyId',
        'notes',
      ])
      .where('id', 'in', ids)
      .where(visibleSites(principal))
      .execute();
    // `numeric(6,2)` comes back from the driver as a string: the phone gets a number.
    for (const row of visible) {
      const power = row.connectionPowerKw === null ? null : Number(row.connectionPowerKw);
      states.set(row.id, { kind: 'upsert', projection: { ...row, connectionPowerKw: power } });
    }
    const rest = ids.filter((id) => !states.has(id));
    if (rest.length === 0) return states;
    const hidden = await siteTables(tx).selectFrom('sites.sites').select('id').where('id', 'in', rest).execute();
    for (const row of hidden) states.set(row.id, { kind: 'delete' });
    return states;
  }
}
