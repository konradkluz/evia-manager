/**
 * Shared ESLint flat config (ADR-0012): type-aware strict rules for TypeScript and checked JavaScript, the SQL
 * concatenation ban (EVM-008; SR-INPUT-03, ADR-0003) and the web UI rules (EVM-008; styleguide § 7.2, SR-WEB-03).
 */
import js from '@eslint/js';
import type { Linter } from 'eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint, { type ConfigArray } from 'typescript-eslint';

/** The only place allowed to import the PostgreSQL driver (pool, timeouts, Kysely dialect). */
export const DATABASE_DRIVER_FILES = ['src/platform/database/**'];

const SQL_MESSAGE = 'SR-INPUT-03: SQL only through the Kysely builder or the sql`` template with parameters (ADR-0003).';

/**
 * SQL safety (SR-INPUT-03; ASVS V1.2.4; CWE-89): no raw SQL builders, no dynamic identifiers, no direct driver use.
 * There is no exception for migrations — they use the sql`` template too.
 */
const SQL_SELECTORS = [
  { selector: "CallExpression[callee.object.name='sql'][callee.property.name=/^(raw|lit)$/]", message: SQL_MESSAGE },
  { selector: "MemberExpression[object.name='CompiledQuery'][property.name='raw']", message: SQL_MESSAGE },
  {
    selector: "CallExpression[callee.object.name='sql'][callee.property.name=/^(ref|id|table)$/] > :not(Literal).arguments",
    message: `${SQL_MESSAGE} Identifiers must be string literals (allow-list dynamic sort fields first).`,
  },
];

export function sqlSafety(): Linter.Config[] {
  return [
    {
      rules: {
        'no-restricted-syntax': ['error', ...SQL_SELECTORS],
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

/** Sources of a web UI workspace (apps/web, packages/ui-web) covered by webUi(). */
export const WEB_UI_FILES = ['src/**/*.ts', 'src/**/*.tsx'];

const TOKENS_MESSAGE = 'Styleguide § 7.2: styles only through design tokens (Tailwind theme of @evia/ui-web), no literal values.';
const I18N_MESSAGE = 'Styleguide § 6, AC3: UI text only through i18n (t(...) with the pl catalogue), never literal text.';
/** Tailwind arbitrary values (`p-[13px]`, `bg-(--x)`, `w-[${a}]`) — they bypass the token theme. */
const ARBITRARY = String.raw`/(^|[\s:])!?-?[a-z][\w-]*-[\[(]/`;
const LITERAL_COLOUR = String.raw`/#[0-9a-fA-F]{3,8}\b|\b(rgba?|hsla?|oklch|oklab|lab|lch|color)\(/`;
const LITERAL_LENGTH = String.raw`/\b\d+(\.\d+)?(px|rem|em|vh|vw|pt)\b/`;

/**
 * Web UI rules (EVM-008 AC3, AC4): no raw HTML from data (SR-WEB-03), no inline styles, arbitrary Tailwind values or
 * literal colours and lengths (styleguide § 7.2), no literal UI text (i18n), rules of hooks. One `no-restricted-syntax`
 * list together with the SQL selectors (a later block replaces the options of the same rule).
 */
export function webUi({ files = WEB_UI_FILES }: { files?: string[] } = {}): Linter.Config[] {
  return [
    {
      files,
      languageOptions: { globals: { ...globals.browser } },
      plugins: { 'react-hooks': reactHooks as unknown as NonNullable<Linter.Config['plugins']>[string] },
      rules: {
        'react-hooks/rules-of-hooks': 'error',
        'react-hooks/exhaustive-deps': 'error',
        'no-restricted-syntax': [
          'error',
          ...SQL_SELECTORS,
          {
            selector: "JSXAttribute[name.name='dangerouslySetInnerHTML']",
            message: 'SR-WEB-03: no raw HTML in the UI — render text through React (escaped).',
          },
          { selector: "JSXAttribute[name.name='style']", message: TOKENS_MESSAGE },
          { selector: `Literal[value=${ARBITRARY}]`, message: TOKENS_MESSAGE },
          { selector: `TemplateElement[value.raw=${ARBITRARY}]`, message: TOKENS_MESSAGE },
          { selector: `Literal[value=${LITERAL_COLOUR}]`, message: TOKENS_MESSAGE },
          { selector: `Literal[value=${LITERAL_LENGTH}]`, message: TOKENS_MESSAGE },
          { selector: String.raw`JSXText[value=/\S/]`, message: I18N_MESSAGE },
          {
            selector:
              'JSXAttribute[name.name=/^(aria-label|aria-description|aria-roledescription|title|alt|placeholder|label)$/] > Literal',
            message: I18N_MESSAGE,
          },
        ],
      },
    },
  ];
}

export function config({ tsconfigRootDir, ignores = [] }: { tsconfigRootDir: string; ignores?: string[] }): ConfigArray {
  return [
    { ignores: ['dist/**', '.dev-build/**', 'coverage/**', 'node_modules/**', 'generated/**', ...ignores] },
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
