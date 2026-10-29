/**
 * The system ports of `sites`. `SITE_PROJECTION_SOURCE` is for the read model (ADR-0017 W5; EVM-034): the type of the site of the orders, nothing else. Not part
 * of `index.ts` (see `work-orders/system-ports.ts`): only `overview` and `sync` may import it, so no controller can reach a read that skips the read policy.
 * A deleted site keeps its type - the projection of an order is about the order, not about who may see the site.
 * `SITE_SYNC_SOURCE` is for the phone (EVM-096; ADR-0021 D8): the projection of a site WITHOUT the metering point (PPE), read with the policy in the query.
 */
import type { Kysely } from 'kysely';
import type { Database } from '../../platform/database/database.ts';
import type { Principal } from '../../platform/http/principal.ts';
import type { SyncRowState } from '../../platform/sync/sync-row-state.ts';

export const SITE_PROJECTION_SOURCE = Symbol('SITE_PROJECTION_SOURCE');

export interface SiteProjectionSource {
  /** The `siteType` code of every site among `ids` that exists (ONE query); the others are absent. */
  siteTypesOf(tx: Kysely<Database>, ids: readonly string[]): Promise<ReadonlyMap<string, string>>;
}

export const SITE_SYNC_SOURCE = Symbol('SITE_SYNC_SOURCE');

/** The fields of `SyncSite` (contract) that come from the site. */
export interface SyncSiteProjection {
  readonly id: string;
  readonly version: number;
  readonly siteType: string;
  readonly street: string;
  readonly buildingNumber: string;
  readonly apartmentNumber: string | null;
  readonly postalCode: string;
  readonly city: string;
  readonly parkingSpotNumber: string | null;
  readonly garageLevel: string | null;
  readonly connectionPowerKw: number | null;
  readonly managerPartyId: string | null;
  readonly distributionSystemOperatorPartyId: string | null;
  readonly notes: string | null;
}

export interface SiteSyncSource {
  /** The state of every site among `ids` that exists (ONE query for the content, ONE for the deleted ones); the caller applies the scope. */
  statesOf(
    tx: Kysely<Database>,
    principal: Principal,
    ids: readonly string[],
  ): Promise<ReadonlyMap<string, SyncRowState<SyncSiteProjection>>>;
}
