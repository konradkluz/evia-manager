/**
 * The SYNC port of `customers` (EVM-096; ADR-0021 D8): the projection of a customer for the phone - the display name and the telephone, NO e-mail, tax id,
 * address or notes (rodo.md: "telefon - bez e-maila i notatek"). The read policy is in the query; the columns are listed, never `*`. Not part of `index.ts`:
 * only `sync` may import it (the rule of module boundaries), so no controller can reach a read that skips the policy.
 */
import type { Kysely } from 'kysely';
import type { Database } from '../../platform/database/database.ts';
import type { Principal } from '../../platform/http/principal.ts';
import type { SyncRowState } from '../../platform/sync/sync-row-state.ts';

export const CUSTOMER_SYNC_SOURCE = Symbol('CUSTOMER_SYNC_SOURCE');

/** The fields of `SyncCustomer` (contract) that come from the customer. */
export interface SyncCustomerProjection {
  readonly id: string;
  readonly version: number;
  readonly kind: string;
  readonly displayName: string;
  readonly phone: string;
}

export interface CustomerSyncSource {
  /**
   * The state of every customer among `ids` that exists (ONE query): `upsert` with the projection when the caller may read it, `delete` when it is soft
   * deleted. The caller (`sync`) decides, with the scope, whether a marker is due.
   */
  statesOf(
    tx: Kysely<Database>,
    principal: Principal,
    ids: readonly string[],
  ): Promise<ReadonlyMap<string, SyncRowState<SyncCustomerProjection>>>;
}
