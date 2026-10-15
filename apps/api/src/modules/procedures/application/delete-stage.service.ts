/**
 * The deletion of a stage from a process (EVM-042 AC3, AC4, AC5, AC6, AC7; SR-API-05, SR-API-06, SR-API-07, SR-AUTHZ-02,
 * SR-AUTHZ-05, SR-LOG-03, ASVS V2.3.3, CWE-639). Soft delete: the stage leaves the process for every role, the other stages are
 * numbered 1…n again and the version of the process rises (its make-up changed). The panel recommends "Nie dotyczy" (a transition
 * that keeps the history); this is the other choice. The guard has decided before this runs: a signed-in Administrator or Editor on
 * the web channel with a valid CSRF token — Read-only gets 403 and an anonymous caller 401 without reaching the headers.
 *
 * ONE transaction, and every decision in it is taken on rows LOCKED, never on an earlier read:
 *   1. the ORDER is locked (the read policy is in that query): missing or soft deleted is `404 not_found`, the same for every role;
 *   2. the idempotency port (when there is a key), BEFORE the stage is looked for: a repeat of the same key, order and stage answers
 *      `204` although the stage is gone (a retry after a lost answer is the same command, not a `404`);
 *   3. the STAGE is locked with `id AND work_order_id AND deleted_at is null` and a live process in ONE condition: a stage of another
 *      order, one that does not exist, one already deleted and one of a deleted process are the same `404 not_found` (IDOR), BEFORE
 *      `If-Match`;
 *   4. `If-Match` (`428` / `400`); a closed order (settled or cancelled, PO-8) is `409 work_order_closed`, before the version;
 *   5. the version of the STAGE (`412 version_conflict`, no current values);
 *   6. the soft delete, the renumbering, the version of the process, the audit record (`procedure_stage.deleted`) and the entry of
 *      the journal (identifiers and the code of the process — no name), the idempotency record. An error anywhere rolls the whole
 *      command back.
 */
import { zDeleteProcedureStageHeaders, zDeleteProcedureStagePath } from '@evia/contracts/zod';
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
import { WORK_ORDER_DIRECTORY, type WorkOrderDirectory, type WorkOrderRef } from '../../work-orders/index.ts';
import { movesToClose } from '../domain/ordering.ts';
import {
  activeStagePlaces,
  bumpProcedureVersion,
  lockOwnerOf,
  lockStageInState,
  moveStages,
  softDeleteStage,
} from '../infrastructure/manual-store.ts';
import { procedureTables } from '../infrastructure/tables.ts';
import { publishManualChange } from './manual-shared.ts';
import { runInTransaction } from '../../../platform/database/transactional.ts';

/** Method and route template; the key of an idempotency record is bound to it AND to the order and the stage (see {@link deleteStageScope}). */
export const DELETE_STAGE_SCOPE = 'DELETE /api/v1/work-orders/{workOrderId}/procedure-stages/{stageId}';

/**
 * What an idempotency key is bound to besides the user: the method, the route, THE ORDER and THE STAGE. A removal has no body, so a
 * scope of the route alone would let the key of one stage "replay" the removal of another (ASVS V2.3.1, SR-API-05, CWE-841).
 */
export const deleteStageScope = (workOrderId: string, stageId: string): string =>
  DELETE_STAGE_SCOPE.replace('{workOrderId}', workOrderId).replace('{stageId}', stageId);

const pathSchema = strictObjects(zDeleteProcedureStagePath);
const idempotencyKeySchema = zDeleteProcedureStageHeaders.shape['Idempotency-Key'];

@Injectable()
export class DeleteStageService {
  readonly #db: Kysely<Database>;
  readonly #clock: Clock;
  readonly #events: EventBus;
  readonly #idempotency: Idempotency;
  readonly #orders: WorkOrderDirectory;

  constructor(
    @Inject(DATABASE) db: Kysely<Database>,
    @Inject(CLOCK) clock: Clock,
    @Inject(EVENT_BUS) events: EventBus,
    @Inject(IDEMPOTENCY) idempotency: Idempotency,
    @Inject(WORK_ORDER_DIRECTORY) orders: WorkOrderDirectory,
  ) {
    this.#db = db;
    this.#clock = clock;
    this.#events = events;
    this.#idempotency = idempotency;
    this.#orders = orders;
  }

  /**
   * @param rawParams the path parameters as parsed by the framework
   * @param rawIfMatch the `If-Match` header as received (`undefined` when absent)
   * @param rawKey the `Idempotency-Key` header as received (`undefined` when absent)
   * @returns `true` when the answer repeats an earlier removal (`Idempotent-Replayed: true`)
   */
  async delete(
    principal: Principal,
    rawParams: unknown,
    rawIfMatch: string | undefined,
    rawKey: string | undefined,
    context: EventContext,
  ): Promise<boolean> {
    const { workOrderId, stageId } = parseInput(pathSchema, rawParams) as { workOrderId: string; stageId: string };
    const key = rawKey === undefined ? undefined : (parseInput(idempotencyKeySchema, rawKey) as string);
    const request = { ...context, sessionId: principal.sessionId };

    return runInTransaction(this.#db, async (tx) => {
      const order = await this.#orders.lockVisible(tx, principal, workOrderId);
      if (order === undefined) throw new ProblemException('not_found');

      const perform = async () => {
        await this.#remove(tx, principal, order, stageId, rawIfMatch, request);
        return { value: undefined, result: { status: 204, code: 'deleted', resourceId: stageId } };
      };
      if (key === undefined) {
        await perform();
        return false;
      }
      const outcome = await this.#idempotency.run(
        tx,
        { userId: principal.userId, deviceId: null, key, scope: deleteStageScope(order.id, stageId), bodyHash: requestHash(null) },
        perform,
      );
      return outcome.replayed;
    });
  }

  /** Steps 3–6 of the order described above, on the locked rows. */
  async #remove(
    tx: Kysely<Database>,
    principal: Principal,
    order: WorkOrderRef,
    stageId: string,
    rawIfMatch: string | undefined,
    request: EventContext,
  ): Promise<void> {
    const tables = procedureTables(tx);
    const locked = await lockStageInState(tables, order.id, stageId, 'active');
    if (locked === undefined) throw new ProblemException('not_found');
    const expectedVersion = parseIfMatch(rawIfMatch);
    if (order.closed) throw new ProblemException('work_order_closed');
    if (locked.version !== expectedVersion) throw new ProblemException('version_conflict');

    // the process of a live stage is live (the lock found it so) and is locked next — the stage first, the process second, as everywhere
    const owner = await lockOwnerOf(tables, order.id, locked.procedure_id);

    const now = this.#clock.now();
    await softDeleteStage(tables, order.id, stageId, expectedVersion, principal.userId, now);
    await moveStages(tables, order.id, locked.procedure_id, movesToClose(await activeStagePlaces(tables, order.id, locked.procedure_id)));
    await bumpProcedureVersion(tables, order.id, locked.procedure_id, principal.userId, now);
    await publishManualChange(
      this.#events,
      tx,
      principal,
      { object: 'procedure_stage', action: 'deleted', objectId: stageId, workOrderId: order.id, procedureCode: owner.code },
      request,
    );
  }
}
