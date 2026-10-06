import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';

// E2E of the panel (EVM-008 AC4–AC6; ADR-0015): against `vite preview` of the production build — the same strict
// headers as production (security-headers.ts). The shell does not call the API, so no API or database is needed.
// Browsers: Chromium and Firefox everywhere (CI Linux: job e2e-web), Edge (`msedge`) on Windows — the evidence of
// ADR-0015. Screenshots for the UX review are a separate project (`pnpm run e2e:screenshots`), not visual assertions.
const CI = Boolean(process.env['CI']);
const PORT = 4173;
const baseURL = `http://localhost:${String(PORT)}`;
const regular = { testIgnore: /screenshots\.spec\.ts$/ };
// Screenshots for the UX review (PNG files are ignored by git).
const uxReviewDir = fileURLToPath(new URL('../../docs/ux/reviews/EVM-008/', import.meta.url));

export default defineConfig({
  testDir: 'test/e2e',
  fullyParallel: true,
  forbidOnly: CI,
  // One retry on CI only: Firefox on the runner sometimes hangs a navigation (page.goto 30 s); traces are kept.
  retries: CI ? 1 : 0,
  reporter: CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  use: { baseURL, trace: 'retain-on-failure' },
  webServer: { command: 'pnpm run build && pnpm run preview', url: baseURL, reuseExistingServer: !CI, timeout: 120_000 },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] }, ...regular },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] }, ...regular },
    ...(process.platform === 'win32' ? [{ name: 'msedge', use: { ...devices['Desktop Edge'], channel: 'msedge' }, ...regular }] : []),
    { name: 'screenshots', use: { ...devices['Desktop Chrome'] }, testMatch: /screenshots\.spec\.ts$/, metadata: { uxReviewDir } },
  ],
});
