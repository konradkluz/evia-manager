import type { QueueRecord } from '@evia/sync-core';
import { Database } from '../../src/storage/database';
import { KEY_CHECK_FILE, type OpenResult, type UnlockedStore } from '../../src/storage/local-data';
import { cipherVersionSupported, generateKeyHex, keyPragma } from '../../src/storage/key';
import { SCHEMA, createReplicaTablesV1, dropReplicaTables, type SchemaPlan } from '../../src/storage/schema';
import { FakeCrypto, boot, newDevice, type Device } from './fakes';
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

/** First run: a database of user A with `n` entries, closed again (the process ends). */
async function installed(n = 3): Promise<void> {
  const { host } = boot(device);
  const store = unlocked(await host.openForUser(USER_A));
  for (let i = 1; i <= n; i += 1) await store.queue.append(record(i));
  await closeAll();
}

/** The process ends: every native handle is closed (WAL checkpointed), as after `am force-stop`. */
function closeAll(): Promise<void> {
  for (const handle of disk.handles) if (handle.isOpen) handle.close();
  return Promise.resolve();
}

describe('opening the encrypted database (EVM-093 AC1)', () => {
  it('EVM-093 AC1: a fresh install creates a 256-bit key from the CSPRNG, stores it BEFORE the database exists, then the KCV', async () => {
    const { host, engine } = boot(device);
    const result = await host.openForUser(USER_A);
    expect(result).toMatchObject({ kind: 'unlocked', initialPullRequired: true });
    expect(device.key).toMatch(/^[0-9a-f]{64}$/);
    const order = device.log.filter((e) => ['vault.write', 'engine.open', `files.write:${KEY_CHECK_FILE}`].includes(e));
    expect(order).toEqual(['vault.write', 'engine.open', `files.write:${KEY_CHECK_FILE}`]);
    expect(engine.statements[0]).not.toMatch(/key/i);
    expect(disk.owners.get(engine.path)).toBe(device.key);
    expect(device.deletions).toEqual([]);
  });

  it('EVM-093 AC1: the key goes first in the opening sequence; writing PRAGMAs only after the checks', () => {
    // the PRAGMA key itself is intercepted by the simulated cipher, so the order is asserted on the SQL that reached SQLite
    return (async () => {
      const { host, engine } = boot(device);
      await host.openForUser(USER_A);
      const firstWrite = engine.statements.findIndex((s) => /journal_mode|synchronous|BEGIN/.test(s));
      const checks = ['SELECT count(*) AS n FROM sqlite_master', 'PRAGMA quick_check', 'PRAGMA temp_store'];
      for (const check of checks) expect(engine.statements.indexOf(check)).toBeLessThan(firstWrite);
      expect(engine.statements).toContain('PRAGMA temp_store = MEMORY');
      expect(engine.statements).toContain('PRAGMA synchronous = FULL');
      expect(engine.statements).toContain('PRAGMA journal_mode = WAL');
      expect(
        engine.statements.some((s) => /locking_mode|cipher_use_hmac|cipher_compatibility|cipher_plaintext_header_size =/i.test(s)),
      ).toBe(false);
    })();
  });

  it('EVM-093 AC1: without a CSPRNG there is no database (never a fallback), and nothing is stored', async () => {
    for (const random of ['throws', 'zeros', 'short'] as const) {
      device.random = random;
      const { host } = boot(device);
      expect(await host.openForUser(USER_A)).toEqual({ kind: 'unavailable', code: 'csprng_unavailable' });
      expect(device.key).toBeNull();
      expect(device.log).not.toContain('engine.open');
    }
  });

  it('EVM-093 AC1: plain SQLite without a cipher is refused before anything is written (no unencrypted mode)', async () => {
    disk.cipher.version = '';
    const { host, engine } = boot(device);
    expect(await host.openForUser(USER_A)).toEqual({ kind: 'unavailable', code: 'cipher_unsupported' });
    expect(engine.statements).toEqual([]);
    expect(device.files.has(KEY_CHECK_FILE)).toBe(false);
  });

  it('EVM-093 AC1: SQLCipher older than 4.6 is refused, 4.6.0 and 4.17.0 are accepted (numeric comparison)', async () => {
    expect(cipherVersionSupported('4.5.9 community')).toBe(false);
    expect(cipherVersionSupported('3.15.2')).toBe(false);
    expect(cipherVersionSupported('4.6.0 community')).toBe(true);
    expect(cipherVersionSupported('4.17.0 community')).toBe(true);
    expect(cipherVersionSupported('5.0.0')).toBe(true);
    expect(cipherVersionSupported('')).toBe(false);
    expect(cipherVersionSupported(undefined)).toBe(false);
    disk.cipher.version = '4.5.9 community';
    expect(await boot(device).host.openForUser(USER_A)).toEqual({ kind: 'unavailable', code: 'cipher_unsupported' });
  });

  it('EVM-093 AC1: a plaintext header (weakened SQLCipher default) is refused', async () => {
    disk.cipher.plaintextHeaderSize = '32';
    expect(await boot(device).host.openForUser(USER_A)).toEqual({ kind: 'unavailable', code: 'cipher_misconfigured' });
  });

  it('EVM-093 AC1: only a 64-digit lowercase hex key can reach PRAGMA key', () => {
    expect(keyPragma('ab'.repeat(32))).toBe(`PRAGMA key = "x'${'ab'.repeat(32)}'"`);
    for (const bad of ['AB'.repeat(32), 'ab'.repeat(31), `${'ab'.repeat(31)}a"`, `${'ab'.repeat(32)}'; --`])
      expect(() => keyPragma(bad)).toThrow('key_unavailable');
  });

  it('EVM-093 AC1: generated keys are 32 random bytes as hex and differ', () => {
    const crypto = new FakeCrypto(device);
    const a = generateKeyHex(crypto);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(generateKeyHex(crypto)).not.toBe(a);
  });

  it('EVM-093 AC1: the key appears in no diagnostic event and no error; the hardware fact is reported and never blocks', async () => {
    device.hardware = 'throws';
    const { host, diagnostics } = boot(device);
    unlocked(await host.openForUser(USER_A));
    await new Promise((resolve) => {
      setImmediate(resolve);
    });
    expect(diagnostics).toContainEqual({ event: 'keystore-hardware', level: 'unknown' });
    expect(JSON.stringify(diagnostics)).not.toContain(device.key);
    device.fail.set('engine.open', { after: false, sticky: false });
    await closeAll();
    const again = boot(device);
    const failed = await again.host.openForUser(USER_A);
    expect(JSON.stringify(failed)).not.toContain(device.key);
    expect(JSON.stringify(again.diagnostics)).not.toContain(device.key);
  });

  it('EVM-093 AC1, AC3: after a restart the same key opens the same database and the queue is intact', async () => {
    await installed(20);
    const store = unlocked(await boot(device).host.openForUser(USER_A));
    expect((await store.queue.readAll()).length).toBe(20);
    expect(device.deletions).toEqual([]);
  });

  it('EVM-093 AC2, SR-MOB-09: a database newer than the app is opened read-only, not changed, and reports update_required', async () => {
    const newer: SchemaPlan = {
      queue: SCHEMA.queue,
      replica: [
        ...SCHEMA.replica,
        {
          version: 9,
          up: async (tx) => {
            await dropReplicaTables(tx);
            await createReplicaTablesV1(tx);
            return 'reset';
          },
        },
      ],
    };
    const first = boot(device, { schema: newer });
    const store = unlocked(await first.host.openForUser(USER_A));
    await store.queue.append(record(1));
    await closeAll();
    const hash = first.engine.fileHash();
    const older = boot(device);
    expect(await older.host.openForUser(USER_A)).toEqual({ kind: 'update_required' });
    expect(older.engine.statements.some((s) => /journal_mode|synchronous|BEGIN|INSERT|CREATE/.test(s))).toBe(false);
    expect(older.engine.statements).toContain('PRAGMA query_only = ON');
    expect(older.engine.openConnections).toBe(0);
    expect(older.engine.fileHash()).toBe(hash);
    expect(device.deletions).toEqual([]);
  });
});

type Row = {
  name: string;
  key: 'present' | 'absent' | 'unavailable';
  file: 'absent' | 'ok' | 'corrupt' | 'other_key' | 'exists_error' | 'open_error';
  kcv: 'absent' | 'match' | 'mismatch' | 'read_error';
  expected: OpenResult['kind'];
  reason?: string;
};

/**
 * Every combination of key × file × key check value (security 1, architecture 3), including the states left by a crash between the
 * creation steps (key → secure store → database → KCV). Only certain causes are `data_lost`; no row deletes anything before "Rozumiem".
 */
const TABLE: Row[] = [
  { name: 'fresh install', key: 'absent', file: 'absent', kcv: 'absent', expected: 'unlocked' },
  { name: 'fresh install with an orphaned KCV', key: 'absent', file: 'absent', kcv: 'mismatch', expected: 'unlocked' },
  { name: 'crash after the key was stored (key, no file)', key: 'present', file: 'absent', kcv: 'absent', expected: 'unlocked' },
  { name: 'key and KCV, no file', key: 'present', file: 'absent', kcv: 'match', expected: 'unlocked' },
  { name: 'crash after the database, before the KCV', key: 'present', file: 'ok', kcv: 'absent', expected: 'unlocked' },
  { name: 'normal start', key: 'present', file: 'ok', kcv: 'match', expected: 'unlocked' },
  { name: 'KCV unreadable, database fine', key: 'present', file: 'ok', kcv: 'read_error', expected: 'unlocked' },
  { name: 'key missing, file present', key: 'absent', file: 'ok', kcv: 'match', expected: 'data_lost', reason: 'key_missing' },
  { name: 'key missing, file and no KCV', key: 'absent', file: 'ok', kcv: 'absent', expected: 'data_lost', reason: 'key_missing' },
  { name: 'key does not match (KCV)', key: 'present', file: 'other_key', kcv: 'mismatch', expected: 'data_lost', reason: 'key_invalid' },
  { name: 'file corrupt (KCV matches)', key: 'present', file: 'corrupt', kcv: 'match', expected: 'data_lost', reason: 'file_corrupt' },
  {
    name: 'not a database without a KCV (uncertain)',
    key: 'present',
    file: 'corrupt',
    kcv: 'absent',
    expected: 'unavailable',
    reason: 'not_a_database',
  },
  {
    name: 'wrong key without a KCV (uncertain)',
    key: 'present',
    file: 'other_key',
    kcv: 'absent',
    expected: 'unavailable',
    reason: 'not_a_database',
  },
  {
    name: 'not a database, KCV unreadable',
    key: 'present',
    file: 'corrupt',
    kcv: 'read_error',
    expected: 'unavailable',
    reason: 'not_a_database',
  },
  { name: 'Keystore unavailable', key: 'unavailable', file: 'ok', kcv: 'match', expected: 'unavailable', reason: 'key_unavailable' },
  {
    name: 'Keystore unavailable, no file',
    key: 'unavailable',
    file: 'absent',
    kcv: 'absent',
    expected: 'unavailable',
    reason: 'key_unavailable',
  },
  { name: 'file system error', key: 'present', file: 'exists_error', kcv: 'match', expected: 'unavailable', reason: 'file_unavailable' },
  { name: 'native open error', key: 'present', file: 'open_error', kcv: 'match', expected: 'unavailable', reason: 'sql_failed' },
];

async function arrange(row: Row): Promise<void> {
  if (row.file !== 'absent') await installed(3);
  const realKey = device.key;
  if (row.file === 'absent') {
    await new NodeSqliteEngine(disk).remove();
    device.files.delete(KEY_CHECK_FILE);
  }
  if (row.key === 'present' && device.key === null) device.key = 'cd'.repeat(32);
  if (row.key === 'absent') device.key = null;
  if (row.key === 'unavailable') device.fail.set('vault.read', { after: false, sticky: true });
  if (row.file === 'corrupt') new NodeSqliteEngine(disk).corrupt();
  if (row.file === 'other_key') device.key = 'ef'.repeat(32);
  if (row.file === 'exists_error') device.fail.set('engine.exists', { after: false, sticky: true });
  if (row.file === 'open_error') device.fail.set('engine.open', { after: false, sticky: true });
  const kcvKey = row.kcv === 'mismatch' ? '01'.repeat(32) : (realKey ?? device.key ?? '01'.repeat(32));
  if (row.kcv === 'absent') device.files.delete(KEY_CHECK_FILE);
  else device.files.set(KEY_CHECK_FILE, await new FakeCrypto(device).sha256Hex(`evia.database-key-check.v1:${kcvKey}`));
  if (row.kcv === 'read_error') device.fail.set(`files.read:${KEY_CHECK_FILE}`, { after: false, sticky: true });
  device.deletions.length = 0;
}

describe('classification of a database that cannot be opened (EVM-093 AC5; fail-safe)', () => {
  it.each(TABLE)('EVM-093 AC5: $name → $expected $reason, nothing deleted before "Rozumiem"', async (row) => {
    await arrange(row);
    const keyBefore = device.key;
    const { host, diagnostics } = boot(device);
    const result = await host.openForUser(USER_A);
    expect(result.kind).toBe(row.expected);
    if (result.kind === 'data_lost') expect(result.reason).toBe(row.reason);
    if (result.kind === 'unavailable') expect(result.code).toBe(row.reason);
    if (row.expected !== 'unlocked') {
      expect(device.deletions).toEqual([]);
      expect(device.key).toBe(keyBefore);
      expect(diagnostics).toContainEqual({ event: 'db-open-failed', code: row.reason });
      // fixed names and codes only: no number, path or identifier
      for (const event of diagnostics) expect(JSON.stringify(event)).not.toMatch(/\d|[\\/]/);
    }
    if (row.file === 'absent' && row.key === 'present') expect(device.key).toBe(keyBefore);
    if (row.expected === 'unlocked' && row.file === 'ok') {
      const store = unlocked(result);
      expect((await store.queue.readAll()).length).toBe(3);
    }
  });

  it('EVM-093 AC5: an orphaned KCV of an old key is replaced at a fresh install, so the next start is a normal one', async () => {
    device.files.set(KEY_CHECK_FILE, 'f'.repeat(64));
    unlocked(await boot(device).host.openForUser(USER_A));
    await closeAll();
    expect(await boot(device).host.openForUser(USER_A)).toMatchObject({ kind: 'unlocked', initialPullRequired: false });
  });

  it('EVM-093 AC5: a missing KCV next to a working database is written again (repair)', async () => {
    await installed(1);
    device.files.delete(KEY_CHECK_FILE);
    unlocked(await boot(device).host.openForUser(USER_A));
    expect(device.files.has(KEY_CHECK_FILE)).toBe(true);
  });

  it('EVM-093 AC5: diagnostics carry only the code of the cause — no number, content or path', async () => {
    await installed(5);
    device.key = null;
    const { host, diagnostics } = boot(device);
    await host.openForUser(USER_A);
    expect(diagnostics).toEqual([{ event: 'db-open-failed', code: 'key_missing' }]);
  });

  it.each(['key_missing', 'key_invalid', 'file_corrupt'] as const)(
    'EVM-093 AC5: %s → "Rozumiem" removes the old file, creates a new key and database, a new device, and asks for the first download',
    async (reason) => {
      await installed(4);
      const oldKey = device.key;
      device.identity = { deviceId: 'device-synthetic-1', secret: 'secret-synthetic-1' };
      if (reason === 'key_missing') device.key = null;
      if (reason === 'key_invalid') device.files.set(KEY_CHECK_FILE, '0'.repeat(64));
      if (reason === 'file_corrupt') new NodeSqliteEngine(disk).corrupt();
      const { host } = boot(device);
      const lost = await host.openForUser(USER_A);
      if (lost.kind !== 'data_lost') throw new Error(lost.kind);
      expect(lost.reason).toBe(reason);
      expect(device.deletions).toEqual([]);
      const after = await lost.acknowledge();
      expect(after).toMatchObject({ kind: 'unlocked', initialPullRequired: true });
      const store = unlocked(after);
      expect(await store.queue.readAll()).toEqual([]);
      expect(device.key).toMatch(/^[0-9a-f]{64}$/);
      expect(device.key).not.toBe(oldKey);
      expect(device.identity).toBeNull();
      expect(await store.identity.read()).toBeNull();
      expect((await store.replica.loadState()).active.initialLoadDone).toBe(false);
    },
  );

  it('EVM-093 AC5: a failure inside "Rozumiem" deletes nothing more and is reported as unavailable; the next start classifies again', async () => {
    await installed(2);
    device.key = null;
    device.fail.set('engine.remove', { after: false, sticky: false });
    const lost = await boot(device).host.openForUser(USER_A);
    if (lost.kind !== 'data_lost') throw new Error(lost.kind);
    expect(await lost.acknowledge()).toEqual({ kind: 'unavailable', code: 'file_unavailable' });
    expect((await boot(device).host.openForUser(USER_A)).kind).toBe('data_lost');
  });

  it('EVM-093 AC5: a failure to store a new key leaves no database behind', async () => {
    device.fail.set('vault.write', { after: false, sticky: false });
    expect(await boot(device).host.openForUser(USER_A)).toEqual({ kind: 'unavailable', code: 'key_unavailable' });
    expect(device.log).not.toContain('engine.open');
  });

  it('EVM-093 AC5: a copy of the old file does not open with the new key (the old key is gone)', async () => {
    await installed(2);
    const copy = new NodeSqliteEngine(disk, 'copy.db');
    new NodeSqliteEngine(disk).copyTo(copy);
    device.key = null;
    const lost = await boot(device).host.openForUser(USER_A);
    if (lost.kind !== 'data_lost') throw new Error(lost.kind);
    await lost.acknowledge();
    const db = new Database(await copy.open());
    await db.read((tx) => tx.exec(keyPragma(device.key ?? '')));
    await expect(db.read((tx) => tx.get('SELECT count(*) AS n FROM sqlite_master'))).rejects.toMatchObject({ code: 'not_a_database' });
  });
});
