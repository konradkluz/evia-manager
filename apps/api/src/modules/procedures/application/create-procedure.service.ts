/**
 * The addition of a process to a work order by hand (EVM-042 AC1, AC4, AC5, AC6; SR-API-02, SR-API-05, SR-API-06, SR-AUTHZ-02,
 * SR-AUTHZ-04, SR-AUTHZ-05, SR-INPUT-01, SR-INPUT-02, SR-LOG-03, ASVS V2.3.1, V2.3.3, CWE-639, CWE-915). The guard has decided
 * before this runs: a signed-in Administrator or Editor on the web channel with a valid CSRF token — Read-only gets 403 and an
 * anonymous caller 401 without reaching the headers or the body.
 *
 * ONE transaction on the order LOCKED (`SELECT … FOR NO KEY UPDATE`, the read policy is in that query), so the code, the limit and the
 * closing are decided on rows no other command can change (two additions of the same code: exactly one wins). The order:
 *   1. the order is locked: missing or soft deleted is `404 not_found`, the same for every role, BEFORE the body;
 *   2. the body against the strict schema of the contract (a field of the server — `code`, `name`, `stages` … — is `read_only_field`,
 *      a stranger `unknown_field`): `400`, pointers and codes, never values;
 *   3. the idempotency port (when there is a key): a repeat of the same key, order and body returns the stored result BEFORE the
 *      checks below. The key is bound to the ORDER: the same key and body on another order is `422 idempotency_mismatch`;
 *   4. a closed order (settled or cancelled, PO-8) is `409 work_order_closed`;
 *   5. the template through the facade of `catalog`: an active one by its stable code (missing and retired are the ONE answer
 *      `422 template_unavailable`);
 *   6. a code already active in the order is `409 procedure_already_active` (the answer has no name); then the limit of 30
 *      processes (`422 limit_exceeded`; a template with more than 30 stages too);
 *   7. the place: the others make room (one UPDATE per row, the last first), then the INSERT of the process with the identifier of the
 *      client (an existing `id` — also of a process of ANOTHER order — is `409 id_conflict`, nothing is overwritten) and its stages,
 *      every one `todo`; the audit record (an action of its own) and the entry of the journal (the code of the process), the
 *      idempotency record. An error anywhere rolls the whole command back.
 * The answer is the process as it is NOW, read again with `id AND work_order_id AND deleted_at is null` (a repeat of a process that
 * was deleted since is `404`).
 */
import { zCreateProcedureRequest, zCreateWorkOrderProcedureHeaders, zCreateWorkOrderProcedurePath, zProcedure } from '@evia/contracts/zod';
import { Inject, Injectable } from '@nestjs/common';
import type { Kysely } from 'kysely';
import type { Clock } from '../../../platform/clock/clock.ts';
import type { Database } from '../../../platform/database/database.ts';
import type { EventBus, EventContext } from '../../../platform/events/event-bus.ts';
import type { Principal } from '../../../platform/http/principal.ts';
import { ProblemException } from '../../../platform/http/problem.ts';
import { parseInput, readOnlyKeys, strictObjects } from '../../../platform/http/validation.ts';
import { requestHash } from '../../../platform/idempotency/canonical-json.ts';
import { IDEMPOTENCY, type Idempotency } from '../../../platform/idempotency/idempotency.ts';
import { CLOCK, DATABASE, EVENT_BUS } from '../../../platform/tokens.ts';
import { TEMPLATE_DIRECTORY, type TemplateDirectory } from '../../catalog/index.ts';
import { UserDirectory } from '../../identity/index.ts';
import { PARTY_DIRECTORY, type PartyDirectory } from '../../parties/index.ts';
import { WORK_ORDER_DIRECTORY, type WorkOrderDirectory, type WorkOrderRef } from '../../work-orders/index.ts';
import { CompositionLimitError, planProcedureCopy } from '../domain/composition-plan.ts';
import { insertionPoint, movesToOpen } from '../domain/ordering.ts';
import { MAX_PROCEDURES_PER_ORDER } from '../domain/stage-rules.ts';
import { activeProcedurePlaces, insertProcedureWithId, moveProcedures } from '../infrastructure/manual-store.ts';
import { insertStages } from '../infrastructure/procedure-store.ts';
import { procedureTables } from '../infrastructure/tables.ts';
import { limitExceeded, presentProcedure, publishManualChange, type VersionedProcedure } from './manual-shared.ts';
import { runInTransaction } from '../../../platform/database/transactional.ts';

/** Method and route template; the key of an idempotency record is bound to it AND to the order (see {@link createProcedureScope}). */
export const CREATE_PROCEDURE_SCOPE = 'POST /api/v1/work-orders/{workOrderId}/procedures';

/**
 * What an idempotency key is bound to besides the user: the method, the route and THE ORDER. The body of an addition says nothing of
 * the order, so a scope of the route alone would let the key and the body of one order replay the result in ANOTHER order
 * (ASVS V2.3.1, SR-API-05, CWE-639, CWE-841).
 */
export const createProcedureScope = (workOrderId: string): string => CREATE_PROCEDURE_SCOPE.replace('{workOrderId}', workOrderId);

const pathSchema = strictObjects(zCreateWorkOrderProcedurePath);
const createBody = strictObjects(zCreateProcedureRequest);
const idempotencyKeySchema = zCreateWorkOrderProcedureHeaders.shape['Idempotency-Key'];
/** The fields of the server that a request names in vain: the keys of the process that the request lacks, and the columns no answer carries. */
const SERVER_FIELDS: ReadonlySet<string> = new Set([
  ...readOnlyKeys(zProcedure, zCreateProcedureRequest),
  'workOrderId',
  'sourceProcedureTemplateId',
  'createdBy',
  'updatedAt',
  'updatedBy',
  'deletedAt',
  'deletedBy',
]);

interface CreateInput {
  readonly id: string;
  readonly procedureTemplateCode: string;
  readonly position?: number | undefined;
}

export interface CreatedProcedure {
  readonly procedure: VersionedProcedure;
  /** True when the answer repeats an earlier addition (same key, order and body): `Idempotent-Replayed: true`. */
  readonly replayed: boolean;
}

@Injectable()
export class CreateProcedureService {
  readonly #db: Kysely<Database>;
  readonly #clock: Clock;
  readonly #events: EventBus;
  readonly #idempotency: Idempotency;
  readonly #orders: WorkOrderDirectory;
  readonly #templates: TemplateDirectory;
  readonly #parties: PartyDirectory;
  readonly #users: UserDirectory;

  constructor(
    @Inject(DATABASE) db: Kysely<Database>,
    @Inject(CLOCK) clock: Clock,
    @Inject(EVENT_BUS) events: EventBus,
    @Inject(IDEMPOTENCY) idempotency: Idempotency,
    @Inject(WORK_ORDER_DIRECTORY) orders: WorkOrderDirectory,
    @Inject(TEMPLATE_DIRECTORY) templates: TemplateDirectory,
    @Inject(PARTY_DIRECTORY) parties: PartyDirectory,
    @Inject(UserDirectory) users: UserDirectory,
  ) {
    this.#db = db;
    this.#clock = clock;
    this.#events = events;
    this.#idempotency = idempotency;
    this.#orders = orders;
    this.#templates = templates;
    this.#parties = parties;
    this.#users = users;
  }

  /**
   * @param rawParams the path parameters as parsed by the framework
   * @param rawKey the `Idempotency-Key` header as received (`undefined` when absent)
   */
  async create(
    principal: Principal,
    rawParams: unknown,
    rawBody: unknown,
    rawKey: string | undefined,
    context: EventContext,
  ): Promise<CreatedProcedure> {
    const { workOrderId } = parseInput(pathSchema, rawParams) as { workOrderId: string };
    const key = rawKey === undefined ? undefined : (parseInput(idempotencyKeySchema, rawKey) as string);
    const request = { ...context, sessionId: principal.sessionId };

    return runInTransaction(this.#db, async (tx) => {
      const order = await this.#orders.lockVisible(tx, principal, workOrderId);
      if (order === undefined) throw new ProblemException('not_found');
      const input = parseInput(createBody, rawBody, SERVER_FIELDS) as CreateInput;

      const perform = async () => {
        await this.#add(tx, principal, order, input, request);
        return { value: undefined, result: { status: 201, code: 'created', resourceId: input.id } };
      };
      const replayed =
        key === undefined
          ? (await perform(), false)
          : (
              await this.#idempotency.run(
                tx,
                { userId: principal.userId, deviceId: null, key, scope: createProcedureScope(order.id), bodyHash: requestHash(input) },
                perform,
              )
            ).replayed;

      const deps = { users: this.#users, parties: this.#parties, clock: this.#clock };
      return { procedure: await presentProcedure(deps, tx, principal, order.id, input.id), replayed };
    });
  }

  /** Steps 4–7 of the order described above, in the transaction of the command. */
  async #add(tx: Kysely<Database>, principal: Principal, order: WorkOrderRef, input: CreateInput, request: EventContext): Promise<void> {
    if (order.closed) throw new ProblemException('work_order_closed');
    const template = await this.#templates.findActiveProcedureForCopy(tx, input.procedureTemplateCode);
    if (template === undefined) throw new ProblemException('template_unavailable');

    const tables = procedureTables(tx);
    const active = await activeProcedurePlaces(tables, order.id);
    if (active.some((procedure) => procedure.code === template.code)) throw new ProblemException('procedure_already_active');
    if (active.length >= MAX_PROCEDURES_PER_ORDER) throw limitExceeded('too_many_procedures');

    const at = insertionPoint(input.position, active.length);
    let planned;
    try {
      planned = planProcedureCopy(template, at);
    } catch (error) {
      if (error instanceof CompositionLimitError) throw limitExceeded(error.reason);
      throw error;
    }

    const now = this.#clock.now();
    await moveProcedures(tables, order.id, movesToOpen(active, at));
    if (!(await insertProcedureWithId(tables, input.id, order.id, planned, principal.userId, now))) {
      throw new ProblemException('id_conflict');
    }
    await insertStages(tables, order.id, [planned], principal.userId, now);

    await publishManualChange(
      this.#events,
      tx,
      principal,
      { object: 'procedure', action: 'created', objectId: input.id, workOrderId: order.id, procedureCode: planned.code },
      request,
    );
  }
}
