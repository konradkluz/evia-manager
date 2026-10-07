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
    expect(Object.keys(MIGRATIONS)).toEqual([
      '0001_foundation',
      '0002_roles',
      '0003_audit',
      '0004_identity',
      '0005_security_alerts',
      '0006_login',
      '0007_catalog',
      '0008_catalog_seed',
      '0009_step_up',
      '0010_work_orders',
      '0011_customers',
      '0012_idempotency',
    ]);
    for (const migration of Object.values(MIGRATIONS)) expect(Object.keys(migration)).toEqual(['up']);
  });

  it('EVM-008 AC1 0001 creates search extensions, a hijack-safe immutable f_unaccent and revokes CREATE on public', async () => {
    const { db, statements } = recordingDb();
    const { applied } = await migrateToLatest(db, { '0001_foundation': MIGRATIONS['0001_foundation'] as never });
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

describe('identity and audit migrations (EVM-016 AC7; ADR-0003)', () => {
  it('EVM-016 AC7 the migrations never touch the database clock, drop data or create default privileges', async () => {
    const { db, statements } = recordingDb();
    await migrateToLatest(db, MIGRATIONS);
    const all = statements.join(' ; ');
    expect(all).not.toMatch(/\bnow\(\)|current_timestamp|alter default privileges|drop table|drop schema/i);
    expect(all).toContain('create role evia_app nologin');
    expect(all).not.toMatch(/create role evia_migrator|\blogin\b/i);
  });

  it('EVM-016 AC7 audit.events is append-only for evia_app and rejected by triggers for everybody else', async () => {
    const { db, statements } = recordingDb();
    await migrateToLatest(db, MIGRATIONS);
    expect(statements).toEqual(
      expect.arrayContaining([
        'grant insert, select on audit.events to evia_app',
        'create trigger events_reject_row_change before update or delete on audit.events for each row execute function audit.reject_change()',
        'create trigger events_reject_truncate before truncate on audit.events for each statement execute function audit.reject_change()',
      ]),
    );
    expect(statements.join(' ; ')).not.toMatch(/grant [^;]*(update|delete|truncate|all)[^;]* on audit\./i);
  });
});

describe('catalog migrations (EVM-019 AC1, AC6; ADR-0003)', () => {
  it('EVM-019 AC6 evia_app gets USAGE on the schema and an explicit SELECT on every catalog table, and nothing that changes data', async () => {
    const { db, statements } = recordingDb();
    await migrateToLatest(db, MIGRATIONS);
    const grants = statements.filter((statement) => /^grant .* on catalog\./.test(statement));
    expect(grants.sort()).toEqual(
      [
        'document_kinds',
        'payment_milestone_templates',
        'procedure_stage_templates',
        'procedure_templates',
        'service_catalog_item_procedures',
        'service_catalog_items',
        'work_order_template_items',
        'work_order_templates',
      ].map((table) => `grant select on catalog.${table} to evia_app`),
    );
    expect(statements).toEqual(
      expect.arrayContaining(['revoke all on schema catalog from public', 'grant usage on schema catalog to evia_app']),
    );
    expect(statements.join(' ; ')).not.toMatch(/grant [^;]*(insert|update|delete|truncate|all)[^;]* on catalog\./i);
    expect(statements.join(' ; ')).not.toMatch(/alter default privileges/i);
  });

  it('EVM-019 AC1 the data migration inserts every value as a bound parameter and never reads the database clock', async () => {
    const { db, statements } = recordingDb();
    await migrateToLatest(db, { '0008_catalog_seed': MIGRATIONS['0008_catalog_seed'] as never });
    const inserts = statements.filter((statement) => statement.startsWith('insert into catalog.'));
    expect(inserts).toHaveLength(12 + 11 + 10 + 32 + 16 + 5 + 26 + 11);
    for (const insert of inserts) {
      expect(insert).toMatch(/^insert into catalog\.[a-z_]+ \(.*\) values \(.*\)$/);
      expect(insert).not.toMatch(/'/);
      expect(insert).not.toMatch(/now\(\)|current_timestamp/i);
    }
  });
});
