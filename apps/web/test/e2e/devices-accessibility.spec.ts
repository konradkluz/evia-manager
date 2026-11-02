import { violations } from './axe.ts';
import { expect, test } from './fixtures.ts';

// axe-core is injected as a script, which the strict CSP rightly blocks — only this spec bypasses it.
test.use({ bypassCSP: true, baseURL: 'http://localhost:4173', session: 'active' });

const WIDTHS = [360, 768, 1280, 1440];

test.describe('accessibility of W-15 Urządzenia and W-17 in the browser, with colour contrast (EVM-095; WCAG 2.2 AA)', () => {
  for (const width of WIDTHS) {
    const px = String(width);

    test(`EVM-095 AC1 AC3 W-15 the phones and the logout dialog have no axe violations at ${px} px`, async ({ page, api }) => {
      await page.setViewportSize({ width, height: 800 });
      api.role = 'editor';
      api.stepUp = 'fresh';
      await page.goto('/account');
      await expect(page.getByRole('table', { name: 'Lista moich telefonów' })).toBeVisible();
      expect(await violations(page)).toEqual([]);
      await page.getByRole('button', { name: 'Wyloguj telefon Pixel 7' }).click();
      await expect(page.getByRole('alertdialog', { name: 'Wylogować telefon „Pixel 7”?' })).toBeVisible();
      expect(await violations(page)).toEqual([]);
    });

    test(`EVM-095 AC2 AC4 W-17 the list, the menu and the wipe dialog have no axe violations at ${px} px`, async ({ page, api }) => {
      await page.setViewportSize({ width, height: 800 });
      api.stepUp = 'fresh';
      await page.goto('/administration/devices');
      await expect(page.getByRole('table', { name: 'Urządzenia użytkowników' })).toBeVisible();
      expect(await violations(page)).toEqual([]);
      await page.getByRole('button', { name: 'Akcje dla Pixel 7, Anna Testowa' }).click();
      await expect(page.getByRole('menuitem', { name: 'Zablokuj i wyczyść…' })).toBeVisible();
      expect(await violations(page)).toEqual([]);
      await page.getByRole('menuitem', { name: 'Zablokuj i wyczyść…' }).click();
      await expect(page.getByRole('alertdialog', { name: 'Zablokować i wyczyścić „Pixel 7”?' })).toBeVisible();
      expect(await violations(page)).toEqual([]);
    });

    test(`EVM-095 AC2 W-17 "Brak dostępu" of an Edytor has no axe violations at ${px} px`, async ({ page, api }) => {
      await page.setViewportSize({ width, height: 800 });
      api.role = 'editor';
      await page.goto('/administration/devices');
      await expect(page.getByRole('heading', { name: 'Nie masz dostępu do administracji.' })).toBeVisible();
      expect(await violations(page)).toEqual([]);
    });
  }
});
