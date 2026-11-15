import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { QueueRecord } from '@evia/sync-core';
import { Database } from '../../src/storage/database';
import { SqlMediaFileStore, type NewMediaFile } from '../../src/storage/media-file-store';
import { SqlQueueStore } from '../../src/storage/queue-store';
import { SqlReplicaStore } from '../../src/storage/replica-store';
import { SCHEMA, migrate, readVersions, type SchemaPlan } from '../../src/storage/schema';
import { migratedDatabase } from './harness';
import { newDisk, removeDisk, type TestDisk } from './node-sqlite-engine';

/** The core of this branch does not know the type yet (the contract branch adds it): the rows of the queue are written raw. */
const MEDIA_COMMAND = 'CreateMediaAsset' as unknown as QueueRecord['type'];

let disk: TestDisk;
beforeEach(() => {
  disk = newDisk();
});
afterEach(() => {
  removeDisk(disk);
});

const OWNER = '90000000-0000-4000-8000-0000000000aa';
const OTHER = '90000000-0000-4000-8000-0000000000bb';
const WO = '10000000-0000-4000-8000-000000000001';
const asset = (n: number): string => `0194c2a0-0000-7000-8000-${String(n).padStart(12, '0')}`;
const mutation = (n: number): string => `0194c2a1-0000-7000-8000-${String(n).padStart(12, '0')}`;
const SHA = 'a'.repeat(64);

const file = (n: number, overrides: Partial<NewMediaFile> = {}): NewMediaFile => ({
  assetId: asset(n),
  mutationId: mutation(n),
  workOrderId: WO,
  ownerUserId: OWNER,
  fileName: asset(n),
  sizeBytes: 1000 + n,
  sha256: SHA,
  mime: 'image/jpeg',
  createdAt: n,
  ...overrides,
});

const command = (n: number, owner = OWNER): QueueRecord => ({
  mutationId: mutation(n),
  type: MEDIA_COMMAND,
  commandVersion: 1,
  payload: { id: asset(n), workOrderId: WO, mediaType: 'photo', category: 'other' },
  objectId: asset(n),
  orderingKey: WO,
  createdAt: n,
  ownerUserId: owner,
  state: 'pending',
  attempts: 0,
});

describe('the table of files of the queue (EVM-130 AC4; architect 6)', () => {
  it('EVM-130 AC4: the table is on the queue side, minimal, with no address, token, description or progress column', async () => {
    const { db } = await migratedDatabase(disk);
    const columns = (await db.read((tx) => tx.all('PRAGMA table_info(media_files)'))).map((c) => String(c['name']));
    expect(columns).toEqual([
      'asset_id',
      'mutation_id',
      'work_order_id',
      'owner_user_id',
      'file_name',
      'size_bytes',
      'sha256',
      'mime',
      'state',
      'last_code',
      'created_at',
      'updated_at',
      // v3 (EVM-108): the only addition, a closed code of the category of the picture
      'category',
    ]);
  });

  it('EVM-130 AC4: a database of the previous version (queue v1, 120 entries) migrates to v2 with the queue intact and an empty table of files', async () => {
    const previous: SchemaPlan = { queue: SCHEMA.queue.filter((m) => m.version === 1), replica: SCHEMA.replica };
    const { db } = await migratedDatabase(disk, previous);
    const queue = new SqlQueueStore(db);
    for (let n = 1; n <= 120; n += 1) await queue.append({ ...command(n), type: 'CreateNote' });
    const before = JSON.stringify(
      await db.read((tx) => tx.all('SELECT seq, mutation_id, owner_user_id, record FROM queue_entries ORDER BY seq')),
    );
    expect(await db.read(readVersions)).toEqual({ queue: 1, replica: 1 });
    expect(await migrate(db, SCHEMA)).toEqual({ kind: 'ok', replicaReset: false });
    expect(await db.read(readVersions)).toEqual({ queue: 3, replica: 1 });
    expect(
      JSON.stringify(await db.read((tx) => tx.all('SELECT seq, mutation_id, owner_user_id, record FROM queue_entries ORDER BY seq'))),
    ).toBe(before);
    expect(await new SqlMediaFileStore(db, OWNER).list()).toEqual([]);
  });

  it('EVM-130 AC4: a row is registered as pending, listed for its owner only, and a second registration of the same asset changes nothing', async () => {
    const { db } = await migratedDatabase(disk);
    const queue = new SqlQueueStore(db);
    await queue.append(command(1));
    const store = new SqlMediaFileStore(db, OWNER);
    await store.register(file(1));
    await store.register(file(1, { sizeBytes: 5 }));
    const rows = await store.list();
    expect(rows).toEqual([
      {
        assetId: asset(1),
        mutationId: mutation(1),
        workOrderId: WO,
        ownerUserId: OWNER,
        fileName: asset(1),
        sizeBytes: 1001,
        sha256: SHA,
        mime: 'image/jpeg',
        state: 'pending',
        lastCode: null,
        createdAt: 1,
        updatedAt: 1,
      },
    ]);
    expect(await new SqlMediaFileStore(db, OTHER).list()).toEqual([]);
    await new SqlMediaFileStore(db, OTHER).setState(asset(1), 'clean', null, 9);
    expect((await store.list())[0]?.state).toBe('pending');
  });

  it('EVM-130 AC4: a row that is not a UUID name, a foreign owner, a bad digest or an empty file is refused (no path, no free text)', async () => {
    const { db } = await migratedDatabase(disk);
    const store = new SqlMediaFileStore(db, OWNER);
    for (const bad of [
      file(1, { fileName: '../escape' }),
      file(1, { assetId: 'not-a-uuid', fileName: 'not-a-uuid' }),
      file(1, { ownerUserId: OTHER }),
      file(1, { sha256: 'zz' }),
      file(1, { sizeBytes: 0 }),
      file(1, { mime: 'text/html' }),
      file(1, { workOrderId: 'x' }),
    ]) {
      await expect(store.register(bad)).rejects.toThrow('invalid_media_file');
    }
    expect(await store.list()).toEqual([]);
  });

  it('EVM-130 AC1: settling the command marks the file applied in the SAME transaction; a file whose command is still in the queue stays pending', async () => {
    const { db } = await migratedDatabase(disk);
    const queue = new SqlQueueStore(db);
    const store = new SqlMediaFileStore(db, OWNER);
    for (const n of [1, 2]) {
      await queue.append(command(n));
      await store.register(file(n));
    }
    await queue.settle(mutation(1), { outcome: 'applied', warnings: [] });
    await queue.settle(mutation(7), { outcome: 'applied', warnings: [] });
    expect((await store.list()).map((row) => [row.assetId, row.state])).toEqual([
      [asset(1), 'applied'],
      [asset(2), 'pending'],
    ]);
  });

  it('EVM-130 AC1: the rollback of a settle leaves the row pending (no state without the settled command)', async () => {
    const { db, engine } = await migratedDatabase(disk);
    const queue = new SqlQueueStore(db);
    const store = new SqlMediaFileStore(db, OWNER);
    await queue.append(command(1));
    await store.register(file(1));
    engine.failNext((sql) => sql.startsWith('UPDATE media_files SET state'));
    await expect(queue.settle(mutation(1), { outcome: 'applied', warnings: [] })).rejects.toBeDefined();
    expect((await store.list())[0]?.state).toBe('pending');
    expect(await queue.readAll()).toHaveLength(1);
    await queue.settle(mutation(1), { outcome: 'duplicate', warnings: [] });
    expect((await store.list())[0]?.state).toBe('applied');
  });

  it('EVM-130 AC4: the states move, the code is kept as a code, the row stays after clean; an unknown state in a row is skipped, never invented', async () => {
    const { db } = await migratedDatabase(disk);
    const store = new SqlMediaFileStore(db, OWNER);
    await store.register(file(1));
    await store.setState(asset(1), 'failed', 'checksum_mismatch', 5);
    expect(await store.list()).toMatchObject([{ state: 'failed', lastCode: 'checksum_mismatch', updatedAt: 5 }]);
    await store.setState(asset(1), 'clean', null, 6);
    expect(await store.list()).toMatchObject([{ state: 'clean', lastCode: null }]);
    await expect(store.setState(asset(1), 'bogus' as never, null, 7)).rejects.toThrow('invalid_media_state');
    await db.transaction((tx) => tx.run("UPDATE media_files SET state = 'clean' WHERE asset_id = ?", [asset(1)]));
    // `remove` only ever removes a row that never left `pending`
    await store.remove(asset(1));
    expect(await store.list()).toHaveLength(1);
    await store.register(file(2));
    await store.remove(asset(2));
    expect((await store.list()).map((row) => row.assetId)).toEqual([asset(1)]);
  });

  it('EVM-108 AC6 (security 19): `discard` removes the row of a file that needs attention - only that state, only the own row', async () => {
    const { db } = await migratedDatabase(disk);
    const store = new SqlMediaFileStore(db, OWNER);
    const other = new SqlMediaFileStore(db, OTHER);
    await store.register(file(1));
    await store.register(file(2));
    await other.register(file(3, { ownerUserId: OTHER }));
    await store.setState(asset(1), 'needs_attention', 'quarantined', 5);
    await store.setState(asset(2), 'failed', 'checksum_mismatch', 5);
    await other.setState(asset(3), 'needs_attention', 'quarantined', 5);
    // a file in another state (a failed one still has "Ponów") and another owner's row are not touched
    await store.discard(asset(2));
    await store.discard(asset(3));
    expect((await store.list()).map((row) => row.assetId)).toEqual([asset(1), asset(2)]);
    expect((await other.list()).map((row) => row.assetId)).toEqual([asset(3)]);
    await store.discard(asset(1));
    expect((await store.list()).map((row) => row.assetId)).toEqual([asset(2)]);
  });

  it('EVM-130 AC4: the state of the file on the server comes from the active generation of the replica; nothing else of the entity leaves', async () => {
    const { db } = await migratedDatabase(disk);
    const replica = new SqlReplicaStore(db);
    const { active } = await replica.loadState();
    const entity = (n: number, fileState: string, reason: string | null) => ({
      op: 'upsert' as const,
      entity: {
        type: 'media_asset' as const,
        id: asset(n),
        version: 1,
        fields: { workOrderId: WO, mediaType: 'photo', description: 'SYNTHETIC-DESCRIPTION', fileState, fileStateReasonCode: reason },
      },
    });
    await replica.applyPage({
      generation: active.generation,
      ownerUserId: OWNER,
      ops: [
        { op: 'upsert', entity: { type: 'work_order', id: WO, version: 1, fields: { siteId: null } } },
        entity(1, 'ready', null),
        entity(2, 'failed', 'checksum_mismatch'),
      ],
      cursor: 'cursor-000000000001',
      phase: 'changes',
      complete: true,
      serverTime: 1,
      hydrationAdd: [],
      hydrationRemove: [],
    });
    const states = await replica.readMediaServerStates([asset(1), asset(2), asset(3)]);
    expect([...states.entries()]).toEqual([
      [asset(1), { fileState: 'ready', reasonCode: null }],
      [asset(2), { fileState: 'failed', reasonCode: 'checksum_mismatch' }],
    ]);
    expect(JSON.stringify([...states.values()])).not.toContain('SYNTHETIC');
    expect((await replica.readMediaServerStates([])).size).toBe(0);
  });

  it('EVM-130 AC4: the database object is the one the stores share (a closed database refuses the store)', async () => {
    const { db } = await migratedDatabase(disk);
    const store = new SqlMediaFileStore(db, OWNER);
    await db.close();
    expect(db).toBeInstanceOf(Database);
    await expect(store.list()).rejects.toBeDefined();
  });
});

describe('the category of a picture, schema v3 (EVM-108 AC1; SR-MOB-10; RR-98)', () => {
  const V2_ONLY: SchemaPlan = { queue: SCHEMA.queue.filter((m) => m.version <= 2), replica: SCHEMA.replica };

  /** A row as the previous app version wrote it (the table of v2 has no column of the category). */
  const rowOfV2 = async (db: Database, n: number): Promise<void> => {
    await db.transaction((tx) =>
      tx.run(
        "INSERT INTO media_files (asset_id, mutation_id, work_order_id, owner_user_id, file_name, size_bytes, sha256, mime, state, last_code, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'image/jpeg', 'pending', NULL, ?, ?)",
        [asset(n), mutation(n), WO, OWNER, asset(n), 1000 + n, SHA, n, n],
      ),
    );
  };

  it('EVM-108 AC1: v2 -> v3 keeps every row of the files and the queue, the new column is empty (shown as a picture without a category)', async () => {
    const { db } = await migratedDatabase(disk, V2_ONLY);
    const queue = new SqlQueueStore(db);
    const store = new SqlMediaFileStore(db, OWNER);
    for (let n = 1; n <= 5; n += 1) {
      await queue.append(command(n));
      await rowOfV2(db, n);
    }
    await store.setState(asset(2), 'failed', 'checksum_mismatch', 9);
    const rowsOf = async (): Promise<string> =>
      JSON.stringify(
        await db.read((tx) =>
          tx.all('SELECT asset_id, mutation_id, state, last_code, size_bytes, created_at, updated_at FROM media_files ORDER BY asset_id'),
        ),
      );
    const rowsBefore = await rowsOf();
    const queueBefore = JSON.stringify(await db.read((tx) => tx.all('SELECT seq, mutation_id, record FROM queue_entries ORDER BY seq')));
    expect(await db.read(readVersions)).toEqual({ queue: 2, replica: 1 });
    expect(await migrate(db, SCHEMA)).toEqual({ kind: 'ok', replicaReset: false });
    expect(await db.read(readVersions)).toEqual({ queue: 3, replica: 1 });
    expect(await rowsOf()).toBe(rowsBefore);
    expect(await store.list()).toHaveLength(5);
    expect(JSON.stringify(await db.read((tx) => tx.all('SELECT seq, mutation_id, record FROM queue_entries ORDER BY seq')))).toBe(
      queueBefore,
    );
    expect(await db.read((tx) => tx.all('SELECT category FROM media_files WHERE category IS NOT NULL'))).toEqual([]);
    // running the migration again is nothing to do (the version is stored in the same transaction)
    expect(await migrate(db, SCHEMA)).toEqual({ kind: 'ok', replicaReset: false });
  });

  it('EVM-108 AC1: a v3 migration that fails is rolled back with its version - the app keeps v2 and every row (rollback)', async () => {
    const { db, engine } = await migratedDatabase(disk, V2_ONLY);
    await new SqlQueueStore(db).append(command(1));
    await rowOfV2(db, 1);
    engine.failNext((sql) => sql.includes('ADD COLUMN category'));
    await expect(migrate(db, SCHEMA)).rejects.toBeDefined();
    expect(await db.read(readVersions)).toEqual({ queue: 2, replica: 1 });
    const columns = (await db.read((tx) => tx.all('PRAGMA table_info(media_files)'))).map((c) => String(c['name']));
    expect(columns).not.toContain('category');
    expect(await db.read((tx) => tx.all('SELECT asset_id FROM media_files'))).toHaveLength(1);
    expect(await migrate(db, SCHEMA)).toEqual({ kind: 'ok', replicaReset: false });
    expect(await db.read(readVersions)).toEqual({ queue: 3, replica: 1 });
  });

  it('EVM-108 AC1: the category is stored with the row and read back; a row without one has no category, an unknown code reads as "unknown"', async () => {
    const { db } = await migratedDatabase(disk);
    const store = new SqlMediaFileStore(db, OWNER);
    await store.register(file(1, { category: 'defect' }));
    await store.register(file(2));
    await store.register(file(3, { category: 'other' }));
    await db.transaction((tx) => tx.run("UPDATE media_files SET category = 'from-the-future' WHERE asset_id = ?", [asset(3)]));
    const rows = await store.list();
    expect(rows.map((row) => row.category)).toEqual(['defect', undefined, 'unknown']);
    expect('category' in (rows[1] ?? {})).toBe(false);
  });

  it('EVM-108 AC1: a category outside the closed list is refused before anything is written', async () => {
    const { db } = await migratedDatabase(disk);
    const store = new SqlMediaFileStore(db, OWNER);
    await expect(store.register(file(1, { category: 'holiday' as never }))).rejects.toThrow('invalid_media_file');
    expect(await store.list()).toEqual([]);
  });

  it('EVM-108 AC1: the job file of the native module never carries the category (RR-98) - the allow-list of its keys is unchanged', () => {
    const kotlin = readFileSync(
      join(
        __dirname,
        '..',
        '..',
        'modules',
        'evia-upload',
        'engine',
        'src',
        'main',
        'kotlin',
        'pl',
        'eviacharge',
        'upload',
        'files',
        'JobFile.kt',
      ),
      'utf8',
    );
    const names = /val FIELD_NAMES =\s*setOf\(([^)]*)\)/.exec(kotlin)?.[1] ?? '';
    expect([...names.matchAll(/"([A-Za-z0-9]+)"/g)].map((match) => match[1])).toEqual([
      'fileSchemaVersion',
      'assetId',
      'workOrderId',
      'size',
      'userId',
      'deviceId',
      'contentType',
      'sha256',
      'snapshot',
    ]);
    expect(kotlin).not.toMatch(/category/i);
  });
});
