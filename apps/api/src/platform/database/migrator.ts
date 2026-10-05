/**
 * Applies pending migrations (ADR-0003). Run only by `pnpm --filter @evia/api run db:migrate` / the release step —
 * never at API startup (the future evia_migrator role owns DDL; evia_app has none).
 */
import type { Kysely } from 'kysely';
import { Migrator, type Migration } from 'kysely/migration';
import type { Database } from './database.ts';

export interface MigrationReport {
  readonly applied: readonly string[];
}

export async function migrateToLatest(db: Kysely<Database>, migrations: Readonly<Record<string, Migration>>): Promise<MigrationReport> {
  const migrator = new Migrator({ db, provider: { getMigrations: () => Promise.resolve({ ...migrations }) } });
  const { error, results = [] } = await migrator.migrateToLatest();
  if (error !== undefined) throw error instanceof Error ? error : new Error('migration failed');
  return { applied: results.filter((result) => result.status === 'Success').map((result) => result.migrationName) };
}
