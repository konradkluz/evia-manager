/**
 * Creation of a work order from a template (EVM-022 AC1–AC7; SR-AUTHZ-02, SR-AUTHZ-04, SR-INPUT-01, SR-INPUT-02, SR-API-05, SR-API-06,
 * SR-API-07, SR-LOG-02). The guard has decided before this runs (Administrator and Editor, web channel, CSRF): a caller who may not
 * create never reaches the validation, so a Read-only user gets 403 for any body and nobody who is not entitled can fill the table of
 * idempotency records (TM-22).
 *
 * Order: the `Idempotency-Key` header and the body are validated with the schemas of the contract (strict — a field of the server is
 * `read_only_field`, a stranger `unknown_field`), then the rules of the domain (plain text, the range of the date; errors are pointers
 * and codes, never values); then ONE transaction: the idempotency port (when there is a key), and inside it
 *   1. the customer and the site, through the facades, with the SAME transaction as the insert — `404 not_found`, the same answer for
 *      an object that is missing and one that is deleted, for every role (the id comes from the client and grants nothing);
 *   2. the template (an active one; missing and retired alike are `422 template_unavailable`) with its items;
 *   3. the assignee: an ACTIVE user, by default the signed-in one — never taken from anything but the session when absent; a user who
 *      is missing, invited, deactivated or deleted is the one answer `400 assignee_unavailable` (no way to enumerate accounts);
 *   4. the number from the yearly counter (the year in `Europe/Warsaw` of the injected clock) and the INSERT of the order — an existing
 *      `id`, also a deleted order's, is `409 id_conflict` and the content is never compared;
 *   5. the scope items copied from the template, the coordinator assignment, then the contributors of the composition in their fixed
 *      order (see `composition-contributor.ts`), then the event `work_order.created` for the audit trail (identifiers only).
 * Any failure throws, so the transaction rolls back as a whole: no order, no scope item, no assignment, no audit record, no
 * idempotency record, and the number is not used. A repeat (same key and body) runs none of it again: it returns the order as it is
 * NOW, read with the permissions of the caller of the repeat.
 */
import { zCreateWorkOrderHeaders, zCreateWorkOrderRequest, zWorkOrder } from '@evia/contracts/zod';
import type { WorkOrder } from '@evia/contracts';
import { Inject, Injectable } from '@nestjs/common';
import type { Kysely } from 'kysely';
import type { Database } from '../../../platform/database/database.ts';
import type { EventContext } from '../../../platform/events/event-bus.ts';
import type { Principal } from '../../../platform/http/principal.ts';
import { ProblemException } from '../../../platform/http/problem.ts';
import { parseInput, readOnlyKeys, strictObjects } from '../../../platform/http/validation.ts';
import { requestHash } from '../../../platform/idempotency/canonical-json.ts';
import { IDEMPOTENCY, type Idempotency } from '../../../platform/idempotency/idempotency.ts';
import { DATABASE } from '../../../platform/tokens.ts';
import { CUSTOMER_DIRECTORY, type CustomerDirectory } from '../../customers/index.ts';
import { UserDirectory } from '../../identity/index.ts';
import { SITE_DIRECTORY, type SiteDirectory } from '../../sites/index.ts';
import { normalizeNewWorkOrder, type NewWorkOrder, type WorkOrderInput } from '../domain/new-work-order.ts';
import { workOrderTables } from '../infrastructure/tables.ts';
import { findCoordinatorUserId, findVisibleWorkOrder, listScopeItems } from '../infrastructure/work-order-store.ts';
import { WorkOrderComposer } from './work-order-composer.ts';
import { toWorkOrder } from './work-order-representation.ts';
import { runInTransaction } from '../../../platform/database/transactional.ts';

/** Method and route template: what an idempotency key is bound to besides the user. */
export const CREATE_WORK_ORDER_SCOPE = 'POST /api/v1/work-orders';

const createBody = strictObjects(zCreateWorkOrderRequest);
/** The fields of the server: the keys of the order that the request lacks (derived from the contract, not kept by hand). */
const SERVER_FIELDS = readOnlyKeys(zWorkOrder, zCreateWorkOrderRequest);
const idempotencyKeySchema = zCreateWorkOrderHeaders.shape['Idempotency-Key'];

export interface CreatedWorkOrder {
  readonly workOrder: WorkOrder;
  /** True when the answer repeats an earlier creation (same key and body): `Idempotent-Replayed: true`. */
  readonly replayed: boolean;
}

@Injectable()
export class CreateWorkOrderService {
  readonly #db: Kysely<Database>;
  readonly #idempotency: Idempotency;
  readonly #customers: CustomerDirectory;
  readonly #sites: SiteDirectory;
  readonly #users: UserDirectory;
  readonly #composer: WorkOrderComposer;

  constructor(
    @Inject(DATABASE) db: Kysely<Database>,
    @Inject(IDEMPOTENCY) idempotency: Idempotency,
    @Inject(CUSTOMER_DIRECTORY) customers: CustomerDirectory,
    @Inject(SITE_DIRECTORY) sites: SiteDirectory,
    @Inject(UserDirectory) users: UserDirectory,
    @Inject(WorkOrderComposer) composer: WorkOrderComposer,
  ) {
    this.#db = db;
    this.#idempotency = idempotency;
    this.#customers = customers;
    this.#sites = sites;
    this.#users = users;
    this.#composer = composer;
  }

  /** @param rawKey the `Idempotency-Key` header as received (`undefined` when absent) */
  async create(principal: Principal, rawBody: unknown, rawKey: string | undefined, context: EventContext): Promise<CreatedWorkOrder> {
    const key = rawKey === undefined ? undefined : (parseInput(idempotencyKeySchema, rawKey) as string);
    const body = parseInput(createBody, rawBody, SERVER_FIELDS) as WorkOrderInput;
    const normalized = normalizeNewWorkOrder(body);
    if (!normalized.ok) throw new ProblemException('validation_failed', { errors: normalized.errors });

    const request = { ...context, sessionId: principal.sessionId };
    return runInTransaction(this.#db, async (tx) => {
      const perform = async () => {
        await this.#compose(tx, principal, normalized.order, request);
        return { value: normalized.order.id, result: { status: 201, code: 'created', resourceId: normalized.order.id } };
      };
      if (key === undefined) {
        await perform();
        return { workOrder: await this.#read(tx, principal, normalized.order.id), replayed: false };
      }

      const outcome = await this.#idempotency.run(
        tx,
        { userId: principal.userId, deviceId: null, key, scope: CREATE_WORK_ORDER_SCOPE, bodyHash: requestHash(body) },
        perform,
      );
      const id = outcome.replayed ? outcome.result.resourceId : outcome.value;
      if (id === null) throw new ProblemException('not_found');
      return { workOrder: await this.#read(tx, principal, id), replayed: outcome.replayed };
    });
  }

  /** The composition is the shared component's (`WorkOrderComposer`); its typed result is mapped to the problems of the panel here. */
  async #compose(tx: Kysely<Database>, principal: Principal, order: NewWorkOrder, context: EventContext): Promise<void> {
    const result = await this.#composer.compose(tx, principal, order, { origin: 'office', createdViaDeviceId: null }, context);
    if (result.ok) return;
    switch (result.reason) {
      case 'target_unavailable':
        throw new ProblemException('not_found');
      case 'template_unavailable':
        throw new ProblemException('template_unavailable');
      case 'id_conflict':
        throw new ProblemException('id_conflict');
      case 'assignee_unavailable':
        if (!result.named) throw new ProblemException('forbidden');
        throw new ProblemException('validation_failed', { errors: [{ pointer: '/assigneeUserId', code: 'assignee_unavailable' }] });
      case 'composition_limit':
        // the configuration of the template passes a limit: as before EVM-099 a failure of the server that rolls the creation back as a whole
        throw new Error('the composition of the template passes a limit');
    }
  }

  /** The order as the caller may read it NOW: the order, its scope, the customer and the site (through the facades) and the coordinator. */
  async #read(tx: Kysely<Database>, principal: Principal, id: string): Promise<WorkOrder> {
    const tables = workOrderTables(tx);
    const row = await findVisibleWorkOrder(tables, principal, id);
    if (row === undefined || row.customer_id === null || row.site_id === null) throw new ProblemException('not_found');
    const scope = await listScopeItems(tables, id);
    const coordinatorId = await findCoordinatorUserId(tables, id);
    const customer = await this.#customers.findVisible(tx, principal, row.customer_id);
    const site = await this.#sites.findVisible(tx, principal, row.site_id);
    if (customer === undefined || site === undefined || coordinatorId === undefined) throw new ProblemException('not_found');
    const names = await this.#users.displayNamesOf([coordinatorId], tx);
    const displayName = names.get(coordinatorId);
    if (displayName === undefined) throw new ProblemException('not_found');
    return toWorkOrder({ row, scope, customer, site, coordinator: { id: coordinatorId, displayName } });
  }
}
