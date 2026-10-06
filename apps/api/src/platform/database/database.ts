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
  readonly application_name: string;
}

export const POOL_SETTINGS: PoolSettings = Object.freeze({
  max: 10,
  connectionTimeoutMillis: 2000,
  idleTimeoutMillis: 30_000,
  statement_timeout: 2000,
  query_timeout: 3000,
  application_name: 'evia-api',
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
  return pool;
}

export function createDatabase(options: DatabaseOptions): Kysely<Database> {
  return new Kysely<Database>({ dialect: new PostgresDialect({ pool: createPool(options) }) });
}
