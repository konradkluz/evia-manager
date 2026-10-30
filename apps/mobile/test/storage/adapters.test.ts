import type { ApplyPageInput, EntityKey, QueueRecord, ReplicaEntity } from '@evia/sync-core';
import { SETTLED_RETENTION, SqlQueueStore } from '../../src/storage/queue-store';
import { SqlReplicaStore } from '../../src/storage/replica-store';
import { migratedDatabase } from './harness';
import { newDisk, removeDisk, type TestDisk } from './node-sqlite-engine';

let disk: TestDisk;
beforeEach(() => {
  disk = newDisk();
});
afterEach(() => {
  removeDisk(disk);
});

const USER = '90000000-0000-4000-8000-0000000000aa';
const WO = '10000000-0000-4000-8000-000000000001';
const uuid = (prefix: string, n: number): string => `${prefix}0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const record = (n: number): QueueRecord => ({
  mutationId: `0194c2a0-0000-7000-8000-${String(n).padStart(12, '0')}`,
  type: 'CreateNote',
  commandVersion: 1,
  payload: { id: uuid('5', n), workOrderId: WO, body: 'synthetic' },
  objectId: uuid('5', n),
  orderingKey: WO,
  createdAt: n,
  ownerUserId: USER,
  state: 'pending',
  attempts: 0,
});

describe('SqlQueueStore specifics (EVM-093 AC3; SR-MOB-10)', () => {
  it('EVM-093 AC3, SR-MOB-10: an unreadable row is handed over raw (for the core to reject) and no row is skipped', async () => {
    const { db } = await migratedDatabase(disk);
    const store = new SqlQueueStore(db);
    await store.append(record(1));
    await db.read((tx) => tx.run("INSERT INTO queue_entries (mutation_id, owner_user_id, record) VALUES ('broken', NULL, '{not json')"));
    await store.append(record(3));
    const rows = await store.readAll();
    expect(rows.length).toBe(3);
    expect(rows[1]).toBe('{not json');
    expect((rows[2] as QueueRecord).mutationId).toBe(record(3).mutationId);
  });

  it('EVM-093 AC3: update of an unreadable row writes a valid patch without throwing', async () => {
    const { db } = await migratedDatabase(disk);
    await db.read((tx) => tx.run("INSERT INTO queue_entries (mutation_id, owner_user_id, record) VALUES ('m1', NULL, '[1]')"));
    await new SqlQueueStore(db).update('m1', { state: 'blocked', attempts: 1 });
    expect(await new SqlQueueStore(db).readAll()).toEqual([{ state: 'blocked', attempts: 1 }]);
  });

  it('EVM-093 AC3: settled results are bounded (retention) and removed when taken', async () => {
    const { db } = await migratedDatabase(disk);
    const store = new SqlQueueStore(db);
    for (let n = 1; n <= SETTLED_RETENTION + 5; n += 1) await store.settle(`m${String(n)}`, { outcome: 'applied', warnings: [] });
    const taken = await store.takeSettled();
    expect(taken.length).toBe(SETTLED_RETENTION);
    expect(taken[0]?.mutationId).toBe('m6');
    expect(await store.takeSettled()).toEqual([]);
  });

  it('EVM-093 AC2, AC7: settled results and the queue survive wipeReplica (they are the queue side)', async () => {
    const { db } = await migratedDatabase(disk);
    const queue = new SqlQueueStore(db);
    await queue.append(record(1));
    await queue.settle('m-done', { outcome: 'duplicate', warnings: [] });
    await new SqlReplicaStore(db).wipeReplica();
    expect((await queue.readAll()).length).toBe(1);
    expect((await queue.takeSettled()).map((s) => s.mutationId)).toEqual(['m-done']);
  });
});

describe('SqlReplicaStore specifics (EVM-093 AC3; bulk contract of EVM-092)', () => {
  const page = (generation: number, ops: ApplyPageInput['ops']): ApplyPageInput => ({
    generation,
    ownerUserId: USER,
    ops,
    cursor: 'cursor-000000000001',
    phase: 'changes',
    complete: false,
    serverTime: 1,
    hydrationAdd: [],
    hydrationRemove: [],
  });
  const upserts = (entities: ReplicaEntity[]): ApplyPageInput['ops'] => entities.map((entity) => ({ op: 'upsert', entity }));
  const orders = (count: number, site: string | null = null): ReplicaEntity[] =>
    Array.from({ length: count }, (_, i) => ({ type: 'work_order', id: uuid('1', i + 1), version: 1, fields: { siteId: site } }));

  it('EVM-093 AC3: readVersions of 1200 keys works in bounded chunks with a constant number of statements per chunk (no N+1)', async () => {
    const { db, engine } = await migratedDatabase(disk);
    const store = new SqlReplicaStore(db);
    const { active } = await store.loadState();
    const entities = orders(1200);
    await store.applyPage(page(active.generation, upserts(entities)));
    const before = engine.statements.length;
    const keys = entities.map((e) => `work_order:${e.id}` as EntityKey);
    const versions = await store.readVersions(active.generation, keys);
    expect(versions.size).toBe(1200);
    const reads = engine.statements.slice(before);
    expect(reads.length).toBe(2 * Math.ceil(1200 / 249));
    for (const sql of reads) expect((sql.match(/\?/g) ?? []).length).toBeLessThanOrEqual(500);
  });

  it('EVM-093 AC3: findWorkOrdersBySite answers 700 sites in chunks', async () => {
    const { db } = await migratedDatabase(disk);
    const store = new SqlReplicaStore(db);
    const { active } = await store.loadState();
    const site = uuid('3', 1);
    await store.applyPage(page(active.generation, upserts(orders(3, site))));
    const sites = [site, ...Array.from({ length: 699 }, (_, i) => uuid('3', i + 2))];
    const found = await store.findWorkOrdersBySite(active.generation, sites);
    expect(found.get(site)?.length).toBe(3);
    expect(found.size).toBe(1);
  });

  it('EVM-093 AC3: an upsert after a cascade delete in the same page re-creates the child (the order of ops is kept)', async () => {
    const { db } = await migratedDatabase(disk);
    const store = new SqlReplicaStore(db);
    const { active } = await store.loadState();
    const child: ReplicaEntity = { type: 'scope_item', id: uuid('5', 1), version: 1, fields: { workOrderId: WO } };
    await store.applyPage(page(active.generation, upserts([{ type: 'work_order', id: WO, version: 1, fields: {} }, child])));
    await store.applyPage(
      page(active.generation, [
        { op: 'delete', type: 'work_order', id: WO, version: 2 },
        { op: 'upsert', entity: { ...child, version: 2 } },
      ]),
    );
    const versions = await store.readVersions(active.generation, [`scope_item:${child.id}`]);
    expect(versions.get(`scope_item:${child.id}`)).toEqual({ version: 2, deleted: false });
  });

  it('EVM-093 AC3: a sweep of a generation that does not exist removes nothing; unreadable stored values come back raw', async () => {
    const { db } = await migratedDatabase(disk);
    const store = new SqlReplicaStore(db);
    expect(await store.sweep({ generation: 999, closedBefore: 0, keepWorkOrderIds: [], keepReferencedIds: [] })).toEqual({
      removedWorkOrders: 0,
      removedOrphans: 0,
    });
    await db.read((tx) => tx.run("INSERT INTO replica_meta (key, value) VALUES ('contact', '{bad')"));
    expect((await store.loadState()).contact).toBe('{bad');
  });

  it('EVM-093 AC2: a replica without an active generation reads as empty (never throws)', async () => {
    const { db } = await migratedDatabase(disk);
    await db.read((tx) => tx.run('DELETE FROM replica_generations'));
    const state = await new SqlReplicaStore(db).loadState();
    expect(state.active.generation).toBe(0);
    expect(state.hasData).toBe(false);
  });
});
