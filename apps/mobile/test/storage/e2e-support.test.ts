// Read-only facts, the probe of a copied file and the wipe fault of the e2e hooks (EVM-093 AC1, AC6): the hooks reach the store only
// through these public ports, and none of them hands out a key, a path or a content.
import type { QueueRecord } from '@evia/sync-core';
import { WIPE_MARKER_FILE, wipeFaultForE2e, type OpenResult, type UnlockedStore } from '../../src/storage/local-data';
import { boot, newDevice, type Device } from './fakes';
import { NodeSqliteEngine, newDisk, removeDisk, type TestDisk } from './node-sqlite-engine';

let disk: TestDisk;
let device: Device;
beforeEach(() => {
  disk = newDisk();
  device = newDevice(disk);
  wipeFaultForE2e.afterStep = null;
});
afterEach(() => {
  removeDisk(disk);
});

const USER_A = '90000000-0000-4000-8000-0000000000aa';
const USER_B = '90000000-0000-4000-8000-0000000000bb';
const WO = '10000000-0000-4000-8000-000000000001';
const mid = (n: number): string => `0194c2a0-0000-7000-8000-${String(n).padStart(12, '0')}`;
const record = (n: number): QueueRecord => ({
  mutationId: mid(n),
  type: 'CreateNote',
  commandVersion: 1,
  payload: { id: mid(n + 100), workOrderId: WO, body: `synthetic ${String(n)}` },
  objectId: mid(n + 100),
  orderingKey: WO,
  createdAt: n,
  ownerUserId: USER_A,
  state: 'pending',
  attempts: 0,
});

function unlocked(result: OpenResult): UnlockedStore {
  if (result.kind !== 'unlocked') throw new Error(`expected unlocked, got ${result.kind}`);
  return result.store;
}

describe('ports of the e2e hooks (EVM-093 AC1, AC6)', () => {
  it('EVM-093 AC1: facts report the cipher version and temp_store of the open database, and nothing before it is opened', async () => {
    const { host } = boot(device);
    expect(await host.facts()).toEqual({ open: false, cipherVersion: null, tempStore: null, wipePending: false });
    unlocked(await host.openForUser(USER_A));
    expect(await host.facts()).toEqual({ open: true, cipherVersion: '4.17.0 community', tempStore: 2, wipePending: false });
    device.files.set(WIPE_MARKER_FILE, '1');
    expect((await host.facts()).wipePending).toBe(true);
    device.fail.set(`files.read:${WIPE_MARKER_FILE}`, { after: false, sticky: false });
    expect((await host.facts()).wipePending).toBeNull();
  });

  it('EVM-093 AC6: a copy taken before the wipe does not open with the new key (code only), the current file does (positive control)', async () => {
    const first = boot(device);
    const store = unlocked(await first.host.openForUser(USER_A));
    await store.queue.append(record(1));
    const before = new NodeSqliteEngine(disk, 'evia-copy.db');
    new NodeSqliteEngine(disk).copyTo(before);
    expect(await first.host.wipeCompanyData()).toBe('done');

    const second = boot(device);
    const fresh = unlocked(await second.host.openForUser(USER_B));
    expect(await second.host.probe(before)).toBe('not_a_database');
    const current = new NodeSqliteEngine(disk, 'evia-current.db');
    new NodeSqliteEngine(disk).copyTo(current);
    expect(await second.host.probe(current)).toBe('opened');
    // the probe never replaces the open database of the host
    expect(await fresh.queue.readAll()).toEqual([]);
    await fresh.queue.append(record(2));
    expect(await fresh.queue.readAll()).toHaveLength(1);
  });

  it('EVM-093 AC6: without a key the probe answers a code and opens nothing', async () => {
    const { host } = boot(device);
    const copy = new NodeSqliteEngine(disk, 'evia-copy.db');
    expect(await host.probe(copy)).toBe('key_unavailable');
    expect(copy.openConnections).toBe(0);
  });

  it('EVM-093 AC6: the wipe fault set by the e2e hooks fails the named step once; the marker stays and the next start finishes', async () => {
    const first = boot(device);
    unlocked(await first.host.openForUser(USER_A));
    wipeFaultForE2e.afterStep = 'database_file';
    expect(await first.host.wipeCompanyData()).toBe('incomplete');
    expect(wipeFaultForE2e.afterStep).toBeNull();
    expect(first.diagnostics).toContainEqual({ event: 'wipe-step-failed', step: 'database_file' });
    expect(device.files.has(WIPE_MARKER_FILE)).toBe(true);
    // the step itself ran (a crash AFTER it): the key is already gone
    expect(device.key).toBeNull();

    const second = boot(device);
    expect(await second.host.prepare()).toBe('ready');
    expect(device.files.has(WIPE_MARKER_FILE)).toBe(false);
  });
});
