/**
 * The restoration of a deleted stage (EVM-042 AC3, AC4, AC5, AC6, AC7; SR-API-05, SR-API-06, SR-API-07, SR-AUTHZ-02, SR-AUTHZ-05,
 * SR-LOG-03, ASVS V2.3.3, CWE-639). The guard has decided before this runs: a signed-in ADMINISTRATOR on the web channel with a valid
 * CSRF token — the Editor and Read-only get 403 and an anonymous caller 401 without reaching the headers. No step-up (see
 * `restore-procedure.service.ts`).
 *
 * ONE transaction, and every decision in it is taken on rows LOCKED, never on an earlier read:
 *   1. the ORDER is locked (the read policy is in that query): missing or soft deleted is `404 not_found`, the same for every role;
 *   2. the idempotency port (when there is a key), BEFORE the stage is looked for: a repeat answers `200` with the stage as it is NOW.
 *      The key is bound to the ORDER and the STAGE;
 *   3. the STAGE is locked with `id AND work_order_id AND deleted_at is not null` in ONE condition: a stage of another order, one that
 *      does not exist and one that is not deleted are the same `404 not_found` (IDOR), BEFORE `If-Match`;
 *   4. `If-Match` (`428` / `400`); a closed order (settled or cancelled, PO-8) is `409 work_order_closed`, before the version;
 *   5. the version of the STAGE (`412 version_conflict`, no current values);
 *   6. the PROCESS of the stage is locked next: a deleted one is `409 parent_deleted` (the process is restored first); the limit of 30
 *      stages (`422 limit_exceeded`) — checked under the lock of the order, like the addition;
 *   7. the stage returns to its remembered place (cut to the end; the others make room) in the status it had, the version of the
 *      process rises, the audit record (`procedure_stage.restored`) and the entry of the journal (identifiers and the code of the
 *      process — no name), the idempotency record. An error anywhere rolls the whole command back.
 */
import { zRestoreProcedureStageHeaders, zRestoreProcedureStagePath } from '@evia/contracts/zod';
import type { ProcedureStage } from '@evia/contracts';
import { Inject, Injectable } from '@nestjs/common';
import type { Kysely } from 'kysely';
import type { Clock } from '../../../platform/clock/clock.ts';
import type { Database } from '../../../platform/database/database.ts';
import type { EventBus, EventContext } from '../../../platform/events/event-bus.ts';
import { parseIfMatch } from '../../../platform/http/if-match.ts';
import type { Principal } from '../../../platform/http/principal.ts';
import { ProblemException } from '../../../platform/http/problem.ts';
import { parseInput, strictObjects } from '../../../platform/http/validation.ts';
import { requestHash } from '../../../platform/idempotency/canonical-json.ts';
import { IDEMPOTENCY, type Idempotency } from '../../../platform/idempotency/idempotency.ts';
import { CLOCK, DATABASE, EVENT_BUS } from '../../../platform/tokens.ts';
import { UserDirectory } from '../../identity/index.ts';
import { PARTY_DIRECTORY, type PartyDirectory } from '../../parties/index.ts';
import { WORK_ORDER_DIRECTORY, type WorkOrderDirectory, type WorkOrderRef } from '../../work-orders/index.ts';
import { insertionPoint, movesToOpen } from '../domain/ordering.ts';
import { MAX_STAGES_PER_PROCEDURE } from '../domain/stage-rules.ts';
import {
  activeStagePlaces,
  bumpProcedureVersion,
  lockOwnerOf,
  lockStageInState,
  moveStages,
  restoreStage,
} from '../infrastructure/manual-store.ts';
import { procedureTables } from '../infrastructure/tables.ts';
import { limitExceeded, publishManualChange } from './manual-shared.ts';
import { presentStage } from './stage-answer.ts';
import { runInTransaction } from '../../../platform/database/transactional.ts';

/** Method and route template; the key of an idempotency record is bound to it AND to the order and the stage (see {@link restoreStageScope}). */
export const RESTORE_STAGE_SCOPE = 'POST /api/v1/work-orders/{workOrderId}/procedure-stages/{stageId}/restore';

/**
 * What an idempotency key is bound to besides the user: the method, the route, THE ORDER and THE STAGE. A restoration has no body, so
 * a scope of the route alone would let the key of one stage "replay" the restoration of another (ASVS V2.3.1, SR-API-05, CWE-841).
 */
export const restoreStageScope = (workOrderId: string, stageId: string): string =>
  RESTORE_STAGE_SCOPE.replace('{workOrderId}', workOrderId).replace('{stageId}', stageId);

const pathSchema = strictObjects(zRestoreProcedureStagePath);
const idempotencyKeySchema = zRestoreProcedureStageHeaders.shape['Idempotency-Key'];

export interface RestoredStage {
  readonly stage: ProcedureStage;
  /** True when the answer repeats an earlier restoration (same key, order and stage): `Idempotent-Replayed: true`. */
  readonly replayed: boolean;
}

@Injectable()
export class RestoreStageService {
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
  async restore(
    principal: Principal,
    rawParams: unknown,
    rawIfMatch: string | undefined,
    rawKey: string | undefined,
    context: EventContext,
  ): Promise<RestoredStage> {
    const { workOrderId, stageId } = parseInput(pathSchema, rawParams) as { workOrderId: string; stageId: string };
    const key = rawKey === undefined ? undefined : (parseInput(idempotencyKeySchema, rawKey) as string);
    const request = { ...context, sessionId: principal.sessionId };

    return runInTransaction(this.#db, async (tx) => {
      const order = await this.#orders.lockVisible(tx, principal, workOrderId);
      if (order === undefined) throw new ProblemException('not_found');

      const perform = async () => {
        await this.#bringBack(tx, principal, order, stageId, rawIfMatch, request);
        return { value: undefined, result: { status: 200, code: 'restored', resourceId: stageId } };
      };
      const replayed =
        key === undefined
          ? (await perform(), false)
          : (
              await this.#idempotency.run(
                tx,
                { userId: principal.userId, deviceId: null, key, scope: restoreStageScope(order.id, stageId), bodyHash: requestHash(null) },
                perform,
              )
            ).replayed;

      // the stage is read again with the order of the URL and the policy of the moment — a repeat never returns a stage deleted since
      const deps = { users: this.#users, parties: this.#parties, clock: this.#clock };
      return { stage: await presentStage(deps, tx, principal, order.id, stageId), replayed };
    });
  }

  /** Steps 3–7 of the order described above, on the locked rows. */
  async #bringBack(
    tx: Kysely<Database>,
    principal: Principal,
    order: WorkOrderRef,
    stageId: string,
    rawIfMatch: string | undefined,
    request: EventContext,
  ): Promise<void> {
    const tables = procedureTables(tx);
    const locked = await lockStageInState(tables, order.id, stageId, 'deleted');
    if (locked === undefined) throw new ProblemException('not_found');
    const expectedVersion = parseIfMatch(rawIfMatch);
    if (order.closed) throw new ProblemException('work_order_closed');
    if (locked.version !== expectedVersion) throw new ProblemException('version_conflict');

    const owner = await lockOwnerOf(tables, order.id, locked.procedure_id);
    if (owner.deleted_at !== null) throw new ProblemException('parent_deleted');
    const places = await activeStagePlaces(tables, order.id, locked.procedure_id);
    if (places.length >= MAX_STAGES_PER_PROCEDURE) throw limitExceeded('too_many_stages');

    const at = insertionPoint(locked.position, places.length);
    const now = this.#clock.now();
    await moveStages(tables, order.id, locked.procedure_id, movesToOpen(places, at));
    await restoreStage(tables, order.id, stageId, at, expectedVersion, principal.userId, now);
    await bumpProcedureVersion(tables, order.id, locked.procedure_id, principal.userId, now);
    await publishManualChange(
      this.#events,
      tx,
      principal,
      { object: 'procedure_stage', action: 'restored', objectId: stageId, workOrderId: order.id, procedureCode: owner.code },
      request,
    );
  }
}
