/**
 * Queries of the creation of a work order (EVM-022). Every value reaches the database as a bound parameter; the read policy is a
 * condition of the query, never a filter of the result (SR-AUTHZ-03). Every query names its columns (no `select *`), so a column
 * that is not in the contract (`created_by`, `deleted_by`) cannot leak into a response (SR-DATA-03).
 */
import { sql } from 'kysely';
import type { TemplateScopeItem } from '../../catalog/index.ts';
import type { Principal } from '../../../platform/http/principal.ts';
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
