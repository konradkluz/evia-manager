/**
 * The deletion of a process from a work order (EVM-042 AC3, AC4, AC5, AC6, AC7; SR-API-05, SR-API-06, SR-API-07, SR-AUTHZ-02,
 * SR-AUTHZ-05, SR-LOG-03, ASVS V2.3.3, CWE-639). Soft delete of the PROCESS only: its stages stay in the database untouched and
 * disappear with it, so the restoration brings them back as they were; the other processes are numbered 1…n again. The guard has
 * decided before this runs: a signed-in Administrator or Editor on the web channel with a valid CSRF token — Read-only gets 403 and
 * an anonymous caller 401 without reaching the headers.
 *
 * ONE transaction, and every decision in it is taken on rows LOCKED, never on an earlier read:
 *   1. the ORDER is locked (the read policy is in that query): missing or soft deleted is `404 not_found`, the same for every role;
 *   2. the idempotency port (when there is a key), BEFORE the process is looked for: a repeat of the same key, order and process
 *      answers `204` although the process is gone — a retry after a lost answer is the same command, not a `404`. The key is bound
 *      to the ORDER and the PROCESS, and a first request for a process that is not the caller's was a `404` that rolled back and
 *      left no record;
 *   3. the PROCESS is locked with `id AND work_order_id AND deleted_at is null` in ONE condition: a process of another order, one that
 *      does not exist and one that is already deleted are the same `404 not_found` (IDOR), BEFORE `If-Match`;
 *   4. `If-Match` (`428` / `400`); a closed order (settled or cancelled, PO-8) is `409 work_order_closed`, before the version;
 *   5. the version of the PROCESS (`412 version_conflict`, no current values);
 *   6. the soft delete, the renumbering, the audit record (`procedure.deleted`, an action of its own) and the entry of the journal
 *      (the code of the process), the idempotency record. An error anywhere rolls the whole command back.
 */
import { zDeleteWorkOrderProcedureHeaders, zDeleteWorkOrderProcedurePath } from '@evia/contracts/zod';
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
import { activeProcedurePlaces, lockProcedure, moveProcedures, softDeleteProcedure } from '../infrastructure/manual-store.ts';
import { procedureTables } from '../infrastructure/tables.ts';
import { publishManualChange } from './manual-shared.ts';
import { runInTransaction } from '../../../platform/database/transactional.ts';

/** Method and route template; the key of an idempotency record is bound to it AND to the order and the process (see {@link deleteProcedureScope}). */
export const DELETE_PROCEDURE_SCOPE = 'DELETE /api/v1/work-orders/{workOrderId}/procedures/{procedureId}';

/**
 * What an idempotency key is bound to besides the user: the method, the route, THE ORDER and THE PROCESS. A removal has no body, so a
 * scope of the route alone would let the key of one process "replay" the removal of another (ASVS V2.3.1, SR-API-05, CWE-841).
 */
export const deleteProcedureScope = (workOrderId: string, procedureId: string): string =>
  DELETE_PROCEDURE_SCOPE.replace('{workOrderId}', workOrderId).replace('{procedureId}', procedureId);

const pathSchema = strictObjects(zDeleteWorkOrderProcedurePath);
const idempotencyKeySchema = zDeleteWorkOrderProcedureHeaders.shape['Idempotency-Key'];

@Injectable()
export class DeleteProcedureService {
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
    const { workOrderId, procedureId } = parseInput(pathSchema, rawParams) as { workOrderId: string; procedureId: string };
    const key = rawKey === undefined ? undefined : (parseInput(idempotencyKeySchema, rawKey) as string);
    const request = { ...context, sessionId: principal.sessionId };

    return runInTransaction(this.#db, async (tx) => {
      const order = await this.#orders.lockVisible(tx, principal, workOrderId);
      if (order === undefined) throw new ProblemException('not_found');

      const perform = async () => {
        await this.#remove(tx, principal, order, procedureId, rawIfMatch, request);
        return { value: undefined, result: { status: 204, code: 'deleted', resourceId: procedureId } };
      };
      if (key === undefined) {
        await perform();
        return false;
      }
      const outcome = await this.#idempotency.run(
        tx,
        { userId: principal.userId, deviceId: null, key, scope: deleteProcedureScope(order.id, procedureId), bodyHash: requestHash(null) },
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
    procedureId: string,
    rawIfMatch: string | undefined,
    request: EventContext,
  ): Promise<void> {
    const tables = procedureTables(tx);
    const locked = await lockProcedure(tables, order.id, procedureId, 'active');
    if (locked === undefined) throw new ProblemException('not_found');
    const expectedVersion = parseIfMatch(rawIfMatch);
    if (order.closed) throw new ProblemException('work_order_closed');
    if (locked.version !== expectedVersion) throw new ProblemException('version_conflict');

    await softDeleteProcedure(tables, order.id, procedureId, expectedVersion, principal.userId, this.#clock.now());
    await moveProcedures(tables, order.id, movesToClose(await activeProcedurePlaces(tables, order.id)));
    await publishManualChange(
      this.#events,
      tx,
      principal,
      { object: 'procedure', action: 'deleted', objectId: procedureId, workOrderId: order.id, procedureCode: locked.code },
      request,
    );
  }
}
