/**
 * 0024 — the job queue (ADR-0010; EVM-034 W11): the schema `pgboss` with the tables of pg-boss, created as the MIGRATOR role with the
 * FROZEN SQL of schema version 43 (`data/pgboss-schema-43.ts`, generated once from `getConstructionPlans` of pg-boss 12.35.1) — the
 * migration never calls the library, so it builds the same schema whatever package is installed. The worker (the application role) starts with `migrate: false` and `createSchema:
 * false`: it never creates or alters a table (SR-INFRA-03, ASVS V13.2.2).
 *
 * - expand only: a new schema, nothing existing changes;
 * - the application role: USAGE on the schema, DML on the tables, USAGE on the sequences, EXECUTE on the functions — NO CREATE on the
 *   schema or the database; the grants are EXPLICIT (no default privileges: the policy of the migrations, EVM-016 AC7), so a migration
 *   that adds a table of the library grants it too. The read-only role (and everyone else) has no access: the queue holds
 *   identifiers of orders (pseudonymous data) and counts only (TM-26, TM-72);
 * - `BEGIN` and `COMMIT` of the library's script are cut off: the migrator already runs this migration in a transaction;
 * - UPGRADING pg-boss: the version of the schema comes with the package (`pgboss.schema` in its package.json). The integration test
 *   "the schema version of the package equals the frozen one" turns red when Renovate raises the package to a newer schema; the fix is
 *   a NEW migration that applies `getMigrationPlans('pgboss', 43)` and repeats the grants — never an edit of this one or of the
 *   frozen script.
 */
import { sql, type Kysely } from 'kysely';
import { PGBOSS_SCHEMA_43_SCRIPT } from './data/pgboss-schema-43.ts';
import type { Database } from '../platform/database/database.ts';
import { runTrustedScript, withoutTransaction } from '../platform/database/script.ts';

export async function up(db: Kysely<Database>): Promise<void> {
  await runTrustedScript(db, withoutTransaction(PGBOSS_SCHEMA_43_SCRIPT));
  await sql`revoke all on schema pgboss from public`.execute(db);
  await sql`grant usage on schema pgboss to evia_app`.execute(db);
  await sql`grant select, insert, update, delete on all tables in schema pgboss to evia_app`.execute(db);
  await sql`grant usage, select on all sequences in schema pgboss to evia_app`.execute(db);
  await sql`grant execute on all functions in schema pgboss to evia_app`.execute(db);
}
