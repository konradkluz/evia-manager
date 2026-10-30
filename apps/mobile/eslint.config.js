// @ts-check
import { config, mobileUi } from '@evia/config/eslint';

export default [{ ignores: ['android/**', 'ios/**', '.expo/**'] }, ...config({ tsconfigRootDir: import.meta.dirname }), ...mobileUi()];
