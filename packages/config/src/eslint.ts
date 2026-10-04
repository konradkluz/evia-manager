/**
 * Shared ESLint flat config (ADR-0012): type-aware strict rules for TypeScript and checked JavaScript.
 * UI token rules and the SQL concatenation ban arrive with the first UI and Kysely code (EVM-008).
 */
import js from '@eslint/js';
import globals from 'globals';
import tseslint, { type ConfigArray } from 'typescript-eslint';

export function config({ tsconfigRootDir, ignores = [] }: { tsconfigRootDir: string; ignores?: string[] }): ConfigArray {
  return [
    { ignores: ['dist/**', 'coverage/**', 'node_modules/**', ...ignores] },
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
      },
    },
  ];
}
