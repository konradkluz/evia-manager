import { describe, expect, it } from 'vitest';
import { config } from '../src/eslint.ts';

const rules = (entries: ReturnType<typeof config>): Record<string, unknown> =>
  Object.fromEntries(entries.flatMap((entry) => Object.entries(entry.rules ?? {})));

describe('ESLint flat config (EVM-006 AC2)', () => {
  const entries = config({ tsconfigRootDir: '/repo/packages/x' });

  it('EVM-006 AC2: type-aware strict rules with explicit any as an error', () => {
    const all = rules(entries);
    expect(all['@typescript-eslint/no-explicit-any']).toBe('error');
    expect(all['@typescript-eslint/no-floating-promises']).toEqual([
      'error',
      { allowForKnownSafeCalls: [{ from: 'package', package: 'node:test', name: ['describe', 'it', 'suite', 'test'] }] },
    ]);
    expect(all['no-eval']).toBe('error');
    expect(all['@typescript-eslint/no-extraneous-class']).toEqual(['error', { allowWithDecorator: true }]);
  });

  it('EVM-006 AC2: the project service is rooted in the workspace directory', () => {
    const withParser = entries.find((entry) => entry.languageOptions?.parserOptions?.['projectService']);
    expect(withParser?.languageOptions?.parserOptions).toMatchObject({ projectService: true, tsconfigRootDir: '/repo/packages/x' });
  });

  it('EVM-006 AC2: build output, generated code (EVM-008 contract client), coverage and dependencies are never linted; extra ignores are appended', () => {
    const ignored = config({ tsconfigRootDir: '/r', ignores: ['legacy/**'] })[0]?.ignores;
    expect(ignored).toEqual(['dist/**', '.dev-build/**', 'coverage/**', 'node_modules/**', 'generated/**', 'legacy/**']);
  });
});
