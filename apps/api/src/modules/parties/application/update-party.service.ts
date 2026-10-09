/**
 * The edit of a party (EVM-036 AC3, AC4, AC7; SR-API-05, SR-API-06, SR-API-07, SR-AUTHZ-02, SR-AUTHZ-04, SR-AUTHZ-05, SR-INPUT-01,
 * SR-LOG-02, SR-LOG-03, SR-DATA-02, ASVS V2.3.3, CWE-639). The guard has decided before this runs: a signed-in Administrator or
 * Editor on the web channel with a valid CSRF token — Read-only gets 403 and an anonymous caller 401 without reaching the headers or
 * the body.
 *
 * Order: the path (400), the `Idempotency-Key`, `If-Match` (`428` / `400`) and the body against the schema of the contract (strict: a
 * field of the server — `id`, `version` and the immutable `kind` — is `read_only_field`, a stranger `unknown_field`) — all of it
 * BEFORE the database is asked. Then ONE transaction, and every decision in it is taken on the party LOCKED with
 * `SELECT … FOR UPDATE` (the read policy is in that query), never on an earlier read:
 *   1. the party is locked: missing or soft deleted is `404 not_found`, the same for every role (before the version — no oracle of
 *      existence for a stale `If-Match`);
 *   2. the idempotency port (when there is a key), bound to the PARTY (the scope holds its id): the same key and body on another
 *      party is `422 idempotency_mismatch`;
 *   3. the version (`412 version_conflict`, no current value in the answer);
 *   4. the merged party through the rules of the creation (`400`, pointers and codes, never a value);
 *   5. the update (`version + 1`), the event `party.updated` for the audit trail (the actor and the party — no name, not even of a
 *      natural person, no field, no value), the idempotency record. An error anywhere rolls the whole command back.
 * A repeat returns the party as the caller may read it NOW.
 */
import { zParty, zPartyPatch, zUpdatePartyHeaders, zUpdatePartyPath } from '@evia/contracts/zod';
import type { Party } from '@evia/contracts';
import { Inject, Injectable } from '@nestjs/common';
import type { Kysely } from 'kysely';
import type { Clock } from '../../../platform/clock/clock.ts';
import type { Database } from '../../../platform/database/database.ts';
import type { EventBus, EventContext } from '../../../platform/events/event-bus.ts';
import { parseIfMatch } from '../../../platform/http/if-match.ts';
import type { Principal } from '../../../platform/http/principal.ts';
import { ProblemException } from '../../../platform/http/problem.ts';
import { parseInput, readOnlyKeys, strictObjects } from '../../../platform/http/validation.ts';
import { requestHash } from '../../../platform/idempotency/canonical-json.ts';
import { IDEMPOTENCY, type Idempotency } from '../../../platform/idempotency/idempotency.ts';
import { CLOCK, DATABASE, EVENT_BUS } from '../../../platform/tokens.ts';
import { normalizeNewParty, type PartyInput } from '../domain/party.ts';
import { mergePartyPatch, type PartyPatchInput } from '../domain/party-patch.ts';
import type { PartyEvent } from '../events.ts';
import { findVisibleParty, lockVisibleParty, updatePartyRow, type PartyRow } from '../infrastructure/party-store.ts';
import { partyTables } from '../infrastructure/tables.ts';
import { toParty } from './party-representation.ts';

/** Method and route template; the key of an idempotency record is bound to it AND to the party (see {@link updatePartyScope}). */
export const UPDATE_PARTY_SCOPE = 'PATCH /api/v1/parties/{partyId}';

/** What an idempotency key is bound to besides the user: the method, the route and THE PARTY (ASVS V2.3.1, SR-API-05, CWE-639). */
export const updatePartyScope = (partyId: string): string => UPDATE_PARTY_SCOPE.replace('{partyId}', partyId);

const pathSchema = strictObjects(zUpdatePartyPath);
const patchBody = strictObjects(zPartyPatch);
/** The fields of the server that a patch names in vain: the keys of the party that the patch lacks, the kind included. */
const SERVER_FIELDS = readOnlyKeys(zParty, zPartyPatch);
const idempotencyKeySchema = zUpdatePartyHeaders.shape['Idempotency-Key'];

export interface UpdatedParty {
  readonly party: Party;
  /** True when the answer repeats an earlier edit (same key, party and body): `Idempotent-Replayed: true`. */
  readonly replayed: boolean;
}

@Injectable()
export class UpdatePartyService {
  readonly #db: Kysely<Database>;
  readonly #clock: Clock;
  readonly #events: EventBus;
  readonly #idempotency: Idempotency;

  constructor(
    @Inject(DATABASE) db: Kysely<Database>,
    @Inject(CLOCK) clock: Clock,
    @Inject(EVENT_BUS) events: EventBus,
    @Inject(IDEMPOTENCY) idempotency: Idempotency,
  ) {
    this.#db = db;
    this.#clock = clock;
    this.#events = events;
    this.#idempotency = idempotency;
  }

  /**
   * @param rawParams the path parameters as parsed by the framework
   * @param rawIfMatch the `If-Match` header as received (`undefined` when absent)
   * @param rawKey the `Idempotency-Key` header as received (`undefined` when absent)
   */
  async update(
    principal: Principal,
    rawParams: unknown,
    rawIfMatch: string | undefined,
    rawBody: unknown,
    rawKey: string | undefined,
    context: EventContext,
  ): Promise<UpdatedParty> {
    const { partyId } = parseInput(pathSchema, rawParams) as { partyId: string };
    const key = rawKey === undefined ? undefined : (parseInput(idempotencyKeySchema, rawKey) as string);
    const expectedVersion = parseIfMatch(rawIfMatch);
    const patch = parseInput(patchBody, rawBody, SERVER_FIELDS) as PartyPatchInput;
    const request = { ...context, sessionId: principal.sessionId };

    return this.#db.transaction().execute(async (tx) => {
      const locked = await lockVisibleParty(partyTables(tx), principal, partyId);
      if (locked === undefined) throw new ProblemException('not_found');

      const perform = async () => {
        await this.#perform(tx, principal, locked, expectedVersion, patch, request);
        return { value: undefined, result: { status: 200, code: 'updated', resourceId: partyId } };
      };
      const replayed =
        key === undefined
          ? (await perform(), false)
          : (
              await this.#idempotency.run(
                tx,
                { userId: principal.userId, deviceId: null, key, scope: updatePartyScope(partyId), bodyHash: requestHash(patch) },
                perform,
              )
            ).replayed;
      const current = await findVisibleParty(partyTables(tx), principal, partyId);
      if (current === undefined) throw new ProblemException('not_found');
      return { party: toParty(current), replayed };
    });
  }

  /** Steps 3–5 of the order described above, on the locked row. */
  async #perform(
    tx: Kysely<Database>,
    principal: Principal,
    locked: PartyRow,
    expectedVersion: number,
    patch: PartyPatchInput,
    request: EventContext,
  ): Promise<void> {
    if (locked.version !== expectedVersion) throw new ProblemException('version_conflict');
    const normalized = normalizeNewParty(mergePartyPatch(inputOf(locked), patch));
    if (!normalized.ok) throw new ProblemException('validation_failed', { errors: normalized.errors });

    const updated = await updatePartyRow(
      partyTables(tx),
      locked.id,
      expectedVersion,
      normalized.party,
      principal.userId,
      this.#clock.now(),
    );
    if (updated === undefined) throw new ProblemException('internal_error');
    const event: PartyEvent = {
      type: 'party.updated',
      actor: { type: 'user', userId: principal.userId },
      outcome: 'success',
      objectType: 'party',
      objectId: locked.id,
    };
    await this.#events.publish(tx, event, request);
  }
}

/** The stored party as the input of the rules (a column that is NULL is an absent field). */
function inputOf(row: PartyRow): PartyInput {
  const text = (value: string | null): string | undefined => value ?? undefined;
  return {
    id: row.id,
    kind: row.kind,
    legalForm: row.legal_form,
    displayName: row.display_name,
    contactPersonName: text(row.contact_person_name),
    phone: text(row.phone),
    email: text(row.email),
    notes: text(row.notes),
  };
}
