/**
 * The change due for each entity the rows of the change log name (EVM-096 AC3, AC4; EVM-097 AC1, AC2, AC5; ADR-0021 D1, D4): the log holds no content, so each
 * entity is read at its CURRENT state - under the read policy and the rule of scope, both evaluated NOW and not remembered - and answered with its projection
 * (`upsert`), a marker (`delete`) or nothing. A fixed number of queries per type, whatever the number of rows.
 *
 * - An entity anchored to an order (scope item, stage, entry): the order is judged by `work-orders` (the ONE reader of the scope, the same as the snapshot), the
 *   content is read only for the orders in scope. A marker `delete` is due for a row that is deleted in an order in scope, and for one that no longer exists at
 *   all (the log cannot tell whether the phone ever had it, and the marker carries a type and an identifier only).
 * - An entity without an anchor (customer, site, party, user): it belongs to the phone only while an order in scope names it, so the scope is asked at every
 *   read; a marker is due for one that is deleted and was named, or no longer exists. One that no order of the device names gets nothing, not even a marker.
 */
import { Inject, Injectable } from '@nestjs/common';
import type { Kysely } from 'kysely';
import type { Database } from '../../../platform/database/database.ts';
import type { Principal } from '../../../platform/http/principal.ts';
import type { OrderChildSyncSource } from '../../../platform/sync/sync-row-state.ts';
import { CUSTOMER_SYNC_SOURCE, type CustomerSyncSource } from '../../customers/system-ports.ts';
import { USER_SYNC_SOURCE, type UserSyncSource } from '../../identity/system-ports.ts';
import { PARTY_SYNC_SOURCE, type PartySyncSource } from '../../parties/system-ports.ts';
import { PROCEDURE_STAGE_SYNC_SOURCE, type ProcedureStageSyncSource } from '../../procedures/system-ports.ts';
import { SITE_SYNC_SOURCE, type SiteSyncSource } from '../../sites/system-ports.ts';
import { TIMELINE_ENTRY_SYNC_SOURCE, type TimelineEntrySyncSource } from '../../timeline/system-ports.ts';
import {
  SCOPE_ITEM_SYNC_SOURCE,
  WORK_ORDER_SYNC_SOURCE,
  type ScopeItemSyncSource,
  type SyncScopeRule,
  type WorkOrderSyncSource,
} from '../../work-orders/system-ports.ts';
import { entityKey, type ChangeLogRow } from '../domain/changes-page.ts';
import {
  customerChange,
  deleteChange,
  partyChange,
  procedureStageChange,
  scopeItemChange,
  siteChange,
  timelineEntryChange,
  userChange,
  workOrderChange,
  type SyncChange,
  type SyncEntityType,
} from '../domain/projection.ts';

const unique = (ids: readonly string[]): string[] => [...new Set(ids)];

@Injectable()
export class CurrentStateReader {
  readonly #orders: WorkOrderSyncSource;
  readonly #customers: CustomerSyncSource;
  readonly #sites: SiteSyncSource;
  readonly #parties: PartySyncSource;
  readonly #users: UserSyncSource;
  readonly #items: ScopeItemSyncSource;
  readonly #stages: ProcedureStageSyncSource;
  readonly #entries: TimelineEntrySyncSource;

  constructor(
    @Inject(WORK_ORDER_SYNC_SOURCE) orders: WorkOrderSyncSource,
    @Inject(CUSTOMER_SYNC_SOURCE) customers: CustomerSyncSource,
    @Inject(SITE_SYNC_SOURCE) sites: SiteSyncSource,
    @Inject(PARTY_SYNC_SOURCE) parties: PartySyncSource,
    @Inject(USER_SYNC_SOURCE) users: UserSyncSource,
    @Inject(SCOPE_ITEM_SYNC_SOURCE) items: ScopeItemSyncSource,
    @Inject(PROCEDURE_STAGE_SYNC_SOURCE) stages: ProcedureStageSyncSource,
    @Inject(TIMELINE_ENTRY_SYNC_SOURCE) entries: TimelineEntrySyncSource,
  ) {
    this.#orders = orders;
    this.#customers = customers;
    this.#sites = sites;
    this.#parties = parties;
    this.#users = users;
    this.#items = items;
    this.#stages = stages;
    this.#entries = entries;
  }

  async changesFor(
    tx: Kysely<Database>,
    principal: Principal,
    scope: SyncScopeRule,
    rows: readonly ChangeLogRow[],
  ): Promise<ReadonlyMap<string, SyncChange>> {
    const idsOf = (type: SyncEntityType): string[] => unique(rows.filter((row) => row.type === type).map((row) => row.id));
    const due = new Map<string, SyncChange>();
    // The version of a soft-deleted object is the highest one the log named for it (a purged object has none: it is not asked for).
    const versions = new Map<string, number>();
    for (const row of rows) versions.set(entityKey(row), Math.max(versions.get(entityKey(row)) ?? 0, row.version));
    const mark = (type: SyncEntityType, id: string): SyncChange => deleteChange(type, id, versions.get(entityKey({ type, id })));
    const put = (type: SyncEntityType, id: string, change: SyncChange): void => void due.set(entityKey({ type, id }), change);

    const orderIds = idsOf('work_order');
    const orders = await this.#orders.statesOf(tx, principal, scope, orderIds);
    for (const id of orderIds) {
      const state = orders.get(id);
      if (state === undefined) put('work_order', id, deleteChange('work_order', id));
      else if (state.kind === 'delete') put('work_order', id, mark('work_order', id));
      else if (state.kind === 'upsert') put('work_order', id, workOrderChange(state.projection));
    }

    const customerIds = idsOf('customer');
    const customers = await this.#customers.statesOf(tx, principal, customerIds);
    const usedCustomers = await this.#orders.customersInScope(
      tx,
      principal,
      scope,
      customerIds.filter((id) => customers.has(id)),
    );
    for (const id of customerIds) {
      const state = customers.get(id);
      if (state === undefined) put('customer', id, deleteChange('customer', id));
      else if (usedCustomers.has(id))
        put('customer', id, state.kind === 'upsert' ? customerChange(state.projection) : mark('customer', id));
    }

    const siteIds = idsOf('site');
    const sites = await this.#sites.statesOf(tx, principal, siteIds);
    const usedSites = await this.#orders.sitesInScope(
      tx,
      principal,
      scope,
      siteIds.filter((id) => sites.has(id)),
    );
    for (const id of siteIds) {
      const state = sites.get(id);
      if (state === undefined) put('site', id, deleteChange('site', id));
      else if (usedSites.has(id)) put('site', id, state.kind === 'upsert' ? siteChange(state.projection) : mark('site', id));
    }

    const partyIds = idsOf('party');
    const parties = await this.#parties.statesOf(tx, principal, partyIds);
    const namedParties = await this.#partiesInScope(
      tx,
      principal,
      scope,
      partyIds.filter((id) => parties.has(id)),
    );
    for (const id of partyIds) {
      const state = parties.get(id);
      if (state === undefined) put('party', id, deleteChange('party', id));
      else if (namedParties.has(id)) put('party', id, state.kind === 'upsert' ? partyChange(state.projection) : mark('party', id));
    }

    const userIds = idsOf('user');
    const users = await this.#users.statesOf(tx, userIds);
    const namedUsers = await this.#usersInScope(
      tx,
      principal,
      scope,
      userIds.filter((id) => users.has(id)),
    );
    for (const id of userIds) {
      const state = users.get(id);
      if (state === undefined) put('user', id, deleteChange('user', id));
      else if (namedUsers.has(id)) put('user', id, state.kind === 'upsert' ? userChange(state.projection) : mark('user', id));
    }

    await this.#anchored(tx, principal, scope, 'scope_item', idsOf('scope_item'), this.#items, scopeItemChange, put, mark);
    await this.#anchored(tx, principal, scope, 'procedure_stage', idsOf('procedure_stage'), this.#stages, procedureStageChange, put, mark);
    await this.#anchored(tx, principal, scope, 'timeline_entry', idsOf('timeline_entry'), this.#entries, timelineEntryChange, put, mark);
    return due;
  }

  /** The entities anchored to an order: the order is judged first, the content is read only for the orders in scope. */
  async #anchored<Projection>(
    tx: Kysely<Database>,
    principal: Principal,
    scope: SyncScopeRule,
    type: SyncEntityType,
    ids: readonly string[],
    source: OrderChildSyncSource<Projection>,
    serialize: (projection: Projection) => SyncChange,
    put: (type: SyncEntityType, id: string, change: SyncChange) => void,
    mark: (type: SyncEntityType, id: string) => SyncChange,
  ): Promise<void> {
    if (ids.length === 0) return;
    const anchors = await source.anchorsOf(tx, ids);
    const inScope = await this.#orders.ordersInScope(
      tx,
      principal,
      scope,
      unique([...anchors.values()].map((anchor) => anchor.workOrderId)),
    );
    const liveIds = ids.filter((id) => {
      const anchor = anchors.get(id);
      return anchor?.state === 'live' && inScope.has(anchor.workOrderId);
    });
    const live = await source.liveOf(tx, liveIds, [...inScope]);
    for (const id of ids) {
      const anchor = anchors.get(id);
      if (anchor === undefined) put(type, id, deleteChange(type, id));
      else if (anchor.state === 'hidden' || !inScope.has(anchor.workOrderId)) continue;
      else if (anchor.state === 'deleted') put(type, id, mark(type, id));
      else {
        const projection = live.get(id);
        if (projection !== undefined) put(type, id, serialize(projection));
      }
    }
  }

  /** The parties among `ids` that a site or a stage of an order in scope names (the scope is asked now; 4 queries). */
  async #partiesInScope(
    tx: Kysely<Database>,
    principal: Principal,
    scope: SyncScopeRule,
    ids: readonly string[],
  ): Promise<ReadonlySet<string>> {
    if (ids.length === 0) return new Set();
    const bySite = await this.#sites.partyReferences(tx, ids);
    const byStage = await this.#stages.waitingOnParties(tx, ids);
    const sites = await this.#orders.sitesInScope(tx, principal, scope, unique(bySite.map((ref) => ref.siteId)));
    const orders = await this.#orders.ordersInScope(tx, principal, scope, unique(byStage.map((ref) => ref.workOrderId)));
    return new Set([
      ...bySite.filter((ref) => sites.has(ref.siteId)).map((ref) => ref.partyId),
      ...byStage.filter((ref) => orders.has(ref.workOrderId)).map((ref) => ref.partyId),
    ]);
  }

  /** The users among `ids` that coordinate an order in scope, are responsible for a stage of one, or wrote an entry of one (the scope is asked now). */
  async #usersInScope(
    tx: Kysely<Database>,
    principal: Principal,
    scope: SyncScopeRule,
    ids: readonly string[],
  ): Promise<ReadonlySet<string>> {
    if (ids.length === 0) return new Set();
    const coordinators = await this.#orders.coordinatorsInScope(tx, principal, scope, ids);
    const byStage = await this.#stages.responsibleUsers(tx, ids);
    const byEntry = await this.#entries.authors(tx, ids);
    const orders = await this.#orders.ordersInScope(tx, principal, scope, unique([...byStage, ...byEntry].map((ref) => ref.workOrderId)));
    return new Set([
      ...coordinators,
      ...byStage.filter((ref) => orders.has(ref.workOrderId)).map((ref) => ref.userId),
      ...byEntry.filter((ref) => orders.has(ref.workOrderId)).map((ref) => ref.userId),
    ]);
  }
}
