/**
 * Queries of the editing of the data and the scope of a work order (EVM-035). Every value reaches the database as a bound parameter;
 * the read policy is a condition of the query, never a filter of the result (SR-AUTHZ-03); every query names its columns (no
 * `select *`), so a column outside the contract (`created_by`, `deleted_by`) cannot leak into a response (SR-DATA-03). The anchor
 * `work_order_id` is in the condition of every read and write of an item (SR-AUTHZ-02, CWE-639): an item is never found by its own
 * identifier alone. The order is locked FIRST (`lockWorkOrderForEdit`, `findVisibleWorkOrderRef` with the lock), so the decisions of
 * a command — closed, the limit, the version — are taken on rows no other transaction can change until this one ends.
 */
import { sql } from 'kysely';
import type { Principal } from '../../../platform/http/principal.ts';
import { visibleWorkOrders } from './read-policy.ts';
import type { WorkOrdersDb } from './tables.ts';
import { insertCoordinator, SCOPE_ITEMS_LIMIT, scopeItemColumns } from './work-order-store.ts';

/**
 * The order of a change of its data, LOCKED (`SELECT … FOR UPDATE`) with the read policy in the query (EVM-035 AC1, AC6; SR-API-06,
 * SR-API-07): every decision of the command — closed, the version, what really changes — is taken on THIS row, which no other
 * transaction can change until this one ends (a change of the status included, so "closed" cannot move under the command).
 */
export function lockWorkOrderForEdit(db: WorkOrdersDb, principal: Principal, id: string) {
  return db
    .selectFrom('work_orders.work_orders')
    .select(['id', 'status', 'title', 'description', sql<string | null>`to_char(planned_date, 'YYYY-MM-DD')`.as('planned_date'), 'version'])
    .where('id', '=', id)
    .where(visibleWorkOrders(principal))
    .forUpdate()
    .executeTakeFirst();
}

export type EditableWorkOrderRow = NonNullable<Awaited<ReturnType<typeof lockWorkOrderForEdit>>>;

export interface DataColumns {
  readonly title?: string;
  readonly description?: string | null;
  readonly plannedDate?: string | null;
}

/**
 * Writes the named columns and raises the version by one — only for the version the command decided on (the lock already guarantees
 * it; the condition is the second line of defence). `undefined` — nothing was updated. The status is not among the columns: it can be
 * changed only by the transition (`updateWorkOrderStatus`).
 */
export async function updateWorkOrderData(
  db: WorkOrdersDb,
  id: string,
  expectedVersion: number,
  columns: DataColumns,
  actorUserId: string,
  now: Date,
): Promise<number | undefined> {
  const row = await db
    .updateTable('work_orders.work_orders')
    .set({
      ...(columns.title === undefined ? {} : { title: columns.title }),
      ...(columns.description === undefined ? {} : { description: columns.description }),
      ...(columns.plannedDate === undefined ? {} : { planned_date: columns.plannedDate }),
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
 * Ends the active coordinator assignment (soft delete) and starts the new one. The partial unique index allows one active
 * coordinator per order, so the old one is ended FIRST. The history of the assignment stays in the table; the journal names the field.
 */
export async function replaceCoordinator(
  db: WorkOrdersDb,
  workOrderId: string,
  userId: string,
  actorUserId: string,
  now: Date,
): Promise<void> {
  await db
    .updateTable('work_orders.work_order_assignments')
    .set({ deleted_at: now, deleted_by: actorUserId, updated_at: now, updated_by: actorUserId, version: sql<number>`version + 1` })
    .where('work_order_id', '=', workOrderId)
    .where('role', '=', 'coordinator')
    .where('deleted_at', 'is', null)
    .execute();
  await insertCoordinator(db, workOrderId, userId, actorUserId, now);
}

/** The positions taken by the ACTIVE items of an order (their number is the number of the items — the limit is checked on it). */
export async function takenScopePositions(db: WorkOrdersDb, workOrderId: string): Promise<number[]> {
  const rows = await db
    .selectFrom('work_orders.scope_items')
    .select('position')
    .where('work_order_id', '=', workOrderId)
    .where('deleted_at', 'is', null)
    .limit(SCOPE_ITEMS_LIMIT + 1)
    .execute();
  return rows.map((row) => row.position);
}

export interface ScopeItemToInsert {
  readonly id: string;
  readonly workOrderId: string;
  readonly sourceCatalogItemId: string;
  readonly position: number;
  readonly code: string;
  readonly name: string;
  readonly parameterSetCode: string | null;
  readonly parameters: Readonly<Record<string, string | number | boolean>>;
  readonly notes: string | null;
}

/**
 * INSERT only: an existing identifier — also of an item of ANOTHER order or a deleted one — inserts nothing (`undefined`), whatever
 * the content, and the caller answers `409 id_conflict` without a word about the existing row (no overwrite, no access). The
 * quantity is 1 and the version 1: the server decides.
 */
export function insertScopeItem(db: WorkOrdersDb, item: ScopeItemToInsert, actorUserId: string, now: Date) {
  return db
    .insertInto('work_orders.scope_items')
    .values({
      id: item.id,
      work_order_id: item.workOrderId,
      source_catalog_item_id: item.sourceCatalogItemId,
      position: item.position,
      code: item.code,
      name: item.name,
      parameter_set_code: item.parameterSetCode,
      parameters: JSON.stringify(item.parameters),
      quantity: 1,
      notes: item.notes,
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

/**
 * The item of THIS order: `id` AND `work_order_id` are in the one condition, so an item of another order is as missing as one that
 * does not exist or one that is deleted (`undefined` → `404`, SR-AUTHZ-02, SR-INPUT-02, CWE-639). With `lock` the row is taken
 * `FOR UPDATE` — every decision of a change is taken on it, which no other transaction can change until this one ends.
 */
export function findScopeItem(
  db: WorkOrdersDb,
  workOrderId: string,
  itemId: string,
  options: { readonly lock: boolean } = { lock: false },
) {
  const query = db
    .selectFrom('work_orders.scope_items')
    .select(scopeItemColumns)
    .where('id', '=', itemId)
    .where('work_order_id', '=', workOrderId)
    .where('deleted_at', 'is', null);
  return (options.lock ? query.forUpdate() : query).executeTakeFirst();
}

export interface ScopeItemChange {
  readonly parameters?: Readonly<Record<string, string | number | boolean>>;
  readonly notes?: string | null;
}

/** Writes the named columns of the item and raises its version by one — only for the version the command decided on. */
export async function updateScopeItem(
  db: WorkOrdersDb,
  workOrderId: string,
  itemId: string,
  expectedVersion: number,
  change: ScopeItemChange,
  actorUserId: string,
  now: Date,
): Promise<void> {
  await db
    .updateTable('work_orders.scope_items')
    .set({
      ...(change.parameters === undefined ? {} : { parameters: JSON.stringify(change.parameters) }),
      ...(change.notes === undefined ? {} : { notes: change.notes }),
      updated_at: now,
      updated_by: actorUserId,
      version: sql<number>`version + 1`,
    })
    .where('id', '=', itemId)
    .where('work_order_id', '=', workOrderId)
    .where('version', '=', expectedVersion)
    .where('deleted_at', 'is', null)
    .returning('version')
    .executeTakeFirstOrThrow();
}

/** Soft delete: the item leaves the scope, the row stays (the processes it brought keep pointing at it). */
export async function softDeleteScopeItem(
  db: WorkOrdersDb,
  workOrderId: string,
  itemId: string,
  expectedVersion: number,
  actorUserId: string,
  now: Date,
): Promise<void> {
  await db
    .updateTable('work_orders.scope_items')
    .set({ deleted_at: now, deleted_by: actorUserId, updated_at: now, updated_by: actorUserId, version: sql<number>`version + 1` })
    .where('id', '=', itemId)
    .where('work_order_id', '=', workOrderId)
    .where('version', '=', expectedVersion)
    .where('deleted_at', 'is', null)
    .returning('version')
    .executeTakeFirstOrThrow();
}

/**
 * Numbers the ACTIVE items 1…n again after a removal. The unique index on the position is not deferrable, so the items are moved
 * one by one in ascending order — each moves into the place the previous one left, never onto a taken one. The version is NOT
 * raised: the position is a place in the list, not the content of the item, and a stale tag of a neighbour would be a false `412`.
 */
export async function renumberScopeItems(db: WorkOrdersDb, workOrderId: string): Promise<void> {
  const rows = await db
    .selectFrom('work_orders.scope_items')
    .select(['id', 'position'])
    .where('work_order_id', '=', workOrderId)
    .where('deleted_at', 'is', null)
    .orderBy('position')
    .limit(SCOPE_ITEMS_LIMIT)
    .execute();
  for (const [index, row] of rows.entries()) {
    if (row.position === index + 1) continue;
    await db
      .updateTable('work_orders.scope_items')
      .set({ position: index + 1 })
      .where('id', '=', row.id)
      .where('work_order_id', '=', workOrderId)
      .execute();
  }
}
