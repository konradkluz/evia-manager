/**
 * The extension of a site survey by 90 days (EVM-140 AC2, AC3; ADR-0024 pt 9; SR-AUTHZ-02, SR-AUTHZ-05, SR-PRIV-01, SR-API-06, SR-LOG-03; CWE-639). The guard has
 * decided before this runs: a signed-in Administrator or Editor on the web channel with a valid CSRF token - Read-only gets 403, an anonymous caller 401 and a
 * token of the phone 403 without reaching the body.
 *
 * ONE transaction; every decision is taken on the order LOCKED with `SELECT ... FOR NO KEY UPDATE` (the read policy is in that query). The order of the steps
 * (the same as of the assignment of a customer, EVM-136):
 *   1. the order: missing, soft deleted and not visible are ONE `404 not_found`, before the body;
 *   2. the body (the strict schema of the contract: an unknown reason is `400`; a field of the server is `read_only_field`);
 *   3. the idempotency port (with a key): a repeat of the same key, order and body returns the stored result BEFORE every other decision; the key is bound to
 *      the ORDER;
 *   4. the decision of the domain ({@link decideExtension}): no open survey or a cancelled one - `409 invalid_state_transition`; two extensions already -
 *      `409 extension_limit_reached`; a stale version - `412 version_conflict`;
 *   5. the update (one `UPDATE`), the event of the audit trail and of the journal (identifiers and the code of the reason), the idempotency record. An error
 *      anywhere rolls all back.
 * The address and the phone of the requester are never read here.
 */
import { zExtendSiteSurveyHeaders, zExtendSiteSurveyPath, zExtendSiteSurveyRequest, zWorkOrderDetails } from '@evia/contracts/zod';
import type { WorkOrderDetails } from '@evia/contracts';
import { Inject, Injectable } from '@nestjs/common';
import type { Kysely } from 'kysely';
import type { Clock } from '../../../platform/clock/clock.ts';
import type { Database } from '../../../platform/database/database.ts';
import { runInTransaction } from '../../../platform/database/transactional.ts';
import type { EventBus, EventContext } from '../../../platform/events/event-bus.ts';
import type { Principal } from '../../../platform/http/principal.ts';
import { ProblemException } from '../../../platform/http/problem.ts';
import { parseInput, readOnlyKeys, strictObjects } from '../../../platform/http/validation.ts';
import { requestHash } from '../../../platform/idempotency/canonical-json.ts';
import { IDEMPOTENCY, type Idempotency } from '../../../platform/idempotency/idempotency.ts';
import { CLOCK, DATABASE, EVENT_BUS } from '../../../platform/tokens.ts';
import { decideExtension, type SiteSurveyExtensionReason } from '../domain/site-survey-extension.ts';
import type { WorkOrderSiteSurveyExtendedEvent } from '../events.ts';
import { extendSiteSurvey, lockWorkOrderForExtension, type ExtendableWorkOrderRow } from '../infrastructure/site-survey-extension-store.ts';
import { workOrderTables } from '../infrastructure/tables.ts';
import { ReadWorkOrderService } from './read-work-order.service.ts';

/** Method and route template; the key of an idempotency record is bound to it AND to the order (see {@link extendSiteSurveyScope}). */
export const EXTEND_SITE_SURVEY_SCOPE = 'POST /api/v1/work-orders/{workOrderId}/site-survey/extensions';

/** What an idempotency key is bound to besides the user: the method, the route and THE ORDER (the body names no order, ASVS V2.3.1, CWE-841). */
export const extendSiteSurveyScope = (workOrderId: string): string => EXTEND_SITE_SURVEY_SCOPE.replace('{workOrderId}', workOrderId);

const pathSchema = strictObjects(zExtendSiteSurveyPath);
const extendBody = strictObjects(zExtendSiteSurveyRequest);
/** The fields of the server that a command names in vain: the keys of the order that the command lacks (derived from the contract). */
const SERVER_FIELDS = readOnlyKeys(zWorkOrderDetails, zExtendSiteSurveyRequest);
const idempotencyKeySchema = zExtendSiteSurveyHeaders.shape['Idempotency-Key'];

interface ExtendBody {
  readonly reason: SiteSurveyExtensionReason;
  readonly version: number;
}

export interface ExtendedSiteSurvey {
  readonly workOrder: WorkOrderDetails;
  /** True when the answer repeats an earlier command (same key, order and body): `Idempotent-Replayed: true`. */
  readonly replayed: boolean;
}

@Injectable()
export class ExtendSiteSurveyService {
  readonly #db: Kysely<Database>;
  readonly #clock: Clock;
  readonly #events: EventBus;
  readonly #idempotency: Idempotency;
  readonly #reads: ReadWorkOrderService;

  constructor(
    @Inject(DATABASE) db: Kysely<Database>,
    @Inject(CLOCK) clock: Clock,
    @Inject(EVENT_BUS) events: EventBus,
    @Inject(IDEMPOTENCY) idempotency: Idempotency,
    @Inject(ReadWorkOrderService) reads: ReadWorkOrderService,
  ) {
    this.#db = db;
    this.#clock = clock;
    this.#events = events;
    this.#idempotency = idempotency;
    this.#reads = reads;
  }

  /**
   * @param rawParams the path parameters as parsed by the framework
   * @param rawKey the `Idempotency-Key` header as received (`undefined` when absent)
   */
  async extend(
    principal: Principal,
    rawParams: unknown,
    rawBody: unknown,
    rawKey: string | undefined,
    context: EventContext,
  ): Promise<ExtendedSiteSurvey> {
    const { workOrderId } = parseInput(pathSchema, rawParams) as { workOrderId: string };
    const key = rawKey === undefined ? undefined : (parseInput(idempotencyKeySchema, rawKey) as string);
    const request = { ...context, sessionId: principal.sessionId };

    return runInTransaction(this.#db, async (tx) => {
      const locked = await lockWorkOrderForExtension(workOrderTables(tx), principal, workOrderId);
      if (locked === undefined) throw new ProblemException('not_found');
      const body = parseInput(extendBody, rawBody, SERVER_FIELDS) as ExtendBody;

      const perform = async () => {
        await this.#perform(tx, principal, locked, body, request);
        return { value: undefined, result: { status: 200, code: 'site_survey_extended', resourceId: workOrderId } };
      };
      const replayed =
        key === undefined
          ? (await perform(), false)
          : (
              await this.#idempotency.run(
                tx,
                { userId: principal.userId, deviceId: null, key, scope: extendSiteSurveyScope(workOrderId), bodyHash: requestHash(body) },
                perform,
              )
            ).replayed;
      return { workOrder: await this.#reads.detailsOf(tx, principal, workOrderId), replayed };
    });
  }

  /** Steps 4-5 of the order described above, on the locked row. */
  async #perform(
    tx: Kysely<Database>,
    principal: Principal,
    locked: ExtendableWorkOrderRow,
    body: ExtendBody,
    request: EventContext,
  ): Promise<void> {
    const decision = decideExtension(body.version, {
      customerId: locked.customer_id,
      siteSurveyExpiresAt: locked.site_survey_expires_at,
      extensions: locked.site_survey_extensions,
      status: locked.status,
      version: locked.version,
    });
    if (decision.kind === 'refuse') throw new ProblemException(decision.code);

    const version = await extendSiteSurvey(
      workOrderTables(tx),
      locked.id,
      locked.version,
      locked.site_survey_extensions,
      decision.expiresAt,
      principal.userId,
      this.#clock.now(),
    );
    if (version === undefined) throw new ProblemException('internal_error');

    const event: WorkOrderSiteSurveyExtendedEvent = {
      type: 'work_order.site_survey_extended',
      actor: { type: 'user', userId: principal.userId },
      outcome: 'success',
      objectType: 'work_order',
      objectId: locked.id,
      reasonCode: body.reason,
    };
    await this.#events.publish(tx, event, request);
  }
}
