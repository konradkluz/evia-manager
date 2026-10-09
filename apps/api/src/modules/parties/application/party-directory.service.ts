/** The implementation of the `PartyDirectory` facade (see `party-directory.ts`): one query under the read policy of parties. */
import { Injectable } from '@nestjs/common';
import type { Kysely } from 'kysely';
import type { Database } from '../../../platform/database/database.ts';
import type { Principal } from '../../../platform/http/principal.ts';
import type { PartyKind } from '../domain/party.ts';
import type { PartyDirectory } from '../party-directory.ts';
import { findVisiblePartyKinds, findVisiblePartyNames } from '../infrastructure/party-store.ts';
import { partyTables } from '../infrastructure/tables.ts';

@Injectable()
export class PartyDirectoryService implements PartyDirectory {
  kindsOf(
    tx: Kysely<Database>,
    principal: Principal,
    ids: readonly string[],
    options: { readonly lock?: boolean } = {},
  ): Promise<ReadonlyMap<string, PartyKind>> {
    return findVisiblePartyKinds(partyTables(tx), principal, [...new Set(ids)], options.lock === true);
  }

  namesOf(tx: Kysely<Database>, principal: Principal, ids: readonly string[]): Promise<ReadonlyMap<string, string>> {
    return findVisiblePartyNames(partyTables(tx), principal, [...new Set(ids)]);
  }
}
