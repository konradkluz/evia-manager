/**
 * The system ports of `sites`. `SITE_PROJECTION_SOURCE` is for the read model (ADR-0017 W5; EVM-034): the type of the site of the orders, nothing else. Not part
 * of `index.ts` (see `work-orders/system-ports.ts`): only `overview` and `sync` may import it, so no controller can reach a read that skips the read policy.
 * A deleted site keeps its type - the projection of an order is about the order, not about who may see the site.
 * `SITE_SYNC_SOURCE` is for the phone (EVM-096; ADR-0021 D8): the projection of a site WITHOUT the metering point (PPE), read with the policy in the query.
 */
import type { Kysely } from 'kysely';
import type { Database } from '../../platform/database/database.ts';
import type { EventContext } from '../../platform/events/event-bus.ts';
import type { Principal } from '../../platform/http/principal.ts';
import type { FieldIssue } from '../../platform/input/field-issues.ts';
import type { SyncRowState } from '../../platform/sync/sync-row-state.ts';
import type { QuickSiteInput } from './domain/quick-site.ts';

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
  /** Which live sites name one of the parties among `ids` as the manager or the operator of the network: the party and the site (ONE query, EVM-097). */
  partyReferences(
    tx: Kysely<Database>,
    ids: readonly string[],
  ): Promise<ReadonlyArray<{ readonly partyId: string; readonly siteId: string }>>;
  /** The state of every site among `ids` that exists (ONE query for the content, ONE for the deleted ones); the caller applies the scope. */
  statesOf(
    tx: Kysely<Database>,
    principal: Principal,
    ids: readonly string[],
  ): Promise<ReadonlyMap<string, SyncRowState<SyncSiteProjection>>>;
}

/**
 * The COMMAND port of `sites` for the quick work order of the phone (EVM-099 AC2, AC3, AC7; ADR-0008): a site created from the fields of the command, INSERT only,
 * with the device of the session recorded, and the count of the sites a device created lately (the limit of 20 in 24 hours is decided by `sync`). It runs in the
 * transaction of `sync`. The answer is a code only. Not part of `index.ts`: only `sync` may import it.
 */
export const SITE_QUICK_CREATION = Symbol('SITE_QUICK_CREATION');

export interface SiteQuickCreation {
  /** The rules of the content, without a write: the pointers and the codes of the errors (never values) - empty when the site is valid. */
  check(input: QuickSiteInput): readonly FieldIssue[];
  /** `created`; `invalid` - a rule of the content; `id_conflict` - the identifier exists (also a deleted or foreign site). Publishes `site.created`. */
  create(
    tx: Kysely<Database>,
    principal: Principal,
    deviceId: string,
    input: QuickSiteInput,
    context: EventContext,
  ): Promise<'created' | 'invalid' | 'id_conflict'>;
  /** The sites this device created after `since`, deleted ones included. */
  countCreatedBy(tx: Kysely<Database>, deviceId: string, since: Date): Promise<number>;
}
