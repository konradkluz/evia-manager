import { sql, type Kysely } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MIGRATIONS } from '../../src/migrations/index.ts';
import { createDatabase, type Database } from '../../src/platform/database/database.ts';
import { migrateToLatest } from '../../src/platform/database/migrator.ts';
import { createLogger } from '../../src/platform/logging/logger.ts';
import { freshDatabaseUrl, migratedDatabase, type MigratedDatabase } from './database.ts';

let db: Kysely<Database>;

beforeAll(async () => {
  db = createDatabase({ url: await freshDatabaseUrl(), logger: createLogger({ level: 'fatal' }) });
});

afterAll(async () => {
  await db.destroy();
});

const rows = async <T>(query: ReturnType<typeof sql<T>>): Promise<T[]> => (await query.execute(db)).rows;

describe('database foundation on PostgreSQL (EVM-008 AC1; ADR-0003)', () => {
  it('EVM-008 AC1 migrations apply to an empty database and are idempotent', async () => {
    expect(await migrateToLatest(db, MIGRATIONS)).toEqual({ applied: Object.keys(MIGRATIONS) });
    expect(await migrateToLatest(db, MIGRATIONS)).toEqual({ applied: [] });
    const extensions = await rows<{ extname: string }>(
      sql`select extname from pg_extension where extname in ('unaccent', 'pg_trgm') order by extname`,
    );
    expect(extensions.map((row) => row.extname)).toEqual(['pg_trgm', 'unaccent']);
  });

  it('EVM-008 AC1 database uses ICU pl-PL collation', async () => {
    const [database] = await rows<{ provider: string; locale: string | null }>(
      sql`select datlocprovider as provider, datlocale as locale from pg_database where datname = current_database()`,
    );
    expect(database).toEqual({ provider: 'i', locale: 'pl-PL' });
    const sorted = await rows<{ word: string }>(
      sql`select word from (values ('Mazury'), ('Łódź'), ('Lodz'), ('Las')) as words(word) order by word`,
    );
    expect(sorted.map((row) => row.word)).toEqual(['Las', 'Lodz', 'Łódź', 'Mazury']);
  });

  it('EVM-008 AC1 f_unaccent maps Polish letters and is immutable, parallel safe, strict, with a fixed search_path', async () => {
    const [mapped] = await rows<{ value: string; nothing: string | null }>(
      sql`select public.f_unaccent('Łódź Żółć') as value, public.f_unaccent(null) as nothing`,
    );
    expect(mapped).toEqual({ value: 'Lodz Zolc', nothing: null });
    const [definition] = await rows<{ volatile: string; parallel: string; strict: boolean; config: string[] }>(
      sql`select provolatile as volatile, proparallel as parallel, proisstrict as strict, proconfig as config
          from pg_proc where oid = 'public.f_unaccent(text)'::regprocedure`,
    );
    expect(definition).toEqual({ volatile: 'i', parallel: 's', strict: true, config: ['search_path=pg_catalog, public'] });
  });

  it('EVM-008 AC1 roles other than the owner cannot create objects in schema public', async () => {
    await sql`drop role if exists ${sql.id('evia_it_probe')}`.execute(db);
    await sql`create role ${sql.id('evia_it_probe')} nologin`.execute(db);
    const [privilege] = await rows<{ allowed: boolean }>(sql`select has_schema_privilege('evia_it_probe', 'public', 'CREATE') as allowed`);
    await sql`drop role ${sql.id('evia_it_probe')}`.execute(db);
    expect(privilege).toEqual({ allowed: false });
  });
});

describe('roles and privileges (EVM-016 AC7; ADR-0003, W7)', () => {
  let database: MigratedDatabase;
  let app: Kysely<Database>;

  beforeAll(async () => {
    database = await migratedDatabase();
    app = createDatabase({ url: database.appUrl, logger: createLogger({ level: 'fatal' }), pool: { max: 2 } });
  });

  afterAll(async () => {
    await app.destroy();
    await database.close();
  });

  const privileges = async (relation: string, role = 'evia_it_app') => {
    const checks = ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] as const;
    const result: Record<string, boolean> = {};
    for (const privilege of checks) {
      const { rows: found } = await sql<{
        allowed: boolean;
      }>`select has_table_privilege(${role}, ${relation}, ${privilege}) as allowed`.execute(database.admin);
      result[privilege] = found[0]?.allowed ?? false;
    }
    return result;
  };

  it('EVM-016 AC7 0002 creates evia_app as a NOLOGIN role and tolerates an existing role (roles are cluster-wide)', async () => {
    const [role] = (
      await sql<{ rolcanlogin: boolean; rolsuper: boolean; rolcreatedb: boolean; rolcreaterole: boolean }>`
        select rolcanlogin, rolsuper, rolcreatedb, rolcreaterole from pg_roles where rolname = 'evia_app'`.execute(database.admin)
    ).rows;
    expect(role).toEqual({ rolcanlogin: false, rolsuper: false, rolcreatedb: false, rolcreaterole: false });
    const second = await migratedDatabase();
    await second.close();
    const migrator = await sql<{ rolname: string }>`select rolname from pg_roles where rolname in ('evia_migrator')`.execute(
      database.admin,
    );
    expect(migrator.rows).toEqual([]);
  });

  it('EVM-016 AC7 evia_app can only INSERT and SELECT on audit.events, and nothing else on the audit schema', async () => {
    expect(await privileges('audit.events')).toEqual({
      SELECT: true,
      INSERT: true,
      UPDATE: false,
      DELETE: false,
      TRUNCATE: false,
      REFERENCES: false,
      TRIGGER: false,
    });
    const { rows: relations } = await sql<{ relname: string }>`
      select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'audit' and c.relkind in ('r', 'p', 'v', 'm', 'S') order by c.relname`.execute(database.admin);
    expect(relations.map((row) => row.relname)).toEqual(['events']);
  });

  it('EVM-016 AC7 every table of the identity and platform schemas has explicit DML for evia_app and nothing is left to defaults', async () => {
    const { rows: tables } = await sql<{ schema: string; name: string }>`
      select n.nspname as schema, c.relname as name from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname in ('identity', 'platform') and c.relkind in ('r', 'p') order by 1, 2`.execute(database.admin);
    expect(tables.map((table) => `${table.schema}.${table.name}`)).toEqual([
      'identity.login_attempts',
      'identity.one_time_links',
      'identity.passkeys',
      'identity.password_credentials',
      'identity.sessions',
      'identity.users',
      'identity.webauthn_challenges',
      'platform.idempotency_records',
      'platform.security_alert_outbox',
    ]);
    for (const table of tables) {
      const granted = await privileges(`${table.schema}.${table.name}`);
      expect(granted.SELECT && granted.INSERT && granted.UPDATE, `${table.schema}.${table.name}`).toBe(true);
      expect(granted.TRUNCATE || granted.REFERENCES || granted.TRIGGER, `${table.schema}.${table.name}`).toBe(false);
    }
    const { rows: defaults } = await sql<{ count: string }>`
      select count(*)::text as count from pg_default_acl
      where defaclnamespace in (select oid from pg_namespace where nspname in ('audit', 'identity', 'platform'))`.execute(database.admin);
    expect(defaults[0]?.count).toBe('0');
  });

  it('EVM-016 AC7 PUBLIC has nothing on the schemas of the application and evia_app owns nothing and has no DDL', async () => {
    const { rows: schemaAccess } = await sql<{ schema: string; usage: boolean; create: boolean }>`
      select n.nspname as schema, has_schema_privilege('public', n.oid, 'USAGE') as usage, has_schema_privilege('public', n.oid, 'CREATE') as create
      from pg_namespace n where n.nspname in ('audit', 'identity', 'platform') order by 1`.execute(database.admin);
    expect(schemaAccess).toEqual([
      { schema: 'audit', usage: false, create: false },
      { schema: 'identity', usage: false, create: false },
      { schema: 'platform', usage: false, create: false },
    ]);
    const { rows: owned } = await sql<{ relname: string }>`
      select c.relname from pg_class c join pg_roles r on r.oid = c.relowner where r.rolname in ('evia_app', 'evia_it_app')`.execute(
      database.admin,
    );
    expect(owned).toEqual([]);
    for (const schema of ['audit', 'identity', 'platform', 'public']) {
      const { rows: create } = await sql<{
        allowed: boolean;
      }>`select has_schema_privilege('evia_it_app', ${schema}, 'CREATE') as allowed`.execute(database.admin);
      expect(create[0]?.allowed, schema).toBe(false);
    }
    const { rows: functionAccess } = await sql<{ allowed: boolean }>`
      select has_function_privilege('public', 'audit.reject_change()', 'EXECUTE') as allowed`.execute(database.admin);
    expect(functionAccess[0]?.allowed).toBe(false);
  });

  const insertEvent = sql`
    insert into audit.events (occurred_at, actor_type, origin, action, outcome, object_type, trace_id)
    values ('2026-10-01T08:00:00Z', 'system', 'cli', 'activation_link.issued', 'success', 'user', ${'a'.repeat(32)})`;

  it('EVM-016 AC7 evia_app inserts and reads audit events, but UPDATE, DELETE and TRUNCATE fail with permission denied (42501)', async () => {
    await insertEvent.execute(app);
    const { rows: read } = await sql<{ action: string }>`select action from audit.events`.execute(app);
    expect(read).toEqual([{ action: 'activation_link.issued' }]);
    const attempts = [sql`update audit.events set outcome = 'failed'`, sql`delete from audit.events`, sql`truncate audit.events`];
    for (const attempt of attempts) {
      await expect(attempt.execute(app)).rejects.toMatchObject({ code: '42501' });
    }
  });

  it('EVM-016 AC7 evia_app can neither disable the trigger nor drop the table or the schema, nor create objects', async () => {
    for (const statement of [
      sql`alter table audit.events disable trigger events_reject_row_change`,
      sql`alter table audit.events disable trigger all`,
      sql`drop table audit.events`,
      sql`drop schema audit cascade`,
      sql`create table audit.other (id int)`,
      sql`create table identity.other (id int)`,
      sql`create function audit.other() returns int language sql return 1`,
    ]) {
      await expect(statement.execute(app)).rejects.toMatchObject({ code: '42501' });
    }
  });

  it('EVM-016 AC7 even the owner is stopped by the trigger: UPDATE, DELETE and TRUNCATE are rejected (EV001)', async () => {
    await insertEvent.execute(database.admin);
    for (const statement of [sql`update audit.events set outcome = 'failed'`, sql`delete from audit.events`, sql`truncate audit.events`]) {
      await expect(statement.execute(database.admin)).rejects.toMatchObject({ code: 'EV001' });
    }
    const { rows: count } = await sql<{ n: string }>`select count(*)::text as n from audit.events`.execute(database.admin);
    expect(Number(count[0]?.n)).toBeGreaterThanOrEqual(1);
  });

  it('EVM-016 AC7 the trigger function has a fixed search_path and the audit table has the expected closed columns', async () => {
    const [config] = (
      await sql<{ proconfig: string[] }>`select proconfig from pg_proc where oid = 'audit.reject_change()'::regprocedure`.execute(
        database.admin,
      )
    ).rows;
    expect(config?.proconfig).toEqual(['search_path=pg_catalog']);
    const { rows: columns } = await sql<{ column_name: string }>`
      select column_name from information_schema.columns where table_schema = 'audit' and table_name = 'events' order by ordinal_position`.execute(
      database.admin,
    );
    expect(columns.map((column) => column.column_name)).toEqual([
      'id',
      'occurred_at',
      'actor_type',
      'actor_user_id',
      'session_id',
      'ip_prefix',
      'origin',
      'action',
      'outcome',
      'reason_code',
      'object_type',
      'object_id',
      'trace_id',
    ]);
  });

  it('EVM-016 AC7 the e-mail column is stored normalised and unique (lower case enforced by the database)', async () => {
    const insert = (email: string) =>
      sql`insert into identity.users (email, display_name, role, status, webauthn_user_handle, created_at, updated_at)
          values (${email}, 'Synthetic', 'editor', 'invited', ${Buffer.alloc(32, email.length)}, '2026-10-01T08:00:00Z', '2026-10-01T08:00:00Z')`;
    await insert('lower@evia.invalid').execute(database.admin);
    await expect(insert('lower@evia.invalid').execute(database.admin)).rejects.toMatchObject({ code: '23505' });
    await expect(insert('Upper@evia.invalid').execute(database.admin)).rejects.toMatchObject({ code: '23514' });
  });
});
