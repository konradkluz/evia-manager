/**
 * Expand/contract of database migrations (EVM-007 AC4; ADR-0018 "Rollback i migracje", ADR-0003; architect 15): a
 * release only expands the schema, so version N−1 keeps working on schema N and a rollback never needs a down migration.
 * A destructive operation — DROP of a table, column, schema, view, type, function or sequence, RENAME, a change of a
 * column type, SET NOT NULL, a new NOT NULL column without a default — is allowed only in a migration marked as the
 * contract phase: `export const phase = 'contract';` (a later release, after the code stopped using the old shape).
 * Dropping or re-creating a constraint or an index is not destructive for N−1 and is not reported.
 */

const RULES: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bdrop\s+(table|column|schema|view|materialized\s+view|type|function|sequence)\b/i, 'DROP'],
  [/\.(dropTable|dropColumn|dropSchema|dropView|dropType)\(/, 'DROP (Kysely)'],
  [/\brename\s+(to|column)\b/i, 'RENAME'],
  [/\.(renameTo|renameColumn)\(/, 'RENAME (Kysely)'],
  [/\balter\s+column\s+"?\w+"?\s+(set\s+data\s+)?type\b/i, 'zmiana typu kolumny'],
  [/\.setDataType\(/, 'zmiana typu kolumny (Kysely)'],
  [/\bset\s+not\s+null\b/i, 'SET NOT NULL'],
  [/\.setNotNull\(/, 'SET NOT NULL (Kysely)'],
  [/\badd\s+column\s+(if\s+not\s+exists\s+)?"?\w+"?\s+[^,;`]*\bnot\s+null\b(?![^,;`]*\bdefault\b)/i, 'ADD COLUMN NOT NULL bez DEFAULT'],
];

export const CONTRACT_MARKER = "export const phase = 'contract';";

/** The source without comments and without a `down` migration (which may undo anything). */
function upCode(source: string): string {
  const withoutComments = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  const down = withoutComments.search(/export\s+async\s+function\s+down\b/);
  return down < 0 ? withoutComments : withoutComments.slice(0, down);
}

/** Kysely: `.alterTable(…).addColumn(…, (column) => column.notNull())` without `.defaultTo(` in the same column. */
function kyselyNotNullColumns(code: string): boolean {
  if (!code.includes('alterTable(')) return false;
  return code
    .split('.addColumn(')
    .slice(1)
    .some((part) => {
      const column = part.split(/\.(addColumn|execute|alterColumn|dropColumn)\(/)[0] ?? '';
      return column.includes('.notNull()') && !column.includes('.defaultTo(');
    });
}

/** Destructive operations of one migration without the contract marker; [] when there are none or it is marked. */
export function destructiveMigrationProblems(file: string, source: string): string[] {
  if (source.includes(CONTRACT_MARKER)) return [];
  const code = upCode(source);
  const problems = RULES.filter(([pattern]) => pattern.test(code)).map(([, name]) => `${file}: ${name} bez oznaczenia fazy „contract”`);
  if (kyselyNotNullColumns(code)) problems.push(`${file}: ADD COLUMN NOT NULL bez DEFAULT (Kysely) bez oznaczenia fazy „contract”`);
  return problems;
}
