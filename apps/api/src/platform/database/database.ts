/**
 * PostgreSQL access (ADR-0003): Kysely over a small pg pool with short timeouts — `/api/health` is public and has no
 * rate limit yet (EVM-016/EVM-076), so a slow or unreachable database must neither hang requests nor exhaust the pool
 * (CWE-400). Migrations use their own connection without the statement timeout (src/migrate.ts).
 * The only module allowed to import the pg driver (lint: DATABASE_DRIVER_FILES).
 */
import { Kysely, PostgresDialect } from 'kysely';
import pg from 'pg';
import type { Logger } from '../logging/logger.ts';

/** Tables of the application schema — none yet (the first tables arrive with E1/E2; kysely-codegen then). */
export type Database = Record<string, never>;

export interface PoolSettings {
  readonly max: number;
  readonly connectionTimeoutMillis: number;
  readonly idleTimeoutMillis: number;
  readonly statement_timeout?: number | undefined;
  readonly query_timeout?: number | undefined;
  readonly idle_in_transaction_session_timeout?: number | undefined;
  /** Startup options of the session (`-c name=value`): the driver has no field for `transaction_timeout`, PostgreSQL 17+ ends the session when a transaction runs longer. */
  readonly options?: string | undefined;
  readonly application_name: string;
}

export const POOL_SETTINGS: PoolSettings = Object.freeze({
  max: 10,
  connectionTimeoutMillis: 2000,
  idleTimeoutMillis: 30_000,
  statement_timeout: 2000,
  query_timeout: 3000,
  // a transaction that waits for something outside the database (the register of deletions, up to ~5 s) must not hold its locks for ever
  idle_in_transaction_session_timeout: 10_000,
  // EVM-096 AC4 (ADR-0021 D5): no transaction of the API holds the horizon of the change log for more than 30 s; the session ends, the pool discards the connection
  options: '-c transaction_timeout=30000',
  application_name: 'evia-api',
});

/**
 * Profiles of the other processes (ADR-0021 D5). The worker runs jobs (retention, purge, rebuild of projections, exports) whose transactions legitimately outlast an
 * API request: 5 minutes per transaction, 30 s idle in a transaction. Every CLI that rebuilds data (`overview`) runs with the worker profile.
 */
export const WORKER_POOL_SETTINGS: Partial<PoolSettings> = Object.freeze({
  idle_in_transaction_session_timeout: 30_000,
  options: '-c transaction_timeout=300000',
});

/** The migrator: the runner applies ALL pending migrations in ONE transaction and DDL may take long, so it inherits NO limit of the API (ADR-0021 D5). */
export const MIGRATOR_POOL_SETTINGS: Partial<PoolSettings> = Object.freeze({
  max: 1,
  statement_timeout: undefined,
  query_timeout: undefined,
  idle_in_transaction_session_timeout: undefined,
  options: undefined,
});

export interface DatabaseOptions {
  readonly url: string;
  readonly logger: Logger;
  /** Pool overrides — the migrator disables the statement timeout. */
  readonly pool?: Partial<PoolSettings>;
}

export function createPool({ url, logger, pool: overrides = {} }: DatabaseOptions): pg.Pool {
  const pool = new pg.Pool({ connectionString: url, ...POOL_SETTINGS, ...overrides });
  // An idle client losing its connection emits 'error' on the pool; unhandled, it would stop the process.
  pool.on('error', (error) => {
    logger.warn({ err: error }, 'database pool: idle connection error');
  });
  // A session ended by the server while a client is checked out (`transaction_timeout`, `idle_in_transaction_session_timeout`, a restart) emits 'error' on the
  // client: without a listener the process would stop. The listener only logs; the client is no longer queryable, so the pool discards it on release.
  pool.on('connect', (client) => {
    client.on('error', (error) => {
      logger.warn({ err: error }, 'database pool: a session was ended by the server');
    });
  });
  return pool;
}

export function createDatabase(options: DatabaseOptions): Kysely<Database> {
  return new Kysely<Database>({ dialect: new PostgresDialect({ pool: createPool(options) }) });
}
