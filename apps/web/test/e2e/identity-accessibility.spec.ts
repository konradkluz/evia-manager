import { violations } from './axe.ts';
import { expect, test } from './fixtures.ts';
import { DISPLAY_NAME, VALID_TOKEN } from './mock-api.ts';

// axe-core is injected as a script, which the strict CSP rightly blocks — only this spec bypasses it.
test.use({ bypassCSP: true, session: 'none' });

const WIDTHS = [360, 768, 1280, 1440];

test.describe('accessibility of W-13, W-03 and the account menu in the browser, with colour contrast (EVM-016; WCAG 2.2 AA)', () => {
  for (const width of WIDTHS) {
    test(`EVM-016 AC3 W-13 (form, loading error and invalid link) has no axe violations at ${String(width)} px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.goto(`/activate#${VALID_TOKEN}`);
      await expect(page.getByLabel('Nowe hasło')).toBeVisible();
      expect(await violations(page)).toEqual([]);

      await page.getByLabel('Nowe hasło').fill('za krótkie');
      await page.getByRole('button', { name: 'Ustaw hasło' }).click();
      await expect(page.getByRole('alert')).toBeVisible();
      expect(await violations(page)).toEqual([]);

      await page.goto('/activate');
      await expect(page.getByRole('heading', { level: 1, name: 'Link jest nieważny lub wygasł.' })).toBeVisible();
      expect(await violations(page)).toEqual([]);
    });

    test(`EVM-016 AC4 W-03 with its error has no axe violations at ${String(width)} px`, async ({ page, api }) => {
      api.session = 'enrollment';
      api.failNext.set('POST /api/v1/account/passkeys/registration-options', { status: 429, code: 'rate_limited' });
      await page.setViewportSize({ width, height: 800 });
      await page.goto('/mfa-setup');
      await expect(page.getByRole('heading', { level: 1, name: 'Skonfiguruj drugi krok logowania' })).toBeVisible();
      expect(await violations(page)).toEqual([]);
      await page.getByRole('button', { name: 'Dodaj klucz dostępu' }).click();
      await expect(page.getByRole('alert')).toBeVisible();
      expect(await violations(page)).toEqual([]);
    });

    test(`EVM-016 AC6 the shell with the account menu open has no axe violations at ${String(width)} px`, async ({ page, api }) => {
      api.session = 'active';
      await page.setViewportSize({ width, height: 800 });
      await page.goto('/work-orders');
      await page.getByRole('button', { name: `Konto: ${DISPLAY_NAME}` }).click();
      await expect(page.getByRole('menuitem', { name: 'Wyloguj' })).toBeVisible();
      expect(await violations(page)).toEqual([]);
    });
  }
});
