/**
 * The change of the person responsible and the due date of a stage (EVM-031 AC3, AC5, AC6, AC7; SR-API-05, SR-API-06, SR-API-07,
 * SR-AUTHZ-02, SR-AUTHZ-04, SR-AUTHZ-05, SR-INPUT-01, SR-INPUT-02, SR-DATA-03, SR-LOG-02, SR-LOG-03, ASVS V2.3.3, CWE-639, CWE-915).
 * The guard has decided before this runs: a signed-in Administrator or Editor on the web channel with a valid CSRF token — Read-only
 * gets 403 and an anonymous caller 401 without reaching the headers or the body.
 *
 * Order: the path (400), the `Idempotency-Key` and `If-Match` (`428` / `400`) — all of it BEFORE the database is asked, so a malformed
 * request says nothing about an order or a stage. Then ONE transaction, and every decision in it is taken on rows LOCKED with
 * `SELECT … FOR UPDATE`, never on an earlier read:
 *   1. the ORDER is locked through the facade of `work-orders` (the read policy is in that query): missing or soft deleted is
 *      `404 not_found`, the same for every role;
 *   2. the STAGE is locked with `id AND work_order_id` in ONE condition: a stage of another order, one that does not exist and one of
 *      a deleted order are the same `404 not_found` (a lookup by the stage alone, then a comparison, is an IDOR). Both 404 come before
 *      the body, so a malformed body tells a caller nothing about an object that is not theirs;
 *   3. the body against the schema of the contract (strict: a field of the server — `status`, `name`, `version`, "waiting for",
 *      `notes` … — is `read_only_field`, a stranger `unknown_field`) and the rules of the domain (a field is named, the range of the
 *      date): `400`, pointers and codes, never values;
 *   4. the idempotency port (when there is a key): a repeat of the same key, stage and body returns the stored result BEFORE the checks
 *      below. The key is bound to the STAGE (the scope holds its id): the same key and body on another stage is `422 idempotency_mismatch`;
 *   5. a closed order (settled or cancelled, PO-8) is `409 work_order_closed` — before the version, so a client with a stale tag learns
 *      the true reason;
 *   6. the version (`412 version_conflict`, no current value in the answer, the data stay as they were);
 *   7. the person responsible, when one is named: an ACTIVE user, read in this transaction; one who is missing, invited, deactivated or
 *      deleted is the ONE answer `400 validation_failed` (`/responsibleUserId`, `assignee_unavailable`) — no way to enumerate accounts;
 *   8. the update (`version + 1`), the event `procedure_stage.updated` for the audit trail (the actor and the stage — no name of the
 *      person, no date), the idempotency record. An error anywhere rolls the whole command back.
 * A repeat returns the stage as it is NOW.
 */
import { zProcedureStage, zProcedureStagePatch, zUpdateProcedureStageHeaders, zUpdateProcedureStagePath } from '@evia/contracts/zod';
import type { ProcedureStage } from '@evia/contracts';
import { Inject, Injectable } from '@nestjs/common';
import type { Kysely } from 'kysely';
import { businessDate } from '../../../platform/clock/business-date.ts';
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
import { UserDirectory } from '../../identity/index.ts';
import { WORK_ORDER_DIRECTORY, type WorkOrderDirectory } from '../../work-orders/index.ts';
import { normalizeStagePatch, type StagePatch, type StagePatchInput } from '../domain/stage-patch.ts';
import type { ProcedureStageEvent } from '../events.ts';
import { findStage, lockStage, updateStage } from '../infrastructure/procedure-store.ts';
import { procedureTables } from '../infrastructure/tables.ts';
import { toProcedureStage } from './procedure-representation.ts';
import { responsibleNamesOf } from './responsible-names.ts';

/** Method and route template; the key of an idempotency record is bound to it AND to the stage (see {@link updateStageScope}). */
export const UPDATE_STAGE_SCOPE = 'PATCH /api/v1/work-orders/{workOrderId}/procedure-stages/{stageId}';

/**
 * What an idempotency key is bound to besides the user: the method, the route and THE STAGE. A patch such as `{"dueDate":null}` says
 * nothing of the stage, so a scope of the route alone would let the key of one stage "replay" the change for another one that was
 * never changed (ASVS V2.3.1, SR-API-05, CWE-639, CWE-841). A stage belongs to exactly one order, so its id binds the order as well.
 */
export const updateStageScope = (stageId: string): string => UPDATE_STAGE_SCOPE.replace('{stageId}', stageId);

const pathSchema = strictObjects(zUpdateProcedureStagePath);
const patchBody = strictObjects(zProcedureStagePatch);
const idempotencyKeySchema = zUpdateProcedureStageHeaders.shape['Idempotency-Key'];

/**
 * The fields of the server that a patch names in vain: the keys of the stage that the patch lacks (derived from the contract) and the
 * columns of the model that this story does not return (EVM-032): all are `read_only_field`, not `unknown_field` (SR-AUTHZ-04).
 */
const SERVER_FIELDS: ReadonlySet<string> = new Set([
  ...readOnlyKeys(zProcedureStage, zProcedureStagePatch),
  'procedureId',
  'workOrderId',
  'waitingOn',
  'waitingOnPartyId',
  'waitingSince',
  'blockedReason',
  'startedAt',
  'completedOn',
  'outputDocumentKindCodes',
  'sourceStageTemplateId',
  'notes',
]);

export interface UpdatedStage {
  readonly stage: ProcedureStage;
  /** True when the answer repeats an earlier change (same key, stage and body): `Idempotent-Replayed: true`. */
  readonly replayed: boolean;
}

@Injectable()
export class UpdateStageService {
  readonly #db: Kysely<Database>;
  readonly #clock: Clock;
  readonly #events: EventBus;
  readonly #idempotency: Idempotency;
  readonly #orders: WorkOrderDirectory;
  readonly #users: UserDirectory;

  constructor(
    @Inject(DATABASE) db: Kysely<Database>,
    @Inject(CLOCK) clock: Clock,
    @Inject(EVENT_BUS) events: EventBus,
    @Inject(IDEMPOTENCY) idempotency: Idempotency,
    @Inject(WORK_ORDER_DIRECTORY) orders: WorkOrderDirectory,
    @Inject(UserDirectory) users: UserDirectory,
  ) {
    this.#db = db;
    this.#clock = clock;
    this.#events = events;
    this.#idempotency = idempotency;
    this.#orders = orders;
    this.#users = users;
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
  ): Promise<UpdatedStage> {
    const { workOrderId, stageId } = parseInput(pathSchema, rawParams) as { workOrderId: string; stageId: string };
    const key = rawKey === undefined ? undefined : (parseInput(idempotencyKeySchema, rawKey) as string);
    const expectedVersion = parseIfMatch(rawIfMatch);
    const request = { ...context, sessionId: principal.sessionId };

    return this.#db.transaction().execute(async (tx) => {
      const order = await this.#orders.lockVisible(tx, principal, workOrderId);
      if (order === undefined) throw new ProblemException('not_found');
      const locked = await lockStage(procedureTables(tx), order.id, stageId);
      if (locked === undefined) throw new ProblemException('not_found');

      const normalized = normalizeStagePatch(parseInput(patchBody, rawBody, SERVER_FIELDS) as StagePatchInput);
      if (!normalized.ok) throw new ProblemException('validation_failed', { errors: normalized.errors });
      const patch = normalized.patch;

      const perform = async () => {
        await this.#perform(
          tx,
          principal,
          { orderId: order.id, closed: order.closed, stageId, version: locked.version },
          expectedVersion,
          patch,
          request,
        );
        return { value: undefined, result: { status: 200, code: 'updated', resourceId: stageId } };
      };
      const replayed =
        key === undefined
          ? (await perform(), false)
          : (
              await this.#idempotency.run(
                tx,
                { userId: principal.userId, deviceId: null, key, scope: updateStageScope(stageId), bodyHash: requestHash(patch) },
                perform,
              )
            ).replayed;
      return { stage: await this.#present(tx, order.id, stageId), replayed };
    });
  }

  /** Steps 5–8 of the order described above, on the locked rows. */
  async #perform(
    tx: Kysely<Database>,
    principal: Principal,
    target: { readonly orderId: string; readonly closed: boolean; readonly stageId: string; readonly version: number },
    expectedVersion: number,
    patch: StagePatch,
    request: EventContext,
  ): Promise<void> {
    if (target.closed) throw new ProblemException('work_order_closed');
    if (target.version !== expectedVersion) throw new ProblemException('version_conflict');
    await this.#requireActiveUser(tx, patch.responsibleUserId);

    const version = await updateStage(
      procedureTables(tx),
      target.orderId,
      target.stageId,
      expectedVersion,
      patch,
      principal.userId,
      this.#clock.now(),
    );
    if (version === undefined) throw new ProblemException('internal_error');
    const event: ProcedureStageEvent = {
      type: 'procedure_stage.updated',
      actor: { type: 'user', userId: principal.userId },
      outcome: 'success',
      objectType: 'procedure_stage',
      objectId: target.stageId,
    };
    await this.#events.publish(tx, event, request);
  }

  /** `null` and absent name no one; a named user must be ACTIVE — the one answer for every other state of an account. */
  async #requireActiveUser(tx: Kysely<Database>, userId: string | null | undefined): Promise<void> {
    if (userId === null || userId === undefined) return;
    if ((await this.#users.findActive(userId, tx)) === undefined) {
      throw new ProblemException('validation_failed', { errors: [{ pointer: '/responsibleUserId', code: 'assignee_unavailable' }] });
    }
  }

  /** The stage of THIS order as it is NOW, with the name of the person responsible. */
  async #present(tx: Kysely<Database>, orderId: string, stageId: string): Promise<ProcedureStage> {
    const row = await findStage(procedureTables(tx), orderId, stageId);
    if (row === undefined) throw new ProblemException('not_found');
    const names = await responsibleNamesOf(this.#users, tx, row.responsible_user_id === null ? [] : [row.responsible_user_id]);
    return toProcedureStage(row, names, businessDate(this.#clock.now()));
  }
}
