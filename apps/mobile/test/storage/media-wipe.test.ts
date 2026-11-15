// The native step of the wipe and the unsent files (EVM-130 AC4, AC5; architect 8; security A3).
import type { QueueRecord } from '@evia/sync-core';
import { WIPE_MARKER_FILE, type OpenResult, type UnlockedStore } from '../../src/storage/local-data';
import { CompanyDataWipe } from '../../src/wipe/company-wipe';
import { boot, newDevice, type Device } from './fakes';
import { newDisk, removeDisk, type TestDisk } from './node-sqlite-engine';

let disk: TestDisk;
let device: Device;
beforeEach(() => {
  disk = newDisk();
  device = newDevice(disk);
});
afterEach(() => {
  for (const handle of disk.handles) if (handle.isOpen) handle.close();
  removeDisk(disk);
});

const USER = '90000000-0000-4000-8000-0000000000aa';
const WO = '10000000-0000-4000-8000-000000000001';
const id = (n: number): string => `0194c2a0-0000-7000-8000-${String(n).padStart(12, '0')}`;
const SHA = 'b'.repeat(64);

function unlocked(result: OpenResult): UnlockedStore {
  if (result.kind !== 'unlocked') throw new Error(`expected unlocked, got ${result.kind}`);
  return result.store;
}

const command = (n: number): QueueRecord => ({
  mutationId: id(n + 500),
  type: 'CreateMediaAsset',
  commandVersion: 1,
  payload: { id: id(n), workOrderId: WO, mediaType: 'photo', category: 'other' },
  objectId: id(n),
  orderingKey: WO,
  createdAt: n,
  ownerUserId: USER,
  state: 'pending',
  attempts: 0,
});

describe('the native step of the wipe (EVM-130 AC5; security A3)', () => {
  it('EVM-130 AC5: the native step registered as FIRST runs right after the marker, before the key, the file and the secrets are touched', async () => {
    const { host } = boot(device);
    unlocked(await host.openForUser(USER));
    const order: string[] = [];
    host.registerWipeStep('late', () => {
      order.push('late');
      return Promise.resolve();
    });
    host.registerWipeStep(
      'native_uploads',
      () => {
        order.push(`native (marker: ${String(device.files.has(WIPE_MARKER_FILE))}, key: ${String(device.key !== null)})`);
        return Promise.resolve();
      },
      { first: true },
    );
    expect(host.wipeStepNames()[0]).toBe('native_uploads');
    expect(host.wipeStepNames().at(-2)).toBe('late');
    expect(await host.wipeCompanyData()).toBe('done');
    expect(order).toEqual(['native (marker: true, key: true)', 'late']);
  });

  it('EVM-130 AC5: a native step that fails ("unfinished") keeps the marker and NOTHING else is deleted; the next start repeats it first', async () => {
    const { host } = boot(device);
    unlocked(await host.openForUser(USER));
    let attempts = 0;
    host.registerWipeStep(
      'native_uploads',
      () => {
        attempts += 1;
        return attempts === 1 ? Promise.reject(new Error('native wipe unfinished')) : Promise.resolve();
      },
      { first: true },
    );
    device.log.length = 0;
    expect(await host.wipeCompanyData()).toBe('incomplete');
    expect(device.files.has(WIPE_MARKER_FILE)).toBe(true);
    expect(device.log).not.toContain('vault.destroy');
    expect(device.log).not.toContain('engine.remove');
    expect(device.key).not.toBeNull();
    // the restart of the app: before any data is read the wipe is finished, the native step is the first of it
    for (const handle of disk.handles) if (handle.isOpen) handle.close();
    const again = boot(device);
    let again_attempts = 0;
    again.host.registerWipeStep(
      'native_uploads',
      () => {
        again_attempts += 1;
        return Promise.resolve();
      },
      { first: true },
    );
    expect(await again.host.prepare()).toBe('ready');
    expect(again_attempts).toBe(1);
    expect(device.files.has(WIPE_MARKER_FILE)).toBe(false);
    expect(device.key).toBeNull();
  });
});

describe('unsent files (EVM-130 AC4; offline-sync.md, pkt 7)', () => {
  it('EVM-130 AC4: a file whose command left the queue but which the server has not confirmed still counts as unsent; a clean one does not', async () => {
    const { host } = boot(device);
    const store = unlocked(await host.openForUser(USER));
    await store.queue.append(command(1));
    await store.media.register({
      assetId: id(1),
      mutationId: id(501),
      workOrderId: WO,
      ownerUserId: USER,
      fileName: id(1),
      sizeBytes: 10,
      sha256: SHA,
      mime: 'image/jpeg',
      createdAt: 1,
    });
    expect(await store.unsentItemCount()).toBe(1);
    // the server state of a file the replica does not know yet is absent (through the capability of the store)
    expect((await store.replicaExtras.readMediaServerStates([id(1)])).size).toBe(0);
    await (store.queue as unknown as { settle(id: string, info: unknown): Promise<void> }).settle(id(501), {
      outcome: 'applied',
      warnings: [],
    });
    expect((await store.media.list())[0]?.state).toBe('applied');
    expect(await store.unsentItemCount()).toBe(1);
    await store.media.setState(id(1), 'uploaded', null, 2);
    expect(await store.unsentItemCount()).toBe(1);
    await store.media.setState(id(1), 'needs_attention', 'quarantined', 3);
    expect(await store.unsentItemCount()).toBe(1);
    await store.media.setState(id(1), 'clean', null, 4);
    expect(await store.unsentItemCount()).toBe(0);
  });
});

describe('the chain of the server-ordered wipe (EVM-130 AC5; architect 8)', () => {
  const chain = async (nativeSteps: (() => Promise<void>)[]) => {
    device.identity = { deviceId: 'device-synthetic-a', secret: 'secret-synthetic-a' };
    const order: string[] = [];
    const { host } = boot(device);
    unlocked(await host.openForUser(USER));
    const attempts = [...nativeSteps];
    host.registerWipeStep(
      'native_uploads',
      () => {
        order.push('native');
        return attempts.shift()?.() ?? Promise.resolve();
      },
      { first: true },
    );
    const wipe = new CompanyDataWipe({
      host,
      client: {
        confirmWipe: () => {
          order.push(`confirmDeviceWipe (identity gone: ${String(device.identity === null)}, key gone: ${String(device.key === null)})`);
          return Promise.resolve({ kind: 'confirmed' as const });
        },
      },
      now: () => 0,
    });
    return { wipe, order, host };
  };

  it('EVM-130 AC5: device_wipe_required — ONE native call first, then the rest of the wipe, and only then confirmDeviceWipe', async () => {
    const { wipe, order } = await chain([() => Promise.resolve()]);
    expect(await wipe.runRequired()).toBe('done');
    expect(order).toEqual(['native', 'confirmDeviceWipe (identity gone: true, key gone: true)']);
  });

  it('EVM-130 AC5: an interrupted native step — nothing is confirmed to the server and the data are not touched; the next start repeats the step first and then confirms', async () => {
    const { wipe, order } = await chain([() => Promise.reject(new Error('native wipe unfinished'))]);
    expect(await wipe.runRequired()).toBe('incomplete');
    expect(order).toEqual(['native']);
    expect(device.key).not.toBeNull();
    expect(device.files.has(WIPE_MARKER_FILE)).toBe(true);
    // the next start of the app: the step runs again (first), the wipe finishes, the owed confirmation goes
    await wipe.resume();
    expect(order).toEqual(['native', 'native', 'confirmDeviceWipe (identity gone: true, key gone: true)']);
    expect(device.files.has(WIPE_MARKER_FILE)).toBe(false);
  });
});
