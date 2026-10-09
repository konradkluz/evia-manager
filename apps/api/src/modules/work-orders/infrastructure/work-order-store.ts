/**
 * Queries of the creation of a work order (EVM-022). Every value reaches the database as a bound parameter; the read policy is a
 * condition of the query, never a filter of the result (SR-AUTHZ-03). Every query names its columns (no `select *`), so a column
 * that is not in the contract (`created_by`, `deleted_by`) cannot leak into a response (SR-DATA-03).
 */
import { sql } from 'kysely';
import type { TemplateScopeItem } from '../../catalog/index.ts';
import type { Principal } from '../../../platform/http/principal.ts';
import type { ActiveStatus } from '../domain/work-order-transitions.ts';
import type { WorkOrderStatus } from '../domain/work-order-list-query.ts';
import { visibleWorkOrders } from './read-policy.ts';
import type { WorkOrdersDb } from './tables.ts';

export interface WorkOrderToInsert {
  readonly id: string;
  readonly number: string;
  readonly title: string;
  readonly customerId: string;
  readonly siteId: string;
  readonly sourceTemplateId: string | null;
  readonly plannedDate: string | null;
  readonly description: string | null;
}

/**
 * INSERT only: an existing identifier — also of a soft-deleted order — inserts nothing (`undefined`), whatever the content, and the
 * caller answers `409 id_conflict` without a word about the existing row. The status is always `new`: the server decides.
 */
export function insertWorkOrder(db: WorkOrdersDb, order: WorkOrderToInsert, actorUserId: string, now: Date) {
  return db
    .insertInto('work_orders.work_orders')
    .values({
      id: order.id,
      number: order.number,
      title: order.title,
      status: 'new',
      customer_id: order.customerId,
      site_id: order.siteId,
      source_template_id: order.sourceTemplateId,
      planned_date: order.plannedDate,
      description: order.description,
      created_at: now,
      created_by: actorUserId,
      updated_at: now,
      updated_by: actorUserId,
      deleted_at: null,
      deleted_by: null,
    })
    .onConflict((conflict) => conflict.column('id').doNothing())
    .returning('id')
    .executeTakeFirst();
}

export interface InsertedScopeItem {
  readonly id: string;
  readonly source_catalog_item_id: string | null;
  readonly position: number;
  readonly code: string;
}

/** The scope is a COPY of the items of the template (D1): the values are the template's at this moment. */
export async function insertScopeItems(
  db: WorkOrdersDb,
  workOrderId: string,
  items: readonly TemplateScopeItem[],
  actorUserId: string,
  now: Date,
): Promise<InsertedScopeItem[]> {
  if (items.length === 0) return [];
  return db
    .insertInto('work_orders.scope_items')
    .values(
      items.map((item) => ({
        work_order_id: workOrderId,
        source_catalog_item_id: item.catalogItemId,
        position: item.position,
        code: item.code,
        name: item.name,
        parameter_set_code: item.parameterSetCode,
        parameters: JSON.stringify(item.parameters),
        quantity: item.quantity,
        created_at: now,
        created_by: actorUserId,
        updated_at: now,
        updated_by: actorUserId,
        deleted_at: null,
        deleted_by: null,
      })),
    )
    .returning(['id', 'source_catalog_item_id', 'position', 'code'])
    .execute();
}

export function insertCoordinator(db: WorkOrdersDb, workOrderId: string, userId: string, actorUserId: string, now: Date) {
  return db
    .insertInto('work_orders.work_order_assignments')
    .values({
      work_order_id: workOrderId,
      user_id: userId,
      role: 'coordinator',
      created_at: now,
      created_by: actorUserId,
      updated_at: now,
      updated_by: actorUserId,
      deleted_at: null,
      deleted_by: null,
    })
    .execute();
}

/** The order as the caller may see it (the read policy is in the query). `planned_date` is read as text — see `tables.ts`. */
export function findVisibleWorkOrder(db: WorkOrdersDb, principal: Principal, id: string) {
  return db
    .selectFrom('work_orders.work_orders')
    .select([
      'id',
      'number',
      'title',
      'status',
      'customer_id',
      'site_id',
      sql<string | null>`to_char(planned_date, 'YYYY-MM-DD')`.as('planned_date'),
      'description',
      'version',
      'created_at',
    ])
    .where('id', '=', id)
    .where(visibleWorkOrders(principal))
    .executeTakeFirst();
}

export type WorkOrderRow = NonNullable<Awaited<ReturnType<typeof findVisibleWorkOrder>>>;

/** The ACTIVE items of an order, in order. */
export function listScopeItems(db: WorkOrdersDb, workOrderId: string) {
  return db
    .selectFrom('work_orders.scope_items')
    .select(['id', 'position', 'code', 'name', 'parameter_set_code', 'parameters', 'quantity'])
    .where('work_order_id', '=', workOrderId)
    .where('deleted_at', 'is', null)
    .orderBy('position')
    .execute();
}

export type ScopeItemRow = Awaited<ReturnType<typeof listScopeItems>>[number];

/** The user of the active coordinator assignment, if any. */
export async function findCoordinatorUserId(db: WorkOrdersDb, workOrderId: string): Promise<string | undefined> {
  const row = await db
    .selectFrom('work_orders.work_order_assignments')
    .select('user_id')
    .where('work_order_id', '=', workOrderId)
    .where('role', '=', 'coordinator')
    .where('deleted_at', 'is', null)
    .executeTakeFirst();
  return row?.user_id;
}

/**
 * The order as the READ operations of one order see it (EVM-018): the read policy is in the query and the columns are named — only
 * what the header and the anchors of the cards need (no description, no planned date, no author). `customer_id` and `site_id` of the
 * cards come from THIS row only, never from the request (SR-AUTHZ-02, CWE-639).
 */
export function findReadableWorkOrder(db: WorkOrdersDb, principal: Principal, id: string) {
  return db
    .selectFrom('work_orders.work_orders')
    .select([
      'id',
      'number',
      'title',
      'status',
      'customer_id',
      'site_id',
      'resume_status',
      'status_changed_at',
      'closed_at',
      sql<string | null>`to_char(completed_on, 'YYYY-MM-DD')`.as('completed_on'),
      'version',
      'created_at',
    ])
    .where('id', '=', id)
    .where(visibleWorkOrders(principal))
    .executeTakeFirst();
}

export type ReadableWorkOrderRow = NonNullable<Awaited<ReturnType<typeof findReadableWorkOrder>>>;

/**
 * The order of a status command, LOCKED (`SELECT … FOR UPDATE`) with the read policy in the query (EVM-030 AC5, AC7; SR-API-06, SR-API-07):
 * every decision of the command — the row of the table, the role, the step-up, the version, the conditions — is taken on THIS row,
 * which no other transaction can change until this one ends. Never a decision on an earlier read. Only the columns the decision
 * needs; the reason of an earlier hold or cancellation is not among them (it is overwritten, never read back).
 */
export function lockWorkOrderForTransition(db: WorkOrdersDb, principal: Principal, id: string) {
  return db
    .selectFrom('work_orders.work_orders')
    .select([
      'id',
      'status',
      'resume_status',
      'closed_at',
      sql<string | null>`to_char(completed_on, 'YYYY-MM-DD')`.as('completed_on'),
      'version',
    ])
    .where('id', '=', id)
    .where(visibleWorkOrders(principal))
    .forUpdate()
    .executeTakeFirst();
}

export type LockedWorkOrderRow = NonNullable<Awaited<ReturnType<typeof lockWorkOrderForTransition>>>;

export interface StatusColumns {
  readonly status: WorkOrderStatus;
  readonly resumeStatus: ActiveStatus | null;
  readonly statusReason: string | null;
  readonly closedAt: Date | null;
  readonly completedOn: string | null;
}

/**
 * Writes the new status and its companions and raises the version by one — only for the version the command decided on (the lock
 * already guarantees it; the condition is the second line of defence). `undefined` — nothing was updated.
 */
export async function updateWorkOrderStatus(
  db: WorkOrdersDb,
  id: string,
  expectedVersion: number,
  columns: StatusColumns,
  actorUserId: string,
  now: Date,
): Promise<number | undefined> {
  const row = await db
    .updateTable('work_orders.work_orders')
    .set({
      status: columns.status,
      resume_status: columns.resumeStatus,
      status_reason: columns.statusReason,
      status_changed_at: now,
      closed_at: columns.closedAt,
      completed_on: columns.completedOn,
      updated_at: now,
      updated_by: actorUserId,
      version: sql<number>`version + 1`,
    })
    .where('id', '=', id)
    .where('version', '=', expectedVersion)
    .where('deleted_at', 'is', null)
    .returning('version')
    .executeTakeFirst();
  return row?.version;
}

/**
 * The identifier and the status of an order the caller may see (the read policy is in the query) — what the facade for other modules
 * needs. With `lock` the row is taken `FOR UPDATE` (the caller is in a transaction of a change that depends on the status).
 */
export function findVisibleWorkOrderRef(db: WorkOrdersDb, principal: Principal, id: string, options: { readonly lock: boolean }) {
  const query = db.selectFrom('work_orders.work_orders').select(['id', 'status']).where('id', '=', id).where(visibleWorkOrders(principal));
  return (options.lock ? query.forUpdate() : query).executeTakeFirst();
}
