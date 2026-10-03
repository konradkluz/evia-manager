// @ts-check
import { defineConfig } from 'vitest/config';
import { coverage } from './src/vitest.js';

export default defineConfig({
  test: {
    include: ['test/**/*.test.js'],
    coverage: coverage({ layer: 'shared', include: ['src/**/*.js'] }),
  },
});
