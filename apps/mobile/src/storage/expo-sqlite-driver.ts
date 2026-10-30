/**
 * Native shell of the local database (EVM-093 AC1, AC3): expo-sqlite built with SQLCipher (`useSQLCipher: true`, plugins/expo-config.ts).
 * The ONLY file allowed to import expo-sqlite (eslint `no-restricted-imports`, security review 7): no key-value or local-storage
 * entry point, no serialization or backup of the database, no custom `directory` (the default internal `files/SQLite`). Everything above this file
 * (key, checks, PRAGMAs, migrations, transactions) is TypeScript tested in Jest; this file is proven on the emulator only
 * (packages/config/coverage-exclusions.json).
 */
import { File } from 'expo-file-system';
import { defaultDatabaseDirectory, openDatabaseAsync } from 'expo-sqlite';
import type { SqlConnection, SqlEngine } from './sql';

export const DATABASE_NAME = 'evia.db';
const SIDECARS = ['', '-wal', '-shm', '-journal'] as const;

const fileOf = (suffix: string): File => new File(`file://${String(defaultDatabaseDirectory)}`, `${DATABASE_NAME}${suffix}`);

export const expoSqliteEngine: SqlEngine = {
  exists: () => Promise.resolve(fileOf('').exists),

  async open(): Promise<SqlConnection> {
    const db = await openDatabaseAsync(DATABASE_NAME);
    return {
      exec: (sql) => db.execAsync(sql),
      run: async (sql, params) => (await db.runAsync(sql, [...params])).changes,
      all: (sql, params) => db.getAllAsync<Record<string, unknown>>(sql, [...params]),
      close: () => db.closeAsync(),
    };
  },

  /** Main file and sidecars one by one (expo-sqlite's deleteDatabaseAsync fails when only a sidecar is left after a crash). */
  remove(): Promise<void> {
    for (const suffix of SIDECARS) {
      const file = fileOf(suffix);
      if (file.exists) file.delete();
    }
    return Promise.resolve();
  },
};
