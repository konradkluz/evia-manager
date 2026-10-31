import { StorageError, toStorageError } from './errors';
import type { SqlConnection, SqlRow, SqlValue } from './sql';

/** Statements available inside a transaction (and to single statements). */
export interface Tx {
  exec(sql: string): Promise<void>;
  run(sql: string, params?: readonly SqlValue[]): Promise<number>;
  all(sql: string, params?: readonly SqlValue[]): Promise<readonly SqlRow[]>;
  get(sql: string, params?: readonly SqlValue[]): Promise<SqlRow | undefined>;
}

/** What a store needs: serialized single statements and transactions. */
export interface DbAccess {
  read<T>(work: (tx: Tx) => Promise<T>): Promise<T>;
  transaction<T>(work: (tx: Tx) => Promise<T>): Promise<T>;
}

/** SQLite's limit of host parameters is far higher, but chunks keep statements small and portable (SQLite 3.53 / SQLCipher 4.17). */
export const MAX_PARAMS = 500;

export function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * The single access path to the connection (EVM-093, architecture review 1). expo-sqlite does not isolate `withTransactionAsync`: any
 * statement sent on the same connection while a transaction is open joins it, so a rollback of one operation could undo a write of
 * another. Every transaction and every single statement therefore goes through one asynchronous queue (mutex). After `close` the
 * database refuses new work (the wipe closes it first, AC6).
 */
export class Database implements DbAccess {
  readonly #connection: SqlConnection;
  #tail: Promise<unknown> = Promise.resolve();
  #closed = false;

  constructor(connection: SqlConnection) {
    this.#connection = connection;
  }

  get closed(): boolean {
    return this.#closed;
  }

  #serialize<T>(task: () => Promise<T>): Promise<T> {
    if (this.#closed) return Promise.reject(new StorageError('closed'));
    const run = this.#tail.then(task);
    this.#tail = run.catch(() => undefined);
    return run;
  }

  #statements(isOpen: () => boolean): Tx {
    const connection = this.#connection;
    const guard = (): void => {
      if (!isOpen()) throw new StorageError('closed');
    };
    const wrap = async <T>(work: () => Promise<T>): Promise<T> => {
      guard();
      try {
        return await work();
      } catch (error) {
        throw toStorageError(error);
      }
    };
    return {
      exec: (sql) => wrap(() => connection.exec(sql)),
      run: (sql, params = []) => wrap(() => connection.run(sql, params)),
      all: (sql, params = []) => wrap(() => connection.all(sql, params)),
      get: (sql, params = []) => wrap(async () => (await connection.all(sql, params))[0]),
    };
  }

  /** One statement outside a transaction (autocommit), serialized with everything else. */
  read<T>(work: (tx: Tx) => Promise<T>): Promise<T> {
    return this.#serialize(async () => {
      let open = true;
      try {
        return await work(this.#statements(() => open));
      } finally {
        open = false;
      }
    });
  }

  /**
   * `BEGIN IMMEDIATE` … `COMMIT` as one unit of the queue: resolves after COMMIT (with `synchronous=FULL` the change is durable then);
   * any error rolls back and rejects with a code. The `tx` handle stops working once the transaction ended.
   */
  transaction<T>(work: (tx: Tx) => Promise<T>): Promise<T> {
    return this.#serialize(async () => {
      let open = true;
      const tx = this.#statements(() => open);
      await tx.exec('BEGIN IMMEDIATE');
      try {
        const result = await work(tx);
        await tx.exec('COMMIT');
        return result;
      } catch (error) {
        try {
          await this.#connection.exec('ROLLBACK');
        } catch {
          // the connection may already have rolled back by itself (e.g. SQLITE_FULL); the original error is what matters
        }
        throw toStorageError(error);
      } finally {
        open = false;
      }
    });
  }

  /** A view that works only while `allowed()` holds (the capability of an unlocked owner; AC7). */
  gated(allowed: () => boolean): DbAccess {
    return {
      read: (work) => (allowed() ? this.read(work) : Promise.reject(new StorageError('locked'))),
      transaction: (work) => (allowed() ? this.transaction(work) : Promise.reject(new StorageError('locked'))),
    };
  }

  /** Refuses new work at once, lets the work queued before finish, then closes the connection. Idempotent. */
  async close(): Promise<void> {
    if (this.#closed) return;
    const pending = this.#tail;
    this.#closed = true;
    await pending;
    try {
      await this.#connection.close();
    } catch {
      // closing a broken connection must not stop the wipe or a reset
    }
  }
}
