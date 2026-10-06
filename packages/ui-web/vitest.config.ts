import { coverage } from '@evia/config/vitest';
import { defineConfig } from 'vitest/config';

// Component tests in jsdom with Testing Library and axe-core (EVM-008 AC3). A shared package: 90% threshold.
export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['test/**/*.test.{ts,tsx}'],
    setupFiles: ['test/setup.ts'],
    coverage: coverage({ layer: 'shared', include: ['src/**/*.{ts,tsx}'] }),
  },
});
