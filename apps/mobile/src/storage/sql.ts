/**
 * The thin native shell of the local database (EVM-093; ADR-0007, ADR-0015). Production: expo-sqlite with SQLCipher
 * (`expo-sqlite-driver.ts`, verified on the emulator); Jest: `node:sqlite` with a simulated cipher. Everything above it (opening
 * sequence, migrations, transactions, stores) is TypeScript tested natively.
 */
export type SqlValue = string | number | null;
export type SqlRow = Readonly<Record<string, unknown>>;

/** One raw connection. Errors are raw too; `Database` maps them to codes. */
export interface SqlConnection {
  /** One or more statements without parameters. */
  exec(sql: string): Promise<void>;
  /** One statement with positional parameters; resolves with the number of changed rows. */
  run(sql: string, params: readonly SqlValue[]): Promise<number>;
  all(sql: string, params: readonly SqlValue[]): Promise<readonly SqlRow[]>;
  close(): Promise<void>;
}

/**
 * The database file of the app. One connection per JS process; the port does not assume an exclusive lock of the file, so a native
 * process (background tasks, EVM-109) can open the same file later (WAL + busy_timeout, never `locking_mode=EXCLUSIVE`).
 */
export interface SqlEngine {
  /** Whether the main file exists (an empty file counts). */
  exists(): Promise<boolean>;
  /** Opens (and creates) the file. Nothing is written until the first statement. */
  open(): Promise<SqlConnection>;
  /** Removes the main file and its sidecars (`-wal`, `-shm`, `-journal`); idempotent. */
  remove(): Promise<void>;
}
