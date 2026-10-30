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

  async wipeReplica(): Promise<void> {
    await this.#db.transaction(async (tx) => {
      for (const table of ['replica_entities', 'replica_tombstones', 'replica_hydration', 'replica_generations'])
        await tx.run(`DELETE FROM ${table}`);
      await tx.run("DELETE FROM replica_meta WHERE key IN ('owner', 'pending_resync')");
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
