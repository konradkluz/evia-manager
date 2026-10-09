import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';

// E2E of the panel (EVM-008 AC4–AC6; ADR-0015): against `vite preview` of the production build — the same strict
// headers as production (security-headers.ts). The shell does not call the API, so no API or database is needed.
// Browsers: Chromium and Firefox everywhere (CI Linux: job e2e-web), Edge (`msedge`) on Windows — the evidence of
// ADR-0015. Screenshots for the UX review are a separate project (`pnpm run e2e:screenshots`), not visual assertions.
const CI = Boolean(process.env['CI']);
const PORT = 4173;
const baseURL = `http://127.0.0.1:${String(PORT)}`;
const regular = { testIgnore: /screenshots\.spec\.ts$/ };
// Screenshots for the UX review (PNG files are ignored by git).
const uxReviewDir = fileURLToPath(new URL('../../docs/ux/reviews/EVM-008/', import.meta.url));
const uxReviewDirIdentity = fileURLToPath(new URL('../../docs/ux/reviews/EVM-016/', import.meta.url));
const uxReviewDirLogin = fileURLToPath(new URL('../../docs/ux/reviews/EVM-067/', import.meta.url));
const uxReviewDirAudit = fileURLToPath(new URL('../../docs/ux/reviews/EVM-029/', import.meta.url));
const uxReviewDirWorkOrders = fileURLToPath(new URL('../../docs/ux/reviews/EVM-017/', import.meta.url));
const uxReviewDirCustomers = fileURLToPath(new URL('../../docs/ux/reviews/EVM-020/', import.meta.url));
const uxReviewDirLocations = fileURLToPath(new URL('../../docs/ux/reviews/EVM-021/', import.meta.url));

const uxReviewDirOrders = fileURLToPath(new URL('../../docs/ux/reviews/EVM-022/', import.meta.url));
const uxReviewDirDetails = fileURLToPath(new URL('../../docs/ux/reviews/EVM-018/', import.meta.url));
const uxReviewDirStatus = fileURLToPath(new URL('../../docs/ux/reviews/EVM-030/', import.meta.url));
const uxReviewDirClients = fileURLToPath(new URL('../../docs/ux/reviews/EVM-039/', import.meta.url));

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
    {
      name: 'screenshots',
      use: { ...devices['Desktop Chrome'] },
      testMatch: /screenshots\.spec\.ts$/,
      metadata: {
        uxReviewDir,
        uxReviewDirIdentity,
        uxReviewDirLogin,
        uxReviewDirAudit,
        uxReviewDirWorkOrders,
        uxReviewDirCustomers,
        uxReviewDirLocations,
        uxReviewDirOrders,
        uxReviewDirDetails,
        uxReviewDirStatus,
        uxReviewDirClients,
      },
    },
  ],
});
