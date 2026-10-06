import { DummyDriver, Kysely, PostgresAdapter, PostgresIntrospector, PostgresQueryCompiler, sql } from 'kysely';
import { describe, expect, it } from 'vitest';
import { MIGRATIONS } from '../../src/migrations/index.ts';
import type { Database } from '../../src/platform/database/database.ts';
import { migrateToLatest } from '../../src/platform/database/migrator.ts';

/** Kysely without a database: records the compiled SQL (the real run is in test/integration). */
function recordingDb() {
  const statements: string[] = [];
  const db = new Kysely<Database>({
    dialect: {
      createAdapter: () => new PostgresAdapter(),
      createDriver: () => new DummyDriver(),
      createIntrospector: (instance) => new PostgresIntrospector(instance),
      createQueryCompiler: () => new PostgresQueryCompiler(),
    },
    log: (event) => {
      if (event.level === 'query') statements.push(event.query.sql.replace(/\s+/g, ' ').trim());
    },
  });
  return { db, statements };
}

describe('first migration (EVM-008 AC1; ADR-0003)', () => {
  it('EVM-008 AC1 migrations are forward only and start with 0001_foundation', () => {
    expect(Object.keys(MIGRATIONS)).toEqual(['0001_foundation']);
    for (const migration of Object.values(MIGRATIONS)) expect(Object.keys(migration)).toEqual(['up']);
  });

  it('EVM-008 AC1 0001 creates search extensions, a hijack-safe immutable f_unaccent and revokes CREATE on public', async () => {
    const { db, statements } = recordingDb();
    const { applied } = await migrateToLatest(db, MIGRATIONS);
    expect(applied).toEqual(['0001_foundation']);
    expect(statements).toEqual(
      expect.arrayContaining([
        'create extension if not exists unaccent with schema public',
        'create extension if not exists pg_trgm with schema public',
        "create or replace function public.f_unaccent(text) returns text language sql immutable parallel safe strict set search_path = pg_catalog, public return public.unaccent('public.unaccent'::regdictionary, $1)",
        'revoke create on schema public from public',
      ]),
    );
    expect(statements.join('\n')).not.toMatch(/drop |truncate |delete from/i);
  });

  it('EVM-008 AC1 a failing migration fails the run', async () => {
    const { db } = recordingDb();
    const failing = {
      '0001_failing': {
        up: async (instance: Kysely<Database>) => {
          await sql`select 1`.execute(instance);
          throw new Error('synthetic migration failure');
        },
      },
    };
    await expect(migrateToLatest(db, failing)).rejects.toThrow('synthetic migration failure');
    await expect(
      migrateToLatest(db, {
        '0001_rejecting': {
          // A rejection with a value that is not an Error (a third-party migration helper could do that).
          up: () => Promise.reject(Object.create(null) as Error),
        },
      }),
    ).rejects.toThrow('migration failed');
  });
});
