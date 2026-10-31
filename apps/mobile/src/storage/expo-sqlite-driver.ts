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

/** Name of the copy that the e2e scenario 13 takes with `run-as cp` before the wipe (EVM-093 AC6); used by the e2e hooks only. */
export const E2E_COPY_NAME = 'evia-copy.db';

/** The engine of one database file in the default internal directory (`files/SQLite`). */
export function createExpoSqliteEngine(name: string = DATABASE_NAME): SqlEngine {
  const fileOf = (suffix: string): File => new File(`file://${String(defaultDatabaseDirectory)}`, `${name}${suffix}`);
  return {
    exists: () => Promise.resolve(fileOf('').exists),

    async open(): Promise<SqlConnection> {
      const db = await openDatabaseAsync(name);
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
}

export const expoSqliteEngine: SqlEngine = createExpoSqliteEngine();
