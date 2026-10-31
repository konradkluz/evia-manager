/**
 * The SYSTEM port of `parties` for the read model (ADR-0017 W5; EVM-034): the kind of the parties waited for, nothing else. Not part
 * of `index.ts` (see `work-orders/system-ports.ts`). The read policy of parties is deliberately NOT applied: the kind is a code,
 * and the projection must be the same whoever caused the recomputation (T8).
 */
import type { Kysely } from 'kysely';
import type { Database } from '../../platform/database/database.ts';
import type { Principal } from '../../platform/http/principal.ts';
import type { SyncRowState } from '../../platform/sync/sync-row-state.ts';

export const PARTY_PROJECTION_SOURCE = Symbol('PARTY_PROJECTION_SOURCE');

export interface PartyProjectionSource {
  /** The `kind` code of every party among `ids` that exists (ONE query); the others are absent. */
  kindsOf(tx: Kysely<Database>, ids: readonly string[]): Promise<ReadonlyMap<string, string>>;
}

/**
 * The SYNC port of `parties` (EVM-097; ADR-0021 D8): the projection of a party for the phone - NO e-mail, notes or legal form (rodo.md), the columns listed,
 * never `*`, the read policy in the query. Whether the phone should know the party (a site or a stage of an order in scope names it) is decided by `sync`.
 */
export const PARTY_SYNC_SOURCE = Symbol('PARTY_SYNC_SOURCE');

/** The fields of `SyncParty` (contract) that come from the party. */
export interface SyncPartyProjection {
  readonly id: string;
  readonly version: number;
  readonly kind: string;
  readonly displayName: string;
  readonly contactPersonName: string | null;
  readonly phone: string | null;
}

export interface PartySyncSource {
  /** The state of every party among `ids` that exists (ONE query for the content, ONE for the deleted ones): `upsert` when readable, `delete` when soft deleted. */
  statesOf(
    tx: Kysely<Database>,
    principal: Principal,
    ids: readonly string[],
  ): Promise<ReadonlyMap<string, SyncRowState<SyncPartyProjection>>>;
}
