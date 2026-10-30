import { proofFields } from '../../src/storage/installation-proof';
import type { OpenResult } from '../../src/storage/local-data';
import { FakeSecrets, boot, newDevice, type Device } from './fakes';
import { newDisk, removeDisk, type TestDisk } from './node-sqlite-engine';

let disk: TestDisk;
let device: Device;
beforeEach(() => {
  disk = newDisk();
  device = newDevice(disk);
});
afterEach(() => {
  removeDisk(disk);
});

const USER_A = '90000000-0000-4000-8000-0000000000aa';
const DEVICE_ID = '7a000000-0000-4000-8000-000000000001';
const SECRET = 's'.repeat(43);
const mid = (n: number): string => `0194c2a0-0000-7000-8000-${String(n).padStart(12, '0')}`;

const unlocked = (result: OpenResult) => {
  if (result.kind !== 'unlocked') throw new Error(`expected unlocked, got ${result.kind}`);
  return result.store;
};

describe('installation proof of the first sign-in step (EVM-100 AC1; security W3)', () => {
  it('EVM-100 AC1: a new device has no proof (the request then carries no pair), never an error', async () => {
    const { host } = boot(device);
    expect(await host.installationProof()).toBeNull();
  });

  it('EVM-100 AC1: the proof carries the stored pair to the HTTP adapter only, and serialises to a constant (no value leaks)', async () => {
    device.identity = { deviceId: DEVICE_ID, secret: SECRET };
    const { host } = boot(device);
    const proof = await host.installationProof();
    if (proof === null) throw new Error('expected a proof');
    expect(proofFields(proof)).toEqual({ deviceId: DEVICE_ID, installationSecret: SECRET });
    for (const shown of [JSON.stringify({ proof }), String(proof), proof.toString(), JSON.stringify(Object.entries(proof))]) {
      expect(shown).not.toContain(SECRET);
      expect(shown).not.toContain(DEVICE_ID);
    }
    expect(Object.keys(proof)).toEqual([]);
    expect(Object.isFrozen(proof)).toBe(true);
  });

  it('EVM-100 AC1: the proof never names the owner of the store and does not open the database', async () => {
    device.identity = { deviceId: DEVICE_ID, secret: SECRET };
    const { host } = boot(device);
    const proof = await host.installationProof();
    expect(JSON.stringify(proof)).not.toContain(USER_A);
    expect(device.log).not.toContain('engine.open');
  });

  it('EVM-100 AC1: an identity that cannot be read is a new device (no pair), not a failure of the sign-in', async () => {
    class BusySecrets extends FakeSecrets {
      override readIdentity(): Promise<null> {
        return Promise.reject(new Error('keystore busy (synthetic)'));
      }
    }
    const { host } = boot(device, { secrets: new BusySecrets(device) });
    expect(await host.installationProof()).toBeNull();
  });

  it('EVM-100 AC1: the proof waits for a running wipe (host queue) — it never hands out a pair that the wipe is removing', async () => {
    device.identity = { deviceId: DEVICE_ID, secret: SECRET };
    const { host } = boot(device);
    const wipe = host.wipeCompanyData();
    const proof = host.installationProof();
    expect(await wipe).toBe('done');
    expect(await proof).toBeNull();
  });

  it('EVM-100 AC1: a proof made by anything but the store unwraps to nothing', () => {
    expect(proofFields(Object.create(null) as never)).toBeNull();
  });
});

describe('unsent items before a sign-in (EVM-100 AC3, 426 "Zobacz kolejkę")', () => {
  it('EVM-100 AC3: without a database file the count is 0 and no database is created', async () => {
    const { host, engine } = boot(device);
    expect(await host.unsentItemCountBeforeSignIn()).toBe(0);
    expect(await engine.exists()).toBe(false);
    expect(device.key).toBeNull();
  });

  it('EVM-100 AC3: the queue of the previous session is counted without unlocking it (a number only)', async () => {
    const first = boot(device);
    const store = unlocked(await first.host.openForUser(USER_A));
    for (let n = 1; n <= 3; n += 1) {
      await store.queue.append({
        mutationId: mid(n),
        type: 'CreateNote',
        commandVersion: 1,
        payload: { id: mid(n + 100), workOrderId: mid(900), body: 'synthetic' },
        objectId: mid(n + 100),
        orderingKey: mid(900),
        createdAt: n,
        ownerUserId: USER_A,
        state: 'pending',
        attempts: 0,
      });
    }
    await store.endSession();
    for (const handle of disk.handles) if (handle.isOpen) handle.close();
    const { host } = boot(device);
    expect(await host.unsentItemCountBeforeSignIn()).toBe(3);
    // the same process signs in afterwards: the database opened for the count is reused, the owner guard still applies
    expect((await host.openForUser(USER_A)).kind).toBe('unlocked');
  });

  it('EVM-100 AC3: an uncertain state (key missing, wipe not finished) gives no number and deletes nothing', async () => {
    const first = boot(device);
    unlocked(await first.host.openForUser(USER_A));
    for (const handle of disk.handles) if (handle.isOpen) handle.close();
    device.key = null;
    expect(await boot(device).host.unsentItemCountBeforeSignIn()).toBeNull();
    expect(device.deletions).toEqual([]);
    device.files.set('evia-wipe-in-progress', '1');
    device.fail.set('vault.destroy', { after: false, sticky: true });
    expect(await boot(device).host.unsentItemCountBeforeSignIn()).toBeNull();
  });

  it('EVM-100 AC3: a failing file check gives no number', async () => {
    device.fail.set('engine.exists', { after: false, sticky: true });
    expect(await boot(device).host.unsentItemCountBeforeSignIn()).toBeNull();
  });
});
