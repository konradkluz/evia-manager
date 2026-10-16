import { coverage } from '@evia/config/vitest';
import { defineConfig } from 'vitest/config';

// Component and unit tests in jsdom (EVM-008 AC2–AC4). E2E (Playwright) lives in test/e2e and runs with `pnpm run e2e`.
export default defineConfig({
  test: {
    environment: 'jsdom',
    // EVM-081 AC3: kept at 20 s after moving the tests to userEvent without delay (test/user.ts). Measured locally in a full parallel run the slowest test takes about 5 s (payments, party and location dialogs with axe), and the shared CI runner is several times slower, so a lower limit would leave no margin. Fake-timer tests (EVM-017 AC8, 10 000 ms) advance virtual time and are not affected by this limit.
    // Component tests render the whole panel and run axe; on the shared CI runner (many workers at once) they take several times longer than locally.
    testTimeout: 20_000,
    include: ['test/**/*.test.{ts,tsx}'],
    setupFiles: ['test/setup.ts'],
    coverage: coverage({ layer: 'web', include: ['src/**/*.{ts,tsx}', 'security-headers.ts'] }),
  },
});
