import type { QueueRecord } from '@evia/sync-core';
import { SqlMediaFileStore, type NewMediaFile } from '../../src/storage/media-file-store';
import { SqlQueueStore, type PendingMediaFile } from '../../src/storage/queue-store';
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

const row = (n: number, overrides: Partial<PendingMediaFile> = {}): PendingMediaFile => ({
  assetId: asset(n),
  workOrderId: WO,
  ownerUserId: OWNER,
  fileName: asset(n),
  sizeBytes: 1000 + n,
  sha256: 'a'.repeat(64),
  mime: 'image/jpeg',
  createdAt: n,
  category: 'defect',
  ...overrides,
});

const command = (n: number, overrides: Partial<QueueRecord> = {}): QueueRecord => ({
  mutationId: mutation(n),
  type: MEDIA_COMMAND,
  commandVersion: 1,
  payload: { id: asset(n), workOrderId: WO, mediaType: 'photo', category: 'defect' },
  objectId: asset(n),
  orderingKey: WO,
  createdAt: n,
  ownerUserId: OWNER,
  state: 'pending',
  attempts: 0,
  ...overrides,
});

describe('one transaction for the command and the row of a captured file (EVM-108 AC1; security 14)', () => {
  it('EVM-108 AC1: the command and the row are written in ONE transaction of the encrypted database, the row carries the mutation id of the command', async () => {
    const { db, engine } = await migratedDatabase(disk);
    const queue = new SqlQueueStore(db);
    queue.registerPendingMedia(row(1));
    const before = engine.statements.length;
    await queue.append(command(1));
    const writes = engine.statements.slice(before).filter((sql) => /^(BEGIN|COMMIT|ROLLBACK|INSERT)/.test(sql));
    expect(
      writes.map((sql) =>
        sql
          .split(' ')
          .slice(0, sql.startsWith('INSERT') ? 3 : 2)
          .join(' '),
      ),
    ).toEqual(['BEGIN IMMEDIATE', 'INSERT INTO queue_entries', 'INSERT INTO media_files', 'COMMIT']);
    expect(await queue.readAll()).toHaveLength(1);
    expect(await new SqlMediaFileStore(db, OWNER).list()).toMatchObject([
      { assetId: asset(1), mutationId: mutation(1), state: 'pending', category: 'defect', createdAt: 1, sizeBytes: 1001 },
    ]);
  });

  it('EVM-108 AC1: a failure after the command was written leaves neither the command nor the row', async () => {
    const { db, engine } = await migratedDatabase(disk);
    const queue = new SqlQueueStore(db);
    queue.registerPendingMedia(row(1));
    engine.failNext((sql) => sql.startsWith('INSERT INTO media_files'));
    await expect(queue.append(command(1))).rejects.toBeDefined();
    expect(await queue.readAll()).toEqual([]);
    expect(await new SqlMediaFileStore(db, OWNER).list()).toEqual([]);
    // the registration was used up by the failed append: a retry without a new registration writes the command only
    await queue.append(command(1, { mutationId: mutation(11) }));
    expect(await queue.readAll()).toHaveLength(1);
    expect(await new SqlMediaFileStore(db, OWNER).list()).toEqual([]);
  });

  it('EVM-108 AC1: a failure of the command itself leaves no row either', async () => {
    const { db, engine } = await migratedDatabase(disk);
    const queue = new SqlQueueStore(db);
    queue.registerPendingMedia(row(1));
    engine.failNext((sql) => sql.startsWith('INSERT INTO queue_entries'));
    await expect(queue.append(command(1))).rejects.toBeDefined();
    expect(await new SqlMediaFileStore(db, OWNER).list()).toEqual([]);
  });

  it('EVM-108 AC1: without a registration the command is alone (the files of EVM-128/130 are unchanged), and a registration is used exactly once', async () => {
    const { db } = await migratedDatabase(disk);
    const queue = new SqlQueueStore(db);
    await queue.append(command(1));
    expect(await new SqlMediaFileStore(db, OWNER).list()).toEqual([]);
    queue.registerPendingMedia(row(2));
    await queue.append(command(2));
    await queue.append(command(2, { mutationId: mutation(22) }));
    expect(await new SqlMediaFileStore(db, OWNER).list()).toHaveLength(1);
    expect(await queue.readAll()).toHaveLength(3);
  });

  it('EVM-108 AC1: a stale registration never attaches itself to the next command of another file, and a cleared one is gone', async () => {
    const { db } = await migratedDatabase(disk);
    const queue = new SqlQueueStore(db);
    queue.registerPendingMedia(row(1));
    await queue.append(command(2));
    expect(await new SqlMediaFileStore(db, OWNER).list()).toEqual([]);
    queue.registerPendingMedia(row(3));
    queue.clearPendingMedia(asset(3));
    queue.clearPendingMedia(asset(404));
    await queue.append(command(3));
    expect(await new SqlMediaFileStore(db, OWNER).list()).toEqual([]);
    // the registration of file 1 is still waiting for ITS command
    await queue.append(command(1));
    expect(await new SqlMediaFileStore(db, OWNER).list()).toMatchObject([{ assetId: asset(1), mutationId: mutation(1) }]);
  });

  it('EVM-108 AC1: only a command of the type CreateMediaAsset uses a registration', async () => {
    const { db } = await migratedDatabase(disk);
    const queue = new SqlQueueStore(db);
    queue.registerPendingMedia(row(1));
    await queue.append(command(1, { type: 'CreateNote' }));
    expect(await new SqlMediaFileStore(db, OWNER).list()).toEqual([]);
  });

  it('EVM-108 AC1: a registration of another owner or a row that is not valid is refused: nothing is written, the registration is used up', async () => {
    const { db } = await migratedDatabase(disk);
    const queue = new SqlQueueStore(db);
    const bad: PendingMediaFile[] = [row(1, { ownerUserId: OTHER }), row(1, { sha256: 'zz' }), row(1, { category: 'holiday' as never })];
    for (const registration of bad) {
      queue.registerPendingMedia(registration);
      await expect(queue.append(command(1))).rejects.toThrow('invalid_media_file');
    }
    expect(await queue.readAll()).toEqual([]);
    expect(await new SqlMediaFileStore(db, OWNER).list()).toEqual([]);
  });

  it('EVM-108 AC1: the registration holds no path and no free text - exactly the fields of a row', () => {
    const fields = Object.keys(row(1)) as (keyof NewMediaFile)[];
    expect(fields.sort()).toEqual(
      ['assetId', 'category', 'createdAt', 'fileName', 'mime', 'ownerUserId', 'sha256', 'sizeBytes', 'workOrderId'].sort(),
    );
  });
});
