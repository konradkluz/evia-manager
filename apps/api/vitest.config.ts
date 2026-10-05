import { coverage } from '@evia/config/vitest';
import { defineConfig } from 'vitest/config';

// Unit and HTTP tests without a database (run everywhere, also in the backend-tests container).
// Tests that need PostgreSQL live in test/integration and run only through vitest.integration.config.ts (EVM-008).
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    exclude: ['test/integration/**'],
    setupFiles: ['test/support/setup.ts'],
    testTimeout: 20_000,
    coverage: coverage({ layer: 'backend', include: ['src/**/*.ts'] }),
  },
});
