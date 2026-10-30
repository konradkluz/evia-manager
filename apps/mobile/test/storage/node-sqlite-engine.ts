// Test engine of the local store (EVM-093; ADR-0015): real SQLite (`node:sqlite`, built into Node 26) behind the same port as
// expo-sqlite. node:sqlite has no cipher, so the engine SIMULATES SQLCipher's observable behaviour: the first key that writes a file
// owns it, any other key reads "file is not a database"; `cipher_*` pragmas answer from configuration. Real encryption is proven on
// the emulator only. Every statement yields to the event loop first, like the asynchronous native bridge.
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { SqlConnection, SqlEngine, SqlRow, SqlValue } from '../../src/storage/sql';

export interface SimulatedCipher {
  /** Answer of `PRAGMA cipher_version` ('' = plain SQLite without a cipher). */
  version: string;
  plaintextHeaderSize: string;
}

/** The "flash" of the phone: survives restarts (new engines and connections on the same disk). */
export interface TestDisk {
  readonly directory: string;
  /** Path of a database file -> the key that owns it (simulated encryption). */
  readonly owners: Map<string, string>;
  /** Open native handles (closed by `removeDisk`; Windows cannot delete open files). */
  readonly handles: Set<DatabaseSync>;
  cipher: SimulatedCipher;
}

export function newDisk(): TestDisk {
  return {
    directory: mkdtempSync(join(tmpdir(), 'evm093-')),
    owners: new Map(),
    handles: new Set(),
    cipher: { version: '4.17.0 community', plaintextHeaderSize: '0' },
  };
}

export function removeDisk(disk: TestDisk): void {
  for (const handle of disk.handles) if (handle.isOpen) handle.close();
  rmSync(disk.directory, { recursive: true, force: true });
}

const yieldToLoop = (): Promise<void> =>
  new Promise((resolve) => {
    setImmediate(resolve);
  });

export class NodeSqliteEngine implements SqlEngine {
  readonly disk: TestDisk;
  readonly path: string;
  /** Every statement that reached SQLite, in order (assertions like "nothing was written"). */
  readonly statements: string[] = [];
  readonly #faults: ((sql: string) => boolean)[] = [];
  openConnections = 0;

  constructor(disk: TestDisk, name = 'evia.db') {
    this.disk = disk;
    this.path = join(disk.directory, name);
  }

  /** The next statement matching the predicate throws (one-shot): a crash or an I/O error inside a transaction. */
  failNext(predicate: (sql: string) => boolean): void {
    this.#faults.push(predicate);
  }

  exists(): Promise<boolean> {
    return Promise.resolve(existsSync(this.path));
  }

  remove(): Promise<void> {
    for (const suffix of ['', '-wal', '-shm', '-journal']) rmSync(`${this.path}${suffix}`, { force: true });
    this.disk.owners.delete(this.path);
    return Promise.resolve();
  }

  open(): Promise<SqlConnection> {
    const db = new DatabaseSync(this.path);
    this.disk.handles.add(db);
    this.openConnections += 1;
    let key: string | undefined;
    let closed = false;
    const pragma = (sql: string): readonly SqlRow[] | undefined => {
      const keyMatch = /^PRAGMA key = "x'([0-9a-f]+)'"$/.exec(sql);
      if (keyMatch !== null) {
        key = keyMatch[1];
        return [];
      }
      if (sql === 'PRAGMA cipher_version') return this.disk.cipher.version === '' ? [] : [{ cipher_version: this.disk.cipher.version }];
      if (sql === 'PRAGMA cipher_plaintext_header_size')
        return this.disk.cipher.version === '' ? [] : [{ cipher_plaintext_header_size: this.disk.cipher.plaintextHeaderSize }];
      return undefined;
    };
    const before = async (sql: string): Promise<void> => {
      await yieldToLoop();
      if (closed) throw new Error('database is closed');
      const fault = this.#faults.findIndex((p) => p(sql));
      if (fault >= 0) {
        this.#faults.splice(fault, 1);
        throw new Error('simulated I/O error (synthetic)');
      }
      this.statements.push(sql);
      const owner = this.disk.owners.get(this.path);
      if (owner !== undefined && owner !== (key ?? '')) throw new Error('file is not a database');
      if (owner === undefined && statSync(this.path).size === 0 && !/^PRAGMA (busy_timeout|temp_store|query_only)/.test(sql))
        this.disk.owners.set(this.path, key ?? '');
    };
    const bind = (params: readonly SqlValue[]): SqlValue[] => [...params];
    return Promise.resolve({
      exec: async (sql: string): Promise<void> => {
        await yieldToLoop();
        if (pragma(sql) !== undefined) return;
        await before(sql);
        db.exec(sql);
      },
      run: async (sql: string, params: readonly SqlValue[]): Promise<number> => {
        await before(sql);
        return Number(db.prepare(sql).run(...bind(params)).changes);
      },
      all: async (sql: string, params: readonly SqlValue[]): Promise<readonly SqlRow[]> => {
        await yieldToLoop();
        const answer = pragma(sql);
        if (answer !== undefined) return answer;
        await before(sql);
        return db.prepare(sql).all(...bind(params));
      },
      close: (): Promise<void> => {
        if (!closed) {
          closed = true;
          this.openConnections -= 1;
          db.close();
        }
        return Promise.resolve();
      },
    });
  }

  /** SHA-256 of the main file (the downgrade case must not change a byte). */
  fileHash(): string {
    return createHash('sha256').update(readFileSync(this.path)).digest('hex');
  }

  /** Copies the file (and the simulated owner key) elsewhere, e.g. "a copy taken before the wipe". */
  copyTo(target: NodeSqliteEngine): void {
    copyFileSync(this.path, target.path);
    const owner = this.disk.owners.get(this.path);
    if (owner !== undefined) target.disk.owners.set(target.path, owner);
  }

  /** Overwrites the first bytes of the file (a corrupted file that keeps its owner key). */
  corrupt(): void {
    const bytes = readFileSync(this.path);
    bytes.fill(0x5a, 0, Math.min(bytes.length, 4096));
    writeFileSync(this.path, bytes);
  }
}
