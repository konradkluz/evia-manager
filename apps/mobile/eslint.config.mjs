// @ts-check
import { config, mobileUi } from '@evia/config/eslint';

export default [...config({ tsconfigRootDir: import.meta.dirname, ignores: ['android/**', 'ios/**', '.expo/**'] }), ...mobileUi()];
