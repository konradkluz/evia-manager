/**
 * The edit of a site (EVM-036 AC1, AC2, AC4, AC7; SR-API-05, SR-API-06, SR-API-07, SR-AUTHZ-02, SR-AUTHZ-04, SR-AUTHZ-05, SR-INPUT-01,
 * SR-INPUT-02, SR-LOG-02, SR-LOG-03, SR-DATA-02, ASVS V2.3.3, CWE-639). The guard has decided before this runs: a signed-in
 * Administrator or Editor on the web channel with a valid CSRF token — Read-only gets 403 and an anonymous caller 401 without reaching
 * the headers or the body.
 *
 * Order: the path (400), the `Idempotency-Key`, `If-Match` (`428` / `400`) and the body against the schema of the contract (strict: a
 * field of the server, `id` included, is `read_only_field`, a stranger such as `customerId` `unknown_field`) — all of it BEFORE the
 * database is asked, so a malformed request says nothing about a site that is not there. Then ONE transaction, and every decision in
 * it is taken on the site LOCKED with `SELECT … FOR UPDATE` (the read policy is in that query), never on an earlier read:
 *   1. the site is locked: missing or soft deleted is `404 not_found`, the same for every role (before the version — a deleted site
 *      with a stale `If-Match` is 404, not 412, so the answer is no oracle of existence);
 *   2. the idempotency port (when there is a key): a repeat of the same key, site and body returns the stored result BEFORE the
 *      version is compared. The key is bound to the SITE (the scope holds its id): the same key and body on another site is
 *      `422 idempotency_mismatch`, not a replay that would silently skip the second change;
 *   3. the version (`412 version_conflict`, no current value in the answer);
 *   4. the merged site through the rules of the creation (`400`, pointers and codes, never a value);
 *   5. the kind of each party the PATCH names (`wrong_party_kind` / `unknown_party`, `400`, the rows read `FOR SHARE` in this
 *      transaction, no value and no actual kind in the answer);
 *   6. the update (`version + 1`), the event `site.updated` for the audit trail (the actor and the site, no field, no value), the
 *      idempotency record. An error anywhere rolls the whole command back.
 * A repeat returns the site as the caller may read it NOW (the read policy: deleted in between is 404).
 */
import { zSite, zSitePatch, zUpdateSiteHeaders, zUpdateSitePath } from '@evia/contracts/zod';
import type { Site } from '@evia/contracts';
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
import { PARTY_DIRECTORY, type PartyDirectory } from '../../parties/index.ts';
import { checkPartyKinds, namedParties, normalizeNewSite, type NewSite, type SiteInput } from '../domain/site.ts';
import { mergeSitePatch, partiesNamedByPatch, type SitePatchInput } from '../domain/site-patch.ts';
import type { SiteEvent } from '../events.ts';
import { findVisibleSite, lockVisibleSite, updateSiteRow, type SiteRow } from '../infrastructure/site-store.ts';
import { siteTables } from '../infrastructure/tables.ts';
import { toSite } from './site-representation.ts';

/** Method and route template; the key of an idempotency record is bound to it AND to the site (see {@link updateSiteScope}). */
export const UPDATE_SITE_SCOPE = 'PATCH /api/v1/sites/{siteId}';

/**
 * What an idempotency key is bound to besides the user: the method, the route and THE SITE. A patch such as `{"notes":"…"}` says
 * nothing of the site, so a scope of the route alone would let the key of one site "replay" the change for another one that was never
 * changed (ASVS V2.3.1, SR-API-05, CWE-639, CWE-841).
 */
export const updateSiteScope = (siteId: string): string => UPDATE_SITE_SCOPE.replace('{siteId}', siteId);

const pathSchema = strictObjects(zUpdateSitePath);
const patchBody = strictObjects(zSitePatch);
/** The fields of the server that a patch names in vain: the keys of the site that the patch lacks (derived from the contract). */
const SERVER_FIELDS = readOnlyKeys(zSite, zSitePatch);
const idempotencyKeySchema = zUpdateSiteHeaders.shape['Idempotency-Key'];

export interface UpdatedSite {
  readonly site: Site;
  /** True when the answer repeats an earlier edit (same key, site and body): `Idempotent-Replayed: true`. */
  readonly replayed: boolean;
}

@Injectable()
export class UpdateSiteService {
  readonly #db: Kysely<Database>;
  readonly #clock: Clock;
  readonly #events: EventBus;
  readonly #idempotency: Idempotency;
  readonly #parties: PartyDirectory;

  constructor(
    @Inject(DATABASE) db: Kysely<Database>,
    @Inject(CLOCK) clock: Clock,
    @Inject(EVENT_BUS) events: EventBus,
    @Inject(IDEMPOTENCY) idempotency: Idempotency,
    @Inject(PARTY_DIRECTORY) parties: PartyDirectory,
  ) {
    this.#db = db;
    this.#clock = clock;
    this.#events = events;
    this.#idempotency = idempotency;
    this.#parties = parties;
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
  ): Promise<UpdatedSite> {
    const { siteId } = parseInput(pathSchema, rawParams) as { siteId: string };
    const key = rawKey === undefined ? undefined : (parseInput(idempotencyKeySchema, rawKey) as string);
    const expectedVersion = parseIfMatch(rawIfMatch);
    const patch = parseInput(patchBody, rawBody, SERVER_FIELDS) as SitePatchInput;
    const request = { ...context, sessionId: principal.sessionId };

    return this.#db.transaction().execute(async (tx) => {
      const locked = await lockVisibleSite(siteTables(tx), principal, siteId);
      if (locked === undefined) throw new ProblemException('not_found');

      const perform = async () => {
        await this.#perform(tx, principal, locked, expectedVersion, patch, request);
        return { value: undefined, result: { status: 200, code: 'updated', resourceId: siteId } };
      };
      const replayed =
        key === undefined
          ? (await perform(), false)
          : (
              await this.#idempotency.run(
                tx,
                { userId: principal.userId, deviceId: null, key, scope: updateSiteScope(siteId), bodyHash: requestHash(patch) },
                perform,
              )
            ).replayed;
      const current = await findVisibleSite(siteTables(tx), principal, siteId);
      if (current === undefined) throw new ProblemException('not_found');
      return { site: toSite(current), replayed };
    });
  }

  /** Steps 3–6 of the order described above, on the locked row. */
  async #perform(
    tx: Kysely<Database>,
    principal: Principal,
    locked: SiteRow,
    expectedVersion: number,
    patch: SitePatchInput,
    request: EventContext,
  ): Promise<void> {
    if (locked.version !== expectedVersion) throw new ProblemException('version_conflict');
    const normalized = normalizeNewSite(mergeSitePatch(inputOf(locked), patch));
    if (!normalized.ok) throw new ProblemException('validation_failed', { errors: normalized.errors });
    await this.#checkParties(tx, principal, patch, normalized.site);

    const updated = await updateSiteRow(siteTables(tx), locked.id, expectedVersion, normalized.site, principal.userId, this.#clock.now());
    if (updated === undefined) throw new ProblemException('internal_error');
    const event: SiteEvent = {
      type: 'site.updated',
      actor: { type: 'user', userId: principal.userId },
      outcome: 'success',
      objectType: 'site',
      objectId: locked.id,
    };
    await this.#events.publish(tx, event, request);
  }

  /**
   * The kind of every party the PATCH names, read `FOR SHARE` in the transaction of the update; a mismatch is
   * `400 validation_failed` (SR-INPUT-02) with the pointer and the code only — never the id and never the kind found.
   */
  async #checkParties(tx: Kysely<Database>, principal: Principal, patch: SitePatchInput, site: NewSite): Promise<void> {
    const touched = partiesNamedByPatch(patch, site);
    const named = namedParties(touched);
    if (named.length === 0) return;
    const kinds = await this.#parties.kindsOf(
      tx,
      principal,
      named.map(([, id]) => id),
      { lock: true },
    );
    const issues = checkPartyKinds(touched, kinds);
    if (issues.length > 0) throw new ProblemException('validation_failed', { errors: issues });
  }
}

/** The stored site as the input of the rules (a column that is NULL is an absent field; the power is a `numeric` string). */
function inputOf(row: SiteRow): SiteInput {
  const text = (value: string | null): string | undefined => value ?? undefined;
  return {
    id: row.id,
    siteType: row.site_type,
    street: row.street,
    buildingNumber: row.building_number,
    apartmentNumber: text(row.apartment_number),
    postalCode: row.postal_code,
    city: row.city,
    parkingSpotNumber: text(row.parking_spot_number),
    garageLevel: text(row.garage_level),
    connectionPowerKw: row.connection_power_kw === null ? undefined : Number(row.connection_power_kw),
    meteringPointId: text(row.metering_point_id),
    distributionSystemOperatorPartyId: text(row.distribution_system_operator_party_id),
    managerPartyId: text(row.manager_party_id),
    notes: text(row.notes),
  };
}
