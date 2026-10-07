/**
 * Creation of a site (EVM-021 AC2, AC3, AC5, AC6; SR-INPUT-01, SR-INPUT-02, SR-AUTHZ-04, SR-API-05, SR-DATA-02). The guard has
 * decided before this runs (Administrator and Editor, web channel, CSRF): a caller who may not create never reaches the validation,
 * so a Read-only user gets 403 for any body and nobody who is not entitled can fill the table of idempotency records (TM-22).
 *
 * Order: the `Idempotency-Key` header and the body are validated with the schemas of the contract (strict — a field of the server is
 * `read_only_field`, a stranger such as `customerId` `unknown_field`), then the rules of the domain (garage fields, scale of the
 * power, plain text; errors are pointers and codes, never values); then ONE transaction: the idempotency port (when there is a key),
 * the check of the parties named by the site (the kind of each, through the `PartyDirectory` facade, with the SAME transaction as
 * the insert — no gap between the check and the write), the INSERT (an existing `id` — also a deleted site's — is `409 id_conflict`,
 * the content is never compared), the event `site.created` for the audit trail (no value of personal data). A party of the wrong
 * kind is `wrong_party_kind`, one that does not exist or is deleted `unknown_party` (the same for every role); either rolls the
 * transaction back, so no idempotency record is left. A repeat (same key and body) runs none of it again: it returns the site as it
 * is NOW, read with the permissions of the caller of the repeat.
 */
import { zCreateSiteHeaders, zSite, zSiteWritable } from '@evia/contracts/zod';
import type { Site } from '@evia/contracts';
import { Inject, Injectable } from '@nestjs/common';
import type { Kysely } from 'kysely';
import { CLOCK, DATABASE, EVENT_BUS } from '../../../platform/tokens.ts';
import type { Clock } from '../../../platform/clock/clock.ts';
import type { Database } from '../../../platform/database/database.ts';
import type { EventBus, EventContext } from '../../../platform/events/event-bus.ts';
import type { Principal } from '../../../platform/http/principal.ts';
import { ProblemException } from '../../../platform/http/problem.ts';
import { parseInput, readOnlyKeys, strictObjects } from '../../../platform/http/validation.ts';
import { requestHash } from '../../../platform/idempotency/canonical-json.ts';
import { IDEMPOTENCY, type Idempotency } from '../../../platform/idempotency/idempotency.ts';
import { PARTY_DIRECTORY, type PartyDirectory } from '../../parties/index.ts';
import { checkPartyKinds, namedParties, normalizeNewSite, type NewSite, type SiteInput } from '../domain/site.ts';
import type { SiteEvent } from '../events.ts';
import { findVisibleSite, insertSite, type SiteRow } from '../infrastructure/site-store.ts';
import { siteTables } from '../infrastructure/tables.ts';
import { toSite } from './site-representation.ts';

/** Method and route template: what an idempotency key is bound to besides the user. */
export const CREATE_SITE_SCOPE = 'POST /api/v1/sites';

const createBody = strictObjects(zSiteWritable);
const SERVER_FIELDS = readOnlyKeys(zSite, zSiteWritable);
const idempotencyKeySchema = zCreateSiteHeaders.shape['Idempotency-Key'];

export interface CreatedSite {
  readonly site: Site;
  /** True when the answer repeats an earlier creation (same key and body): `Idempotent-Replayed: true`. */
  readonly replayed: boolean;
}

@Injectable()
export class CreateSiteService {
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

  /** @param rawKey the `Idempotency-Key` header as received (`undefined` when absent) */
  async create(principal: Principal, rawBody: unknown, rawKey: string | undefined, context: EventContext): Promise<CreatedSite> {
    const key = rawKey === undefined ? undefined : (parseInput(idempotencyKeySchema, rawKey) as string);
    const body = parseInput(createBody, rawBody, SERVER_FIELDS) as SiteInput;
    const normalized = normalizeNewSite(body);
    if (!normalized.ok) throw new ProblemException('validation_failed', { errors: normalized.errors });

    const request = { ...context, sessionId: principal.sessionId };
    return this.#db.transaction().execute(async (tx) => {
      const perform = async () => {
        await this.#checkParties(tx, principal, normalized.site);
        const row = await this.#insert(tx, principal, normalized.site, request);
        return { value: row, result: { status: 201, code: 'created', resourceId: row.id } };
      };
      if (key === undefined) return { site: toSite((await perform()).value), replayed: false };

      const outcome = await this.#idempotency.run(
        tx,
        { userId: principal.userId, deviceId: null, key, scope: CREATE_SITE_SCOPE, bodyHash: requestHash(body) },
        perform,
      );
      if (!outcome.replayed) return { site: toSite(outcome.value), replayed: false };
      const current =
        outcome.result.resourceId === null ? undefined : await findVisibleSite(siteTables(tx), principal, outcome.result.resourceId);
      if (current === undefined) throw new ProblemException('not_found');
      return { site: toSite(current), replayed: true };
    });
  }

  /** The kind of every named party, read in the transaction of the insert; a mismatch is `400 validation_failed` (SR-INPUT-02). */
  async #checkParties(tx: Kysely<Database>, principal: Principal, site: NewSite): Promise<void> {
    const named = namedParties(site);
    if (named.length === 0) return;
    const kinds = await this.#parties.kindsOf(
      tx,
      principal,
      named.map(([, id]) => id),
    );
    const issues = checkPartyKinds(site, kinds);
    if (issues.length > 0) throw new ProblemException('validation_failed', { errors: issues });
  }

  async #insert(tx: Kysely<Database>, principal: Principal, site: NewSite, context: EventContext): Promise<SiteRow> {
    const row = await insertSite(siteTables(tx), site, principal.userId, this.#clock.now());
    if (row === undefined) throw new ProblemException('id_conflict');
    const event: SiteEvent = {
      type: 'site.created',
      actor: { type: 'user', userId: principal.userId },
      outcome: 'success',
      objectType: 'site',
      objectId: row.id,
    };
    await this.#events.publish(tx, event, context);
    return row;
  }
}
