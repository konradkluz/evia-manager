/**
 * The reader of the aggregate of a work order for the phone (EVM-097; ADR-0021 D3): the ONE place that gathers an order with everything the phone needs to show
 * it, used by BOTH the phase of the snapshot of the pull (EVM-096 AC2) and `GET /api/v1/sync/work-orders/{id}` (AC3) - so the two cannot differ. The orders
 * come in already judged (the read policy and the rule of scope are in the SQL that produced them), so the entities anchored to them (scope items, stages,
 * entries) are read for those orders only. The customer, the site, the parties and the users are the ones the order's own data names, each read with its
 * own policy: what the phone cannot read is simply not there.
 *
 * A fixed number of queries whatever the number of orders (batches by identifier); every entity once per order.
 */
import { Inject, Injectable } from '@nestjs/common';
import type { Kysely } from 'kysely';
import type { Database } from '../../../platform/database/database.ts';
import type { Principal } from '../../../platform/http/principal.ts';
import { CUSTOMER_SYNC_SOURCE, type CustomerSyncSource } from '../../customers/system-ports.ts';
import { USER_SYNC_SOURCE, type UserSyncSource } from '../../identity/system-ports.ts';
import { PARTY_SYNC_SOURCE, type PartySyncSource } from '../../parties/system-ports.ts';
import { PROCEDURE_STAGE_SYNC_SOURCE, type ProcedureStageSyncSource } from '../../procedures/system-ports.ts';
import { SITE_SYNC_SOURCE, type SiteSyncSource } from '../../sites/system-ports.ts';
import { TIMELINE_ENTRY_SYNC_SOURCE, type TimelineEntrySyncSource } from '../../timeline/system-ports.ts';
import { SCOPE_ITEM_SYNC_SOURCE, type ScopeItemSyncSource, type SyncWorkOrderProjection } from '../../work-orders/system-ports.ts';
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

/** What a download counts (the audit trail holds these three; the rest of the entities are only served). */
export type CountKind = 'workOrders' | 'customers' | 'sites' | 'other';

export interface GroupItem {
  /** `type:id` - the identity of the entity, for the deduplication within a page. */
  readonly key: string;
  /** An `upsert`, or a `delete` marker for a referenced object that is deleted (the reference is resolved, not left dangling). */
  readonly change: SyncChange;
  readonly kind: CountKind;
}

/** An order with everything it needs, flat and in a FIXED order (the order, its customer, site, parties and users, then scope items, stages and entries). */
export interface OrderGroup {
  readonly orderId: string;
  readonly items: readonly GroupItem[];
}

const item = (type: string, id: string, change: SyncChange, kind: CountKind = 'other'): GroupItem => ({
  key: `${type}:${id}`,
  change,
  kind,
});
/** A marker for a referenced object that is deleted (soft): the phone resolves the reference as "deleted" instead of asking for the order again (ADR-0021 D3). */
const tombstone = (type: SyncEntityType, id: string): GroupItem => item(type, id, deleteChange(type, id));
const unique = (ids: ReadonlyArray<string | null | undefined>): string[] => [
  ...new Set(ids.filter((id): id is string => id !== null && id !== undefined)),
];
const groupBy = <T extends { readonly workOrderId: string }>(rows: readonly T[]): ReadonlyMap<string, readonly T[]> => {
  const grouped = new Map<string, T[]>();
  for (const row of rows) grouped.set(row.workOrderId, [...(grouped.get(row.workOrderId) ?? []), row]);
  return grouped;
};

@Injectable()
export class AggregateReader {
  readonly #customers: CustomerSyncSource;
  readonly #sites: SiteSyncSource;
  readonly #parties: PartySyncSource;
  readonly #users: UserSyncSource;
  readonly #items: ScopeItemSyncSource;
  readonly #stages: ProcedureStageSyncSource;
  readonly #entries: TimelineEntrySyncSource;

  constructor(
    @Inject(CUSTOMER_SYNC_SOURCE) customers: CustomerSyncSource,
    @Inject(SITE_SYNC_SOURCE) sites: SiteSyncSource,
    @Inject(PARTY_SYNC_SOURCE) parties: PartySyncSource,
    @Inject(USER_SYNC_SOURCE) users: UserSyncSource,
    @Inject(SCOPE_ITEM_SYNC_SOURCE) items: ScopeItemSyncSource,
    @Inject(PROCEDURE_STAGE_SYNC_SOURCE) stages: ProcedureStageSyncSource,
    @Inject(TIMELINE_ENTRY_SYNC_SOURCE) entries: TimelineEntrySyncSource,
  ) {
    this.#customers = customers;
    this.#sites = sites;
    this.#parties = parties;
    this.#users = users;
    this.#items = items;
    this.#stages = stages;
    this.#entries = entries;
  }

  /** @param orders the orders the caller may read and that are in scope - the reader does not judge them again */
  async read(tx: Kysely<Database>, principal: Principal, orders: readonly SyncWorkOrderProjection[]): Promise<readonly OrderGroup[]> {
    if (orders.length === 0) return [];
    const orderIds = orders.map((order) => order.id);
    const customers = await this.#customers.statesOf(tx, principal, unique(orders.map((order) => order.customerId)));
    const sites = await this.#sites.statesOf(tx, principal, unique(orders.map((order) => order.siteId)));
    const items = groupBy(await this.#items.ofOrders(tx, orderIds));
    const stages = groupBy(await this.#stages.ofOrders(tx, orderIds));
    const entries = groupBy(await this.#entries.ofOrders(tx, orderIds));

    const siteOf = (order: SyncWorkOrderProjection) => {
      const state = order.siteId === null ? undefined : sites.get(order.siteId);
      return state?.kind === 'upsert' ? state.projection : undefined;
    };
    const partyIds = unique([
      ...orders.flatMap((order) => [siteOf(order)?.managerPartyId, siteOf(order)?.distributionSystemOperatorPartyId]),
      ...[...stages.values()].flat().map((stage) => stage.waitingPartyId),
    ]);
    const userIds = unique([
      ...orders.map((order) => order.coordinatorUserId),
      ...[...stages.values()].flat().map((stage) => stage.responsibleUserId),
      ...[...entries.values()].flat().map((entry) => entry.authorUserId),
    ]);
    const parties = await this.#parties.statesOf(tx, principal, partyIds);
    const users = await this.#users.statesOf(tx, userIds);

    return orders.map((order): OrderGroup => {
      const group: GroupItem[] = [item('work_order', order.id, workOrderChange(order), 'workOrders')];
      const customer = order.customerId === null ? undefined : customers.get(order.customerId);
      if (customer?.kind === 'upsert')
        group.push(item('customer', customer.projection.id, customerChange(customer.projection), 'customers'));
      else if (customer?.kind === 'delete' && order.customerId !== null) group.push(tombstone('customer', order.customerId));
      const site = siteOf(order);
      if (site !== undefined) group.push(item('site', site.id, siteChange(site), 'sites'));
      else if (order.siteId !== null && sites.get(order.siteId)?.kind === 'delete') group.push(tombstone('site', order.siteId));
      const orderStages = stages.get(order.id) ?? [];
      const orderEntries = entries.get(order.id) ?? [];
      for (const id of unique([
        site?.managerPartyId,
        site?.distributionSystemOperatorPartyId,
        ...orderStages.map((stage) => stage.waitingPartyId),
      ])) {
        const party = parties.get(id);
        if (party?.kind === 'upsert') group.push(item('party', id, partyChange(party.projection)));
        else if (party?.kind === 'delete') group.push(tombstone('party', id));
      }
      for (const id of unique([
        order.coordinatorUserId,
        ...orderStages.map((stage) => stage.responsibleUserId),
        ...orderEntries.map((entry) => entry.authorUserId),
      ])) {
        const user = users.get(id);
        if (user?.kind === 'upsert') group.push(item('user', id, userChange(user.projection)));
        else if (user?.kind === 'delete') group.push(tombstone('user', id));
      }
      for (const row of items.get(order.id) ?? []) group.push(item('scope_item', row.id, scopeItemChange(row)));
      for (const row of orderStages) group.push(item('procedure_stage', row.id, procedureStageChange(row)));
      for (const row of orderEntries) group.push(item('timeline_entry', row.id, timelineEntryChange(row)));
      return { orderId: order.id, items: group };
    });
  }
}
