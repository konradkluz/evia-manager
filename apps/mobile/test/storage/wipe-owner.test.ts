import type { QueueRecord } from '@evia/sync-core';
import { Database } from '../../src/storage/database';
import { KEY_CHECK_FILE, WIPE_MARKER_FILE, type OpenResult, type UnlockedStore } from '../../src/storage/local-data';
import { keyPragma } from '../../src/storage/key';
import { boot, newDevice, type Device } from './fakes';
import { NodeSqliteEngine, newDisk, removeDisk, type TestDisk } from './node-sqlite-engine';

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
const USER_B = '90000000-0000-4000-8000-0000000000bb';
const WO = '10000000-0000-4000-8000-000000000001';
const mid = (n: number): string => `0194c2a0-0000-7000-8000-${String(n).padStart(12, '0')}`;
const record = (n: number, patch: Partial<QueueRecord> = {}): QueueRecord => ({
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
  ...patch,
});

function unlocked(result: OpenResult): UnlockedStore {
  if (result.kind !== 'unlocked') throw new Error(`expected unlocked, got ${result.kind}`);
  return result.store;
}

const endProcess = (): void => {
  for (const handle of disk.handles) if (handle.isOpen) handle.close();
};

/** User A with 5 unsent items (one of them "Wymaga uwagi"), a replica, an identity and a refresh token. */
async function userAWithWork(): Promise<void> {
  const { host } = boot(device);
  const store = unlocked(await host.openForUser(USER_A));
  for (let n = 1; n <= 4; n += 1) await store.queue.append(record(n));
  await store.queue.append(record(5, { state: 'needs_attention', attempts: 1, lastCode: 'forbidden' }));
  const { active } = await store.replica.loadState();
  await store.replica.applyPage({
    generation: active.generation,
    ownerUserId: USER_A,
    ops: [{ op: 'upsert', entity: { type: 'work_order', id: WO, version: 1, fields: { siteId: null } } }],
    cursor: 'cursor-000000000001',
    phase: 'changes',
    complete: true,
    serverTime: 1,
    hydrationAdd: [],
    hydrationRemove: [],
  });
  await store.identity.write({ deviceId: 'device-synthetic-a', secret: 'secret-synthetic-a' });
  device.refreshToken = 'refresh-synthetic';
  device.otherSecrets = true;
  device.preferences = true;
  endProcess();
}

describe('owner of the queue (EVM-093 AC7; SR-MOB-13)', () => {
  it('EVM-093 AC7: user B is refused the contents (owner_mismatch) and learns only the number of unsent items', async () => {
    await userAWithWork();
    const { host } = boot(device);
    const result = await host.openForUser(USER_B);
    expect(result).toEqual({ kind: 'owner_mismatch', unsentItemCount: 5 });
    expect(Object.keys(result).sort()).toEqual(['kind', 'unsentItemCount']);
  });

  it('EVM-093 AC7: the number of unsent items is the queue (incl. "Wymaga uwagi") plus registered sources (E11 files)', async () => {
    await userAWithWork();
    const { host } = boot(device);
    host.registerUnsentCounter('pending_files', () => Promise.resolve(2));
    expect(await host.openForUser(USER_B)).toEqual({ kind: 'owner_mismatch', unsentItemCount: 7 });
  });

  it('EVM-093 AC7: an empty queue of another user is still owner_mismatch (the decision is EVM-101)', async () => {
    unlocked(await boot(device).host.openForUser(USER_A));
    endProcess();
    expect(await boot(device).host.openForUser(USER_B)).toEqual({ kind: 'owner_mismatch', unsentItemCount: 0 });
  });

  it('EVM-093 AC7: after the wipe user B starts with an empty database, a new key and no installation identity (new deviceId)', async () => {
    await userAWithWork();
    const oldKey = device.key;
    const { host } = boot(device);
    expect((await host.openForUser(USER_B)).kind).toBe('owner_mismatch');
    expect(await host.wipeCompanyData()).toBe('done');
    const store = unlocked(await host.openForUser(USER_B));
    expect(await store.queue.readAll()).toEqual([]);
    expect(await store.identity.read()).toBeNull();
    expect((await store.replica.loadState()).hasData).toBe(false);
    expect(device.key).not.toBe(oldKey);
    expect(await store.unsentItemCount()).toBe(0);
  });

  it('EVM-093 AC7: the same user unlocks the queue again after a restart; the unlock itself is not persisted', async () => {
    await userAWithWork();
    const first = boot(device);
    const store = unlocked(await first.host.openForUser(USER_A));
    expect((await store.queue.readAll()).length).toBe(5);
    expect(await store.identity.read()).toEqual({ deviceId: 'device-synthetic-a', secret: 'secret-synthetic-a' });
    store.lock();
    await expect(store.queue.readAll()).rejects.toMatchObject({ code: 'locked' });
    await expect(store.identity.read()).rejects.toMatchObject({ code: 'locked' });
    await expect(store.unsentItemCount()).rejects.toMatchObject({ code: 'locked' });
    const again = unlocked(await first.host.openForUser(USER_A));
    expect((await again.queue.readAll()).length).toBe(5);
  });

  it('EVM-093 AC7: a capability of A stops working when B opens the store in the same process', async () => {
    await userAWithWork();
    const { host } = boot(device);
    const storeA = unlocked(await host.openForUser(USER_A));
    expect((await host.openForUser(USER_B)).kind).toBe('owner_mismatch');
    await expect(storeA.queue.readAll()).rejects.toMatchObject({ code: 'locked' });
    await expect(storeA.replica.loadState()).rejects.toMatchObject({ code: 'locked' });
  });

  it.each(['sign_out', 'session_revoked'])(
    'EVM-093 AC7: %s removes the replica and the refresh token only; queue, "Wymaga uwagi", key and identity stay',
    async () => {
      await userAWithWork();
      const { host } = boot(device);
      const store = unlocked(await host.openForUser(USER_A));
      const key = device.key;
      await store.endSession();
      expect(device.refreshToken).toBeNull();
      expect(device.key).toBe(key);
      expect(device.identity).not.toBeNull();
      expect(device.otherSecrets).toBe(true);
      await expect(store.queue.readAll()).rejects.toMatchObject({ code: 'locked' });
      endProcess();
      const again = unlocked(await boot(device).host.openForUser(USER_A));
      const queue = (await again.queue.readAll()) as QueueRecord[];
      expect(queue.map((r) => r.mutationId)).toEqual([1, 2, 3, 4, 5].map(mid));
      expect(queue[4]?.state).toBe('needs_attention');
      const replica = await again.replica.loadState();
      expect(replica.hasData).toBe(false);
      expect(replica.ownerUserId).toBeNull();
    },
  );

  it('EVM-093 AC7: removing the replica is atomic — a crash in the middle leaves it whole', async () => {
    await userAWithWork();
    const { host, engine } = boot(device);
    const store = unlocked(await host.openForUser(USER_A));
    engine.failNext((sql) => sql === 'DELETE FROM replica_hydration');
    await expect(store.endSession()).rejects.toMatchObject({ code: 'sql_failed' });
    endProcess();
    const again = unlocked(await boot(device).host.openForUser(USER_A));
    const replica = await again.replica.loadState();
    expect(replica.hasData).toBe(true);
    expect(replica.ownerUserId).toBe(USER_A);
    expect(device.refreshToken).toBe('refresh-synthetic');
  });
});

describe('wipe of company data (EVM-093 AC6; port for EVM-101)', () => {
  it('EVM-093 AC6: the marker is written first, then the steps in the fixed order, and the marker goes last', async () => {
    await userAWithWork();
    const { host } = boot(device);
    unlocked(await host.openForUser(USER_A));
    const extra: string[] = [];
    host.registerWipeStep('media_files', () => {
      extra.push('media_files');
      return Promise.resolve();
    });
    device.log.length = 0;
    expect(await host.wipeCompanyData()).toBe('done');
    expect(host.wipeStepNames()).toEqual([
      'close_database',
      'database_key',
      'database_file',
      'key_check_value',
      'installation_identity',
      'secure_store',
      'preferences',
      'crash_reports',
      'media_files',
      'wipe_marker',
    ]);
    expect(device.log).toEqual([
      `files.write:${WIPE_MARKER_FILE}`,
      'vault.destroy',
      'engine.remove',
      `files.remove:${KEY_CHECK_FILE}`,
      'secrets.deleteIdentity',
      'secrets.deleteAllSecrets',
      'secrets.deletePreferences',
      'secrets.deleteCrashReports',
      `files.remove:${WIPE_MARKER_FILE}`,
    ]);
    expect(extra).toEqual(['media_files']);
    expect(device.files.size).toBe(0);
    expect(device.key).toBeNull();
    expect(device.keyAlias).toBe(false);
    expect(device.identity).toBeNull();
    expect(device.refreshToken).toBeNull();
    expect(device.preferences).toBe(false);
    expect(await new NodeSqliteEngine(disk).exists()).toBe(false);
  });

  it('EVM-093 AC6: the first step closes the database — handles of the store stop working at once', async () => {
    await userAWithWork();
    const { host } = boot(device);
    const store = unlocked(await host.openForUser(USER_A));
    await host.wipeCompanyData();
    await expect(store.queue.readAll()).rejects.toMatchObject({ code: 'locked' });
  });

  it('EVM-093 AC6: no registered steps is not an error; every step is idempotent (a second wipe on a clean device is fine)', async () => {
    const { host } = boot(device);
    expect(await host.wipeCompanyData()).toBe('done');
    expect(await host.wipeCompanyData()).toBe('done');
    expect(device.files.size).toBe(0);
  });

  it('EVM-093 AC6: a marker that cannot be written stops the wipe before anything is deleted', async () => {
    await userAWithWork();
    device.fail.set(`files.write:${WIPE_MARKER_FILE}`, { after: false, sticky: false });
    expect(await boot(device).host.wipeCompanyData()).toBe('incomplete');
    expect(device.deletions).toEqual([]);
  });

  const crashPoints = [
    'vault.destroy',
    'engine.remove',
    `files.remove:${KEY_CHECK_FILE}`,
    'secrets.deleteIdentity',
    'secrets.deleteAllSecrets',
    'secrets.deletePreferences',
    'secrets.deleteCrashReports',
    'extra.media',
    `files.remove:${WIPE_MARKER_FILE}`,
  ];

  it.each(crashPoints)(
    'EVM-093 AC6: the process killed after step %s — the next start finishes the wipe before any data is read',
    async (point) => {
      await userAWithWork();
      const copy = new NodeSqliteEngine(disk, 'before-wipe.db');
      new NodeSqliteEngine(disk).copyTo(copy);
      let extraRuns = 0;
      const first = boot(device);
      first.host.registerWipeStep('media', () => {
        extraRuns += 1;
        return point === 'extra.media' ? Promise.reject(new Error('synthetic crash after media')) : Promise.resolve();
      });
      if (point !== 'extra.media') device.fail.set(point, { after: true, sticky: false });
      const outcome = await first.host.wipeCompanyData();
      expect(outcome).toBe('incomplete');
      endProcess();

      // restart: before sign-in only the wipe runs, no database is opened
      const second = boot(device);
      second.host.registerWipeStep('media', () => {
        extraRuns += 1;
        return Promise.resolve();
      });
      let resumed = false;
      const markerLeft = device.files.has(WIPE_MARKER_FILE);
      device.log.length = 0;
      expect(
        await second.host.prepare(() => {
          resumed = true;
        }),
      ).toBe('ready');
      expect(resumed).toBe(markerLeft);
      expect(device.log).not.toContain('engine.open');
      expect(device.files.has(WIPE_MARKER_FILE)).toBe(false);
      expect(device.key).toBeNull();
      expect(device.identity).toBeNull();
      expect(device.refreshToken).toBeNull();
      expect(extraRuns).toBeGreaterThanOrEqual(1);
      // the next user starts empty; the copy taken before the wipe does not open with the new key
      const store = unlocked(await second.host.openForUser(USER_B));
      expect(await store.queue.readAll()).toEqual([]);
      const db = new Database(await copy.open());
      await db.read((tx) => tx.exec(keyPragma(device.key ?? '')));
      await expect(db.read((tx) => tx.get('SELECT count(*) AS n FROM sqlite_master'))).rejects.toMatchObject({
        code: 'not_a_database',
      });
    },
  );

  it('EVM-093 AC6: a step that keeps failing leaves the marker; openForUser refuses until the wipe is finished', async () => {
    await userAWithWork();
    device.fail.set('vault.destroy', { after: false, sticky: true });
    const { host, diagnostics } = boot(device);
    expect(await host.wipeCompanyData()).toBe('incomplete');
    expect(diagnostics).toContainEqual({ event: 'wipe-step-failed', step: 'database_key' });
    endProcess();
    const again = boot(device);
    expect(await again.host.prepare()).toBe('wipe_incomplete');
    expect(await again.host.openForUser(USER_A)).toEqual({ kind: 'wipe_incomplete' });
    expect(device.log.filter((e) => e === 'engine.open').length).toBe(1);
    device.fail.clear();
    expect(await again.host.prepare()).toBe('ready');
  });

  it('EVM-093 AC6: an unreadable marker counts as an unfinished wipe (never as "no wipe")', async () => {
    device.fail.set(`files.read:${WIPE_MARKER_FILE}`, { after: false, sticky: false });
    expect(await boot(device).host.prepare()).toBe('wipe_incomplete');
  });

  it('EVM-093 AC6: without a marker the start before sign-in touches nothing', async () => {
    await userAWithWork();
    device.log.length = 0;
    expect(await boot(device).host.prepare()).toBe('ready');
    expect(device.log).toEqual([]);
  });
});
