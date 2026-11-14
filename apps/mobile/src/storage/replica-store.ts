import {
  CASCADE_CHILDREN,
  entityKey,
  planSweep,
  type ApplyPageInput,
  type ApplySnapshotInput,
  type EntityKey,
  type EntityType,
  type GenerationState,
  type HydrationItem,
  type ReplicaEntity,
  type ReplicaOp,
  type ReplicaState,
  type ReplicaStore,
  type SweepResult,
  type SweepRule,
  type WriteOutcome,
} from '@evia/sync-core';
import type {
  DetailEntrySource,
  DetailParty,
  DetailScopeItem,
  DetailStageSource,
  DetailUser,
  OrderDetailSource,
} from '../orders/order-detail-model';
import type { OrderListSource, SourceCustomer, SourceOrder, SourceSite, SourceStage } from '../orders/order-list-model';
import type { QuickOrderSource } from '../orders/quick-order-model';
import type { TemplateSet } from '../orders/templates';
import { MAX_PARAMS, chunk, type DbAccess, type Tx } from './database';
import { nextGeneration, startFreshActiveGeneration } from './schema';
import type { SqlRow, SqlValue } from './sql';

const parse = (text: unknown): unknown => {
  if (typeof text !== 'string') return text ?? null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
};

const splitKey = (key: EntityKey): { type: string; id: string } => {
  const at = key.indexOf(':');
  return { type: key.slice(0, at), id: key.slice(at + 1) };
};

interface Known {
  live?: { version: number; type: EntityType; workOrderId: string | null };
  dead?: number;
}

const anchorOf = (entity: ReplicaEntity): string | null => {
  const value = entity.fields['workOrderId'];
  return typeof value === 'string' ? value : null;
};
const siteOf = (entity: ReplicaEntity): string | null => {
  const value = entity.type === 'work_order' ? entity.fields['siteId'] : undefined;
  return typeof value === 'string' ? value : null;
};

/**
 * `ReplicaStore` on the encrypted database (EVM-093 AC2, AC3; port and conformance suite of EVM-092). Server data lives in replica
 * tables with a generation number; nothing here touches a queue table. Reads of a page are bulk (chunks of ≤ 500 parameters, no N+1);
 * every write is one transaction. Reachable only through the owner guard (`LocalStore.unlock`), not exported from the barrel.
 */
export class SqlReplicaStore implements ReplicaStore {
  readonly #db: DbAccess;

  constructor(db: DbAccess) {
    this.#db = db;
  }

  async loadState(): Promise<ReplicaState> {
    return this.#db.read(async (tx) => {
      const generations = await tx.all('SELECT generation, role, cursor, complete, initial_load_done FROM replica_generations');
      const hydration = await tx.all('SELECT generation, work_order_id, reason FROM replica_hydration ORDER BY seq');
      const meta = new Map((await tx.all('SELECT key, value FROM replica_meta')).map((row) => [String(row['key']), row['value']]));
      const hasEntity = (await tx.get('SELECT 1 AS x FROM replica_entities LIMIT 1')) !== undefined;
      const view = (row: SqlRow): GenerationState => ({
        generation: Number(row['generation']),
        cursor: parse(row['cursor']),
        complete: row['complete'] === 1,
        initialLoadDone: row['initial_load_done'] === 1,
        hydration: hydration
          .filter((h) => h['generation'] === row['generation'])
          .map((h) => ({ workOrderId: h['work_order_id'], reason: h['reason'] })),
      });
      const active = generations.find((g) => g['role'] === 'active');
      const shadow = generations.find((g) => g['role'] === 'shadow');
      const owner = meta.get('owner');
      return {
        ownerUserId: typeof owner === 'string' ? owner : null,
        hasData: hasEntity || generations.some((g) => g['cursor'] !== null),
        active:
          active === undefined ? { generation: 0, cursor: null, complete: false, initialLoadDone: false, hydration: [] } : view(active),
        shadow: shadow === undefined ? null : view(shadow),
        pendingResync: parse(meta.get('pending_resync')),
        lastServerTime: parse(meta.get('last_server_time')),
        contact: parse(meta.get('contact')),
        config: parse(meta.get('config')),
      };
    });
  }

  async readVersions(
    generation: number,
    keys: readonly EntityKey[],
  ): Promise<ReadonlyMap<EntityKey, { readonly version: number; readonly deleted: boolean }>> {
    return this.#db.read(async (tx) => {
      const known = await SqlReplicaStore.#known(tx, generation, keys);
      const out = new Map<EntityKey, { version: number; deleted: boolean }>();
      for (const key of keys) {
        const k = known.get(key);
        if (k?.live !== undefined) out.set(key, { version: k.live.version, deleted: false });
        else if (k?.dead !== undefined) out.set(key, { version: k.dead, deleted: true });
      }
      return out;
    });
  }

  /** Live versions and tombstones of the keys: two statements per chunk of keys, whatever the page size. */
  static async #known(tx: Tx, generation: number, keys: readonly EntityKey[]): Promise<Map<EntityKey, Known>> {
    const out = new Map<EntityKey, Known>();
    const unique = [...new Set(keys)];
    for (const part of chunk(unique, Math.floor((MAX_PARAMS - 1) / 2))) {
      const params: SqlValue[] = [generation];
      for (const key of part) {
        const { type, id } = splitKey(key);
        params.push(type, id);
      }
      const pairs = part.map(() => '(?, ?)').join(', ');
      for (const row of await tx.all(
        `SELECT type, id, version, work_order_id FROM replica_entities WHERE generation = ? AND (type, id) IN (VALUES ${pairs})`,
        params,
      )) {
        const key = `${String(row['type'])}:${String(row['id'])}` as EntityKey;
        out.set(key, {
          ...out.get(key),
          live: {
            version: Number(row['version']),
            type: row['type'] as EntityType,
            workOrderId: typeof row['work_order_id'] === 'string' ? row['work_order_id'] : null,
          },
        });
      }
      for (const row of await tx.all(
        `SELECT type, id, version FROM replica_tombstones WHERE generation = ? AND (type, id) IN (VALUES ${pairs})`,
        params,
      )) {
        const key = `${String(row['type'])}:${String(row['id'])}` as EntityKey;
        out.set(key, { ...out.get(key), dead: Number(row['version']) });
      }
    }
    return out;
  }

  async findWorkOrdersBySite(generation: number, siteIds: readonly string[]): Promise<ReadonlyMap<string, readonly string[]>> {
    return this.#db.read(async (tx) => {
      const out = new Map<string, string[]>();
      for (const part of chunk([...new Set(siteIds)], MAX_PARAMS - 1)) {
        const rows = await tx.all(
          `SELECT site_id, id FROM replica_entities WHERE generation = ? AND type = 'work_order' AND site_id IN (${part.map(() => '?').join(', ')}) ORDER BY id`,
          [generation, ...part],
        );
        for (const row of rows) {
          const site = String(row['site_id']);
          out.set(site, [...(out.get(site) ?? []), String(row['id'])]);
        }
      }
      return out;
    });
  }

  static async #exists(tx: Tx, generation: number): Promise<boolean> {
    return (await tx.get('SELECT 1 AS x FROM replica_generations WHERE generation = ?', [generation])) !== undefined;
  }

  static async #setMeta(tx: Tx, key: string, value: unknown): Promise<void> {
    await tx.run('INSERT INTO replica_meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value', [
      key,
      typeof value === 'string' && key === 'owner' ? value : JSON.stringify(value),
    ]);
  }

  /** The ops of a page in order with the same guards as the reference fake; one bulk read, then one write per effective op. */
  static async #apply(tx: Tx, generation: number, ops: readonly ReplicaOp[]): Promise<void> {
    const keys = ops.map((op) => (op.op === 'upsert' ? entityKey(op.entity.type, op.entity.id) : entityKey(op.type, op.id)));
    const known = await SqlReplicaStore.#known(tx, generation, keys);
    for (const op of ops) {
      if (op.op === 'upsert') {
        const { entity } = op;
        const key = entityKey(entity.type, entity.id);
        const k = known.get(key) ?? {};
        if ((k.live !== undefined && k.live.version >= entity.version) || (k.dead !== undefined && k.dead >= entity.version)) continue;
        await tx.run(
          'INSERT INTO replica_entities (generation, type, id, version, work_order_id, site_id, fields) VALUES (?, ?, ?, ?, ?, ?, ?) ' +
            'ON CONFLICT (generation, type, id) DO UPDATE SET version = excluded.version, work_order_id = excluded.work_order_id, ' +
            'site_id = excluded.site_id, fields = excluded.fields',
          [generation, entity.type, entity.id, entity.version, anchorOf(entity), siteOf(entity), JSON.stringify(entity.fields)],
        );
        if (k.dead !== undefined)
          await tx.run('DELETE FROM replica_tombstones WHERE generation = ? AND type = ? AND id = ?', [generation, entity.type, entity.id]);
        known.set(key, { live: { version: entity.version, type: entity.type, workOrderId: anchorOf(entity) } });
      } else {
        const key = entityKey(op.type, op.id);
        const k = known.get(key) ?? {};
        if (k.live !== undefined && op.version < k.live.version && op.version > 0) continue;
        const version = Math.max(op.version, k.live?.version ?? 0, k.dead ?? 0);
        await tx.run('DELETE FROM replica_entities WHERE generation = ? AND type = ? AND id = ?', [generation, op.type, op.id]);
        await tx.run(
          'INSERT INTO replica_tombstones (generation, type, id, version) VALUES (?, ?, ?, ?) ' +
            'ON CONFLICT (generation, type, id) DO UPDATE SET version = excluded.version',
          [generation, op.type, op.id, version],
        );
        known.set(key, { dead: version });
        await SqlReplicaStore.#cascade(tx, generation, op.type, op.id, known);
      }
    }
  }

  static async #cascade(tx: Tx, generation: number, type: EntityType, id: string, known: Map<EntityKey, Known>): Promise<void> {
    const children = CASCADE_CHILDREN[type];
    if (children.length === 0) return;
    await tx.run(
      `DELETE FROM replica_entities WHERE generation = ? AND work_order_id = ? AND type IN (${children.map(() => '?').join(', ')})`,
      [generation, id, ...children],
    );
    for (const [key, k] of known)
      if (k.live !== undefined && children.includes(k.live.type) && k.live.workOrderId === id) known.set(key, { ...k, live: undefined });
  }

  static async #hydration(tx: Tx, generation: number, add: readonly HydrationItem[], remove: readonly string[]): Promise<void> {
    for (const part of chunk([...new Set(remove)], MAX_PARAMS - 1))
      await tx.run(`DELETE FROM replica_hydration WHERE generation = ? AND work_order_id IN (${part.map(() => '?').join(', ')})`, [
        generation,
        ...part,
      ]);
    for (const item of add)
      await tx.run('INSERT INTO replica_hydration (generation, work_order_id, reason) VALUES (?, ?, ?) ON CONFLICT DO NOTHING', [
        generation,
        item.workOrderId,
        item.reason,
      ]);
  }

  static async #markLoadedIfDone(tx: Tx, generation: number): Promise<void> {
    await tx.run(
      'UPDATE replica_generations SET initial_load_done = 1 WHERE generation = ? AND complete = 1 ' +
        'AND NOT EXISTS (SELECT 1 FROM replica_hydration WHERE generation = ?)',
      [generation, generation],
    );
  }

  async applyPage(input: ApplyPageInput): Promise<WriteOutcome> {
    return this.#db.transaction(async (tx) => {
      if (!(await SqlReplicaStore.#exists(tx, input.generation))) return 'stale';
      await SqlReplicaStore.#apply(tx, input.generation, input.ops);
      await tx.run('UPDATE replica_generations SET cursor = ?, complete = ? WHERE generation = ?', [
        JSON.stringify(input.cursor),
        input.complete ? 1 : 0,
        input.generation,
      ]);
      await SqlReplicaStore.#hydration(tx, input.generation, input.hydrationAdd, input.hydrationRemove);
      await SqlReplicaStore.#markLoadedIfDone(tx, input.generation);
      await SqlReplicaStore.#setMeta(tx, 'owner', input.ownerUserId);
      await SqlReplicaStore.#setMeta(tx, 'last_server_time', input.serverTime);
      if (input.plannedResync !== undefined) {
        const active = await tx.get("SELECT generation FROM replica_generations WHERE role = 'active'");
        if (active?.['generation'] === input.generation)
          await SqlReplicaStore.#setMeta(tx, 'pending_resync', { reason: input.plannedResync });
      }
      return 'applied';
    });
  }

  async applySnapshot(input: ApplySnapshotInput): Promise<WriteOutcome> {
    return this.#db.transaction(async (tx) => {
      if (!(await SqlReplicaStore.#exists(tx, input.generation))) return 'stale';
      await SqlReplicaStore.#apply(tx, input.generation, input.ops);
      if (input.removeWorkOrderId !== undefined) {
        await tx.run("DELETE FROM replica_entities WHERE generation = ? AND type = 'work_order' AND id = ?", [
          input.generation,
          input.removeWorkOrderId,
        ]);
        await SqlReplicaStore.#cascade(tx, input.generation, 'work_order', input.removeWorkOrderId, new Map());
      }
      await SqlReplicaStore.#hydration(tx, input.generation, [], input.hydrationRemove);
      await SqlReplicaStore.#markLoadedIfDone(tx, input.generation);
      await SqlReplicaStore.#setMeta(tx, 'owner', input.ownerUserId);
      await SqlReplicaStore.#setMeta(tx, 'last_server_time', input.serverTime);
      return 'applied';
    });
  }

  static async #dropGeneration(tx: Tx, generation: number): Promise<void> {
    for (const table of ['replica_entities', 'replica_tombstones', 'replica_hydration', 'replica_generations'])
      await tx.run(`DELETE FROM ${table} WHERE generation = ?`, [generation]);
  }

  /** The reason is the caller's diagnostics only; the store keeps no copy of it. */
  async beginShadow(): Promise<number> {
    return this.#db.transaction(async (tx) => {
      const old = await tx.get("SELECT generation FROM replica_generations WHERE role = 'shadow'");
      if (old !== undefined) await SqlReplicaStore.#dropGeneration(tx, Number(old['generation']));
      const generation = await nextGeneration(tx);
      await tx.run("INSERT INTO replica_generations (generation, role) VALUES (?, 'shadow')", [generation]);
      await tx.run("DELETE FROM replica_meta WHERE key = 'pending_resync'");
      return generation;
    });
  }

  async promoteShadow(generation: number): Promise<WriteOutcome> {
    return this.#db.transaction(async (tx) => {
      const shadow = await tx.get("SELECT generation FROM replica_generations WHERE role = 'shadow'");
      if (shadow?.['generation'] !== generation) return 'stale';
      const active = await tx.get("SELECT generation FROM replica_generations WHERE role = 'active'");
      if (active !== undefined) await SqlReplicaStore.#dropGeneration(tx, Number(active['generation']));
      await tx.run("UPDATE replica_generations SET role = 'active', initial_load_done = 1 WHERE generation = ?", [generation]);
      return 'applied';
    });
  }

  async discardShadow(): Promise<void> {
    await this.#db.transaction(async (tx) => {
      const shadow = await tx.get("SELECT generation FROM replica_generations WHERE role = 'shadow'");
      if (shadow !== undefined) await SqlReplicaStore.#dropGeneration(tx, Number(shadow['generation']));
    });
  }

  /** Time of the last successful synchronization (EVM-107 AC3): in the replica, so it goes with it (wipe, sign-out). */
  async readLastSuccess(): Promise<number | null> {
    return this.#db.read(async (tx) => {
      const row = await tx.get("SELECT value FROM replica_meta WHERE key = 'last_success_at'");
      const value = typeof row?.['value'] === 'string' ? Number(row['value']) : NaN;
      return Number.isSafeInteger(value) && value > 0 ? value : null;
    });
  }

  async writeLastSuccess(at: number): Promise<void> {
    await this.#db.transaction((tx) => SqlReplicaStore.#setMeta(tx, 'last_success_at', Math.trunc(at)));
  }

  /**
   * The templates of work orders (EVM-106 AC1; security K2-K4): ONE document in `replica_meta` (the encrypted database), replaced in one
   * upsert - a failed write leaves the old set. Not part of a generation, so a resync does not touch it; `wipeReplica` removes it.
   * Returned as stored (`unknown`): the reader validates it again.
   */
  async readTemplates(): Promise<unknown> {
    return this.#db.read(async (tx) => {
      const row = await tx.get("SELECT value FROM replica_meta WHERE key = 'templates'");
      return parse(row?.['value']);
    });
  }

  async writeTemplates(set: TemplateSet): Promise<void> {
    await this.#db.transaction((tx) => SqlReplicaStore.#setMeta(tx, 'templates', set));
  }

  /**
   * The customers and places of the active generation for the form of a quick work order (EVM-106 AC2, AC3; security K4, K7): allow-listed
   * keys through `json_extract` only (name, phone, address; never e-mail, tax id, notes of the place or its manager). Called only while the data
   * are visible.
   */
  async readQuickOrderSource(): Promise<QuickOrderSource> {
    const active = "JOIN replica_generations g ON g.generation = e.generation AND g.role = 'active'";
    const text = (value: unknown): string => (typeof value === 'string' ? value : '');
    return this.#db.read(async (tx) => {
      const customers = (
        await tx.all(
          `SELECT e.id AS id, json_extract(e.fields, '$.kind') AS kind, json_extract(e.fields, '$.displayName') AS display_name, json_extract(e.fields, '$.phone') AS phone FROM replica_entities e ${active} WHERE e.type = 'customer' ORDER BY e.id LIMIT 2000`,
        )
      ).map((row) => ({
        id: String(row['id']),
        kind: text(row['kind']),
        displayName: text(row['display_name']),
        phone: text(row['phone']),
      }));
      const sites = (
        await tx.all(
          `SELECT e.id AS id, json_extract(e.fields, '$.siteType') AS site_type, json_extract(e.fields, '$.street') AS street, json_extract(e.fields, '$.buildingNumber') AS building_number, json_extract(e.fields, '$.apartmentNumber') AS apartment_number, json_extract(e.fields, '$.postalCode') AS postal_code, json_extract(e.fields, '$.city') AS city, json_extract(e.fields, '$.parkingSpotNumber') AS parking_spot FROM replica_entities e ${active} WHERE e.type = 'site' ORDER BY e.id LIMIT 2000`,
        )
      ).map((row) => ({
        id: String(row['id']),
        siteType: text(row['site_type']),
        street: text(row['street']),
        buildingNumber: text(row['building_number']),
        apartmentNumber: text(row['apartment_number']),
        postalCode: text(row['postal_code']),
        city: text(row['city']),
        parkingSpotNumber: text(row['parking_spot']),
      }));
      return { customers, sites };
    });
  }

  /** Work orders of the active generation (the target list of "Dodaj do innego zlecenia"); only what the list shows. */
  async listWorkOrders(limit = 200): Promise<{ id: string; number: string; title: string }[]> {
    return this.#db.read(async (tx) => {
      const rows = await tx.all(
        "SELECT e.id AS id, e.fields AS fields FROM replica_entities e JOIN replica_generations g ON g.generation = e.generation AND g.role = 'active' WHERE e.type = 'work_order' ORDER BY e.id LIMIT ?",
        [Math.max(1, Math.min(limit, 500))],
      );
      return rows.map((row) => {
        const fields = (parse(row['fields']) ?? {}) as Record<string, unknown>;
        return {
          id: String(row['id']),
          number: typeof fields['number'] === 'string' ? fields['number'] : '',
          title: typeof fields['title'] === 'string' ? fields['title'] : '',
        };
      });
    });
  }

  /**
   * The source of "Moje zlecenia" (EVM-103 AC1, AC5, AC6; security K1): ONE read of the active generation, no N+1, no LIMIT. It never
   * selects the whole `fields` document - only allow-listed keys through `json_extract` - so the free-text fields of the projection
   * (title, description, phone, e-mail, notes, apartment number) never leave the database. Without `withData` (the hidden-data mode)
   * only the id, number, status and creation time of the work orders are read: no customer, no place, no stage.
   * Tombstones are not listed, so an order removed from the scope by a synchronization is simply absent.
   */
  async readOrderListSource(withData: boolean): Promise<OrderListSource> {
    const active = "JOIN replica_generations g ON g.generation = e.generation AND g.role = 'active'";
    const text = (value: unknown): string => (typeof value === 'string' ? value : '');
    const nullable = (value: unknown): string | null => (typeof value === 'string' ? value : null);
    return this.#db.read(async (tx) => {
      const orderRows = await tx.all(
        withData
          ? `SELECT e.id AS id, json_extract(e.fields, '$.number') AS number, json_extract(e.fields, '$.status') AS status, json_extract(e.fields, '$.createdAt') AS created_at, json_extract(e.fields, '$.customerId') AS customer_id, json_extract(e.fields, '$.siteId') AS site_id FROM replica_entities e ${active} WHERE e.type = 'work_order'`
          : `SELECT e.id AS id, json_extract(e.fields, '$.number') AS number, json_extract(e.fields, '$.status') AS status, json_extract(e.fields, '$.createdAt') AS created_at FROM replica_entities e ${active} WHERE e.type = 'work_order'`,
      );
      const orders: SourceOrder[] = orderRows.map((row) => {
        const created = typeof row['created_at'] === 'string' ? Date.parse(row['created_at']) : NaN;
        return {
          id: String(row['id']),
          number: nullable(row['number']),
          status: text(row['status']),
          createdAt: Number.isFinite(created) ? created : 0,
          customerId: nullable(row['customer_id']),
          siteId: nullable(row['site_id']),
        };
      });
      if (!withData) return { orders, customers: [], sites: [], stages: [] };
      const customers: SourceCustomer[] = (
        await tx.all(
          `SELECT e.id AS id, json_extract(e.fields, '$.displayName') AS display_name FROM replica_entities e ${active} WHERE e.type = 'customer'`,
        )
      ).map((row) => ({ id: String(row['id']), displayName: text(row['display_name']) }));
      const sites: SourceSite[] = (
        await tx.all(
          `SELECT e.id AS id, json_extract(e.fields, '$.street') AS street, json_extract(e.fields, '$.buildingNumber') AS building_number, json_extract(e.fields, '$.city') AS city, json_extract(e.fields, '$.parkingSpotNumber') AS parking_spot FROM replica_entities e ${active} WHERE e.type = 'site'`,
        )
      ).map((row) => ({
        id: String(row['id']),
        street: text(row['street']),
        buildingNumber: text(row['building_number']),
        city: text(row['city']),
        parkingSpot: text(row['parking_spot']),
      }));
      const stages: SourceStage[] = (
        await tx.all(
          `SELECT e.work_order_id AS work_order_id, json_extract(e.fields, '$.name') AS name, json_extract(e.fields, '$.position') AS position, json_extract(e.fields, '$.status') AS status FROM replica_entities e ${active} WHERE e.type = 'procedure_stage' AND e.work_order_id IS NOT NULL`,
        )
      ).map((row) => ({
        workOrderId: String(row['work_order_id']),
        name: text(row['name']),
        position: typeof row['position'] === 'number' ? row['position'] : 0,
        status: text(row['status']),
      }));
      return { orders, customers, sites, stages };
    });
  }

  /**
   * The source of the work order details (EVM-104 AC1-AC5; security K1, K5, K10): ONE transaction on the active generation, a fixed
   * number of statements whatever the size of the order (no N+1; ids in chunks only for a very long list). The id of the work order is
   * always a bound parameter. It never selects the whole `fields` document - only allow-listed keys through `json_extract` - so e-mail,
   * tax id, PPE, the notes and the apartment of the site, the description of the order, the contact data of parties and the payments
   * never leave the database. Children are selected by the column `work_order_id`; parties and users only those the order refers to.
   * `null` = the work order is not in the active generation (outside the scope or deleted).
   */
  async readOrderDetailSource(workOrderId: string): Promise<OrderDetailSource | null> {
    const active = "JOIN replica_generations g ON g.generation = e.generation AND g.role = 'active'";
    const text = (value: unknown): string => (typeof value === 'string' ? value : '');
    const nullable = (value: unknown): string | null => (typeof value === 'string' ? value : null);
    const time = (value: unknown): number | null => {
      const at = typeof value === 'string' ? Date.parse(value) : NaN;
      return Number.isFinite(at) ? at : null;
    };
    const num = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null);
    return this.#db.read(async (tx) => {
      const orderRow = await tx.get(
        `SELECT e.id AS id, json_extract(e.fields, '$.number') AS number, json_extract(e.fields, '$.title') AS title, json_extract(e.fields, '$.status') AS status, json_extract(e.fields, '$.customerId') AS customer_id, json_extract(e.fields, '$.siteId') AS site_id FROM replica_entities e ${active} WHERE e.type = 'work_order' AND e.id = ?`,
        [workOrderId],
      );
      if (orderRow === undefined) return null;
      const customerId = nullable(orderRow['customer_id']);
      const siteId = nullable(orderRow['site_id']);
      const customerRow =
        customerId === null
          ? undefined
          : await tx.get(
              `SELECT e.id AS id, json_extract(e.fields, '$.displayName') AS display_name, json_extract(e.fields, '$.phone') AS phone FROM replica_entities e ${active} WHERE e.type = 'customer' AND e.id = ?`,
              [customerId],
            );
      const siteRow =
        siteId === null
          ? undefined
          : await tx.get(
              `SELECT e.id AS id, json_extract(e.fields, '$.street') AS street, json_extract(e.fields, '$.buildingNumber') AS building_number, json_extract(e.fields, '$.postalCode') AS postal_code, json_extract(e.fields, '$.city') AS city, json_extract(e.fields, '$.parkingSpotNumber') AS parking_spot, json_extract(e.fields, '$.garageLevel') AS garage_level, json_extract(e.fields, '$.connectionPowerKw') AS power_kw, json_extract(e.fields, '$.managerPartyId') AS manager_party_id, json_extract(e.fields, '$.distributionSystemOperatorPartyId') AS operator_party_id FROM replica_entities e ${active} WHERE e.type = 'site' AND e.id = ?`,
              [siteId],
            );
      const scopeItems: DetailScopeItem[] = (
        await tx.all(
          `SELECT e.id AS id, json_extract(e.fields, '$.position') AS position, json_extract(e.fields, '$.name') AS name, json_extract(e.fields, '$.quantity') AS quantity FROM replica_entities e ${active} WHERE e.type = 'scope_item' AND e.work_order_id = ? ORDER BY e.id`,
          [workOrderId],
        )
      ).map((row) => ({
        id: String(row['id']),
        position: num(row['position']) ?? 0,
        name: text(row['name']),
        quantity: num(row['quantity']),
      }));
      const stages: DetailStageSource[] = (
        await tx.all(
          `SELECT e.id AS id, json_extract(e.fields, '$.procedureId') AS procedure_id, json_extract(e.fields, '$.procedureName') AS procedure_name, json_extract(e.fields, '$.name') AS name, json_extract(e.fields, '$.position') AS position, json_extract(e.fields, '$.status') AS status, json_extract(e.fields, '$.waitingOn') AS waiting_on, json_extract(e.fields, '$.waitingPartyId') AS waiting_party_id FROM replica_entities e ${active} WHERE e.type = 'procedure_stage' AND e.work_order_id = ? ORDER BY e.id`,
          [workOrderId],
        )
      ).map((row) => ({
        id: String(row['id']),
        procedureId: nullable(row['procedure_id']) ?? String(row['id']),
        procedureName: text(row['procedure_name']),
        name: text(row['name']),
        position: num(row['position']) ?? 0,
        status: text(row['status']),
        waitingOn: nullable(row['waiting_on']),
        waitingPartyId: nullable(row['waiting_party_id']),
      }));
      const entries: DetailEntrySource[] = (
        await tx.all(
          `SELECT e.id AS id, json_extract(e.fields, '$.kind') AS kind, json_extract(e.fields, '$.noteCategory') AS note_category, json_extract(e.fields, '$.body') AS body, json_extract(e.fields, '$.authorUserId') AS author_user_id, json_extract(e.fields, '$.createdAt') AS created_at, json_extract(e.fields, '$.capturedAt') AS captured_at, json_extract(e.fields, '$.redactedAt') AS redacted_at, json_extract(e.fields, '$.supersedesEntryId') AS supersedes_entry_id, json_extract(e.fields, '$.supersededByEntryId') AS superseded_by_entry_id FROM replica_entities e ${active} WHERE e.type = 'timeline_entry' AND e.work_order_id = ? ORDER BY e.id`,
          [workOrderId],
        )
      ).map((row) => ({
        id: String(row['id']),
        kind: text(row['kind']),
        noteCategory: nullable(row['note_category']),
        body: nullable(row['body']),
        authorUserId: nullable(row['author_user_id']),
        createdAt: time(row['created_at']) ?? 0,
        capturedAt: time(row['captured_at']),
        // a redaction mark that is present but unreadable still counts as a redaction (the model then drops the body)
        redactedAt: row['redacted_at'] === null || row['redacted_at'] === undefined ? null : (time(row['redacted_at']) ?? 0),
        supersedesEntryId: nullable(row['supersedes_entry_id']),
        supersededByEntryId: nullable(row['superseded_by_entry_id']),
      }));
      const site =
        siteRow === undefined
          ? null
          : {
              id: String(siteRow['id']),
              street: text(siteRow['street']),
              buildingNumber: text(siteRow['building_number']),
              postalCode: text(siteRow['postal_code']),
              city: text(siteRow['city']),
              parkingSpot: text(siteRow['parking_spot']),
              garageLevel: text(siteRow['garage_level']),
              connectionPowerKw: num(siteRow['power_kw']),
              managerPartyId: nullable(siteRow['manager_party_id']),
              operatorPartyId: nullable(siteRow['operator_party_id']),
            };
      const partyIds = [
        ...new Set(
          [site?.managerPartyId, site?.operatorPartyId, ...stages.map((stage) => stage.waitingPartyId)].filter(
            (id): id is string => typeof id === 'string',
          ),
        ),
      ];
      const authorIds = [...new Set(entries.map((entry) => entry.authorUserId).filter((id): id is string => id !== null))];
      const byIds = async (type: 'party' | 'user', ids: readonly string[]): Promise<SqlRow[]> => {
        const rows: SqlRow[] = [];
        for (const part of chunk(ids, MAX_PARAMS - 1)) {
          rows.push(
            ...(await tx.all(
              `SELECT e.id AS id, json_extract(e.fields, '$.displayName') AS display_name, json_extract(e.fields, '$.kind') AS kind FROM replica_entities e ${active} WHERE e.type = '${type}' AND e.id IN (${part.map(() => '?').join(', ')})`,
              part,
            )),
          );
        }
        return rows;
      };
      const parties: DetailParty[] = (await byIds('party', partyIds)).map((row) => ({
        id: String(row['id']),
        kind: text(row['kind']),
        displayName: text(row['display_name']),
      }));
      const users: DetailUser[] = (await byIds('user', authorIds)).map((row) => ({
        id: String(row['id']),
        displayName: text(row['display_name']),
      }));
      return {
        order: {
          id: String(orderRow['id']),
          number: nullable(orderRow['number']),
          title: text(orderRow['title']),
          status: text(orderRow['status']),
          customerId,
          siteId,
        },
        customer:
          customerRow === undefined
            ? null
            : { id: String(customerRow['id']), displayName: text(customerRow['display_name']), phone: text(customerRow['phone']) },
        site,
        parties,
        scopeItems,
        stages,
        entries,
        users,
      };
    });
  }

  async wipeReplica(): Promise<void> {
    await this.#db.transaction(async (tx) => {
      for (const table of ['replica_entities', 'replica_tombstones', 'replica_hydration', 'replica_generations'])
        await tx.run(`DELETE FROM ${table}`);
      await tx.run("DELETE FROM replica_meta WHERE key IN ('owner', 'pending_resync', 'last_success_at', 'templates')");
      await startFreshActiveGeneration(tx);
    });
  }

  async sweep(rule: SweepRule): Promise<SweepResult> {
    return this.#db.transaction(async (tx) => {
      if (!(await SqlReplicaStore.#exists(tx, rule.generation))) return { removedWorkOrders: 0, removedOrphans: 0 };
      const rows = await tx.all('SELECT type, id, version, fields FROM replica_entities WHERE generation = ?', [rule.generation]);
      const entities: ReplicaEntity[] = rows.map((row) => ({
        type: row['type'] as EntityType,
        id: String(row['id']),
        version: Number(row['version']),
        fields: (parse(row['fields']) ?? {}) as ReplicaEntity['fields'],
      }));
      const plan = planSweep(entities, rule);
      for (const part of chunk(plan.removeKeys, Math.floor((MAX_PARAMS - 1) / 2))) {
        const params: SqlValue[] = [rule.generation];
        for (const key of part) {
          const { type, id } = splitKey(key);
          params.push(type, id);
        }
        await tx.run(
          `DELETE FROM replica_entities WHERE generation = ? AND (type, id) IN (VALUES ${part.map(() => '(?, ?)').join(', ')})`,
          params,
        );
      }
      return { removedWorkOrders: plan.removedWorkOrders, removedOrphans: plan.removedOrphans };
    });
  }

  async saveContact(record: unknown): Promise<void> {
    await this.#db.transaction((tx) => SqlReplicaStore.#setMeta(tx, 'contact', record));
  }

  async saveConfig(config: unknown): Promise<void> {
    await this.#db.transaction((tx) => SqlReplicaStore.#setMeta(tx, 'config', config));
  }
}
