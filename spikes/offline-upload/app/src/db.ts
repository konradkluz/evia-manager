// Encrypted queue database (SQLCipher via expo-sqlite, ADR-0007). 256-bit key from the CSPRNG, kept in the Android Keystore through
// expo-secure-store; never in AsyncStorage, a file or a log. JS is the only writer of this database (the native worker keeps its own
// job files; JS reconciles from them), so there are no two writers on one table.
import * as SecureStore from 'expo-secure-store';
import * as SQLite from 'expo-sqlite';
import { getRandomBytes } from 'expo-crypto';

const KEY_NAME = 'evm011_db_key';

const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');

async function dbKey(): Promise<string> {
  const existing = await SecureStore.getItemAsync(KEY_NAME);
  if (existing) return existing;
  const key = hex(getRandomBytes(32));
  await SecureStore.setItemAsync(KEY_NAME, key, { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY });
  return key;
}

export interface MediaRow {
  asset_id: string;
  kind: 'photo' | 'video' | 'synthetic';
  path: string;
  size: number;
  sha256: string;
  content_type: string;
  created_at: number;
  state: string;
}

export async function openQueueDb(): Promise<SQLite.SQLiteDatabase> {
  const db = await SQLite.openDatabaseAsync('evm011-queue.db');
  await db.execAsync(`PRAGMA key = "x'${await dbKey()}'";`);
  await db.execAsync('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
  await db.execAsync(
    `CREATE TABLE IF NOT EXISTS media (
       asset_id TEXT PRIMARY KEY NOT NULL,
       kind TEXT NOT NULL, path TEXT NOT NULL, size INTEGER NOT NULL, sha256 TEXT NOT NULL,
       content_type TEXT NOT NULL, created_at INTEGER NOT NULL, state TEXT NOT NULL
     );`,
  );
  return db;
}

/** ADR-0007 question 5: 2,000 orders and 5,000 entries in the encrypted database; timings of typical operations (emulator, not a phone). */
export async function benchmarkQueueDb(db: SQLite.SQLiteDatabase) {
  await db.execAsync(
    `DROP TABLE IF EXISTS bench_entries; DROP TABLE IF EXISTS bench_orders;
     CREATE TABLE bench_orders (id INTEGER PRIMARY KEY, title TEXT NOT NULL, status TEXT NOT NULL, updated INTEGER NOT NULL);
     CREATE TABLE bench_entries (id INTEGER PRIMARY KEY, order_id INTEGER NOT NULL, body TEXT NOT NULL, created INTEGER NOT NULL);
     CREATE INDEX bench_entries_order ON bench_entries(order_id, created);`,
  );
  const t0 = Date.now();
  await db.withTransactionAsync(async () => {
    for (let i = 0; i < 2000; i++) {
      await db.runAsync('INSERT INTO bench_orders (title, status, updated) VALUES (?, ?, ?)', [
        `synthetic order ${i}`,
        i % 5 === 0 ? 'closed' : 'open',
        i,
      ]);
    }
    for (let i = 0; i < 5000; i++) {
      await db.runAsync('INSERT INTO bench_entries (order_id, body, created) VALUES (?, ?, ?)', [1 + (i % 2000), 'x'.repeat(200), i]);
    }
  });
  const insertMs = Date.now() - t0;
  const t1 = Date.now();
  const list = await db.getAllAsync(
    "SELECT o.id, o.title, (SELECT COUNT(*) FROM bench_entries e WHERE e.order_id = o.id) AS n FROM bench_orders o WHERE o.status = 'open' ORDER BY o.updated DESC LIMIT 50",
  );
  const listMs = Date.now() - t1;
  const t2 = Date.now();
  const entries = await db.getAllAsync('SELECT * FROM bench_entries WHERE order_id = ? ORDER BY created DESC LIMIT 50', [1000]);
  const entriesMs = Date.now() - t2;
  const t3 = Date.now();
  const total = await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM bench_entries');
  return { insertMs, listMs, entriesMs, countMs: Date.now() - t3, listRows: list.length, entryRows: entries.length, total: total?.n };
}
