import { coverage } from '@evia/config/vitest';
import { defineConfig } from 'vitest/config';
import { DATABASE_BOUND } from './coverage.config.ts';

// Unit and HTTP tests without a database (run everywhere, also in the backend-tests container).
// Tests that need PostgreSQL live in test/integration and run only through vitest.integration.config.ts (EVM-008).
// The code that is only meaningful against PostgreSQL is measured by that run instead (coverage.config.ts, EVM-016).
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    exclude: ['test/integration/**'],
    setupFiles: ['test/support/setup.ts'],
    testTimeout: 20_000,
    coverage: coverage({ layer: 'backend', include: ['src/**/*.ts', 'dev/**/*.ts'], exclude: [...DATABASE_BOUND] }),
  },
});
