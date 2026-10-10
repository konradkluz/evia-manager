/**
 * The status command of a stage (EVM-032 AC1–AC7; SR-API-05, SR-API-06, SR-API-07, SR-AUTHZ-02, SR-AUTHZ-04, SR-AUTHZ-05,
 * SR-AUTHZ-10, SR-INPUT-01, SR-INPUT-02, SR-DATA-02, SR-LOG-02, SR-LOG-03, ASVS V2.3.1, V2.3.3, CWE-639, CWE-841). The guard has
 * decided before this runs: a signed-in Administrator or Editor on the web channel with a valid CSRF token — Read-only gets 403 and
 * an anonymous caller 401 without reaching the headers or the body.
 *
 * Order: the path and the `Idempotency-Key` (400) before the database is asked. Then ONE transaction, and every decision in it is
 * taken on rows LOCKED with `SELECT … FOR UPDATE`, never on an earlier read:
 *   1. the ORDER is locked through the facade of `work-orders` (the read policy is in that query): missing or soft deleted is
 *      `404 not_found`, the same for every role;
 *   2. the STAGE is locked with `id AND work_order_id` in ONE condition: a stage of another order, one that does not exist and one of
 *      a deleted order are the same `404 not_found`. Both 404 come before `If-Match` and the body, so a malformed request tells a
 *      caller nothing about an object that is not theirs;
 *   3. `If-Match` (`428` / `400`) and the body against the schema of the contract (strict: `status`, `version` … are `read_only_field`, a stranger `unknown_field`)
 *      and the rules the target decides (`to`: the fields it takes, are required and refuses; the dates; one rule of "waiting for"
 *      shared with the PATCH): `400`, pointers and codes, never values — the reason of a block is free text that may name a person;
 *   4. the idempotency port (when there is a key): a repeat of the same key, stage and body returns the stored result BEFORE the
 *      checks below. The key is bound to the STAGE: the same key and body on another stage is `422 idempotency_mismatch`;
 *   5. a closed order (settled or cancelled, PO-8) is `409 work_order_closed` — the coarser gate, before the table, so the answer
 *      does not depend on the status of the stage;
 *   6. the row of the table of transitions for (the status NOW, `to`): none is `409 invalid_state_transition` — unless the version is
 *      stale, which is `412` (the client has to read the stage again); then the role (the object policy of the use case: every row
 *      is for both roles today, the table is where a stricter row would be said) and the version (`412 version_conflict`);
 *   7. the party, when one is named: visible and LOCKED `FOR SHARE` through the facade of `parties` in this transaction; missing or
 *      deleted is the ONE answer `400` (`/waitingOnPartyId`, `unknown_party`), also for the Administrator;
 *   8. the update (`version + 1`; the fields of the target set, the others cleared), the event `procedure_stage.transitioned` for the
 *      audit trail (the actor and the stage — no reason, no party, no day), the idempotency record. An error anywhere rolls the whole
 *      command back; a repeat returns the stage as it is NOW.
 * "Cofnij" is not a path of its own: it is an ordinary move of the table with the parameters the user could give by hand.
 */
import {
  zProcedureStage,
  zTransitionProcedureStageHeaders,
  zTransitionProcedureStagePath,
  zTransitionProcedureStageRequest,
} from '@evia/contracts/zod';
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
import { PARTY_DIRECTORY, type PartyDirectory } from '../../parties/index.ts';
import { WORK_ORDER_DIRECTORY, type WorkOrderDirectory } from '../../work-orders/index.ts';
import {
  applyStageTransition,
  findStageTransition,
  mayUse,
  normalizeTransitionFields,
  type StageTransitionCommand,
  type TransitionFields,
} from '../domain/stage-transitions.ts';
import type { StageStatus } from '../domain/stage-rules.ts';
import type { ProcedureStageEvent } from '../events.ts';
import { lockStage, transitionStage } from '../infrastructure/procedure-store.ts';
import { procedureTables } from '../infrastructure/tables.ts';
import { HIDDEN_STAGE_COLUMNS, presentStage, requireVisibleParty } from './stage-answer.ts';

/** Method and route template; the key of an idempotency record is bound to it AND to the stage (see {@link transitionStageScope}). */
export const TRANSITION_STAGE_SCOPE = 'POST /api/v1/work-orders/{workOrderId}/procedure-stages/{stageId}/transitions';

/**
 * What an idempotency key is bound to besides the user: the method, the route and THE STAGE. The body of a transition says nothing
 * of the stage (`{"to":"done"}` is the same for every stage), so a scope of the route alone would let the key of one stage replay
 * "done" for another one that was never changed (ASVS V2.3.1, SR-API-05, CWE-639, CWE-841). A stage belongs to exactly one order.
 */
export const transitionStageScope = (stageId: string): string => TRANSITION_STAGE_SCOPE.replace('{stageId}', stageId);

const pathSchema = strictObjects(zTransitionProcedureStagePath);
const commandBody = strictObjects(zTransitionProcedureStageRequest);
const idempotencyKeySchema = zTransitionProcedureStageHeaders.shape['Idempotency-Key'];
/** The fields of the server that a command names in vain: the keys of the stage that the command lacks (derived from the contract). */
const SERVER_FIELDS: ReadonlySet<string> = new Set([
  ...readOnlyKeys(zProcedureStage, zTransitionProcedureStageRequest),
  ...HIDDEN_STAGE_COLUMNS,
]);

export interface TransitionedStage {
  readonly stage: ProcedureStage;
  /** True when the answer repeats an earlier command (same key, stage and body): `Idempotent-Replayed: true`. */
  readonly replayed: boolean;
}

interface Target {
  readonly orderId: string;
  readonly closed: boolean;
  readonly stageId: string;
  readonly version: number;
  readonly status: StageStatus;
}

@Injectable()
export class TransitionStageService {
  readonly #db: Kysely<Database>;
  readonly #clock: Clock;
  readonly #events: EventBus;
  readonly #idempotency: Idempotency;
  readonly #orders: WorkOrderDirectory;
  readonly #parties: PartyDirectory;
  readonly #users: UserDirectory;

  constructor(
    @Inject(DATABASE) db: Kysely<Database>,
    @Inject(CLOCK) clock: Clock,
    @Inject(EVENT_BUS) events: EventBus,
    @Inject(IDEMPOTENCY) idempotency: Idempotency,
    @Inject(WORK_ORDER_DIRECTORY) orders: WorkOrderDirectory,
    @Inject(PARTY_DIRECTORY) parties: PartyDirectory,
    @Inject(UserDirectory) users: UserDirectory,
  ) {
    this.#db = db;
    this.#clock = clock;
    this.#events = events;
    this.#idempotency = idempotency;
    this.#orders = orders;
    this.#parties = parties;
    this.#users = users;
  }

  /**
   * @param rawParams the path parameters as parsed by the framework
   * @param rawIfMatch the `If-Match` header as received (`undefined` when absent)
   * @param rawKey the `Idempotency-Key` header as received (`undefined` when absent)
   */
  async transition(
    principal: Principal,
    rawParams: unknown,
    rawIfMatch: string | undefined,
    rawBody: unknown,
    rawKey: string | undefined,
    context: EventContext,
  ): Promise<TransitionedStage> {
    const { workOrderId, stageId } = parseInput(pathSchema, rawParams) as { workOrderId: string; stageId: string };
    const key = rawKey === undefined ? undefined : (parseInput(idempotencyKeySchema, rawKey) as string);
    const request = { ...context, sessionId: principal.sessionId };

    return this.#db.transaction().execute(async (tx) => {
      const order = await this.#orders.lockVisible(tx, principal, workOrderId);
      if (order === undefined) throw new ProblemException('not_found');
      const locked = await lockStage(procedureTables(tx), order.id, stageId);
      if (locked === undefined) throw new ProblemException('not_found');

      const expectedVersion = parseIfMatch(rawIfMatch);
      const command = parseInput(commandBody, rawBody, SERVER_FIELDS) as StageTransitionCommand;
      const fields = normalizeTransitionFields(command, businessDate(this.#clock.now()));
      if (!fields.ok) throw new ProblemException('validation_failed', { errors: fields.errors });

      const target: Target = { orderId: order.id, closed: order.closed, stageId, version: locked.version, status: locked.status };
      const perform = async () => {
        await this.#perform(tx, principal, target, expectedVersion, command.to, fields.fields, request);
        return { value: undefined, result: { status: 200, code: 'transitioned', resourceId: stageId } };
      };
      const replayed =
        key === undefined
          ? (await perform(), false)
          : (
              await this.#idempotency.run(
                tx,
                { userId: principal.userId, deviceId: null, key, scope: transitionStageScope(stageId), bodyHash: requestHash(command) },
                perform,
              )
            ).replayed;
      const deps = { users: this.#users, parties: this.#parties, clock: this.#clock };
      return { stage: await presentStage(deps, tx, principal, order.id, stageId), replayed };
    });
  }

  /** Steps 5–8 of the order described above, on the locked rows. */
  async #perform(
    tx: Kysely<Database>,
    principal: Principal,
    target: Target,
    expectedVersion: number,
    to: StageStatus,
    fields: TransitionFields,
    request: EventContext,
  ): Promise<void> {
    if (target.closed) throw new ProblemException('work_order_closed');
    const stale = target.version !== expectedVersion;
    const rule = findStageTransition(target.status, to);
    if (rule === undefined) throw new ProblemException(stale ? 'version_conflict' : 'invalid_state_transition');
    if (!mayUse(rule, principal.role)) throw new ProblemException('forbidden');
    if (stale) throw new ProblemException('version_conflict');
    await requireVisibleParty(this.#parties, tx, principal, fields.waiting?.waitingOnPartyId ?? null);

    const now = this.#clock.now();
    await transitionStage(
      procedureTables(tx),
      target.orderId,
      target.stageId,
      expectedVersion,
      applyStageTransition(rule, fields, now),
      principal.userId,
      now,
    );
    const event: ProcedureStageEvent = {
      type: 'procedure_stage.transitioned',
      actor: { type: 'user', userId: principal.userId },
      outcome: 'success',
      objectType: 'procedure_stage',
      objectId: target.stageId,
    };
    await this.#events.publish(tx, event, request);
  }
}
