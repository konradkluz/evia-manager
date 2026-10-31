import { createHash } from 'node:crypto';
import type { QueueRecord } from '@evia/sync-core';
import { Database } from '../../src/storage/database';
import { SqlQueueStore } from '../../src/storage/queue-store';
import { SqlReplicaStore } from '../../src/storage/replica-store';
import {
  QUEUE_TABLES,
  REPLICA_TABLES,
  SCHEMA,
  createReplicaTablesV1,
  dropReplicaTables,
  latest,
  migrate,
  readVersions,
  type SchemaPlan,
} from '../../src/storage/schema';
import { migratedDatabase } from './harness';
import { NodeSqliteEngine, newDisk, removeDisk, type TestDisk } from './node-sqlite-engine';

let disk: TestDisk;
beforeEach(() => {
  disk = newDisk();
});
afterEach(() => {
  removeDisk(disk);
});

const OWNER_A = '90000000-0000-4000-8000-0000000000aa';
const OWNER_B = '90000000-0000-4000-8000-0000000000bb';
const WO = '10000000-0000-4000-8000-000000000001';
const mid = (n: number): string => `0194c2a0-0000-7000-8000-${String(n).padStart(12, '0')}`;
export const entry = (n: number): QueueRecord => ({
  mutationId: mid(n),
  type: 'CreateNote',
  commandVersion: 1,
  payload: { id: mid(n + 1000), workOrderId: WO, body: `synthetic ${String(n)}` },
  objectId: mid(n + 1000),
  orderingKey: WO,
  createdAt: n,
  ownerUserId: n % 3 === 0 ? OWNER_B : OWNER_A,
  state: n % 10 === 0 ? 'needs_attention' : 'pending',
  attempts: n % 4,
});

/** v2 of the synthetic plan: a preserving queue migration and a replica migration that drops the replica (AC2). */
const V2: SchemaPlan = {
  queue: [
    ...SCHEMA.queue,
    {
      version: 2,
      up: async (tx) => {
        await tx.exec('ALTER TABLE queue_entries ADD COLUMN note_v2 TEXT');
        await tx.exec('CREATE INDEX queue_entries_owner ON queue_entries (owner_user_id)');
      },
    },
  ],
  replica: [
    ...SCHEMA.replica,
    {
      version: 2,
      up: async (tx) => {
        await dropReplicaTables(tx);
        await createReplicaTablesV1(tx);
        return 'reset';
      },
    },
  ],
};

async function queueImage(db: Database): Promise<string> {
  const rows = await db.read((tx) => tx.all('SELECT seq, mutation_id, owner_user_id, record FROM queue_entries ORDER BY seq'));
  return createHash('sha256').update(JSON.stringify(rows)).digest('hex');
}

async function seed(db: Database, count: number): Promise<void> {
  const queue = new SqlQueueStore(db);
  for (let n = 1; n <= count; n += 1) await queue.append(entry(n));
  await queue.settle(mid(5), { outcome: 'applied', warnings: [] });
  const replica = new SqlReplicaStore(db);
  const { active } = await replica.loadState();
  await replica.applyPage({
    generation: active.generation,
    ownerUserId: OWNER_A,
    ops: [{ op: 'upsert', entity: { type: 'work_order', id: WO, version: 1, fields: { siteId: null } } }],
    cursor: 'cursor-000000000001',
    phase: 'changes',
    complete: true,
    serverTime: 1,
    hydrationAdd: [],
    hydrationRemove: [],
  });
}

const tables = async (db: Database): Promise<string[]> =>
  (await db.read((tx) => tx.all("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name"))).map((r) => String(r['name']));

describe('local schema and migrations (EVM-093 AC2)', () => {
  it('EVM-093 AC2: a fresh database has separate queue and replica tables and both versions of this app', async () => {
    const { db } = await migratedDatabase(disk);
    expect(await tables(db)).toEqual([...QUEUE_TABLES, ...REPLICA_TABLES].sort());
    expect(await db.read(readVersions)).toEqual(latest(SCHEMA));
    expect(latest(SCHEMA)).toEqual({ queue: 1, replica: 1 });
  });

  it('EVM-093 AC2: N-1 with 120 entries migrates to N with an identical queue (order, mutation_id, owner); the replica is dropped for a new download', async () => {
    const { db } = await migratedDatabase(disk);
    await seed(db, 121);
    const ids = ((await new SqlQueueStore(db).readAll()) as QueueRecord[]).map((r) => r.mutationId);
    expect(ids.length).toBe(120);
    const before = await queueImage(db);
    const generationBefore = (await new SqlReplicaStore(db).loadState()).active.generation;
    expect(await migrate(db, V2)).toEqual({ kind: 'ok', replicaReset: true });
    expect(await db.read(readVersions)).toEqual({ queue: 2, replica: 2 });
    expect(await queueImage(db)).toBe(before);
    const after = (await new SqlQueueStore(db).readAll()) as QueueRecord[];
    expect(after.map((r) => r.mutationId)).toEqual(ids);
    expect(after.map((r) => r.ownerUserId)).toEqual(ids.map((id) => entry(Number(id.slice(-12))).ownerUserId));
    const replica = await new SqlReplicaStore(db).loadState();
    expect(replica.hasData).toBe(false);
    expect(replica.ownerUserId).toBeNull();
    expect(replica.active.initialLoadDone).toBe(false);
    expect(replica.active.generation).toBeGreaterThan(generationBefore);
  });

  it('EVM-093 AC2: the same version migrates nothing', async () => {
    const { db, engine } = await migratedDatabase(disk);
    const count = engine.statements.length;
    expect(await migrate(db, SCHEMA)).toEqual({ kind: 'ok', replicaReset: false });
    const writes = engine.statements
      .slice(count)
      .filter((s) => /^(BEGIN|INSERT|UPDATE|DELETE|CREATE|DROP|ALTER|PRAGMA user_version =)/.test(s));
    expect(writes).toEqual([]);
  });

  it('EVM-093 AC2: a migration interrupted in the middle (injected error) rolls back; the database opens again in N-1 with the queue intact', async () => {
    const { db, engine } = await migratedDatabase(disk);
    await seed(db, 120);
    const before = await queueImage(db);
    engine.failNext((sql) => sql.startsWith('CREATE INDEX queue_entries_owner'));
    await expect(migrate(db, V2)).rejects.toMatchObject({ code: 'sql_failed' });
    expect(await db.read(readVersions)).toEqual({ queue: 1, replica: 1 });
    await db.close();
    const again = new Database(await new NodeSqliteEngine(disk).open());
    expect(await migrate(again, SCHEMA)).toEqual({ kind: 'ok', replicaReset: false });
    expect(await queueImage(again)).toBe(before);
    const columns = (await again.read((tx) => tx.all('PRAGMA table_info(queue_entries)'))).map((c) => c['name']);
    expect(columns).not.toContain('note_v2');
  });

  it('EVM-093 AC2: a replica migration that fails rolls back alone; the queue migration before it stays and the queue is intact', async () => {
    const { db, engine } = await migratedDatabase(disk);
    await seed(db, 10);
    const before = await queueImage(db);
    engine.failNext((sql) => sql === 'DROP TABLE IF EXISTS replica_meta');
    await expect(migrate(db, V2)).rejects.toMatchObject({ code: 'sql_failed' });
    expect(await db.read(readVersions)).toEqual({ queue: 2, replica: 1 });
    expect(await queueImage(db)).toBe(before);
    expect((await new SqlReplicaStore(db).loadState()).hasData).toBe(true);
  });

  it('EVM-093 AC2, SR-MOB-09: a database newer than the app (downgrade) is not modified and reports update_required', async () => {
    const { db, engine } = await migratedDatabase(disk, V2);
    await seed(db, 3);
    await db.close();
    const hash = engine.fileHash();
    const older = new NodeSqliteEngine(disk);
    const again = new Database(await older.open());
    expect(await migrate(again, SCHEMA)).toEqual({ kind: 'update_required' });
    expect(older.statements.filter((s) => !/^(PRAGMA user_version|SELECT)/.test(s))).toEqual([]);
    await again.close();
    expect(older.fileHash()).toBe(hash);
  });

  it('EVM-093 AC2: only the replica being newer is also a downgrade', async () => {
    const replicaOnly: SchemaPlan = { queue: SCHEMA.queue, replica: V2.replica };
    const { db } = await migratedDatabase(disk, replicaOnly);
    expect(await migrate(db, SCHEMA)).toEqual({ kind: 'update_required' });
  });

  it('EVM-093 AC2: migrations run in ascending order whatever the order of the list', async () => {
    const order: number[] = [];
    const first = SCHEMA.queue[0];
    if (first === undefined) throw new Error('schema without v1');
    const plan: SchemaPlan = {
      queue: [
        {
          version: 2,
          up: () => {
            order.push(2);
            return Promise.resolve();
          },
        },
        {
          version: 1,
          up: async (tx) => {
            await first.up(tx);
            order.push(1);
          },
        },
      ],
      replica: SCHEMA.replica,
    };
    await migratedDatabase(disk, plan);
    expect(order).toEqual([1, 2]);
  });

  it('EVM-093 AC2: an empty plan knows version 0', () => {
    expect(latest({ queue: [], replica: [] })).toEqual({ queue: 0, replica: 0 });
  });
});
