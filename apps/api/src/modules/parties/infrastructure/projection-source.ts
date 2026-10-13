/** The query behind the system port of `parties` for the read model (see `../system-ports.ts`). */
import type { Kysely } from 'kysely';
import type { Database } from '../../../platform/database/database.ts';
import type { PartyProjectionSource } from '../system-ports.ts';
import { partyTables } from './tables.ts';

export class PartyProjectionSourceService implements PartyProjectionSource {
  async kindsOf(tx: Kysely<Database>, ids: readonly string[]): Promise<ReadonlyMap<string, string>> {
    if (ids.length === 0) return new Map();
    const rows = await partyTables(tx).selectFrom('parties.parties').select(['id', 'kind']).where('id', 'in', ids).execute();
    return new Map(rows.map((row) => [row.id, row.kind]));
  }
}
