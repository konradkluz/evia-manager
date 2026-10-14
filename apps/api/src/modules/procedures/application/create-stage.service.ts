/**
 * The addition of a stage to a process by hand (EVM-042 AC2, AC4, AC5, AC6; SR-API-02, SR-API-05, SR-API-06, SR-AUTHZ-02,
 * SR-AUTHZ-04, SR-AUTHZ-05, SR-INPUT-01, SR-INPUT-02, SR-INPUT-05, SR-LOG-03, ASVS V2.3.1, V2.3.3, CWE-639, CWE-915). The guard has
 * decided before this runs: a signed-in Administrator or Editor on the web channel with a valid CSRF token — Read-only gets 403 and
 * an anonymous caller 401 without reaching the headers or the body.
 *
 * ONE transaction on the order LOCKED (`SELECT … FOR NO KEY UPDATE`), so the limit and the closing are decided on rows no other
 * command can change (two additions at 29 stages: exactly one wins). The order:
 *   1. the order is locked: missing or soft deleted is `404 not_found`, the same for every role;
 *   2. the PROCESS is locked with `id AND work_order_id AND deleted_at is null` in ONE condition: a process of another order, one that
 *      does not exist and a deleted one are the same `404 not_found`, BEFORE the body (a malformed request tells a caller nothing
 *      about an object that is not theirs);
 *   3. the body against the strict schema of the contract (a field of the server — `code`, `status`, `version` … — is
 *      `read_only_field`, a stranger `unknown_field`), then the rules the schema cannot state: the name is plain text (NFC, trimmed,
 *      no control characters, 1–120) and the day is a business day — `400`, pointers and codes, NEVER the name: it is free text
 *      that may name a person;
 *   4. the idempotency port (when there is a key): a repeat of the same key, process and body returns the stored result BEFORE the
 *      checks below. The key is bound to the ORDER and the PROCESS;
 *   5. a closed order (settled or cancelled, PO-8) is `409 work_order_closed`;
 *   6. the person responsible: an active user (the ONE answer `400` `/responsibleUserId` `assignee_unavailable` for every other state
 *      of an account); the limit of 30 stages (`422 limit_exceeded`);
 *   7. the place: the others make room, then the INSERT of the stage `todo` with the identifier of the client (an existing `id` is
 *      `409 id_conflict`) and a code the SERVER makes (`custom_` + random), the version of the process rises (its make-up changed), the
 *      audit record and the entry of the journal (identifiers and the code of the process — no name), the idempotency record. An error
 *      anywhere rolls the whole command back.
 * The answer is the stage as it is NOW (a repeat of a stage that was deleted since is `404`).
 */
import {
  zCreateProcedureStageHeaders,
  zCreateProcedureStagePath,
  zCreateProcedureStageRequest,
  zProcedureStage,
} from '@evia/contracts/zod';
import type { ProcedureStage } from '@evia/contracts';
import { Inject, Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
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
import { UserDirectory } from '../../identity/index.ts';
import { PARTY_DIRECTORY, type PartyDirectory } from '../../parties/index.ts';
import { WORK_ORDER_DIRECTORY, type WorkOrderDirectory, type WorkOrderRef } from '../../work-orders/index.ts';
import { manualStageCode, normalizeStageName } from '../domain/manual-stage.ts';
import { insertionPoint, movesToOpen } from '../domain/ordering.ts';
import { DUE_DATE_MAX, DUE_DATE_MIN } from '../domain/stage-patch.ts';
import { MAX_STAGES_PER_PROCEDURE } from '../domain/stage-rules.ts';
import { activeStagePlaces, bumpProcedureVersion, insertManualStage, lockProcedure, moveStages } from '../infrastructure/manual-store.ts';
import { procedureTables } from '../infrastructure/tables.ts';
import { limitExceeded, publishManualChange } from './manual-shared.ts';
import { HIDDEN_STAGE_COLUMNS, presentStage } from './stage-answer.ts';
import { runInTransaction } from '../../../platform/database/transactional.ts';

/** Method and route template; the key of an idempotency record is bound to it AND to the order and the process (see {@link createStageScope}). */
export const CREATE_STAGE_SCOPE = 'POST /api/v1/work-orders/{workOrderId}/procedures/{procedureId}/stages';

/**
 * What an idempotency key is bound to besides the user: the method, the route, THE ORDER and THE PROCESS. The body of an addition says
 * nothing of the process, so a scope of the route alone would let the key and the body of one process replay the result in ANOTHER
 * one (ASVS V2.3.1, SR-API-05, CWE-639, CWE-841).
 */
export const createStageScope = (workOrderId: string, procedureId: string): string =>
  CREATE_STAGE_SCOPE.replace('{workOrderId}', workOrderId).replace('{procedureId}', procedureId);

const pathSchema = strictObjects(zCreateProcedureStagePath);
const createBody = strictObjects(zCreateProcedureStageRequest);
const idempotencyKeySchema = zCreateProcedureStageHeaders.shape['Idempotency-Key'];
/** The fields of the server that a request names in vain: the keys of the stage that the request lacks, and the columns no answer carries. */
const SERVER_FIELDS: ReadonlySet<string> = new Set([
  ...readOnlyKeys(zProcedureStage, zCreateProcedureStageRequest),
  ...HIDDEN_STAGE_COLUMNS,
]);

interface CreateInput {
  readonly id: string;
  readonly name: string;
  readonly position?: number | undefined;
  readonly dueDate?: string | undefined;
  readonly responsibleUserId?: string | undefined;
}

export interface CreatedStage {
  readonly stage: ProcedureStage;
  /** True when the answer repeats an earlier addition (same key, process and body): `Idempotent-Replayed: true`. */
  readonly replayed: boolean;
}

interface Target {
  readonly order: WorkOrderRef;
  readonly procedureId: string;
  readonly procedureCode: string;
  readonly name: string;
}

@Injectable()
export class CreateStageService {
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
   * @param rawKey the `Idempotency-Key` header as received (`undefined` when absent)
   */
  async create(
    principal: Principal,
    rawParams: unknown,
    rawBody: unknown,
    rawKey: string | undefined,
    context: EventContext,
  ): Promise<CreatedStage> {
    const { workOrderId, procedureId } = parseInput(pathSchema, rawParams) as { workOrderId: string; procedureId: string };
    const key = rawKey === undefined ? undefined : (parseInput(idempotencyKeySchema, rawKey) as string);
    const request = { ...context, sessionId: principal.sessionId };

    return runInTransaction(this.#db, async (tx) => {
      const order = await this.#orders.lockVisible(tx, principal, workOrderId);
      if (order === undefined) throw new ProblemException('not_found');
      const procedure = await lockProcedure(procedureTables(tx), order.id, procedureId, 'active');
      if (procedure === undefined) throw new ProblemException('not_found');

      const input = parseInput(createBody, rawBody, SERVER_FIELDS) as CreateInput;
      const name = normalizeStageName(input.name);
      if (!name.ok) throw new ProblemException('validation_failed', { errors: name.errors });
      if (input.dueDate !== undefined && (input.dueDate < DUE_DATE_MIN || input.dueDate > DUE_DATE_MAX)) {
        throw new ProblemException('validation_failed', { errors: [{ pointer: '/dueDate', code: 'out_of_range' }] });
      }

      const target: Target = { order, procedureId, procedureCode: procedure.code, name: name.name };
      const perform = async () => {
        await this.#add(tx, principal, target, input, request);
        return { value: undefined, result: { status: 201, code: 'created', resourceId: input.id } };
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
                  scope: createStageScope(order.id, procedureId),
                  bodyHash: requestHash(input),
                },
                perform,
              )
            ).replayed;

      // the stage is read again with the order of the URL in the condition — a repeat never names a stage of another order
      const deps = { users: this.#users, parties: this.#parties, clock: this.#clock };
      return { stage: await presentStage(deps, tx, principal, order.id, input.id), replayed };
    });
  }

  /** Steps 5–7 of the order described above, in the transaction of the command. */
  async #add(tx: Kysely<Database>, principal: Principal, target: Target, input: CreateInput, request: EventContext): Promise<void> {
    if (target.order.closed) throw new ProblemException('work_order_closed');
    await this.#requireActiveUser(tx, input.responsibleUserId);

    const tables = procedureTables(tx);
    const places = await activeStagePlaces(tables, target.order.id, target.procedureId);
    if (places.length >= MAX_STAGES_PER_PROCEDURE) throw limitExceeded('too_many_stages');

    const at = insertionPoint(input.position, places.length);
    const now = this.#clock.now();
    await moveStages(tables, target.order.id, target.procedureId, movesToOpen(places, at));
    const inserted = await insertManualStage(
      tables,
      {
        id: input.id,
        procedureId: target.procedureId,
        workOrderId: target.order.id,
        code: manualStageCode(randomBytes(6).toString('hex')),
        name: target.name,
        position: at,
        dueDate: input.dueDate ?? null,
        responsibleUserId: input.responsibleUserId ?? null,
      },
      principal.userId,
      now,
    );
    if (!inserted) throw new ProblemException('id_conflict');
    await bumpProcedureVersion(tables, target.order.id, target.procedureId, principal.userId, now);

    await publishManualChange(
      this.#events,
      tx,
      principal,
      {
        object: 'procedure_stage',
        action: 'created',
        objectId: input.id,
        workOrderId: target.order.id,
        procedureCode: target.procedureCode,
      },
      request,
    );
  }

  /** `undefined` names no one; a named user must be ACTIVE — the one answer for every other state of an account. */
  async #requireActiveUser(tx: Kysely<Database>, userId: string | undefined): Promise<void> {
    if (userId === undefined) return;
    if ((await this.#users.findActive(userId, tx)) === undefined) {
      throw new ProblemException('validation_failed', { errors: [{ pointer: '/responsibleUserId', code: 'assignee_unavailable' }] });
    }
  }
}
