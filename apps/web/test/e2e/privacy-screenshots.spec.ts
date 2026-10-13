import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test as base } from './fixtures.ts';
import { DISPLAY_NAME } from './mock-api.ts';

// Screenshots for the UX review of EVM-063 (styleguide § 7.2 pkt 3) — evidence, not visual assertions (ADR-0015).
// Target: docs/ux/reviews/EVM-063 (PNG ignored by git); run: pnpm --filter @evia/web run e2e:screenshots
const test = base.extend<{ shot: (name: string) => Promise<void> }>({
  shot: async ({ page }, use, testInfo) => {
    const dir = String(testInfo.project.metadata['uxReviewDirPrivacy']);
    mkdirSync(dir, { recursive: true });
    await use(async (name) => {
      await page.screenshot({ path: join(dir, `${name}.png`), fullPage: true });
    });
  },
});

const WIDTHS = [360, 768, 1280, 1440];

test.describe('UX review screenshots (EVM-063) @screenshots', () => {
  for (const width of WIDTHS) {
    const px = String(width);

    test(`EVM-063 W-01 footer, W-19 before logging in and in the panel at ${px} px`, async ({ page, api, shot }) => {
      api.session = 'none';
      await page.setViewportSize({ width, height: 800 });
      await page.goto('/login');
      await expect(page.getByRole('navigation', { name: 'Prywatność i pomoc' })).toBeVisible();
      await shot(`w01-footer-${px}`);
      await page.getByRole('link', { name: 'Prywatność' }).click();
      await expect(page.getByRole('heading', { level: 2, name: 'Prywatność' })).toBeFocused();
      await shot(`w19-public-${px}`);
      for (const toggle of await page.getByRole('button', { name: /^Klauzula/ }).all()) await toggle.click();
      await shot(`w19-public-clauses-open-${px}`);

      api.session = 'active';
      await page.goto('/work-orders');
      await page.getByRole('button', { name: `Konto: ${DISPLAY_NAME}` }).click();
      await shot(`account-menu-${px}`);
      await page.getByRole('menuitem', { name: 'Prywatność i pomoc' }).click();
      await expect(page.getByRole('heading', { level: 2, name: 'Pomoc' })).toBeVisible();
      await shot(`w19-panel-${px}`);
    });

    test(`EVM-063 W-19 offline, content not loaded, at ${px} px`, async ({ page, api, context, shot }) => {
      api.session = 'none';
      await page.setViewportSize({ width, height: 800 });
      await page.goto('/login');
      await context.setOffline(true);
      await page.getByRole('link', { name: 'Pomoc' }).click();
      await expect(page.getByRole('heading', { level: 2, name: 'Treść wymaga połączenia.' })).toBeVisible();
      await shot(`w19-offline-${px}`);
    });
  }
});
