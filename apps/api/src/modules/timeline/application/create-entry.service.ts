/**
 * Creation of an entry, a comment or a correction (EVM-037 AC1–AC5, AC7, AC8; SR-AUTHZ-02, SR-AUTHZ-04, SR-AUTHZ-05, SR-INPUT-01,
 * SR-INPUT-05, SR-API-05, SR-DATA-02, SR-LOG-02, SR-LOG-03, ASVS V2.3.1, CWE-639, CWE-915). The guard has decided before this runs:
 * a signed-in Administrator or Editor on the web channel with a valid CSRF token — Read-only gets 403 and an anonymous caller 401
 * without reaching the headers, the body or the table of idempotency records.
 *
 * Order: the path (400) before the database is asked. Then ONE transaction:
 *   1. the ORDER through the facade of `work-orders` (the read policy is in that query): missing or soft deleted is `404
 *      not_found`, the same for every role, BEFORE the header and the body, so a malformed request tells a caller nothing about
 *      an order that is not theirs. A closed order (settled, cancelled) takes the entry — "nic nie ginie" (PO-8);
 *   2. the `Idempotency-Key` (required, UUIDv7) and the body against the strict schema of the contract (a field of the server —
 *      the author, the time, the origin — is `read_only_field`, a stranger `unknown_field`, `kind: event` is refused) and the
 *      rules of the entry (category, text): `400`, pointers and codes, never a value — the text may name a person;
 *   3. the idempotency port: a repeat of the same key, order and body returns the stored result BEFORE the checks below. The key
 *      is bound to the ORDER: the same key and body on another order is `422 idempotency_mismatch`;
 *   4. the stage, when one is named: a live stage of THIS order, locked `FOR SHARE` through the facade of `procedures`; another
 *      order's, a missing and a deleted stage are the ONE answer `400` (`/procedureStageId`, `unknown_stage`);
 *   5. the entry to correct, when one is named: locked `FOR UPDATE` with `id AND work_order_id` in one condition; another order's,
 *      a missing, a deleted one and an event are the ONE answer `400` (`/supersedesEntryId`, `unknown_entry`); one that has a
 *      correction already is `409 entry_superseded`; a correction has the kind of the entry it corrects;
 *   6. the INSERT (an existing `id` is `409 id_conflict`, the content is never compared; a violation of a constraint — the race of
 *      two corrections — is a mapped `409`, never a `500` with the name of a constraint), the event `timeline_entry.created` for
 *      the audit trail (the actor and the entry — no text, no category, no stage), the idempotency record (the identifier of the
 *      entry only). An error anywhere rolls the whole command back.
 * The answer is the entry as it is NOW, read again with the read policy and the order of the URL — also for a repeat.
 */
import { zCreateTimelineEntryHeaders, zCreateTimelineEntryPath, zCreateTimelineEntryRequest, zTimelineEntry } from '@evia/contracts/zod';
import type { TimelineEntry } from '@evia/contracts';
import { Inject, Injectable } from '@nestjs/common';
import type { Kysely } from 'kysely';
import { z } from 'zod';
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
import { PROCEDURE_STAGE_DIRECTORY, type ProcedureStageDirectory } from '../../procedures/index.ts';
import { WORK_ORDER_DIRECTORY, type WorkOrderDirectory } from '../../work-orders/index.ts';
import { resolveCreateEntry, type CreateEntryCommand, type CreateEntryInput } from '../domain/create-entry-rules.ts';
import { rethrowMapped } from '../domain/integrity-violation.ts';
import type { TimelineEntryEvent } from '../events.ts';
import { timelineTables } from '../infrastructure/tables.ts';
import { findEntry, hasCorrection, insertEntry, lockCorrectable, type EntryRow } from '../infrastructure/timeline-store.ts';
import { presentEntry } from './entry-page.ts';

/** Method and route template; the key of an idempotency record is bound to it AND to the order (see {@link createTimelineEntryScope}). */
export const CREATE_TIMELINE_ENTRY_SCOPE = 'POST /api/v1/work-orders/{workOrderId}/timeline';

/**
 * What an idempotency key is bound to besides the user: the method, the route and THE ORDER. The body of an entry says nothing of
 * the order, so a scope of the route alone would let the key and the body of one order replay the result of an entry of ANOTHER
 * order (ASVS V2.3.1, SR-API-05, AB-09, CWE-639, CWE-841).
 */
export const createTimelineEntryScope = (workOrderId: string): string => CREATE_TIMELINE_ENTRY_SCOPE.replace('{workOrderId}', workOrderId);

const pathSchema = strictObjects(zCreateTimelineEntryPath);
/**
 * The text is measured by the rules of the domain (`entry-body.ts`) in code points AFTER normalisation, so the schema here only
 * says it is a string: `maxLength` of the contract counts UTF-16 units and would refuse a long text of astral characters.
 */
const createBody = strictObjects(zCreateTimelineEntryRequest.extend({ body: z.string() }));
const idempotencyKeySchema = zCreateTimelineEntryHeaders.shape['Idempotency-Key'];
/** The fields of the server that a request names in vain: the keys of the entry the request lacks, and the columns no answer carries. */
const SERVER_FIELDS: ReadonlySet<string> = new Set([
  ...readOnlyKeys(zTimelineEntry, zCreateTimelineEntryRequest),
  'workOrderId',
  'version',
  'createdBy',
  'redactedBy',
  'deletedAt',
  'deletedBy',
]);

export interface CreatedEntry {
  readonly entry: TimelineEntry;
  /** True when the answer repeats an earlier command (same key, order and body): `Idempotent-Replayed: true`. */
  readonly replayed: boolean;
}

@Injectable()
export class CreateEntryService {
  readonly #db: Kysely<Database>;
  readonly #clock: Clock;
  readonly #events: EventBus;
  readonly #idempotency: Idempotency;
  readonly #orders: WorkOrderDirectory;
  readonly #stages: ProcedureStageDirectory;
  readonly #users: UserDirectory;

  constructor(
    @Inject(DATABASE) db: Kysely<Database>,
    @Inject(CLOCK) clock: Clock,
    @Inject(EVENT_BUS) events: EventBus,
    @Inject(IDEMPOTENCY) idempotency: Idempotency,
    @Inject(WORK_ORDER_DIRECTORY) orders: WorkOrderDirectory,
    @Inject(PROCEDURE_STAGE_DIRECTORY) stages: ProcedureStageDirectory,
    @Inject(UserDirectory) users: UserDirectory,
  ) {
    this.#db = db;
    this.#clock = clock;
    this.#events = events;
    this.#idempotency = idempotency;
    this.#orders = orders;
    this.#stages = stages;
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
  ): Promise<CreatedEntry> {
    const { workOrderId } = parseInput(pathSchema, rawParams) as { workOrderId: string };
    const request = { ...context, sessionId: principal.sessionId };

    return this.#db
      .transaction()
      .execute(async (tx) => {
        const order = await this.#orders.findVisible(tx, principal, workOrderId);
        if (order === undefined) throw new ProblemException('not_found');
        const key = this.#keyOf(rawKey);
        const input = parseInput(createBody, rawBody, SERVER_FIELDS) as CreateEntryInput;
        const resolved = resolveCreateEntry(input);
        if (!resolved.ok) throw new ProblemException('validation_failed', { errors: resolved.errors });
        const command = resolved.command;

        const perform = async () => {
          await this.#insert(tx, principal, order.id, command, request);
          return { value: undefined, result: { status: 201, code: 'created', resourceId: command.id } };
        };
        const outcome = await this.#idempotency.run(
          tx,
          { userId: principal.userId, deviceId: null, key, scope: createTimelineEntryScope(order.id), bodyHash: requestHash(input) },
          perform,
        );
        // the answer is read again with the order of the URL in the condition — a repeat never names an entry of another order
        // (the hash of a repeat includes `id`, so the entry of a repeat is the entry of this command)
        const row = await findEntry(timelineTables(tx), order.id, command.id);
        if (row === undefined) throw new ProblemException('not_found');
        return { entry: await this.#present(tx, order.id, row), replayed: outcome.replayed };
      })
      .catch(rethrowMapped);
  }

  /** @throws ProblemException `validation_failed` — the header is required and is a UUIDv7 (`/headers/Idempotency-Key`) */
  #keyOf(rawKey: string | undefined): string {
    const pointer = '/headers/Idempotency-Key';
    if (rawKey === undefined) throw new ProblemException('validation_failed', { errors: [{ pointer, code: 'required' }] });
    const parsed = idempotencyKeySchema.safeParse(rawKey);
    if (!parsed.success) throw new ProblemException('validation_failed', { errors: [{ pointer, code: 'invalid_format' }] });
    return parsed.data;
  }

  /** Steps 4–6 of the order described above, in the transaction of the command. */
  async #insert(
    tx: Kysely<Database>,
    principal: Principal,
    workOrderId: string,
    command: CreateEntryCommand,
    request: EventContext,
  ): Promise<void> {
    const tables = timelineTables(tx);
    let stageId = command.procedureStageId ?? null;
    if (stageId !== null && !(await this.#stages.existsInOrder(tx, workOrderId, stageId, { lock: true }))) {
      throw new ProblemException('validation_failed', { errors: [{ pointer: '/procedureStageId', code: 'unknown_stage' }] });
    }

    if (command.supersedesEntryId !== null) {
      const target = await lockCorrectable(tables, workOrderId, command.supersedesEntryId);
      if (target === undefined) {
        throw new ProblemException('validation_failed', { errors: [{ pointer: '/supersedesEntryId', code: 'unknown_entry' }] });
      }
      if (target.kind !== command.kind) {
        throw new ProblemException('validation_failed', { errors: [{ pointer: '/kind', code: 'invalid_value' }] });
      }
      if (await hasCorrection(tables, workOrderId, target.id)) throw new ProblemException('entry_superseded');
      // a correction keeps the stage of the entry it corrects unless the request says another one (`null`: none)
      if (command.procedureStageId === undefined) stageId = target.procedure_stage_id;
    }

    const row = await this.#write(tables, principal, workOrderId, command, stageId);
    if (row === undefined) throw new ProblemException('id_conflict');
    const event: TimelineEntryEvent = {
      type: 'timeline_entry.created',
      actor: { type: 'user', userId: principal.userId },
      outcome: 'success',
      objectType: 'timeline_entry',
      objectId: row.id,
    };
    await this.#events.publish(tx, event, request);
  }

  async #write(
    tables: ReturnType<typeof timelineTables>,
    principal: Principal,
    workOrderId: string,
    command: CreateEntryCommand,
    stageId: string | null,
  ) {
    return insertEntry(
      tables,
      {
        id: command.id,
        workOrderId,
        kind: command.kind,
        noteCategory: command.noteCategory,
        body: command.body,
        procedureStageId: stageId,
        supersedesEntryId: command.supersedesEntryId,
        authorUserId: principal.userId,
      },
      this.#clock.now(),
    );
  }

  #present(tx: Kysely<Database>, workOrderId: string, row: EntryRow): Promise<TimelineEntry> {
    return presentEntry({ users: this.#users, stages: this.#stages }, tx, workOrderId, row);
  }
}
