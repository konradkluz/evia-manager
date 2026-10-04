import { coverage } from '@evia/config/vitest';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    testTimeout: 30_000,
    coverage: coverage({ layer: 'shared', include: ['src/**/*.ts'] }),
  },
});
