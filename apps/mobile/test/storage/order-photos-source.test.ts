// EVM-142 AC2: the photos of an order are read from the active generation of the replica - photos only, allow-listed keys, the id of the order as a bound parameter.
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

const OWNER = '90000000-0000-4000-8000-0000000000aa';
const WO = '10000000-0000-4000-8000-000000000001';
const OTHER_WO = '10000000-0000-4000-8000-000000000002';
const asset = (n: number): string => `0194c2a0-0000-7000-8000-${String(n).padStart(12, '0')}`;

describe('readOrderMedia (EVM-142 AC2)', () => {
  it('EVM-142 AC2: the photos and (EVM-143) films of THIS order, with the kind, category, description, time and state; other orders, other kinds and every other key stay out', async () => {
    const { db } = await migratedDatabase(disk);
    const replica = new SqlReplicaStore(db);
    const { active } = await replica.loadState();
    const media = (n: number, workOrderId: string, fields: Record<string, unknown>) => ({
      op: 'upsert' as const,
      entity: {
        type: 'media_asset' as const,
        id: asset(n),
        version: 1,
        fields: { workOrderId, mediaType: 'photo', fileState: 'ready', ...fields },
      },
    });
    await replica.applyPage({
      generation: active.generation,
      ownerUserId: OWNER,
      ops: [
        { op: 'upsert', entity: { type: 'work_order', id: WO, version: 1, fields: { siteId: null } } },
        { op: 'upsert', entity: { type: 'work_order', id: OTHER_WO, version: 1, fields: { siteId: null } } },
        media(1, WO, { category: 'defect', description: 'SYNTHETIC-DESCRIPTION', capturedAt: '2026-11-18T09:30:00Z', sizeBytes: 123456 }),
        media(2, WO, { mediaType: 'video', fileState: 'ready', duration: 20 }),
        media(6, WO, { mediaType: 'document' }),
        media(3, OTHER_WO, { category: 'other' }),
        media(4, WO, { fileState: 'quarantined', capturedAt: null, category: null, description: null }),
        // a record of a newer server: no state, a time that is not text, a category that is not text - read as unknown, never as a crash
        media(5, WO, { fileState: undefined, capturedAt: 1_700_000_000_000, category: 7, description: 8 }),
      ],
      cursor: 'cursor-000000000001',
      phase: 'changes',
      complete: true,
      serverTime: 1,
      hydrationAdd: [],
      hydrationRemove: [],
    });
    const rows = await replica.readOrderMedia(WO);
    expect(rows.map((row) => row.id).sort()).toEqual([asset(1), asset(2), asset(4), asset(5)]);
    expect(rows.find((row) => row.id === asset(5))).toEqual({
      id: asset(5),
      mediaType: 'photo',
      category: null,
      description: null,
      capturedAt: null,
      fileState: 'unknown',
    });
    expect(rows.find((row) => row.id === asset(1))).toEqual({
      id: asset(1),
      mediaType: 'photo',
      category: 'defect',
      description: 'SYNTHETIC-DESCRIPTION',
      capturedAt: Date.UTC(2026, 10, 18, 9, 30),
      fileState: 'ready',
    });
    expect(rows.find((row) => row.id === asset(4))).toEqual({
      id: asset(4),
      mediaType: 'photo',
      category: null,
      description: null,
      capturedAt: null,
      fileState: 'quarantined',
    });
    expect(rows.find((row) => row.id === asset(2))).toEqual({
      id: asset(2),
      mediaType: 'video',
      category: null,
      description: null,
      capturedAt: null,
      fileState: 'ready',
    });
    expect(JSON.stringify(rows)).not.toContain('123456');
    expect(await replica.readOrderMedia('10000000-0000-4000-8000-0000000000ff')).toEqual([]);
  });
});
