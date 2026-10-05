import { coverageExclusions } from '@evia/config/coverage-exclusions';
import { defineConfig } from 'vitest/config';

// Integration tests with PostgreSQL (EVM-008 AC1): Testcontainers, or the database from EVIA_TEST_DATABASE_URL
// (compose service `postgres`). CI job backend-integration; the lcov report (paths relative to the repository root)
// is merged by the coverage job into the changed-code gate. No thresholds here — the unit run enforces them.
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
      include: ['src/**/*.ts'],
      exclude: coverageExclusions(),
    },
  },
});
