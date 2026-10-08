/**
 * Queries of the `parties` module (EVM-021). Every value reaches the database as a bound parameter; the read policy is a
 * condition of the query, never a filter of the result (SR-AUTHZ-03).
 */
import { searchTextMatches } from '../../../platform/database/search-text.ts';
import type { Principal } from '../../../platform/http/principal.ts';
import type { NewParty, PartyKind, PartyLegalForm } from '../domain/party.ts';
import { visibleParties } from './read-policy.ts';
import type { PartiesDb } from './tables.ts';

const COLUMNS = [
  'id',
  'kind',
  'legal_form',
  'display_name',
  'contact_person_name',
  'phone',
  'email',
  'notes',
  'version',
  'created_at',
  'updated_at',
] as const;

export interface PartySearchRow {
  readonly id: string;
  readonly kind: PartyKind;
  readonly legal_form: PartyLegalForm;
  readonly display_name: string;
}

/**
 * Parties whose search text contains the phrase (see `searchTextMatches`), optionally of the given kinds only. The telephone, the
 * e-mail, the contact person and the notes are not selected: the result of a search never carries them (SR-DATA-03). A hard LIMIT
 * and the statement timeout of the pool bound the cost (TM-22); the order is fixed (name, then identifier).
 */
export function searchVisibleParties(
  db: PartiesDb,
  principal: Principal,
  term: string,
  kinds: readonly PartyKind[] | undefined,
  limit: number,
): Promise<PartySearchRow[]> {
  let query = db
    .selectFrom('parties.parties')
    .select(['id', 'kind', 'legal_form', 'display_name'])
    .where(visibleParties(principal))
    .where(searchTextMatches(term));
  if (kinds !== undefined) query = query.where('kind', 'in', kinds);
  return query.orderBy('display_name').orderBy('id').limit(limit).execute();
}

/**
 * INSERT only: an existing identifier — also of a soft-deleted party — inserts nothing (`undefined`), whatever the content, and the
 * caller answers `409 id_conflict` without a word about the existing row.
 */
export function insertParty(db: PartiesDb, party: NewParty, actorUserId: string, now: Date) {
  return db
    .insertInto('parties.parties')
    .values({
      id: party.id,
      kind: party.kind,
      legal_form: party.legalForm,
      display_name: party.displayName,
      contact_person_name: party.contactPersonName,
      phone: party.phone,
      email: party.email,
      notes: party.notes,
      created_at: now,
      created_by: actorUserId,
      updated_at: now,
      updated_by: actorUserId,
      deleted_at: null,
      deleted_by: null,
    })
    .onConflict((conflict) => conflict.column('id').doNothing())
    .returning(COLUMNS)
    .executeTakeFirst();
}

export function findVisibleParty(db: PartiesDb, principal: Principal, id: string) {
  return db.selectFrom('parties.parties').select(COLUMNS).where('id', '=', id).where(visibleParties(principal)).executeTakeFirst();
}

/** The kinds of the visible parties among `ids` (an unknown or deleted one is not in the answer). */
export async function findVisiblePartyKinds(db: PartiesDb, principal: Principal, ids: readonly string[]): Promise<Map<string, PartyKind>> {
  if (ids.length === 0) return new Map();
  const rows = await db
    .selectFrom('parties.parties')
    .select(['id', 'kind'])
    .where('id', 'in', ids)
    .where(visibleParties(principal))
    .execute();
  return new Map(rows.map((row) => [row.id, row.kind]));
}

export type PartyRow = NonNullable<Awaited<ReturnType<typeof findVisibleParty>>>;

/** The display names of the visible parties among `ids` — ONE query; an unknown or deleted party is not in the answer. */
export async function findVisiblePartyNames(db: PartiesDb, principal: Principal, ids: readonly string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const rows = await db
    .selectFrom('parties.parties')
    .select(['id', 'display_name'])
    .where('id', 'in', ids)
    .where(visibleParties(principal))
    .execute();
  return new Map(rows.map((row) => [row.id, row.display_name]));
}
