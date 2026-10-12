/**
 * The addition of an item of the catalogue to the scope of a work order, with the processes it brings (EVM-035 AC2, AC4, AC5, AC6,
 * AC7, AC8; SR-API-02, SR-API-05, SR-API-06, SR-AUTHZ-02, SR-AUTHZ-04, SR-AUTHZ-05, SR-INPUT-01, SR-INPUT-02, SR-INPUT-05,
 * SR-DATA-02, SR-LOG-02, SR-LOG-03, ASVS V2.3.1, V2.3.3, CWE-639, CWE-915). The guard has decided before this runs: a signed-in
 * Administrator or Editor on the web channel with a valid CSRF token — Read-only gets 403 and an anonymous caller 401 without
 * reaching the headers, the body or the table of idempotency records.
 *
 * ONE transaction on the order LOCKED with `SELECT … FOR UPDATE` (the read policy is in that query), so the limit and the closing
 * are decided on rows no other transaction can change (two additions at 49 items: exactly one wins). The order:
 *   1. the order is locked: missing or soft deleted is `404 not_found`, the same for every role, BEFORE the headers and the body;
 *   2. the body against the strict schema of the contract (a field of the server — `code`, `name`, `position`, `version` … — is
 *      `read_only_field`, a stranger `unknown_field`): `400`, pointers and codes, never values;
 *   3. the idempotency port (when there is a key): a repeat of the same key, order and body returns the stored result BEFORE the
 *      checks below. The key is bound to the ORDER: the same key and body on another order is `422 idempotency_mismatch`;
 *   4. a closed order (settled or cancelled, PO-8) is `409 work_order_closed`;
 *   5. the item of the catalogue by its code: an active one (missing and retired are the ONE answer `400` `/catalogItemCode`,
 *      `unknown_catalog_item`); the parameters against the set of THAT item (never a set named by the client), the notes (plain
 *      text; the description of a "Inna usługa" is required), the processes the item brings (`400`, `/procedureCodes/N`,
 *      `not_brought_by_item`, a code twice is `duplicate`) — these rules need the item, so they come after the closing;
 *   6. the limit: 50 active items (`422 limit_exceeded`, a pointer and a code);
 *   7. the INSERT at the end of the scope (an existing `id` — also of an item of ANOTHER order — is `409 id_conflict`, the content is
 *      never compared, nothing is overwritten), the processes through the port of the scope (the same transaction; a code already
 *      active in the order is skipped; more than 30 processes is `422 limit_exceeded`), the event `scope_item.created` for the
 *      audit trail (the actor and the item — no name, no parameter, no note), the event of the JOURNAL (EVM-038: the code of the
 *      item and the codes of the processes), the idempotency record. An error anywhere rolls the whole command back.
 * The answer is the item as it is NOW with the codes of the processes it brought (a repeat names the same ones).
 */
import { zCreateScopeItemRequest, zCreateWorkOrderScopeItemHeaders, zCreateWorkOrderScopeItemPath, zScopeItem } from '@evia/contracts/zod';
import type { ScopeItemAddition } from '@evia/contracts';
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
import { CATALOG_ITEM_DIRECTORY, parseParameters, type CatalogItemDirectory } from '../../catalog/index.ts';
import {
  CUSTOM_SERVICE_CODE,
  forbiddenParameterKeys,
  MAX_SCOPE_ITEMS,
  nextPosition,
  normalizeNotes,
  validateParameters,
  validateProcedureCodes,
} from '../domain/scope-item-rules.ts';
import { CLOSED_STATUSES } from '../domain/work-order-list-query.ts';
import type { ScopeItemAddedEvent, WorkOrderEvent } from '../events.ts';
import type { WorkOrderStatus } from '../domain/work-order-list-query.ts';
import { ScopeLimitError, WorkOrderScopeRegistry } from '../scope-participant.ts';
import { workOrderTables } from '../infrastructure/tables.ts';
import { findScopeItem, insertScopeItem, takenScopePositions } from '../infrastructure/work-order-edit-store.ts';
import { findVisibleWorkOrderRef } from '../infrastructure/work-order-store.ts';
import { toScopeItem } from './scope-item-representation.ts';

/** Method and route template; the key of an idempotency record is bound to it AND to the order (see {@link createScopeItemScope}). */
export const CREATE_SCOPE_ITEM_SCOPE = 'POST /api/v1/work-orders/{workOrderId}/scope-items';

/**
 * What an idempotency key is bound to besides the user: the method, the route and THE ORDER. The body of an addition says nothing of
 * the order, so a scope of the route alone would let the key and the body of one order replay the result of an item of ANOTHER
 * order (ASVS V2.3.1, SR-API-05, AB-09, CWE-639, CWE-841).
 */
export const createScopeItemScope = (workOrderId: string): string => CREATE_SCOPE_ITEM_SCOPE.replace('{workOrderId}', workOrderId);

const pathSchema = strictObjects(zCreateWorkOrderScopeItemPath);
const createBody = strictObjects(zCreateScopeItemRequest);
const idempotencyKeySchema = zCreateWorkOrderScopeItemHeaders.shape['Idempotency-Key'];
/** The fields of the server that a request names in vain: the keys of the item that the request lacks, and the columns no answer carries. */
const SERVER_FIELDS: ReadonlySet<string> = new Set([
  ...readOnlyKeys(zScopeItem, zCreateScopeItemRequest),
  'sourceCatalogItemId',
  'workOrderId',
  'createdBy',
  'updatedAt',
  'updatedBy',
  'deletedAt',
  'deletedBy',
]);

interface CreateInput {
  readonly id: string;
  readonly catalogItemCode: string;
  readonly parameters?: Readonly<Record<string, unknown>> | undefined;
  readonly notes?: string | undefined;
  readonly procedureCodes?: readonly string[] | undefined;
}

export interface CreatedScopeItem {
  readonly workOrderId: string;
  readonly addition: ScopeItemAddition;
  /** True when the answer repeats an earlier addition (same key, order and body): `Idempotent-Replayed: true`. */
  readonly replayed: boolean;
}

@Injectable()
export class CreateScopeItemService {
  readonly #db: Kysely<Database>;
  readonly #clock: Clock;
  readonly #events: EventBus;
  readonly #idempotency: Idempotency;
  readonly #catalog: CatalogItemDirectory;
  readonly #participants: WorkOrderScopeRegistry;

  constructor(
    @Inject(DATABASE) db: Kysely<Database>,
    @Inject(CLOCK) clock: Clock,
    @Inject(EVENT_BUS) events: EventBus,
    @Inject(IDEMPOTENCY) idempotency: Idempotency,
    @Inject(CATALOG_ITEM_DIRECTORY) catalog: CatalogItemDirectory,
    @Inject(WorkOrderScopeRegistry) participants: WorkOrderScopeRegistry,
  ) {
    this.#db = db;
    this.#clock = clock;
    this.#events = events;
    this.#idempotency = idempotency;
    this.#catalog = catalog;
    this.#participants = participants;
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
  ): Promise<CreatedScopeItem> {
    const { workOrderId } = parseInput(pathSchema, rawParams) as { workOrderId: string };
    const key = rawKey === undefined ? undefined : (parseInput(idempotencyKeySchema, rawKey) as string);
    const request = { ...context, sessionId: principal.sessionId };

    return this.#db.transaction().execute(async (tx) => {
      const order = await findVisibleWorkOrderRef(workOrderTables(tx), principal, workOrderId, { lock: true });
      if (order === undefined) throw new ProblemException('not_found');
      const forbidden = forbiddenParameterKeys(rawBody);
      if (forbidden.length > 0) throw new ProblemException('validation_failed', { errors: forbidden });
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
                { userId: principal.userId, deviceId: null, key, scope: createScopeItemScope(order.id), bodyHash: requestHash(input) },
                perform,
              )
            ).replayed;

      // the item is read again with the order of the URL in the condition — a repeat never names an item of another order
      const row = await findScopeItem(workOrderTables(tx), order.id, input.id);
      if (row === undefined) throw new ProblemException('not_found');
      const addedProcedureCodes: string[] = [];
      for (const participant of this.#participants.ordered()) {
        addedProcedureCodes.push(...(await participant.procedureCodesOf(tx, order.id, input.id)));
      }
      return { workOrderId: order.id, addition: { item: toScopeItem(row), addedProcedureCodes }, replayed };
    });
  }

  /** Steps 4–7 of the order described above, in the transaction of the command. */
  async #add(
    tx: Kysely<Database>,
    principal: Principal,
    order: { readonly id: string; readonly status: WorkOrderStatus },
    input: CreateInput,
    request: EventContext,
  ): Promise<void> {
    if (CLOSED_STATUSES.includes(order.status)) throw new ProblemException('work_order_closed');

    const item = await this.#catalog.findActiveByCode(tx, input.catalogItemCode);
    if (item === undefined) {
      throw new ProblemException('validation_failed', { errors: [{ pointer: '/catalogItemCode', code: 'unknown_catalog_item' }] });
    }
    const parameters = validateParameters(parseParameters, item.parameterSetCode, input.parameters ?? {});
    if (!parameters.ok) throw new ProblemException('validation_failed', { errors: parameters.errors });
    // the description of a "Inna usługa" is the notes: required there, optional elsewhere
    const notes = normalizeNotes(input.notes, { required: item.code === CUSTOM_SERVICE_CODE });
    if (!notes.ok) throw new ProblemException('validation_failed', { errors: notes.errors });
    const requested = input.procedureCodes ?? [];
    const procedures = validateProcedureCodes(requested, item.procedureCodes);
    if (!procedures.ok) throw new ProblemException('validation_failed', { errors: procedures.errors });

    const tables = workOrderTables(tx);
    const taken = await takenScopePositions(tables, order.id);
    if (taken.length >= MAX_SCOPE_ITEMS) {
      throw new ProblemException('limit_exceeded', { errors: [{ pointer: '', code: 'too_many_scope_items' }] });
    }

    const now = this.#clock.now();
    const inserted = await insertScopeItem(
      tables,
      {
        id: input.id,
        workOrderId: order.id,
        sourceCatalogItemId: item.id,
        position: nextPosition(taken),
        code: item.code,
        name: item.name,
        parameterSetCode: item.parameterSetCode,
        parameters: parameters.value,
        notes: notes.value,
      },
      principal.userId,
      now,
    );
    if (inserted === undefined) throw new ProblemException('id_conflict');

    const added: string[] = [];
    try {
      for (const participant of this.#participants.ordered()) {
        added.push(
          ...(await participant.addProcedures(tx, {
            workOrderId: order.id,
            scopeItem: { id: input.id, sourceCatalogItemId: item.id, code: item.code },
            procedureCodes: requested,
            principal,
            now,
          })),
        );
      }
    } catch (error) {
      if (error instanceof ScopeLimitError) {
        throw new ProblemException('limit_exceeded', { errors: [{ pointer: error.pointer, code: error.code }] });
      }
      throw error;
    }

    const actor = { type: 'user', userId: principal.userId } as const;
    const audited: WorkOrderEvent = {
      type: 'scope_item.created',
      actor,
      outcome: 'success',
      objectType: 'scope_item',
      objectId: input.id,
    };
    await this.#events.publish(tx, audited, request);
    const journal: ScopeItemAddedEvent = {
      type: 'work_order.scope_item_added',
      actor,
      outcome: 'success',
      objectType: 'scope_item',
      objectId: input.id,
      workOrderId: order.id,
      itemCode: item.code,
      procedureCodes: added,
    };
    await this.#events.publish(tx, journal, request);
  }
}
