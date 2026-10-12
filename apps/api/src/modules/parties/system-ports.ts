/**
 * The SYSTEM port of `parties` for the read model (ADR-0017 W5; EVM-034): the kind of the parties waited for, nothing else. Not part
 * of `index.ts` (see `work-orders/system-ports.ts`). The read policy of parties is deliberately NOT applied: the kind is a code,
 * and the projection must be the same whoever caused the recomputation (T8).
 */
import type { Kysely } from 'kysely';
import type { Database } from '../../platform/database/database.ts';

export const PARTY_PROJECTION_SOURCE = Symbol('PARTY_PROJECTION_SOURCE');

export interface PartyProjectionSource {
  /** The `kind` code of every party among `ids` that exists (ONE query); the others are absent. */
  kindsOf(tx: Kysely<Database>, ids: readonly string[]): Promise<ReadonlyMap<string, string>>;
}
