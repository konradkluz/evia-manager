import { COVERAGE_THRESHOLDS } from '@evia/config/vitest';
import { defineConfig } from 'vitest/config';
import { DATABASE_BOUND } from './coverage-layout.ts';

// Integration tests with PostgreSQL (EVM-008 AC1): Testcontainers, or the database from EVIA_TEST_DATABASE_URL
// (compose service `postgres`). CI job backend-integration; the lcov report (paths relative to the repository root)
// is merged by the coverage job into the changed-code gate. This run measures the database-bound code of the API
// (coverage-layout.ts) against the backend threshold; the unit run measures everything else (EVM-016).
export default defineConfig({
  test: {
    include: ['test/integration/**/*.test.ts'],
    setupFiles: ['test/support/setup.ts'],
    globalSetup: ['test/integration/global-setup.ts'],
    testTimeout: 120_000,
    hookTimeout: 180_000,
    fileParallelism: false,
    coverage: {
      enabled: true,
      provider: 'v8',
      reporter: ['text', ['lcov', { projectRoot: '../..' }]],
      reportsDirectory: 'coverage/integration',
      include: [...DATABASE_BOUND],
      thresholds: { lines: COVERAGE_THRESHOLDS.backend, branches: COVERAGE_THRESHOLDS.backend },
    },
  },
});
