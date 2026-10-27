import { readFileSync } from 'node:fs';
import { sql } from 'kysely';
import { inject, afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MIGRATIONS } from '../../src/migrations/index.ts';
import { createDatabase } from '../../src/platform/database/database.ts';
import { migrateToLatest } from '../../src/platform/database/migrator.ts';
import { runTrustedScript } from '../../src/platform/database/script.ts';
import { createLogger } from '../../src/platform/logging/logger.ts';

// The staging database is created by infra/runtime/postgres-init/10-roles.sql and migrated as evia_migrator, which is
// NOT a superuser and has no CREATEROLE. The other integration tests migrate as the owner of a scratch database, which
// hid a permission failure (42501 on `create role evia_app`) found on the first real deployment.
const ROLES_SQL = new URL('../../../../infra/runtime/postgres-init/10-roles.sql', import.meta.url);
const DATABASE = 'evia_roles_it';
const logger = createLogger({ level: 'fatal' });
const PASSWORD = 'evia-roles-synthetic';

const withDatabase = (url: string, database: string, user?: string): string => {
  const result = new URL(url);
  result.pathname = `/${database}`;
  if (user !== undefined) {
    result.username = user;
    result.password = PASSWORD;
  }
  return result.toString();
};

/** The init script before and after `\connect evia`, with the database renamed for the shared test server. */
function initScript(): { readonly cluster: string; readonly database: string } {
  const script = readFileSync(ROLES_SQL, 'utf8')
    .replace(/^\s*--.*$/gm, '') // comment lines
    .replace('CREATE ROLE evia_app NOLOGIN;', '') // pre-created by the test (the cluster is shared); see beforeAll
    .replaceAll('DATABASE evia ', `DATABASE ${DATABASE} `);
  const [cluster, database] = script.split(`${String.fromCharCode(92)}connect evia`);
  expect(cluster).toBeDefined();
  expect(database).toBeDefined();
  return { cluster: cluster ?? '', database: database ?? '' };
}

describe('production-like roles and migrations (EVM-007 AC1)', () => {
  const adminUrl = inject('adminDatabaseUrl');
  const admin = createDatabase({ url: adminUrl, logger, pool: { max: 1 } });

  const dropAll = async (): Promise<void> => {
    await sql`drop database if exists ${sql.id('evia_roles_it')} with (force)`.execute(admin);
    await sql`drop role if exists evia_api`.execute(admin);
    await sql`drop role if exists evia_migrator`.execute(admin);
  };

  beforeAll(async () => {
    await dropAll();
    // evia_app exists before the migrations, as on staging; the shared cluster keeps it between test files
    await sql`do $$ begin if not exists (select 1 from pg_roles where rolname = 'evia_app') then create role evia_app nologin; end if; end $$`.execute(
      admin,
    );
    await sql`create database ${sql.id('evia_roles_it')} template template1`.execute(admin);
    const { cluster, database } = initScript();
    await runTrustedScript(admin, cluster);
    const inDatabase = createDatabase({ url: withDatabase(adminUrl, DATABASE), logger, pool: { max: 1 } });
    try {
      await runTrustedScript(inDatabase, database);
    } finally {
      await inDatabase.destroy();
    }
    await sql`alter role evia_migrator password 'evia-roles-synthetic'`.execute(admin);
    await sql`alter role evia_api password 'evia-roles-synthetic'`.execute(admin);
  });

  afterAll(async () => {
    await dropAll();
    await admin.destroy();
  });

  it('EVM-007 AC1 the migrator without CREATEROLE applies every migration when evia_app already exists', async () => {
    const [migrator] = (
      await sql<{ rolsuper: boolean; rolcreaterole: boolean; rolcreatedb: boolean }>`
        select rolsuper, rolcreaterole, rolcreatedb from pg_roles where rolname = 'evia_migrator'`.execute(admin)
    ).rows;
    expect(migrator).toEqual({ rolsuper: false, rolcreaterole: false, rolcreatedb: false });

    const db = createDatabase({ url: withDatabase(adminUrl, DATABASE, 'evia_migrator'), logger, pool: { max: 1 } });
    try {
      expect(await migrateToLatest(db, MIGRATIONS)).toEqual({ applied: Object.keys(MIGRATIONS) });
    } finally {
      await db.destroy();
    }
  });

  it('EVM-007 AC1 the API login role works through evia_app and can neither create objects nor change the audit log', async () => {
    const app = createDatabase({ url: withDatabase(adminUrl, DATABASE, 'evia_api'), logger, pool: { max: 1 } });
    try {
      const [who] = (await sql<{ user: string }>`select current_user as user`.execute(app)).rows;
      expect(who).toEqual({ user: 'evia_api' });
      expect((await sql`select count(*) from identity.users`.execute(app)).rows).toHaveLength(1);
      const [privileges] = (
        await sql<Record<string, boolean>>`
          select has_table_privilege('audit.events', 'INSERT') as audit_insert,
                 has_table_privilege('audit.events', 'UPDATE') as audit_update,
                 has_table_privilege('audit.events', 'DELETE') as audit_delete,
                 has_schema_privilege('public', 'CREATE') as public_create,
                 has_database_privilege(current_database(), 'CREATE') as database_create`.execute(app)
      ).rows;
      expect(privileges).toEqual({
        audit_insert: true,
        audit_update: false,
        audit_delete: false,
        public_create: false,
        database_create: false,
      });
      await expect(sql`create table public.evia_api_probe (id integer)`.execute(app)).rejects.toMatchObject({ code: '42501' });
    } finally {
      await app.destroy();
    }
  });
});
