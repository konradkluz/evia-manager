/**
 * The facade of `parties` for the other modules (ADR-0001: a module reaches another one through its `index.ts` only). Today its
 * one consumer is `sites`, which must know that the OSD of a site is a party of the OSD kind and the manager one of a manager kind
 * (EVM-021 AC3, SR-INPUT-02). The caller passes ITS transaction, so the check and the insert that depends on it are one unit of
 * work; the read policy of parties applies (a deleted party is as unknown as one that never existed — no oracle, T6).
 */
import type { Kysely } from 'kysely';
import type { Database } from '../../platform/database/database.ts';
import type { Principal } from '../../platform/http/principal.ts';
import type { PartyKind } from './domain/party.ts';

export const PARTY_DIRECTORY = Symbol('PARTY_DIRECTORY');

export interface PartyDirectory {
  /**
   * The kind of every party among `ids` that exists and is visible to the caller; the others are absent from the map. With
   * `lock: true` the rows are locked `FOR SHARE` until the transaction of the caller ends, so the kind it relies on cannot change
   * or the party disappear under it (EVM-036 AC2).
   */
  kindsOf(
    tx: Kysely<Database>,
    principal: Principal,
    ids: readonly string[],
    options?: { readonly lock?: boolean },
  ): Promise<ReadonlyMap<string, PartyKind>>;
  /** The display name of every party among `ids` that exists and is visible to the caller (ONE query); the others are absent (EVM-018). */
  namesOf(tx: Kysely<Database>, principal: Principal, ids: readonly string[]): Promise<ReadonlyMap<string, string>>;
}
