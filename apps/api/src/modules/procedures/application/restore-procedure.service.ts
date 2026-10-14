/**
 * The restoration of a deleted process (EVM-042 AC3, AC4, AC5, AC6, AC7; SR-API-05, SR-API-06, SR-API-07, SR-AUTHZ-02, SR-AUTHZ-05,
 * SR-LOG-03, ASVS V2.3.3, CWE-639). The guard has decided before this runs: a signed-in ADMINISTRATOR on the web channel with a valid
 * CSRF token — the Editor and Read-only get 403 and an anonymous caller 401 without reaching the headers. There is no step-up: the
 * restoration of an order is the one with it (policies.md → P5), the Administrator's choice here is as reversible as the deletion.
 *
 * ONE transaction, and every decision in it is taken on rows LOCKED, never on an earlier read:
 *   1. the ORDER is locked (the read policy is in that query): missing or soft deleted is `404 not_found`, the same for every role;
 *   2. the idempotency port (when there is a key), BEFORE the process is looked for: a repeat answers `200` with the process as it
 *      is NOW (read again with the policy of the moment). The key is bound to the ORDER and the PROCESS;
 *   3. the PROCESS is locked with `id AND work_order_id AND deleted_at is not null` in ONE condition: a process of another order, one
 *      that does not exist and one that is not deleted are the same `404 not_found` (IDOR), BEFORE `If-Match`;
 *   4. `If-Match` (`428` / `400`); a closed order (settled or cancelled, PO-8) is `409 work_order_closed`, before the version;
 *   5. the version of the PROCESS (`412 version_conflict`, no current values);
 *   6. a code that is active in the order again is `409 procedure_already_active` (no name in the answer); the limit of 30 processes
 *      (`422 limit_exceeded`) — checked under the lock of the order, like the addition;
 *   7. the process returns to its remembered place (cut to the end of the list; the others make room), with its stages as they were,
 *      the audit record (`procedure.restored`) and the entry of the journal (the code), the idempotency record. An error anywhere
 *      rolls the whole command back.
 */
import { zRestoreWorkOrderProcedureHeaders, zRestoreWorkOrderProcedurePath } from '@evia/contracts/zod';
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
import { MAX_PROCEDURES_PER_ORDER } from '../domain/stage-rules.ts';
import { activeProcedurePlaces, lockProcedure, moveProcedures, restoreProcedure } from '../infrastructure/manual-store.ts';
import { procedureTables } from '../infrastructure/tables.ts';
import { limitExceeded, presentProcedure, publishManualChange, type VersionedProcedure } from './manual-shared.ts';
import { runInTransaction } from '../../../platform/database/transactional.ts';

/** Method and route template; the key of an idempotency record is bound to it AND to the order and the process (see {@link restoreProcedureScope}). */
export const RESTORE_PROCEDURE_SCOPE = 'POST /api/v1/work-orders/{workOrderId}/procedures/{procedureId}/restore';

/**
 * What an idempotency key is bound to besides the user: the method, the route, THE ORDER and THE PROCESS. A restoration has no body,
 * so a scope of the route alone would let the key of one process "replay" the restoration of another (ASVS V2.3.1, SR-API-05, CWE-841).
 */
export const restoreProcedureScope = (workOrderId: string, procedureId: string): string =>
  RESTORE_PROCEDURE_SCOPE.replace('{workOrderId}', workOrderId).replace('{procedureId}', procedureId);

const pathSchema = strictObjects(zRestoreWorkOrderProcedurePath);
const idempotencyKeySchema = zRestoreWorkOrderProcedureHeaders.shape['Idempotency-Key'];

export interface RestoredProcedure {
  readonly procedure: VersionedProcedure;
  /** True when the answer repeats an earlier restoration (same key, order and process): `Idempotent-Replayed: true`. */
  readonly replayed: boolean;
}

@Injectable()
export class RestoreProcedureService {
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
  ): Promise<RestoredProcedure> {
    const { workOrderId, procedureId } = parseInput(pathSchema, rawParams) as { workOrderId: string; procedureId: string };
    const key = rawKey === undefined ? undefined : (parseInput(idempotencyKeySchema, rawKey) as string);
    const request = { ...context, sessionId: principal.sessionId };

    return runInTransaction(this.#db, async (tx) => {
      const order = await this.#orders.lockVisible(tx, principal, workOrderId);
      if (order === undefined) throw new ProblemException('not_found');

      const perform = async () => {
        await this.#bringBack(tx, principal, order, procedureId, rawIfMatch, request);
        return { value: undefined, result: { status: 200, code: 'restored', resourceId: procedureId } };
      };
      const replayed =
        key === undefined
          ? (await perform(), false)
          : (
              await this.#idempotency.run(
                tx,
                {
                  userId: principal.userId,
                  deviceId: null,
                  key,
                  scope: restoreProcedureScope(order.id, procedureId),
                  bodyHash: requestHash(null),
                },
                perform,
              )
            ).replayed;

      const deps = { users: this.#users, parties: this.#parties, clock: this.#clock };
      return { procedure: await presentProcedure(deps, tx, principal, order.id, procedureId), replayed };
    });
  }

  /** Steps 3–7 of the order described above, on the locked rows. */
  async #bringBack(
    tx: Kysely<Database>,
    principal: Principal,
    order: WorkOrderRef,
    procedureId: string,
    rawIfMatch: string | undefined,
    request: EventContext,
  ): Promise<void> {
    const tables = procedureTables(tx);
    const locked = await lockProcedure(tables, order.id, procedureId, 'deleted');
    if (locked === undefined) throw new ProblemException('not_found');
    const expectedVersion = parseIfMatch(rawIfMatch);
    if (order.closed) throw new ProblemException('work_order_closed');
    if (locked.version !== expectedVersion) throw new ProblemException('version_conflict');

    const active = await activeProcedurePlaces(tables, order.id);
    if (active.some((procedure) => procedure.code === locked.code)) throw new ProblemException('procedure_already_active');
    if (active.length >= MAX_PROCEDURES_PER_ORDER) throw limitExceeded('too_many_procedures');

    const at = insertionPoint(locked.position, active.length);
    await moveProcedures(tables, order.id, movesToOpen(active, at));
    await restoreProcedure(tables, order.id, procedureId, at, expectedVersion, principal.userId, this.#clock.now());
    await publishManualChange(
      this.#events,
      tx,
      principal,
      { object: 'procedure', action: 'restored', objectId: procedureId, workOrderId: order.id, procedureCode: locked.code },
      request,
    );
  }
}
