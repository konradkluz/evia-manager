import { defineConfig } from 'vitest/config';
import { coverage } from './src/vitest.ts';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    coverage: coverage({ layer: 'shared', include: ['src/**/*.ts'] }),
  },
});
