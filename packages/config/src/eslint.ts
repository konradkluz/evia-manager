/**
 * Shared ESLint flat config (ADR-0012): type-aware strict rules for TypeScript and checked JavaScript, and the SQL
 * concatenation ban (EVM-008; SR-INPUT-03, ADR-0003). UI token rules arrive with the first UI code (EVM-008, web).
 */
import js from '@eslint/js';
import type { Linter } from 'eslint';
import globals from 'globals';
import tseslint, { type ConfigArray } from 'typescript-eslint';

/** The only place allowed to import the PostgreSQL driver (pool, timeouts, Kysely dialect). */
export const DATABASE_DRIVER_FILES = ['src/platform/database/**'];

const SQL_MESSAGE = 'SR-INPUT-03: SQL only through the Kysely builder or the sql`` template with parameters (ADR-0003).';

/**
 * SQL safety (SR-INPUT-03; ASVS V1.2.4; CWE-89): no raw SQL builders, no dynamic identifiers, no direct driver use.
 * There is no exception for migrations — they use the sql`` template too.
 */
export function sqlSafety(): Linter.Config[] {
  return [
    {
      rules: {
        'no-restricted-syntax': [
          'error',
          { selector: "CallExpression[callee.object.name='sql'][callee.property.name=/^(raw|lit)$/]", message: SQL_MESSAGE },
          { selector: "MemberExpression[object.name='CompiledQuery'][property.name='raw']", message: SQL_MESSAGE },
          {
            selector: "CallExpression[callee.object.name='sql'][callee.property.name=/^(ref|id|table)$/] > :not(Literal).arguments",
            message: `${SQL_MESSAGE} Identifiers must be string literals (allow-list dynamic sort fields first).`,
          },
        ],
        'no-restricted-imports': [
          'error',
          {
            paths: [
              { name: 'pg', message: `${SQL_MESSAGE} The pg driver belongs to src/platform/database.` },
              { name: 'pg-pool', message: `${SQL_MESSAGE} The pg driver belongs to src/platform/database.` },
            ],
          },
        ],
      },
    },
    { files: DATABASE_DRIVER_FILES, rules: { 'no-restricted-imports': 'off' } },
  ];
}

export function config({ tsconfigRootDir, ignores = [] }: { tsconfigRootDir: string; ignores?: string[] }): ConfigArray {
  return [
    { ignores: ['dist/**', 'coverage/**', 'node_modules/**', 'generated/**', ...ignores] },
    js.configs.recommended,
    ...tseslint.configs.strictTypeChecked,
    {
      languageOptions: {
        globals: { ...globals.node },
        parserOptions: { projectService: true, tsconfigRootDir },
      },
      linterOptions: { reportUnusedDisableDirectives: 'error' },
      rules: {
        '@typescript-eslint/no-explicit-any': 'error',
        'no-eval': 'error',
        'no-implied-eval': 'off',
        '@typescript-eslint/no-implied-eval': 'error',
        'no-new-func': 'error',
        // node:test suites and tests return promises that the runner awaits itself.
        '@typescript-eslint/no-floating-promises': [
          'error',
          { allowForKnownSafeCalls: [{ from: 'package', package: 'node:test', name: ['describe', 'it', 'suite', 'test'] }] },
        ],
        '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
        // NestJS modules are classes that exist for their decorator (@Module) — EVM-008.
        '@typescript-eslint/no-extraneous-class': ['error', { allowWithDecorator: true }],
      },
    },
    ...sqlSafety(),
  ];
}
