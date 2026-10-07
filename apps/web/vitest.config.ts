import { coverage } from '@evia/config/vitest';
import { defineConfig } from 'vitest/config';

// Component and unit tests in jsdom (EVM-008 AC2–AC4). E2E (Playwright) lives in test/e2e and runs with `pnpm run e2e`.
export default defineConfig({
  test: {
    environment: 'jsdom',
    // Component tests render the whole panel and run axe; on the shared CI runner (many workers at once) they take several times longer than locally.
    testTimeout: 20_000,
    include: ['test/**/*.test.{ts,tsx}'],
    setupFiles: ['test/setup.ts'],
    coverage: coverage({ layer: 'web', include: ['src/**/*.{ts,tsx}', 'security-headers.ts'] }),
  },
});
