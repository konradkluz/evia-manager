import { queueStoreConformance } from '@evia/sync-core/conformance/queue';
import { replicaStoreConformance } from '@evia/sync-core/conformance/replica';
import type { QueueStore } from '@evia/sync-core';
import type { Database } from '../../src/storage/database';
import { SqlQueueStore } from '../../src/storage/queue-store';
import { SqlReplicaStore } from '../../src/storage/replica-store';
import { migratedDatabase } from './harness';
import { NodeSqliteEngine, newDisk, removeDisk, type TestDisk } from './node-sqlite-engine';

// EVM-093 AC3: the SQL adapters pass the executable contracts of @evia/sync-core unchanged (Jest transforms the workspace package).
let disks: TestDisk[] = [];
afterEach(() => {
  for (const disk of disks) removeDisk(disk);
  disks = [];
});

// Jest's `it` types a callback with a done argument; the suites pass promise-returning bodies only.
const jestApi = {
  describe,
  it: (name: string, body: () => void | Promise<void>): void => {
    it(name, async () => {
      await body();
    });
  },
  expect,
};

const handles = new WeakMap<QueueStore, { db: Database; engine: NodeSqliteEngine; disk: TestDisk }>();

async function createQueue(): Promise<QueueStore> {
  const disk = newDisk();
  disks.push(disk);
  const { db, engine } = await migratedDatabase(disk);
  const store = new SqlQueueStore(db);
  handles.set(store, { db, engine, disk });
  return store;
}

queueStoreConformance({
  create: createQueue,
  test: jestApi,
  settledOf: (store) => (store as SqlQueueStore).takeSettled(),
  // a crash between the DELETE of the entry and the INSERT of its result, injected through the driver
  injectSettleFailure: (store) => {
    handles.get(store)?.engine.failNext((sql) => sql.startsWith('INSERT INTO settled_results'));
  },
  // a restart: the old connection is closed, a new engine opens the same file
  reopen: async (store) => {
    const handle = handles.get(store);
    if (handle === undefined) throw new Error('unknown store');
    await handle.db.close();
    const { db, engine } = await migratedDatabase(handle.disk);
    const again = new SqlQueueStore(db);
    handles.set(again, { db, engine, disk: handle.disk });
    return again;
  },
});

replicaStoreConformance({
  create: async () => {
    const disk = newDisk();
    disks.push(disk);
    return new SqlReplicaStore((await migratedDatabase(disk)).db);
  },
  test: jestApi,
});
