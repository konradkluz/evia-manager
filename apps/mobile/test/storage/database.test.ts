import { Database, chunk } from '../../src/storage/database';
import { StorageError, classifySqlError } from '../../src/storage/errors';
import { NodeSqliteEngine, newDisk, removeDisk, type TestDisk } from './node-sqlite-engine';

let disk: TestDisk;
beforeEach(() => {
  disk = newDisk();
});
afterEach(() => {
  removeDisk(disk);
});

async function openDb(engine = new NodeSqliteEngine(disk)): Promise<{ db: Database; engine: NodeSqliteEngine }> {
  const db = new Database(await engine.open());
  await db.read((tx) => tx.exec('CREATE TABLE t (v INTEGER NOT NULL)'));
  return { db, engine };
}

const values = async (db: Database): Promise<unknown[]> =>
  (await db.read((tx) => tx.all('SELECT v FROM t ORDER BY v'))).map((row) => row['v']);

describe('serialized database access (EVM-093 AC3; architecture review 1)', () => {
  it('EVM-093 AC3: two concurrent transactions, one failing, do not affect each other (the rollback does not undo the other write)', async () => {
    const { db, engine } = await openDb();
    engine.failNext((sql) => sql.includes('VALUES (2)'));
    const failing = db.transaction(async (tx) => {
      await tx.run('INSERT INTO t (v) VALUES (1)');
      await tx.run('INSERT INTO t (v) VALUES (2)');
    });
    const other = db.transaction(async (tx) => {
      await tx.run('INSERT INTO t (v) VALUES (3)');
    });
    const single = db.read((tx) => tx.run('INSERT INTO t (v) VALUES (4)'));
    await expect(failing).rejects.toBeInstanceOf(StorageError);
    await other;
    await single;
    expect(await values(db)).toEqual([3, 4]);
  });

  it('EVM-093 AC3: statements of concurrent callers never interleave with an open transaction', async () => {
    const { db, engine } = await openDb();
    await Promise.all([
      db.transaction(async (tx) => {
        await tx.run('INSERT INTO t (v) VALUES (10)');
        await tx.run('INSERT INTO t (v) VALUES (11)');
      }),
      db.read((tx) => tx.run('INSERT INTO t (v) VALUES (20)')),
      db.transaction(async (tx) => {
        await tx.run('INSERT INTO t (v) VALUES (30)');
      }),
    ]);
    const order = engine.statements.filter((s) => /^(BEGIN|COMMIT|INSERT)/.test(s));
    expect(order).toEqual([
      'BEGIN IMMEDIATE',
      'INSERT INTO t (v) VALUES (10)',
      'INSERT INTO t (v) VALUES (11)',
      'COMMIT',
      'INSERT INTO t (v) VALUES (20)',
      'BEGIN IMMEDIATE',
      'INSERT INTO t (v) VALUES (30)',
      'COMMIT',
    ]);
  });

  it('EVM-093 AC3: a transaction resolves only after COMMIT, and its handle stops working afterwards', async () => {
    const { db, engine } = await openDb();
    let leaked: Parameters<Parameters<Database['transaction']>[0]>[0] | undefined;
    await db.transaction(async (tx) => {
      leaked = tx;
      await tx.run('INSERT INTO t (v) VALUES (1)', []);
    });
    expect(engine.statements.at(-1)).toBe('COMMIT');
    await expect(leaked?.run('INSERT INTO t (v) VALUES (2)')).rejects.toMatchObject({ code: 'closed' });
    expect(await values(db)).toEqual([1]);
  });

  it('EVM-093 AC3: an error of the work itself rolls back and is reported as a code, never with the original message', async () => {
    const { db } = await openDb();
    const error = await db
      .transaction(async (tx) => {
        await tx.run('INSERT INTO t (v) VALUES (1)');
        await tx.run('INSERT INTO missing_table_synthetic (v) VALUES (1)');
      })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(StorageError);
    expect((error as StorageError).message).toBe('sql_failed');
    expect(String((error as Error).stack)).not.toContain('missing_table_synthetic');
    expect(await values(db)).toEqual([]);
  });

  it('EVM-093 AC6: after close the database refuses new work; close waits for the running work and is idempotent', async () => {
    const { db } = await openDb();
    const running = db.transaction((tx) => tx.run('INSERT INTO t (v) VALUES (1)'));
    await db.close();
    await running;
    expect(db.closed).toBe(true);
    await expect(db.read((tx) => tx.all('SELECT v FROM t'))).rejects.toMatchObject({ code: 'closed' });
    await expect(db.transaction(() => Promise.resolve())).rejects.toMatchObject({ code: 'closed' });
    await db.close();
  });

  it('EVM-093 AC3: a failing close of a broken connection does not throw', async () => {
    const db = new Database({
      exec: () => Promise.resolve(),
      run: () => Promise.resolve(0),
      all: () => Promise.resolve([]),
      close: () => Promise.reject(new Error('synthetic')),
    });
    await expect(db.close()).resolves.toBeUndefined();
  });

  it('EVM-093 AC3: a failed ROLLBACK does not hide the original error', async () => {
    let calls = 0;
    const db = new Database({
      exec: (sql) => {
        calls += 1;
        return sql === 'BEGIN IMMEDIATE' ? Promise.resolve() : Promise.reject(new Error('database or disk is full'));
      },
      run: () => Promise.reject(new Error('SQLITE_FULL')),
      all: () => Promise.resolve([]),
      close: () => Promise.resolve(),
    });
    await expect(db.transaction((tx) => tx.run('INSERT'))).rejects.toMatchObject({ code: 'disk_full' });
    expect(calls).toBe(2);
  });

  it('EVM-093 AC5: native error texts map to fixed codes', () => {
    expect(classifySqlError(new Error('file is not a database'))).toBe('not_a_database');
    expect(classifySqlError(Object.assign(new Error('x'), { code: 'SQLITE_NOTADB' }))).toBe('not_a_database');
    expect(classifySqlError(new Error('database disk image is malformed'))).toBe('not_a_database');
    expect(classifySqlError(new Error('database or disk is full'))).toBe('disk_full');
    expect(classifySqlError(new Error('database is locked'))).toBe('busy');
    expect(classifySqlError(new Error('anything else'))).toBe('sql_failed');
    expect(classifySqlError('not an error')).toBe('sql_failed');
    expect(classifySqlError(new StorageError('closed'))).toBe('closed');
  });

  it('EVM-093 AC3: chunk splits bulk parameters into bounded statements', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk([], 2)).toEqual([]);
  });
});
