/**
 * What other modules may ask `identity` about people (the facade of ADR-0001): the display name of a user by identifier,
 * nothing else — never an e-mail address, a role, a status or a credential (SR-DATA-03). One query for the whole batch.
 */
import { Inject, Injectable } from '@nestjs/common';
import type { Kysely } from 'kysely';
import type { Database } from '../../../platform/database/database.ts';
import { DATABASE } from '../../../platform/tokens.ts';
import { identityTables } from '../infrastructure/tables.ts';

/** The largest batch: a page of the audit log (limit 100) names at most that many people. */
export const DISPLAY_NAMES_BATCH_LIMIT = 100;

@Injectable()
export class UserDirectory {
  readonly #db: Kysely<Database>;

  constructor(@Inject(DATABASE) db: Kysely<Database>) {
    this.#db = db;
  }

  /**
   * @param handle the transaction of the caller, when the lookup belongs to one (no second connection is taken)
   * @param ids identifiers of users (duplicates allowed, at most {@link DISPLAY_NAMES_BATCH_LIMIT} distinct)
   * @returns the display name of each user that exists; an unknown identifier is absent from the map
   */
  async displayNamesOf(ids: readonly string[], handle: Kysely<Database> = this.#db): Promise<ReadonlyMap<string, string>> {
    const distinct = [...new Set(ids)];
    if (distinct.length === 0) return new Map();
    if (distinct.length > DISPLAY_NAMES_BATCH_LIMIT) throw new RangeError('too many identifiers for one lookup');
    const rows = await identityTables(handle)
      .selectFrom('identity.users')
      .select(['id', 'display_name'])
      .where('id', 'in', distinct)
      .execute();
    return new Map(rows.map((row) => [row.id, row.display_name]));
  }
}
