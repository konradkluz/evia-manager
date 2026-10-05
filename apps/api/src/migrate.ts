/**
 * Entry point `pnpm --filter @evia/api run db:migrate` (ADR-0003): applies pending migrations with its own connection
 * (no statement timeout — DDL may take longer than API queries). Runs with Node type stripping (no decorators here).
 */
import { MIGRATIONS } from './migrations/index.ts';
import { loadConfig } from './platform/config/config.ts';
import { createDatabase } from './platform/database/database.ts';
import { migrateToLatest } from './platform/database/migrator.ts';
import { createLogger } from './platform/logging/logger.ts';

/* v8 ignore start -- process wiring of the migration entry point; migrateToLatest() is covered by tests */
if (import.meta.main) {
  const config = loadConfig(process.env);
  const logger = createLogger({ level: config.logLevel });
  const db = createDatabase({ url: config.databaseUrl, logger, pool: { max: 1, statement_timeout: undefined, query_timeout: undefined } });
  try {
    const { applied } = await migrateToLatest(db, MIGRATIONS);
    logger.info({ applied }, 'migrations applied');
  } catch (error) {
    logger.error({ err: error }, 'migration failed');
    process.exitCode = 1;
  } finally {
    await db.destroy();
  }
}
/* v8 ignore stop */
