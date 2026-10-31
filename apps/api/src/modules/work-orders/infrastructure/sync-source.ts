/** The queries behind the sync port of `work-orders` (see `../system-ports.ts`): SELECT only, a listed column set, the policy and the scope in the WHERE. */
import { sql, type Kysely, type SqlBool } from 'kysely';
import type { Database } from '../../../platform/database/database.ts';
import type { Principal } from '../../../platform/http/principal.ts';
import type { SyncRowState } from '../../../platform/sync/sync-row-state.ts';
import type { SyncChildAnchor } from '../../../platform/sync/sync-row-state.ts';
import type {
  ScopeItemSyncSource,
  SyncScopeItemProjection,
  SyncScopeRule,
  SyncWorkOrderProjection,
  WorkOrderSyncSource,
} from '../system-ports.ts';
import { visibleWorkOrders } from './read-policy.ts';
import { workOrderTables } from './tables.ts';

const ORDERS = 'work_orders.work_orders';
const ASSIGNMENTS = 'work_orders.work_order_assignments';

/** The scope of the phone as a condition: open orders, and closed ones not older than the rule says. */
const inScope = (scope: SyncScopeRule) =>
  sql<SqlBool>`(work_orders.work_orders.closed_at is null or work_orders.work_orders.closed_at >= ${scope.closedSince})`;

export class WorkOrderSyncSourceService implements WorkOrderSyncSource {
  async snapshotPage(
    tx: Kysely<Database>,
    principal: Principal,
    scope: SyncScopeRule,
    afterId: string | undefined,
    limit: number,
  ): Promise<readonly SyncWorkOrderProjection[]> {
    let query = this.#projection(tx).where(visibleWorkOrders(principal)).where(inScope(scope)).orderBy(`${ORDERS}.id`).limit(limit);
    if (afterId !== undefined) query = query.where(`${ORDERS}.id`, '>', afterId);
    return query.execute();
  }

  async statesOf(
    tx: Kysely<Database>,
    principal: Principal,
    scope: SyncScopeRule,
    ids: readonly string[],
  ): Promise<ReadonlyMap<string, SyncRowState<SyncWorkOrderProjection>>> {
    const states = new Map<string, SyncRowState<SyncWorkOrderProjection>>();
    if (ids.length === 0) return states;
    const visible = await this.#projection(tx)
      .where(`${ORDERS}.id`, 'in', ids)
      .where(visibleWorkOrders(principal))
      .where(inScope(scope))
      .execute();
    for (const row of visible) states.set(row.id, { kind: 'upsert', projection: row });
    const rest = ids.filter((id) => !states.has(id));
    if (rest.length === 0) return states;
    // The others carry no content: only whether they still exist, were deleted and were in scope (the state BEFORE the deletion, ADR-0021 D1).
    const others = await workOrderTables(tx)
      .selectFrom(ORDERS)
      .select([`${ORDERS}.id as id`, `${ORDERS}.deleted_at as deletedAt`])
      .select(inScope(scope).as('inScope'))
      .where(`${ORDERS}.id`, 'in', rest)
      .execute();
    for (const row of others) states.set(row.id, row.deletedAt !== null && row.inScope ? { kind: 'delete' } : { kind: 'skip' });
    return states;
  }

  customersInScope(tx: Kysely<Database>, principal: Principal, scope: SyncScopeRule, ids: readonly string[]): Promise<ReadonlySet<string>> {
    return this.#used(tx, principal, scope, 'customer_id', ids);
  }

  sitesInScope(tx: Kysely<Database>, principal: Principal, scope: SyncScopeRule, ids: readonly string[]): Promise<ReadonlySet<string>> {
    return this.#used(tx, principal, scope, 'site_id', ids);
  }

  async #used(
    tx: Kysely<Database>,
    principal: Principal,
    scope: SyncScopeRule,
    column: 'customer_id' | 'site_id',
    ids: readonly string[],
  ): Promise<ReadonlySet<string>> {
    if (ids.length === 0) return new Set();
    const rows = await workOrderTables(tx)
      .selectFrom(ORDERS)
      .select(`${ORDERS}.${column} as id`)
      .distinct()
      .where(`${ORDERS}.${column}`, 'in', ids)
      .where(visibleWorkOrders(principal))
      .where(inScope(scope))
      .execute();
    return new Set(rows.flatMap((row) => (row.id === null ? [] : [row.id])));
  }

  async ordersInScope(
    tx: Kysely<Database>,
    principal: Principal,
    scope: SyncScopeRule,
    ids: readonly string[],
  ): Promise<ReadonlySet<string>> {
    if (ids.length === 0) return new Set();
    const rows = await workOrderTables(tx)
      .selectFrom(ORDERS)
      .select(`${ORDERS}.id as id`)
      .where(`${ORDERS}.id`, 'in', ids)
      .where(visibleWorkOrders(principal))
      .where(inScope(scope))
      .execute();
    return new Set(rows.map((row) => row.id));
  }

  async coordinatorsInScope(
    tx: Kysely<Database>,
    principal: Principal,
    scope: SyncScopeRule,
    ids: readonly string[],
  ): Promise<ReadonlySet<string>> {
    if (ids.length === 0) return new Set();
    const rows = await workOrderTables(tx)
      .selectFrom(ORDERS)
      .innerJoin(ASSIGNMENTS, (join) =>
        join
          .onRef(`${ASSIGNMENTS}.work_order_id`, '=', `${ORDERS}.id`)
          .on(`${ASSIGNMENTS}.role`, '=', 'coordinator')
          .on(`${ASSIGNMENTS}.deleted_at`, 'is', null),
      )
      .select(`${ASSIGNMENTS}.user_id as id`)
      .distinct()
      .where(`${ASSIGNMENTS}.user_id`, 'in', ids)
      .where(visibleWorkOrders(principal))
      .where(inScope(scope))
      .execute();
    return new Set(rows.map((row) => row.id));
  }

  #projection(tx: Kysely<Database>) {
    return workOrderTables(tx)
      .selectFrom(ORDERS)
      .leftJoin(ASSIGNMENTS, (join) =>
        join
          .onRef(`${ASSIGNMENTS}.work_order_id`, '=', `${ORDERS}.id`)
          .on(`${ASSIGNMENTS}.role`, '=', 'coordinator')
          .on(`${ASSIGNMENTS}.deleted_at`, 'is', null),
      )
      .select([
        `${ORDERS}.id as id`,
        `${ORDERS}.version as version`,
        `${ORDERS}.number as number`,
        `${ORDERS}.title as title`,
        `${ORDERS}.status as status`,
        `${ORDERS}.customer_id as customerId`,
        `${ORDERS}.site_id as siteId`,
        `${ASSIGNMENTS}.user_id as coordinatorUserId`,
        `${ORDERS}.description as description`,
        sql<string | null>`to_char(work_orders.work_orders.planned_date, 'YYYY-MM-DD')`.as('plannedDate'),
        `${ORDERS}.created_at as createdAt`,
        `${ORDERS}.closed_at as closedAt`,
      ]);
  }
}

const ITEMS = 'work_orders.scope_items';

/** The scope items for the phone (see `../system-ports.ts`): the listed columns, no `created_by`, `updated_by` or `deleted_by`. */
export class ScopeItemSyncSourceService implements ScopeItemSyncSource {
  async anchorsOf(tx: Kysely<Database>, ids: readonly string[]): Promise<ReadonlyMap<string, SyncChildAnchor>> {
    if (ids.length === 0) return new Map();
    const rows = await workOrderTables(tx)
      .selectFrom(ITEMS)
      .select([`${ITEMS}.id as id`, `${ITEMS}.work_order_id as workOrderId`, `${ITEMS}.deleted_at as deletedAt`])
      .where(`${ITEMS}.id`, 'in', ids)
      .execute();
    return new Map(rows.map((row) => [row.id, { workOrderId: row.workOrderId, state: row.deletedAt === null ? 'live' : 'deleted' }]));
  }

  async liveOf(
    tx: Kysely<Database>,
    ids: readonly string[],
    workOrderIds: readonly string[],
  ): Promise<ReadonlyMap<string, SyncScopeItemProjection>> {
    if (ids.length === 0 || workOrderIds.length === 0) return new Map();
    const rows = await this.#select(tx).where(`${ITEMS}.id`, 'in', ids).where(`${ITEMS}.work_order_id`, 'in', workOrderIds).execute();
    return new Map(rows.map((row) => [row.id, row]));
  }

  async ofOrders(tx: Kysely<Database>, workOrderIds: readonly string[]): Promise<readonly SyncScopeItemProjection[]> {
    if (workOrderIds.length === 0) return [];
    return this.#select(tx)
      .where(`${ITEMS}.work_order_id`, 'in', workOrderIds)
      .orderBy(`${ITEMS}.work_order_id`)
      .orderBy(`${ITEMS}.position`)
      .execute();
  }

  #select(tx: Kysely<Database>) {
    return workOrderTables(tx)
      .selectFrom(ITEMS)
      .select([
        `${ITEMS}.id as id`,
        `${ITEMS}.version as version`,
        `${ITEMS}.work_order_id as workOrderId`,
        `${ITEMS}.position as position`,
        `${ITEMS}.code as code`,
        `${ITEMS}.name as name`,
        `${ITEMS}.parameter_set_code as parameterSetCode`,
        `${ITEMS}.parameters as parameters`,
        `${ITEMS}.quantity as quantity`,
        `${ITEMS}.notes as notes`,
      ])
      .where(`${ITEMS}.deleted_at`, 'is', null);
  }
}
