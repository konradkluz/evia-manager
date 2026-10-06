import { sql, type Kysely } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MIGRATIONS } from '../../src/migrations/index.ts';
import { createDatabase, type Database } from '../../src/platform/database/database.ts';
import { migrateToLatest } from '../../src/platform/database/migrator.ts';
import { createLogger } from '../../src/platform/logging/logger.ts';
import { freshDatabaseUrl } from './database.ts';

let db: Kysely<Database>;

beforeAll(async () => {
  db = createDatabase({ url: await freshDatabaseUrl(), logger: createLogger({ level: 'fatal' }) });
});

afterAll(async () => {
  await db.destroy();
});

const rows = async <T>(query: ReturnType<typeof sql<T>>): Promise<T[]> => (await query.execute(db)).rows;

describe('database foundation on PostgreSQL (EVM-008 AC1; ADR-0003)', () => {
  it('EVM-008 AC1 first migration applies to an empty database and is idempotent', async () => {
    expect(await migrateToLatest(db, MIGRATIONS)).toEqual({ applied: ['0001_foundation'] });
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
