// @ts-check
import { config, webUi } from '@evia/config/eslint';

export default [...config({ tsconfigRootDir: import.meta.dirname }), { ignores: ['playwright-report/**', 'test-results/**'] }, ...webUi()];
