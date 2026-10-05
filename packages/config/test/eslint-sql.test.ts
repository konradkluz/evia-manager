import { Linter } from 'eslint';
import { describe, expect, it } from 'vitest';
import { config, DATABASE_DRIVER_FILES, sqlSafety } from '../src/eslint.ts';

/** Lints a snippet with the SQL safety block only (no type information needed). */
function lint(code: string, filename = 'src/modules/x/infrastructure/repository.js'): string[] {
  const linter = new Linter({ configType: 'flat' });
  const messages = linter.verify(code, [{ files: ['**/*.js'], languageOptions: { sourceType: 'module' } }, ...sqlSafety()], filename);
  return messages.map((message) => message.ruleId ?? message.message);
}

describe('SQL concatenation ban (EVM-008 AC4; SR-INPUT-03, ADR-0003)', () => {
  it('EVM-008 AC4 SQL concatenation is rejected by lint: raw SQL builders are errors', () => {
    const forbidden = [
      'sql.raw(`select * from t where id = ${id}`);',
      "sql.raw('select 1');",
      'sql.lit(value);',
      "db.executeQuery(CompiledQuery.raw('select ' + id));",
      'const raw = CompiledQuery.raw;',
      'sql.ref(column);',
      'sql.id(schema, table);',
      'sql.table(name);',
      'sql.ref(`${prefix}.id`);',
      "import pg from 'pg';",
      "import { Pool } from 'pg';",
      "import Pool from 'pg-pool';",
    ];
    for (const code of forbidden) expect(lint(code), code).not.toEqual([]);
  });

  it('EVM-008 AC4 parameterised SQL and literal identifiers are allowed', () => {
    const allowed = [
      'sql`select ${id}`.execute(db);',
      "db.selectFrom('work_orders').where('id', '=', id).execute();",
      "sql.ref('work_orders.id');",
      "sql.table('work_orders');",
      "sql.id('public', 'f_unaccent');",
      "import { sql } from 'kysely';",
    ];
    for (const code of allowed) expect(lint(code), code).toEqual([]);
  });

  it('EVM-008 AC4 the pg driver is imported only by the platform database module', () => {
    expect(DATABASE_DRIVER_FILES).toEqual(['src/platform/database/**']);
    expect(lint("import pg from 'pg';", 'src/platform/database/database.js')).toEqual([]);
    expect(lint("sql.raw('x');", 'src/platform/database/database.js')).not.toEqual([]);
    expect(lint("import pg from 'pg';", 'src/migrations/0001_foundation.js')).not.toEqual([]);
    expect(lint("sql.raw('x');", 'src/migrations/0001_foundation.js')).not.toEqual([]);
  });

  it('EVM-008 AC4 every workspace gets the SQL safety rules through the shared config', () => {
    const entries = config({ tsconfigRootDir: '/r' });
    for (const block of sqlSafety()) expect(entries).toContainEqual(block);
  });
});
