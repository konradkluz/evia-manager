// @ts-check
import { config, mobileUi } from '@evia/config/eslint';

export default [
  { ignores: ['android/**', 'ios/**', '.expo/**', 'modules/**/build/**', 'modules/**/.gradle/**'] },
  ...config({ tsconfigRootDir: import.meta.dirname }),
  ...mobileUi(),
];
