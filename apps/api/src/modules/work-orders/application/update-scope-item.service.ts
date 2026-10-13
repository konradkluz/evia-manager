/**
 * The change of the parameters and the notes of a scope item (EVM-035 AC4, AC6, AC7, AC8; SR-API-05, SR-API-06, SR-API-07,
 * SR-AUTHZ-02, SR-AUTHZ-04, SR-AUTHZ-05, SR-INPUT-01, SR-INPUT-02, SR-INPUT-05, SR-DATA-02, SR-LOG-02, SR-LOG-03, ASVS V2.3.3,
 * CWE-639, CWE-915). The guard has decided before this runs: a signed-in Administrator or Editor on the web channel with a valid
 * CSRF token — Read-only gets 403 and an anonymous caller 401 without reaching the headers or the body.
 *
 * ONE transaction, and every decision in it is taken on rows LOCKED with `SELECT … FOR NO KEY UPDATE`, never on an earlier read:
 *   1. the ORDER is locked (the read policy is in that query): missing or soft deleted is `404 not_found`, the same for every role;
 *   2. the ITEM is locked with `id AND work_order_id` in ONE condition: an item of another order, one that does not exist and one
 *      that is deleted are the same `404 not_found` (a lookup by the item alone, then a comparison, is an IDOR). Both `404` come
 *      before the headers and the body, so a malformed request tells a caller nothing about an object that is not theirs;
 *   3. `If-Match` (`428` / `400`) and the body against the schema of the contract (strict: a field of the server — `code`, `name`,
 *      `parameterSetCode`, `position`, `quantity`, `sourceCatalogItemId`, `version` — is `read_only_field`, a stranger
 *      `unknown_field`) and the rules of the domain: the parameters against the set SAVED IN THE ITEM (a snapshot — never a set the
 *      client names), the notes as plain text, the description of a "Inna usługa" that cannot be emptied: `400`, pointers and codes,
 *      never values;
 *   4. the idempotency port (when there is a key): a repeat of the same key, order, item and body returns the stored result BEFORE
 *      the checks below. The key is bound to the ORDER and the ITEM: the same key and body on another item is `422
 *      idempotency_mismatch`;
 *   5. a closed order (settled or cancelled, PO-8) is `409 work_order_closed` — before the version;
 *   6. the version of the ITEM (`412 version_conflict`, no current value in the answer, the data stay as they were);
 *   7. the update (`version + 1`), the event `scope_item.updated` for the audit trail (the actor and the item — no name of a field,
 *      no value), the event of the JOURNAL (EVM-038: the code of the item and the NAMES of the fields that really changed), the
 *      idempotency record. An error anywhere rolls the whole command back.
 * A patch that changes nothing writes nothing (no version, no event) and answers the item as it is.
 */
import { zScopeItem, zScopeItemPatch, zUpdateWorkOrderScopeItemHeaders, zUpdateWorkOrderScopeItemPath } from '@evia/contracts/zod';
import type { ScopeItem } from '@evia/contracts';
import { Inject, Injectable } from '@nestjs/common';
import type { Kysely } from 'kysely';
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
import { parseParameters } from '../../catalog/index.ts';
import type { FieldIssue } from '../../../platform/input/field-issues.ts';
import {
  changedScopeFields,
  CUSTOM_SERVICE_CODE,
  forbiddenParameterKeys,
  normalizeNotes,
  validateParameters,
  type ScopeItemField,
  type ScopeParameters,
} from '../domain/scope-item-rules.ts';
import { CLOSED_STATUSES, type WorkOrderStatus } from '../domain/work-order-status.ts';
import type { ScopeItemUpdatedEvent, WorkOrderEvent } from '../events.ts';
import { workOrderTables } from '../infrastructure/tables.ts';
import { findScopeItem, readScopeItem, updateScopeItem } from '../infrastructure/work-order-edit-store.ts';
import { findVisibleWorkOrderRef, type ScopeItemRow } from '../infrastructure/work-order-store.ts';
import { toScopeItem } from './scope-item-representation.ts';
import { runInTransaction } from '../../../platform/database/transactional.ts';

/** Method and route template; the key of an idempotency record is bound to it AND to the order and the item (see {@link updateScopeItemScope}). */
export const UPDATE_SCOPE_ITEM_SCOPE = 'PATCH /api/v1/work-orders/{workOrderId}/scope-items/{scopeItemId}';

/**
 * What an idempotency key is bound to besides the user: the method, the route, THE ORDER and THE ITEM. A patch such as
 * `{"notes":null}` says nothing of the item, so a scope of the route alone would let the key of one item "replay" the change for
 * another one that was never changed (ASVS V2.3.1, SR-API-05, CWE-639, CWE-841).
 */
export const updateScopeItemScope = (workOrderId: string, scopeItemId: string): string =>
  UPDATE_SCOPE_ITEM_SCOPE.replace('{workOrderId}', workOrderId).replace('{scopeItemId}', scopeItemId);

const pathSchema = strictObjects(zUpdateWorkOrderScopeItemPath);
const patchBody = strictObjects(zScopeItemPatch);
const idempotencyKeySchema = zUpdateWorkOrderScopeItemHeaders.shape['Idempotency-Key'];
/** The fields of the server that a patch names in vain: the keys of the item that the patch lacks, and the columns no answer carries. */
const SERVER_FIELDS: ReadonlySet<string> = new Set([
  ...readOnlyKeys(zScopeItem, zScopeItemPatch),
  'sourceCatalogItemId',
  'workOrderId',
  'createdBy',
  'updatedAt',
  'updatedBy',
  'deletedAt',
  'deletedBy',
]);

interface PatchInput {
  readonly parameters?: Readonly<Record<string, unknown>> | undefined;
  readonly notes?: string | null | undefined;
}

export interface UpdatedScopeItem {
  readonly item: ScopeItem;
  /** True when the answer repeats an earlier change (same key, item and body): `Idempotent-Replayed: true`. */
  readonly replayed: boolean;
}

interface Change {
  readonly parameters?: ScopeParameters;
  readonly notes?: string | null;
}

@Injectable()
export class UpdateScopeItemService {
  readonly #db: Kysely<Database>;
  readonly #clock: Clock;
  readonly #events: EventBus;
  readonly #idempotency: Idempotency;

  constructor(
    @Inject(DATABASE) db: Kysely<Database>,
    @Inject(CLOCK) clock: Clock,
    @Inject(EVENT_BUS) events: EventBus,
    @Inject(IDEMPOTENCY) idempotency: Idempotency,
  ) {
    this.#db = db;
    this.#clock = clock;
    this.#events = events;
    this.#idempotency = idempotency;
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
  ): Promise<UpdatedScopeItem> {
    const { workOrderId, scopeItemId } = parseInput(pathSchema, rawParams) as { workOrderId: string; scopeItemId: string };
    const key = rawKey === undefined ? undefined : (parseInput(idempotencyKeySchema, rawKey) as string);
    const request = { ...context, sessionId: principal.sessionId };

    return runInTransaction(this.#db, async (tx) => {
      const tables = workOrderTables(tx);
      const order = await findVisibleWorkOrderRef(tables, principal, workOrderId, { lock: true });
      if (order === undefined) throw new ProblemException('not_found');
      const locked = await findScopeItem(tables, order.id, scopeItemId, { lock: true });
      if (locked === undefined) throw new ProblemException('not_found');

      const expectedVersion = parseIfMatch(rawIfMatch);
      const forbidden = forbiddenParameterKeys(rawBody);
      if (forbidden.length > 0) throw new ProblemException('validation_failed', { errors: forbidden });
      const body = parseInput(patchBody, rawBody, SERVER_FIELDS) as PatchInput;
      const change = this.#resolve(locked, body);
      if (!change.ok) throw new ProblemException('validation_failed', { errors: change.errors });

      const perform = async () => {
        await this.#perform(tx, principal, order, locked, expectedVersion, change.change, request);
        return { value: undefined, result: { status: 200, code: 'updated', resourceId: scopeItemId } };
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
                  scope: updateScopeItemScope(order.id, scopeItemId),
                  bodyHash: requestHash(body),
                },
                perform,
              )
            ).replayed;
      return { item: toScopeItem(await readScopeItem(tables, order.id, scopeItemId)), replayed };
    });
  }

  /** The rules of the domain on the item as it is locked: the set is the one SAVED in the item, never one the client names. */
  #resolve(
    locked: ScopeItemRow,
    body: PatchInput,
  ): { readonly ok: true; readonly change: Change } | { readonly ok: false; readonly errors: readonly FieldIssue[] } {
    const errors: FieldIssue[] = [];
    if (body.parameters === undefined && body.notes === undefined) errors.push({ pointer: '', code: 'required' });

    let parameters: ScopeParameters | undefined;
    if (body.parameters !== undefined) {
      const result = validateParameters(parseParameters, locked.parameter_set_code, body.parameters);
      if (result.ok) parameters = result.value;
      else errors.push(...result.errors);
    }
    let notes: string | null | undefined;
    if (body.notes !== undefined) {
      // the description of a "Inna usługa" is the notes: it cannot be emptied
      const result = normalizeNotes(body.notes, { required: locked.code === CUSTOM_SERVICE_CODE });
      if (result.ok) notes = result.value;
      else errors.push(...result.errors);
    }
    if (errors.length > 0) return { ok: false, errors };
    return {
      ok: true,
      change: { ...(parameters === undefined ? {} : { parameters }), ...(notes === undefined ? {} : { notes }) },
    };
  }

  /** Steps 5–7 of the order described above, on the locked rows. */
  async #perform(
    tx: Kysely<Database>,
    principal: Principal,
    order: { readonly id: string; readonly status: WorkOrderStatus },
    locked: ScopeItemRow,
    expectedVersion: number,
    change: Change,
    request: EventContext,
  ): Promise<void> {
    if (CLOSED_STATUSES.includes(order.status)) throw new ProblemException('work_order_closed');
    if (locked.version !== expectedVersion) throw new ProblemException('version_conflict');

    const changed: ScopeItemField[] = changedScopeFields(change, { parameters: locked.parameters, notes: locked.notes });
    if (changed.length === 0) return;
    await updateScopeItem(
      workOrderTables(tx),
      order.id,
      locked.id,
      expectedVersion,
      {
        ...(changed.includes('parameters') && change.parameters !== undefined ? { parameters: change.parameters } : {}),
        ...(changed.includes('notes') && change.notes !== undefined ? { notes: change.notes } : {}),
      },
      principal.userId,
      this.#clock.now(),
    );
    const actor = { type: 'user', userId: principal.userId } as const;
    const audited: WorkOrderEvent = {
      type: 'scope_item.updated',
      actor,
      outcome: 'success',
      objectType: 'scope_item',
      objectId: locked.id,
    };
    await this.#events.publish(tx, audited, request);
    const journal: ScopeItemUpdatedEvent = {
      type: 'work_order.scope_item_updated',
      actor,
      outcome: 'success',
      objectType: 'scope_item',
      objectId: locked.id,
      workOrderId: order.id,
      itemCode: locked.code,
      changedFields: changed,
    };
    await this.#events.publish(tx, journal, request);
  }
}
