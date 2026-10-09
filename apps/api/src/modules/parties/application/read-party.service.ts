/**
 * The detail of one party for the dialog "Edytuj stronę" (EVM-036 AC3, AC6, AC7; SR-AUTHZ-02, SR-AUTHZ-05, SR-DATA-03). The guard
 * has decided before this runs (the three roles, web channel). The party is resolved with the read policy IN THE QUERY: one that does
 * not exist and one that is soft deleted are the same `404 not_found`, for every role (the view of deleted parties is EVM-060). The
 * answer is parsed with the schema of the contract (no search text, authors or deletion mark). A read is not an audited event;
 * nothing here logs a body.
 */
import { zGetPartyPath } from '@evia/contracts/zod';
import type { Party } from '@evia/contracts';
import { Inject, Injectable } from '@nestjs/common';
import type { Kysely } from 'kysely';
import type { Database } from '../../../platform/database/database.ts';
import type { Principal } from '../../../platform/http/principal.ts';
import { ProblemException } from '../../../platform/http/problem.ts';
import { parseInput, strictObjects } from '../../../platform/http/validation.ts';
import { DATABASE } from '../../../platform/tokens.ts';
import { findVisibleParty } from '../infrastructure/party-store.ts';
import { partyTables } from '../infrastructure/tables.ts';
import { toParty } from './party-representation.ts';

const pathSchema = strictObjects(zGetPartyPath);

@Injectable()
export class ReadPartyService {
  readonly #db: Kysely<Database>;

  constructor(@Inject(DATABASE) db: Kysely<Database>) {
    this.#db = db;
  }

  /** @param rawParams the path parameters as parsed by the framework */
  async get(principal: Principal, rawParams: unknown): Promise<Party> {
    const { partyId } = parseInput(pathSchema, rawParams) as { partyId: string };
    const row = await findVisibleParty(partyTables(this.#db), principal, partyId);
    if (row === undefined) throw new ProblemException('not_found');
    return toParty(row);
  }
}
