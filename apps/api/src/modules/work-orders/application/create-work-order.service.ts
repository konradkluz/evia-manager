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
import type { Clock } from '../../../platform/clock/clock.ts';
import type { Database } from '../../../platform/database/database.ts';
import type { EventBus, EventContext } from '../../../platform/events/event-bus.ts';
import type { Principal } from '../../../platform/http/principal.ts';
import { ProblemException } from '../../../platform/http/problem.ts';
import { parseInput, readOnlyKeys, strictObjects } from '../../../platform/http/validation.ts';
import { requestHash } from '../../../platform/idempotency/canonical-json.ts';
import { IDEMPOTENCY, type Idempotency } from '../../../platform/idempotency/idempotency.ts';
import { CLOCK, DATABASE, EVENT_BUS } from '../../../platform/tokens.ts';
import { TEMPLATE_DIRECTORY, type TemplateDirectory, type TemplateForCopy } from '../../catalog/index.ts';
import { CUSTOMER_DIRECTORY, type CustomerDirectory } from '../../customers/index.ts';
import { UserDirectory } from '../../identity/index.ts';
import { SITE_DIRECTORY, type SiteDirectory } from '../../sites/index.ts';
import { WorkOrderCompositionRegistry } from '../composition-contributor.ts';
import { normalizeNewWorkOrder, resolveTitle, type NewWorkOrder, type WorkOrderInput } from '../domain/new-work-order.ts';
import { businessYear, formatWorkOrderNumber } from '../domain/work-order-number.ts';
import type { WorkOrderEvent } from '../events.ts';
import { takeNextNumber } from '../infrastructure/number-counter.ts';
import { workOrderTables } from '../infrastructure/tables.ts';
import {
  findCoordinatorUserId,
  findVisibleWorkOrder,
  insertCoordinator,
  insertScopeItems,
  insertWorkOrder,
  listScopeItems,
} from '../infrastructure/work-order-store.ts';
import { toWorkOrder } from './work-order-representation.ts';

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
  readonly #clock: Clock;
  readonly #events: EventBus;
  readonly #idempotency: Idempotency;
  readonly #customers: CustomerDirectory;
  readonly #sites: SiteDirectory;
  readonly #templates: TemplateDirectory;
  readonly #users: UserDirectory;
  readonly #contributors: WorkOrderCompositionRegistry;

  constructor(
    @Inject(DATABASE) db: Kysely<Database>,
    @Inject(CLOCK) clock: Clock,
    @Inject(EVENT_BUS) events: EventBus,
    @Inject(IDEMPOTENCY) idempotency: Idempotency,
    @Inject(CUSTOMER_DIRECTORY) customers: CustomerDirectory,
    @Inject(SITE_DIRECTORY) sites: SiteDirectory,
    @Inject(TEMPLATE_DIRECTORY) templates: TemplateDirectory,
    @Inject(UserDirectory) users: UserDirectory,
    @Inject(WorkOrderCompositionRegistry) contributors: WorkOrderCompositionRegistry,
  ) {
    this.#db = db;
    this.#clock = clock;
    this.#events = events;
    this.#idempotency = idempotency;
    this.#customers = customers;
    this.#sites = sites;
    this.#templates = templates;
    this.#users = users;
    this.#contributors = contributors;
  }

  /** @param rawKey the `Idempotency-Key` header as received (`undefined` when absent) */
  async create(principal: Principal, rawBody: unknown, rawKey: string | undefined, context: EventContext): Promise<CreatedWorkOrder> {
    const key = rawKey === undefined ? undefined : (parseInput(idempotencyKeySchema, rawKey) as string);
    const body = parseInput(createBody, rawBody, SERVER_FIELDS) as WorkOrderInput;
    const normalized = normalizeNewWorkOrder(body);
    if (!normalized.ok) throw new ProblemException('validation_failed', { errors: normalized.errors });

    const request = { ...context, sessionId: principal.sessionId };
    return this.#db.transaction().execute(async (tx) => {
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

  async #compose(tx: Kysely<Database>, principal: Principal, order: NewWorkOrder, context: EventContext): Promise<void> {
    const customer = await this.#customers.findVisible(tx, principal, order.customerId);
    const site = await this.#sites.findVisible(tx, principal, order.siteId);
    if (customer === undefined || site === undefined) throw new ProblemException('not_found');
    const template = await this.#template(tx, order.templateId);
    const assigneeId = await this.#assignee(tx, principal, order);

    const now = this.#clock.now();
    const tables = workOrderTables(tx);
    const sequence = await takeNextNumber(tables, businessYear(now));
    const inserted = await insertWorkOrder(
      tables,
      {
        id: order.id,
        number: formatWorkOrderNumber(businessYear(now), sequence),
        title: resolveTitle(order.title, template?.name ?? null),
        customerId: customer.id,
        siteId: site.id,
        sourceTemplateId: template?.id ?? null,
        plannedDate: order.plannedDate,
        description: order.description,
      },
      principal.userId,
      now,
    );
    if (inserted === undefined) throw new ProblemException('id_conflict');

    const scope = await insertScopeItems(tables, order.id, template?.items ?? [], principal.userId, now);
    await insertCoordinator(tables, order.id, assigneeId, principal.userId, now);
    for (const contributor of this.#contributors.ordered()) {
      await contributor.contribute(tx, {
        workOrderId: order.id,
        templateId: template?.id ?? null,
        scopeItems: scope.map((item) => ({
          id: item.id,
          sourceCatalogItemId: item.source_catalog_item_id,
          position: item.position,
          code: item.code,
        })),
        principal,
        now,
      });
    }

    const event: WorkOrderEvent = {
      type: 'work_order.created',
      actor: { type: 'user', userId: principal.userId },
      outcome: 'success',
      objectType: 'work_order',
      objectId: order.id,
    };
    await this.#events.publish(tx, event, context);
  }

  /** `null` is an empty order; a template that is missing or retired is `422 template_unavailable` (the same for both). */
  async #template(tx: Kysely<Database>, templateId: string | null): Promise<TemplateForCopy | null> {
    if (templateId === null) return null;
    const template = await this.#templates.findActiveForCopy(tx, templateId);
    if (template === undefined) throw new ProblemException('template_unavailable');
    return template;
  }

  /**
   * The user named by the request, or — when none is named — the signed-in one; always an ACTIVE user. A named user who is missing,
   * invited, deactivated or deleted is ONE answer (`400 assignee_unavailable`): the error cannot be used to list accounts.
   */
  async #assignee(tx: Kysely<Database>, principal: Principal, order: NewWorkOrder): Promise<string> {
    const named = order.assigneeUserId;
    const user = await this.#users.findActive(named ?? principal.userId, tx);
    if (user !== undefined) return user.id;
    if (named === null) throw new ProblemException('forbidden');
    throw new ProblemException('validation_failed', { errors: [{ pointer: '/assigneeUserId', code: 'assignee_unavailable' }] });
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
