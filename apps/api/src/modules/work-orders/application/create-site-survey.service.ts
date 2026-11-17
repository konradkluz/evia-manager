/**
 * The site survey of the panel - `POST /api/v1/site-surveys` (EVM-135 AC2, AC3, AC4; ADR-0024 pt 5, 10; SR-AUTHZ-02, SR-INPUT-01, SR-API-05, SR-LOG-02). The guard
 * has decided before this runs (Administrator and Editor, the web channel, CSRF): a caller who may not create never reaches the switch or the validation.
 *
 * Order: the switch of the server (`SITE_SURVEYS_ENABLED`; off - `404 not_found` before the body is judged, the same answer as a missing site, nothing is
 * written); the `Idempotency-Key` and the body against the schemas of the contract (strict: a field of the order is `read_only_field`, any other stranger -
 * a customer, a template, a description - `unknown_field`, W8); the rules of the domain (plain title, the phone in E.164; pointers and codes, never values);
 * then ONE transaction: the idempotency port (when there is a key) and the shared composer (`composeSiteSurvey`): the site through its facade (`404 not_found`
 * for a missing, deleted or invisible one alike), the coordinator when named (`400 assignee_unavailable`), the number, the INSERT (`409 id_conflict` for any
 * existing identifier - also of another user or a deleted order - without a word about it), the coordinator and the event `work_order.created` (identifiers only).
 * Any failure rolls back as a whole. The answer is the detail of the order as the caller may read it NOW (`WorkOrderDetails`, with `siteSurvey`).
 */
import { zCreateSiteSurveyHeaders, zCreateSiteSurveyRequest, zWorkOrderDetails } from '@evia/contracts/zod';
import type { WorkOrderDetails } from '@evia/contracts';
import { Inject, Injectable } from '@nestjs/common';
import type { Kysely } from 'kysely';
import type { AppConfig } from '../../../platform/config/config.ts';
import type { Database } from '../../../platform/database/database.ts';
import { runInTransaction } from '../../../platform/database/transactional.ts';
import type { EventContext } from '../../../platform/events/event-bus.ts';
import type { Principal } from '../../../platform/http/principal.ts';
import { ProblemException } from '../../../platform/http/problem.ts';
import { parseInput, readOnlyKeys, strictObjects } from '../../../platform/http/validation.ts';
import { requestHash } from '../../../platform/idempotency/canonical-json.ts';
import { IDEMPOTENCY, type Idempotency } from '../../../platform/idempotency/idempotency.ts';
import { APP_CONFIG, DATABASE } from '../../../platform/tokens.ts';
import { normalizeSiteSurveyRequest, type NormalizedSiteSurvey, type SiteSurveyRequestInput } from '../domain/site-survey.ts';
import { ReadWorkOrderService } from './read-work-order.service.ts';
import { WorkOrderComposer } from './work-order-composer.ts';

/** Method and route template: what an idempotency key is bound to besides the user. */
export const CREATE_SITE_SURVEY_SCOPE = 'POST /api/v1/site-surveys';

const surveyBody = strictObjects(zCreateSiteSurveyRequest);
/** The fields of the server: the keys of the detail of an order that the request lacks (derived from the contract, not kept by hand). */
const SERVER_FIELDS = readOnlyKeys(zWorkOrderDetails, zCreateSiteSurveyRequest);
const idempotencyKeySchema = zCreateSiteSurveyHeaders.shape['Idempotency-Key'];

export interface CreatedSiteSurvey {
  readonly workOrder: WorkOrderDetails;
  /** True when the answer repeats an earlier creation (same key and body): `Idempotent-Replayed: true`. */
  readonly replayed: boolean;
}

@Injectable()
export class CreateSiteSurveyService {
  readonly #db: Kysely<Database>;
  readonly #idempotency: Idempotency;
  readonly #composer: WorkOrderComposer;
  readonly #reads: ReadWorkOrderService;
  readonly #features: AppConfig['features'];

  constructor(
    @Inject(DATABASE) db: Kysely<Database>,
    @Inject(IDEMPOTENCY) idempotency: Idempotency,
    @Inject(WorkOrderComposer) composer: WorkOrderComposer,
    @Inject(ReadWorkOrderService) reads: ReadWorkOrderService,
    @Inject(APP_CONFIG) config: AppConfig,
  ) {
    this.#db = db;
    this.#idempotency = idempotency;
    this.#composer = composer;
    this.#reads = reads;
    this.#features = config.features;
  }

  /** @param rawKey the `Idempotency-Key` header as received (`undefined` when absent) */
  async create(principal: Principal, rawBody: unknown, rawKey: string | undefined, context: EventContext): Promise<CreatedSiteSurvey> {
    if (!this.#features.siteSurveys) throw new ProblemException('not_found');
    const key = rawKey === undefined ? undefined : (parseInput(idempotencyKeySchema, rawKey) as string);
    const body = parseInput(surveyBody, rawBody, SERVER_FIELDS) as SiteSurveyRequestInput;
    const normalized = normalizeSiteSurveyRequest(body);
    if (!normalized.ok) throw new ProblemException('validation_failed', { errors: normalized.errors });
    const survey = normalized.survey;

    const request = { ...context, sessionId: principal.sessionId };
    return runInTransaction(this.#db, async (tx) => {
      const perform = async () => {
        await this.#compose(tx, principal, survey, request);
        return { value: survey.id, result: { status: 201, code: 'created', resourceId: survey.id } };
      };
      if (key === undefined) {
        await perform();
        return { workOrder: await this.#reads.detailsOf(tx, principal, survey.id), replayed: false };
      }
      const outcome = await this.#idempotency.run(
        tx,
        { userId: principal.userId, deviceId: null, key, scope: CREATE_SITE_SURVEY_SCOPE, bodyHash: requestHash(body) },
        perform,
      );
      const id = outcome.replayed ? outcome.result.resourceId : outcome.value;
      if (id === null) throw new ProblemException('not_found');
      return { workOrder: await this.#reads.detailsOf(tx, principal, id), replayed: outcome.replayed };
    });
  }

  /** The composition is the shared component's; its typed result is mapped to the problems of the panel here. */
  async #compose(tx: Kysely<Database>, principal: Principal, survey: NormalizedSiteSurvey, context: EventContext): Promise<void> {
    const result = await this.#composer.composeSiteSurvey(tx, principal, survey, { origin: 'office', createdViaDeviceId: null }, context);
    if (result.ok) return;
    switch (result.reason) {
      case 'target_unavailable':
        throw new ProblemException('not_found');
      case 'id_conflict':
        throw new ProblemException('id_conflict');
      case 'site_survey_limit_exceeded':
        throw new ProblemException('site_survey_limit_exceeded');
      case 'assignee_unavailable':
        throw new ProblemException('validation_failed', { errors: [{ pointer: '/assigneeUserId', code: 'assignee_unavailable' }] });
    }
  }
}
