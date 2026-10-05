// @ts-check
import { config } from '@evia/config/eslint';

export default [
  ...config({ tsconfigRootDir: import.meta.dirname }),
  {
    // EVM-006: rules this EVM-012 tool cannot meet without changing its logic (untyped JSON and test helpers,
    // Polish non-breaking spaces in fixtures). EVM-073 lifts these exceptions; the tool stays JavaScript with node:test.
    // tools/repo-policy lists this workspace as the only one allowed to relax shared checks.
    rules: {
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unnecessary-type-conversion': 'off',
      '@typescript-eslint/no-unnecessary-condition': 'off',
      '@typescript-eslint/no-confusing-void-expression': 'off',
      '@typescript-eslint/no-dynamic-delete': 'off',
      'no-irregular-whitespace': 'off',
    },
  },
];
