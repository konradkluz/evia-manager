/**
 * Destructive migrations need the contract phase (EVM-007 AC4; ADR-0018 V6 "Migracje tylko expand"; architect 15).
 */
import { describe, expect, it } from 'vitest';
import { filesBelow, read } from '../src/files.ts';
import { CONTRACT_MARKER, destructiveMigrationProblems } from '../src/migrations.ts';

const MIGRATIONS = filesBelow('apps/api/src/migrations', (path) => /\/\d{4}_[\w-]+\.ts$/.test(path));
/**
 * Migrations that were destructive before the first deployment of the channel — frozen: this list may only shrink
 * (empty on 2026-10-21: the existing migrations only drop and re-create CHECK constraints, which is not destructive).
 */
const BASELINE: readonly string[] = [];

describe('EVM-007 AC4: migrations only expand the schema', () => {
  it('EVM-007 AC4: no migration of the repository has a destructive operation without the contract phase', () => {
    expect(MIGRATIONS.length).toBeGreaterThan(30);
    const problems = MIGRATIONS.filter((path) => !BASELINE.includes(path)).flatMap((path) =>
      destructiveMigrationProblems(path, read(path)),
    );
    expect(problems).toEqual([]);
  });

  it('EVM-007 AC4: the frozen list of earlier destructive migrations never grows and names existing files only', () => {
    expect(BASELINE.length).toBe(0);
    for (const path of BASELINE) expect(MIGRATIONS).toContain(path);
  });

  const destructive: Array<[string, string]> = [
    ['DROP TABLE', 'await sql`drop table work_orders.legacy`.execute(db);'],
    ['DROP COLUMN', 'await sql`alter table work_orders.orders drop column notes`.execute(db);'],
    ['DROP SCHEMA', 'await sql`drop schema legacy cascade`.execute(db);'],
    ['DROP TYPE', 'await sql`drop type status`.execute(db);'],
    ['Kysely dropTable', "await db.schema.dropTable('legacy').execute();"],
    ['Kysely dropColumn', "await db.schema.alterTable('orders').dropColumn('notes').execute();"],
    ['RENAME TO', 'await sql`alter table orders rename to work_orders`.execute(db);'],
    ['RENAME COLUMN', 'await sql`alter table orders rename column notes to remarks`.execute(db);'],
    ['Kysely renameColumn', "await db.schema.alterTable('orders').renameColumn('a', 'b').execute();"],
    ['a column type change', 'await sql`alter table orders alter column amount type integer`.execute(db);'],
    ['SET DATA TYPE', 'await sql`alter table orders alter column "amount" set data type smallint`.execute(db);'],
    ['Kysely setDataType', "await db.schema.alterTable('orders').alterColumn('a', (c) => c.setDataType('text')).execute();"],
    ['SET NOT NULL', 'await sql`alter table orders alter column notes set not null`.execute(db);'],
    ['Kysely setNotNull', "await db.schema.alterTable('orders').alterColumn('a', (c) => c.setNotNull()).execute();"],
    ['ADD COLUMN NOT NULL without DEFAULT', 'await sql`alter table orders add column code text not null`.execute(db);'],
    [
      'Kysely addColumn notNull without defaultTo',
      "await db.schema.alterTable('orders').addColumn('code', 'text', (c) => c.notNull()).execute();",
    ],
  ];
  for (const [name, statement] of destructive)
    it(`EVM-007 AC4: ${name} without the contract phase turns the test red`, () => {
      const source = `export async function up(db) {\n  ${statement}\n}\n`;
      expect(destructiveMigrationProblems('9999_x.ts', source)).not.toEqual([]);
      expect(destructiveMigrationProblems('9999_x.ts', `${CONTRACT_MARKER}\n${source}`)).toEqual([]);
    });

  it('EVM-007 AC4: expanding changes, constraint and index changes, comments and down migrations are not reported', () => {
    const safe = [
      'await sql`alter table orders add column code text`.execute(db);',
      "await sql`alter table orders add column code text not null default 'x'`.execute(db);",
      "await db.schema.alterTable('orders').addColumn('code', 'text', (c) => c.notNull().defaultTo('x')).execute();",
      "await db.schema.createTable('t').addColumn('id', 'uuid', (c) => c.notNull()).execute();",
      'await sql`alter table orders drop constraint orders_status_check, add constraint orders_status_check check (true)`.execute(db);',
      'await sql`drop index if exists orders_idx`.execute(db);',
      '// drop table legacy — a comment',
      '/* rename to x */',
    ];
    for (const statement of safe)
      expect(destructiveMigrationProblems('9999_x.ts', `export async function up(db) {\n  ${statement}\n}\n`), statement).toEqual([]);
    const withDown = 'export async function up(db) {}\nexport async function down(db) {\n  await sql`drop table orders`.execute(db);\n}\n';
    expect(destructiveMigrationProblems('9999_x.ts', withDown)).toEqual([]);
  });
});
