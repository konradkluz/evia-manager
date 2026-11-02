import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test as base } from './fixtures.ts';

// Screenshots for the UX review of EVM-095 (styleguide § 7.2 pkt 3) — evidence, not visual assertions (ADR-0015).
// Target: docs/ux/reviews/EVM-095 (PNG ignored by git); run: pnpm --filter @evia/web run e2e:screenshots
const test = base.extend<{ shot: (name: string) => Promise<void> }>({
  shot: async ({ page }, use, testInfo) => {
    const dir = String(testInfo.project.metadata['uxReviewDirDevices']);
    mkdirSync(dir, { recursive: true });
    await use(async (name) => {
      await page.screenshot({ path: join(dir, `${name}.png`), fullPage: true });
    });
  },
});

test.use({ session: 'active' });

const WIDTHS = [360, 768, 1280, 1440];

test.describe('UX review screenshots (EVM-095) @screenshots', () => {
  for (const width of WIDTHS) {
    const px = String(width);

    test(`EVM-095 W-15 the phones and the logout dialog at ${px} px`, async ({ page, api, shot }) => {
      await page.setViewportSize({ width, height: 800 });
      api.role = 'editor';
      api.stepUp = 'fresh';
      await page.goto('/account');
      await expect(page.getByRole('table', { name: 'Lista moich telefonów' })).toBeVisible();
      await shot(`w15-devices-${px}`);
      await page.getByRole('button', { name: 'Wyloguj telefon Pixel 7' }).click();
      await expect(page.getByRole('alertdialog', { name: 'Wylogować telefon „Pixel 7”?' })).toBeVisible();
      await shot(`w15-logout-dialog-${px}`);
    });

    test(`EVM-095 W-17 the list, the menu, the wipe dialog and the denied state at ${px} px`, async ({ page, api, shot }) => {
      await page.setViewportSize({ width, height: 800 });
      api.stepUp = 'fresh';
      await page.goto('/administration/devices');
      await expect(page.getByRole('table', { name: 'Urządzenia użytkowników' })).toBeVisible();
      await shot(`w17-list-${px}`);
      await page.getByRole('button', { name: 'Akcje dla Pixel 7, Anna Testowa' }).click();
      await expect(page.getByRole('menuitem', { name: 'Zablokuj i wyczyść…' })).toBeVisible();
      await shot(`w17-menu-${px}`);
      await page.getByRole('menuitem', { name: 'Zablokuj i wyczyść…' }).click();
      await expect(page.getByRole('alertdialog', { name: 'Zablokować i wyczyścić „Pixel 7”?' })).toBeVisible();
      await shot(`w17-wipe-dialog-${px}`);
      await page.getByRole('button', { name: 'Anuluj' }).click();
      api.role = 'editor';
      await page.goto('/administration/devices');
      await expect(page.getByRole('heading', { name: 'Nie masz dostępu do administracji.' })).toBeVisible();
      await shot(`w17-denied-${px}`);
    });
  }
});
