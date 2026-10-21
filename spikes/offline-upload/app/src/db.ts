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
