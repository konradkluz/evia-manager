import { coverage } from '@evia/config/vitest';
import { defineConfig } from 'vitest/config';

// The processor parses hostile files (SR-FILE-06): the shared layer threshold and changed-code coverage apply.
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    testTimeout: 30_000,
    coverage: coverage({ layer: 'shared', include: ['src/**/*.ts'] }),
  },
});
