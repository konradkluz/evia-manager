/**
 * The SYSTEM port of `work-orders` for the read model (ADR-0017 W5; EVM-034): what `overview` needs to recompute the projection of an
 * order, with the MINIMAL data (keys, codes, dates — no title, no description, no names). It is NOT part of `index.ts` on purpose:
 * the rule of module boundaries lets only `modules/overview/(application|infrastructure)` import a `system-ports.ts`, so no controller
 * and no other module can reach a function that skips the read policy. The result does not depend on the role of anyone (T8): the
 * caller of the recomputation is the system, in the transaction of the change or in `rebuild`.
 */
import type { Kysely } from 'kysely';
import type { Database } from '../../platform/database/database.ts';
import type { Principal } from '../../platform/http/principal.ts';
import type { OrderChildSyncSource, SyncRowState } from '../../platform/sync/sync-row-state.ts';

export const WORK_ORDER_PROJECTION_SOURCE = Symbol('WORK_ORDER_PROJECTION_SOURCE');

/** The keys of one order (soft deleted ones included: the projection holds the deletion as `deletedAt`). */
export interface WorkOrderKeys {
  readonly id: string;
  readonly number: string;
  readonly status: string;
  readonly createdAt: Date;
  readonly deletedAt: Date | null;
  /** The active coordinator, if any. */
  readonly coordinatorUserId: string | null;
  readonly customerId: string | null;
  readonly siteId: string | null;
  readonly sourceTemplateId: string | null;
}

export interface WorkOrderProjectionSource {
  /** The keys of the orders among `ids` that exist (ONE query); the others are absent. */
  keysOf(tx: Kysely<Database>, ids: readonly string[]): Promise<readonly WorkOrderKeys[]>;
  /** A page of identifiers in ascending order, after `afterId` (all orders: `rebuild` walks them in batches). */
  idsAfter(tx: Kysely<Database>, afterId: string | undefined, limit: number): Promise<readonly string[]>;
}

/**
 * The SYNC port of `work-orders` (EVM-096; ADR-0021 D8): the projection of an order for the phone, read with the read policy of orders AND the rule of scope IN the
 * query (SR-AUTHZ-03) - the columns are listed, never `*`. `sync` is the only importer (the rule of module boundaries), so no controller reaches it.
 */
export const WORK_ORDER_SYNC_SOURCE = Symbol('WORK_ORDER_SYNC_SOURCE');

/** The rule of scope of the phone (ADR-0021 D1a): an order closed before `closedSince` is out; an open one is always in. */
export interface SyncScopeRule {
  readonly closedSince: Date;
}

/** The fields of `SyncWorkOrder` (contract) that come from the order; `type` is added by the serializer of `sync`. */
export interface SyncWorkOrderProjection {
  readonly id: string;
  readonly version: number;
  readonly number: string;
  readonly title: string;
  readonly status: string;
  readonly customerId: string | null;
  readonly siteId: string | null;
  readonly coordinatorUserId: string | null;
  readonly description: string | null;
  readonly plannedDate: string | null;
  readonly createdAt: Date;
  readonly closedAt: Date | null;
}

export interface WorkOrderSyncSource {
  /** A page of the orders in scope the caller may read, in the ascending order of the identifier, after `afterId` (the phase of the snapshot). */
  snapshotPage(
    tx: Kysely<Database>,
    principal: Principal,
    scope: SyncScopeRule,
    afterId: string | undefined,
    limit: number,
  ): Promise<readonly SyncWorkOrderProjection[]>;
  /** The state of every order among `ids` that exists (2 queries). */
  statesOf(
    tx: Kysely<Database>,
    principal: Principal,
    scope: SyncScopeRule,
    ids: readonly string[],
  ): Promise<ReadonlyMap<string, SyncRowState<SyncWorkOrderProjection>>>;
  /** Which of the customers / sites among `ids` are used by an order in scope that the caller may read (1 query each). */
  customersInScope(tx: Kysely<Database>, principal: Principal, scope: SyncScopeRule, ids: readonly string[]): Promise<ReadonlySet<string>>;
  sitesInScope(tx: Kysely<Database>, principal: Principal, scope: SyncScopeRule, ids: readonly string[]): Promise<ReadonlySet<string>>;
  /** Which of the orders among `ids` are in scope AND readable by the caller (1 query): the ONE judge of the scope for the entities anchored to an order (EVM-097). */
  ordersInScope(tx: Kysely<Database>, principal: Principal, scope: SyncScopeRule, ids: readonly string[]): Promise<ReadonlySet<string>>;
  /** Which of the users among `ids` coordinate an order in scope the caller may read (1 query). */
  coordinatorsInScope(
    tx: Kysely<Database>,
    principal: Principal,
    scope: SyncScopeRule,
    ids: readonly string[],
  ): Promise<ReadonlySet<string>>;
}

export const SCOPE_ITEM_SYNC_SOURCE = Symbol('SCOPE_ITEM_SYNC_SOURCE');

/** The fields of `SyncScopeItem` (contract) that come from the item; `type` is added by the serializer of `sync`. */
export interface SyncScopeItemProjection {
  readonly id: string;
  readonly version: number;
  readonly workOrderId: string;
  readonly position: number;
  readonly code: string;
  readonly name: string;
  readonly parameterSetCode: string | null;
  readonly parameters: Readonly<Record<string, string | number | boolean>>;
  readonly quantity: number;
  readonly notes: string | null;
}

/** The scope items of the orders for the phone (EVM-097): the order is judged by {@link WorkOrderSyncSource.ordersInScope}, the content is read only for the orders in scope. */
export type ScopeItemSyncSource = OrderChildSyncSource<SyncScopeItemProjection>;

/**
 * The target of a mutation of the phone (EVM-098 AC6): may the caller write to this order NOW? `available`; `target_unavailable` - the caller has access but
 * the order is soft deleted; `forbidden` - no access OR no such order (one answer). The state only, never a field of the order. Only `sync` imports it.
 */
export const WORK_ORDER_MUTATION_TARGET = Symbol('WORK_ORDER_MUTATION_TARGET');

export type MutationTargetState = 'available' | 'target_unavailable' | 'forbidden';

export interface WorkOrderMutationTarget {
  stateOf(tx: Kysely<Database>, principal: Principal, workOrderId: string): Promise<MutationTargetState>;
}
