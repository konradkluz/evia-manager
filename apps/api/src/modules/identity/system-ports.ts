/**
 * The SYNC port of `identity` (EVM-097; ADR-0021 D8): the name of a user for the phone - `id`, `displayName` and `version` and NOTHING else (no e-mail, role,
 * status, times of the login or of the activation; SR-SYNC-04, MASVS-PRIVACY-1). The columns are listed, never `*`. Which users the phone may know (the
 * coordinator, the author of an entry, the person responsible for a stage of an order in scope) is decided by `sync`, never here. Not part of `index.ts`
 * (see `work-orders/system-ports.ts`): only `sync` may import it.
 */
import type { Kysely } from 'kysely';
import type { Database } from '../../platform/database/database.ts';
import type { SyncRowState } from '../../platform/sync/sync-row-state.ts';

export const USER_SYNC_SOURCE = Symbol('USER_SYNC_SOURCE');

/** The fields of `SyncUser` (contract) that come from the user. */
export interface SyncUserProjection {
  readonly id: string;
  readonly version: number;
  readonly displayName: string;
}

export interface UserSyncSource {
  /** The state of every user among `ids` that exists (ONE query): `upsert` with the name, `delete` when soft deleted. */
  statesOf(tx: Kysely<Database>, ids: readonly string[]): Promise<ReadonlyMap<string, SyncRowState<SyncUserProjection>>>;
}
