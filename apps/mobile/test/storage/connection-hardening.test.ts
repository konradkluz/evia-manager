import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { KEY_CHECK_FILE } from '../../src/storage/local-data';
import { NodeSqliteEngine, newDisk, removeDisk, type TestDisk } from './node-sqlite-engine';
import { boot, newDevice, type Device } from './fakes';

// EVM-103 AC6 (security K6, Low): every connection of the app sets temp_store = MEMORY (and secure_delete) in ONE place.
let disk: TestDisk;
let device: Device;
beforeEach(() => {
  disk = newDisk();
  device = newDevice(disk);
});
afterEach(() => {
  removeDisk(disk);
});

const USER = '90000000-0000-4000-8000-0000000000aa';
const files = (directory: string): string[] =>
  readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    return statSync(path).isDirectory() ? files(path) : /\.tsx?$/.test(name) ? [path] : [];
  });

describe('connections of the local store (EVM-103 AC6)', () => {
  it('EVM-103 AC6: the source opens a connection in one place only - the opening sequence of the host (no second path, no screen, no list code)', () => {
    const src = join(__dirname, '..', '..', 'src');
    const openers = files(src).filter((path) =>
      /\bengine\.open\(\)|\bengine\s*\.\s*open\b|openDatabaseAsync\(/.test(readFileSync(path, 'utf8')),
    );
    expect(openers.map((path) => path.slice(src.length + 1).replaceAll('\\', '/')).sort()).toEqual([
      'storage/expo-sqlite-driver.ts',
      'storage/local-data.ts',
    ]);
    const host = readFileSync(join(src, 'storage', 'local-data.ts'), 'utf8');
    expect([...host.matchAll(/engine\.open\(\)/g)]).toHaveLength(1);
    expect(host).toContain("await tx.exec('PRAGMA temp_store = MEMORY')");
    expect(host).toContain("await tx.exec('PRAGMA secure_delete = ON')");
  });

  it('EVM-103 AC6: every connection that is opened - first run, restart, the check before sign-in, a reset after data loss, the probe of the e2e hooks - sets and verifies temp_store = MEMORY first', async () => {
    const first = boot(device);
    expect((await first.host.openForUser(USER)).kind).toBe('unlocked');
    const firstOpens = device.log.filter((e) => e === 'engine.open').length;
    expect(firstOpens).toBe(1);
    expect(first.engine.statements.filter((s) => s === 'PRAGMA temp_store = MEMORY')).toHaveLength(1);
    expect(first.engine.statements.filter((s) => s === 'PRAGMA secure_delete = ON')).toHaveLength(1);
    expect(first.engine.statements).toContain('PRAGMA temp_store');
    expect(Number((await first.host.facts()).tempStore)).toBe(2);

    // a restart (new process) and the count before the sign-in open the existing file through the same sequence
    for (const disk0 of disk.handles) if (disk0.isOpen) disk0.close();
    device.log.length = 0;
    const second = boot(device);
    expect(await second.host.unsentItemCountBeforeSignIn()).toBe(0);
    expect(device.log.filter((e) => e === 'engine.open')).toHaveLength(1);
    expect(second.engine.statements.filter((s) => s === 'PRAGMA temp_store = MEMORY')).toHaveLength(1);
    expect((await second.host.openForUser(USER)).kind).toBe('unlocked');
    expect(second.engine.statements.filter((s) => s === 'PRAGMA temp_store = MEMORY')).toHaveLength(1);

    // the probe opens ANOTHER file by the same sequence
    const other = new NodeSqliteEngine(disk, 'evia-copy.db');
    new NodeSqliteEngine(disk).copyTo(other);
    expect(await second.host.probe(other)).toBe('opened');
    expect(other.statements.filter((s) => s === 'PRAGMA temp_store = MEMORY')).toHaveLength(1);
    expect(other.statements.filter((s) => s === 'PRAGMA secure_delete = ON')).toHaveLength(1);
  });

  it('EVM-103 AC6: after a lost key the new database created by "Rozumiem" goes through the same sequence', async () => {
    const first = boot(device);
    await first.host.openForUser(USER);
    for (const handle of disk.handles) if (handle.isOpen) handle.close();
    device.files.set(KEY_CHECK_FILE, 'x'.repeat(64));
    device.log.length = 0;
    const second = boot(device);
    const lost = await second.host.openForUser(USER);
    expect(lost.kind).toBe('data_lost');
    if (lost.kind !== 'data_lost') return;
    expect((await lost.acknowledge()).kind).toBe('unlocked');
    const opens = device.log.filter((e) => e === 'engine.open').length;
    expect(second.engine.statements.filter((s) => s === 'PRAGMA temp_store = MEMORY')).toHaveLength(opens);
  });
});
