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

/**
 * The number of items the phone has not sent yet (EVM-098 AC8; W-17): informative only - it decides nothing on the server. Written for the device of the
 * SESSION (never of a request), at most {@link MAX_PENDING_ITEMS_REPORTED} (a larger value is lowered to it). Only `sync` imports it.
 */
export const DEVICE_PENDING_ITEMS = Symbol('DEVICE_PENDING_ITEMS');

export const MAX_PENDING_ITEMS_REPORTED = 10_000;

export interface DevicePendingItems {
  report(tx: Kysely<Database>, deviceId: string, pendingItems: number): Promise<void>;
}
